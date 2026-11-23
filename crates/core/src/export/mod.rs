//! Export: model JSON -> new PDF (SPEC 7).

pub mod annot;
pub mod appearance;
pub mod assemble;
pub mod bake;
pub mod image;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use lopdf::{Document, ObjectId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{CoreError, Result};
use crate::font::{FontSet, TextRun};
use crate::model::{self, PageObject};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "ExportOptions.ts")]
pub struct ExportOptions {
    /// Bake every object into page content instead of writing annotations (SPEC 6.9).
    pub flatten: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "ExportWarning.ts")]
pub struct ExportWarning {
    pub code: String,
    pub message: String,
    /// Characters missing from the bundled font, for `missing_glyphs`.
    pub chars: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "ExportSummary.ts")]
pub struct ExportSummary {
    pub page_count: u32,
    #[ts(type = "number")]
    pub bytes: u64,
    pub warnings: Vec<ExportWarning>,
}

/// Everything export needs besides the model.
#[derive(Debug, Clone, Default)]
pub struct ExportContext {
    /// Passwords of encrypted sources, by source id. Kept in memory only.
    pub passwords: HashMap<String, String>,
    /// Folder holding `<signatureId>.png`.
    pub signature_dir: Option<PathBuf>,
    pub options: ExportOptions,
}

/// Builds the output PDF in memory.
pub fn export_to_bytes(
    model: &model::Document,
    ctx: &ExportContext,
) -> Result<(Vec<u8>, Vec<ExportWarning>)> {
    let sources = assemble::load_sources(model, &ctx.passwords)?;
    let assembled = assemble::assemble(model, sources)?;
    let mut doc = assembled.doc;
    let warnings = write_objects(&mut doc, model, &assembled.page_ids, ctx)?;

    doc.prune_objects();
    doc.compress();
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes)?;
    Ok((bytes, warnings))
}

/// Builds the output PDF and writes it to `out` safely (SPEC 7.8).
pub fn export_to_file(
    model: &model::Document,
    ctx: &ExportContext,
    out: &Path,
) -> Result<ExportSummary> {
    crate::write::ensure_not_source(out, model.sources.iter().map(|s| Path::new(&s.path)))?;
    let (bytes, warnings) = export_to_bytes(model, ctx)?;
    crate::write::write_atomic(out, &bytes)?;
    Ok(ExportSummary {
        page_count: model.pages.len() as u32,
        bytes: bytes.len() as u64,
        warnings,
    })
}

/// Signature ids become file names; allow only a safe alphabet.
fn signature_path(ctx: &ExportContext, signature_id: &str) -> Result<PathBuf> {
    let ok = !signature_id.is_empty()
        && signature_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err(CoreError::InvalidModel(format!(
            "invalid signature id {signature_id:?}"
        )));
    }
    let dir = ctx.signature_dir.as_ref().ok_or_else(|| {
        CoreError::InvalidModel("the document has signatures but no signature folder".into())
    })?;
    Ok(dir.join(format!("{signature_id}.png")))
}

/// Adds every page object as an annotation or baked content (SPEC 7.3–7.6).
fn write_objects(
    doc: &mut Document,
    model: &model::Document,
    page_ids: &[ObjectId],
    ctx: &ExportContext,
) -> Result<Vec<ExportWarning>> {
    // Pass 1: encode all text so the font subset is written once and shared (SPEC 7.6).
    let mut font: Option<FontSet> = None;
    let mut encoded: HashMap<(usize, usize), Vec<Vec<TextRun>>> = HashMap::new();
    for (pi, page) in model.pages.iter().enumerate() {
        for (oi, obj) in page.objects.iter().enumerate() {
            if let PageObject::Text(t) = obj {
                if font.is_none() {
                    font = Some(FontSet::bundled()?);
                }
                if let Some(f) = font.as_mut() {
                    encoded.insert((pi, oi), t.lines.iter().map(|l| f.encode_line(l)).collect());
                }
            }
        }
    }
    let (font_ids, metrics, missing) = match &font {
        Some(f) => (Some(f.write(doc)?), Some(f.metrics()), f.missing_chars()),
        None => (None, None, Default::default()),
    };

    // Pass 2: appearances, annotations and baking.
    let date = annot::pdf_date_now();
    let mut signature_images: HashMap<String, ObjectId> = HashMap::new();
    for (pi, page) in model.pages.iter().enumerate() {
        let page_id = page_ids[pi];
        let mut annots = Vec::new();
        let mut baked = Vec::new();
        for (oi, obj) in page.objects.iter().enumerate() {
            let ap = match obj {
                PageObject::Highlight(h) => appearance::highlight(h),
                PageObject::Rect(s) => appearance::rect(s),
                PageObject::Ellipse(s) => appearance::ellipse(s),
                PageObject::Line(l) => appearance::line(l),
                PageObject::Text(t) => {
                    let (Some(ids), Some(m)) = (&font_ids, metrics) else {
                        return Err(CoreError::Font("font missing".into()));
                    };
                    appearance::text(t, &encoded[&(pi, oi)], ids, m)
                }
                PageObject::Signature(s) => {
                    let img = match signature_images.get(&s.signature_id) {
                        Some(id) => *id,
                        None => {
                            let path = signature_path(ctx, &s.signature_id)?;
                            let bytes = std::fs::read(&path).map_err(|e| match e.kind() {
                                std::io::ErrorKind::NotFound => {
                                    CoreError::SignatureMissing(s.signature_id.clone())
                                }
                                _ => CoreError::Io(e),
                            })?;
                            let id = image::embed_image(doc, &bytes)?.id;
                            signature_images.insert(s.signature_id.clone(), id);
                            id
                        }
                    };
                    appearance::signature(s, img)
                }
            };
            let bbox = ap.bbox;
            let ap_id = doc.add_object(ap.stream);
            let bake_it = ctx.options.flatten || matches!(obj, PageObject::Signature(_));
            if bake_it {
                baked.push(ap_id);
            } else {
                let dict = annot::annotation(obj, page_id, ap_id, &bbox, &date)?;
                annots.push(doc.add_object(dict));
            }
        }
        bake::bake(doc, page_id, &baked)?;
        if !annots.is_empty() {
            annot::append_annots(doc, page_id, &annots)?;
        }
    }

    let mut warnings = Vec::new();
    if !missing.is_empty() {
        let chars: Vec<String> = missing.iter().map(|c| c.to_string()).collect();
        warnings.push(ExportWarning {
            code: "missing_glyphs".into(),
            message: format!("the bundled font has no glyph for: {}", chars.join(" ")),
            chars,
        });
    }
    Ok(warnings)
}
