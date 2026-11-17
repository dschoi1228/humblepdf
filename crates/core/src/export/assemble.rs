//! Document assembly (SPEC 7.1): base document, copying pages from other sources,
//! image pages, rebuilt page tree, rotation and producer.

use std::collections::{BTreeMap, HashMap, HashSet};

use lopdf::{Dictionary, Document, Object, ObjectId, Stream, dictionary};

use crate::error::{CoreError, Result};
use crate::export::image::{EmbeddedImage, cm, embed_image, orientation_matrix};
use crate::model::{self, ImageFit, Rect, SourceKind};
use crate::pdf_util::{self, INHERITABLE, LETTER_MEDIABOX, rect_to_object};
use crate::source::{ImageInfo, inspect_bytes};

/// A source loaded for export.
pub enum LoadedSource {
    Pdf(Box<Document>),
    Image { bytes: Vec<u8>, info: ImageInfo },
}

pub struct Assembled {
    pub doc: Document,
    /// Output page object ids, in model order.
    pub page_ids: Vec<ObjectId>,
}

/// Tolerance when comparing the model's box with the one recomputed from the source.
const BOX_TOLERANCE: f64 = 1e-3;

fn same_rect(a: &Rect, b: &Rect) -> bool {
    (a.x0 - b.x0).abs() <= BOX_TOLERANCE
        && (a.y0 - b.y0).abs() <= BOX_TOLERANCE
        && (a.x1 - b.x1).abs() <= BOX_TOLERANCE
        && (a.y1 - b.y1).abs() <= BOX_TOLERANCE
}

/// Returns the raw (unresolved) value of an attribute found on the page or an ancestor.
fn inherited_raw(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut current = doc.get_dictionary(page_id).ok()?;
    for _ in 0..64 {
        if let Ok(v) = current.get(key) {
            return Some(v.clone());
        }
        let parent = current.get(b"Parent").ok()?.as_reference().ok()?;
        current = doc.get_dictionary(parent).ok()?;
    }
    None
}

/// Writes inherited attributes directly onto each page (SPEC 7.1) so pages can be
/// moved to a new page tree.
pub fn materialize_inherited(doc: &mut Document) -> Result<()> {
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for page_id in page_ids {
        let mut updates = Vec::new();
        for key in INHERITABLE {
            let has = doc.get_dictionary(page_id)?.has(key);
            if !has && let Some(v) = inherited_raw(doc, page_id, key) {
                updates.push((key, v));
            }
        }
        let page = doc.get_dictionary_mut(page_id)?;
        for (k, v) in updates {
            page.set(k, v);
        }
        if !page.has(b"MediaBox") {
            page.set("MediaBox", rect_to_object(&LETTER_MEDIABOX));
        }
        if !page.has(b"Resources") {
            page.set("Resources", Dictionary::new());
        }
    }
    Ok(())
}

/// Loads every source referenced by the model.
pub fn load_sources(
    model: &model::Document,
    passwords: &HashMap<String, String>,
) -> Result<HashMap<String, LoadedSource>> {
    let used: HashSet<&str> = model.pages.iter().map(|p| p.source_id.as_str()).collect();
    let mut out = HashMap::new();
    for s in &model.sources {
        if !used.contains(s.id.as_str()) {
            continue;
        }
        let bytes = std::fs::read(&s.path)?;
        let password = passwords.get(&s.id).map(String::as_str);
        let loaded = match s.kind {
            SourceKind::Pdf => {
                LoadedSource::Pdf(Box::new(crate::source::load_pdf(&bytes, password)?))
            }
            SourceKind::Image => {
                let info = inspect_bytes(&bytes, None)?
                    .image
                    .ok_or_else(|| CoreError::InvalidModel(format!("{} is not an image", s.id)))?;
                LoadedSource::Image { bytes, info }
            }
        };
        out.insert(s.id.clone(), loaded);
    }
    Ok(out)
}

fn validate(model: &model::Document) -> Result<HashMap<&str, SourceKind>> {
    if model.schema_version != model::SCHEMA_VERSION {
        return Err(CoreError::InvalidModel(format!(
            "unsupported schemaVersion {}",
            model.schema_version
        )));
    }
    if model.pages.is_empty() {
        return Err(CoreError::InvalidModel("the document has no pages".into()));
    }
    let kinds: HashMap<&str, SourceKind> = model
        .sources
        .iter()
        .map(|s| (s.id.as_str(), s.kind))
        .collect();
    let mut seen = HashSet::new();
    for p in &model.pages {
        let kind = kinds.get(p.source_id.as_str()).ok_or_else(|| {
            CoreError::InvalidModel(format!("page {} uses unknown source {}", p.id, p.source_id))
        })?;
        if !seen.insert((p.source_id.as_str(), p.page_index)) {
            return Err(CoreError::InvalidModel(format!(
                "source page {}#{} appears twice",
                p.source_id, p.page_index
            )));
        }
        if *kind == SourceKind::Image && (p.image_fit.is_none() || p.page_index != 0) {
            return Err(CoreError::InvalidModel(format!(
                "image page {} needs imageFit and pageIndex 0",
                p.id
            )));
        }
    }
    validate_objects(model)?;
    Ok(kinds)
}

/// Object values the export relies on (M3). The editor never makes other values; this
/// guards models from other writers, such as the CLI's JSON input.
fn validate_objects(model: &model::Document) -> Result<()> {
    use crate::shape_spec::{MAX_STROKE_WIDTH, MIN_STROKE_WIDTH};
    use model::PageObject as O;
    let bad = |id: &str, what: &str| CoreError::InvalidModel(format!("object {id}: {what}"));
    let finite = |vs: &[f64]| vs.iter().all(|v| v.is_finite());
    let unit = |v: f64| (0.0..=1.0).contains(&v);
    let color_ok = |c: &model::Rgb| c.iter().all(|v| unit(*v));
    let width_ok = |w: f64| (MIN_STROKE_WIDTH..=MAX_STROKE_WIDTH).contains(&w);
    let rect_ok = |r: &Rect| finite(&[r.x0, r.y0, r.x1, r.y1]) && r.x0 < r.x1 && r.y0 < r.y1;

    let mut ids = HashSet::new();
    for o in model.pages.iter().flat_map(|p| &p.objects) {
        let id = o.id();
        if !ids.insert(id) {
            return Err(bad(id, "duplicate id"));
        }
        match o {
            O::Highlight(h) => {
                if h.quads.is_empty() {
                    return Err(bad(id, "highlight without quads"));
                }
                if !h.quads.iter().flatten().all(|p| finite(&[p.x, p.y])) {
                    return Err(bad(id, "non-finite coordinate"));
                }
                if !unit(h.opacity) || !color_ok(&h.color) {
                    return Err(bad(id, "opacity or color out of range"));
                }
            }
            O::Rect(s) | O::Ellipse(s) => {
                if !rect_ok(&s.rect) {
                    return Err(bad(id, "invalid rect"));
                }
                if s.stroke.is_none() && s.fill.is_none() {
                    return Err(bad(id, "shape without stroke and fill"));
                }
                if s.stroke.is_some() && !width_ok(s.stroke_width) {
                    return Err(bad(id, "stroke width out of range"));
                }
                if !unit(s.opacity) || !s.stroke.iter().chain(s.fill.iter()).all(color_ok) {
                    return Err(bad(id, "opacity or color out of range"));
                }
            }
            O::Line(l) => {
                if !finite(&[l.from.x, l.from.y, l.to.x, l.to.y]) {
                    return Err(bad(id, "non-finite coordinate"));
                }
                if !width_ok(l.stroke_width) {
                    return Err(bad(id, "stroke width out of range"));
                }
                if !unit(l.opacity) || !color_ok(&l.stroke) {
                    return Err(bad(id, "opacity or color out of range"));
                }
            }
            O::Text(t) => {
                if !finite(&[t.origin.x, t.origin.y, t.font_size]) || t.font_size <= 0.0 {
                    return Err(bad(id, "invalid origin or font size"));
                }
            }
            O::Signature(g) => {
                if !rect_ok(&g.rect) {
                    return Err(bad(id, "invalid rect"));
                }
            }
        }
    }
    Ok(())
}

/// Builds the output document (pages only; objects are added afterwards).
pub fn assemble(
    model: &model::Document,
    mut sources: HashMap<String, LoadedSource>,
) -> Result<Assembled> {
    let kinds = validate(model)?;

    // The first PDF source in page order is the base document (D9).
    let base_id = model
        .pages
        .iter()
        .map(|p| p.source_id.as_str())
        .find(|id| kinds.get(id) == Some(&SourceKind::Pdf))
        .map(str::to_owned);

    let mut out = match base_id.as_deref().and_then(|id| sources.remove(id)) {
        Some(LoadedSource::Pdf(d)) => *d,
        _ => {
            let mut d = Document::with_version("1.7");
            let catalog = d.add_object(dictionary! { "Type" => "Catalog" });
            d.trailer.set("Root", catalog);
            d
        }
    };
    out.version = "1.7".into();

    // source id -> (page index -> object id in `out`)
    let mut page_maps: HashMap<String, BTreeMap<u32, ObjectId>> = HashMap::new();
    let mut base_pages: Vec<ObjectId> = Vec::new();

    if let Some(id) = &base_id {
        materialize_inherited(&mut out)?;
        let map: BTreeMap<u32, ObjectId> = out
            .get_pages()
            .into_iter()
            .map(|(n, id)| (n - 1, id))
            .collect();
        base_pages = map.values().copied().collect();
        page_maps.insert(id.clone(), map);
    }

    // Copy other PDF sources in order of first use, with non-overlapping object numbers.
    let mut order: Vec<&str> = Vec::new();
    for p in &model.pages {
        if !order.contains(&p.source_id.as_str()) {
            order.push(p.source_id.as_str());
        }
    }
    for sid in &order {
        if Some(*sid) == base_id.as_deref() {
            continue;
        }
        if !matches!(sources.get(*sid), Some(LoadedSource::Pdf(_))) {
            continue; // images are handled below
        }
        if let Some(LoadedSource::Pdf(mut d)) = sources.remove(*sid) {
            materialize_inherited(&mut d)?;
            d.renumber_objects_with(out.max_id + 1);
            let map: BTreeMap<u32, ObjectId> = d
                .get_pages()
                .into_iter()
                .map(|(n, id)| (n - 1, id))
                .collect();
            out.max_id = out.max_id.max(d.max_id);
            out.objects.extend(d.objects);
            page_maps.insert((*sid).to_owned(), map);
        }
    }

    // Build the page list.
    let pages_root = out.new_object_id();
    let mut images: HashMap<String, EmbeddedImage> = HashMap::new();
    let mut page_ids = Vec::with_capacity(model.pages.len());
    for p in &model.pages {
        let page_id = match kinds[p.source_id.as_str()] {
            SourceKind::Pdf => {
                let id = *page_maps
                    .get(&p.source_id)
                    .and_then(|m| m.get(&p.page_index))
                    .ok_or_else(|| {
                        CoreError::InvalidModel(format!(
                            "page {} refers to missing page {}#{}",
                            p.id, p.source_id, p.page_index
                        ))
                    })?;
                let actual_box = pdf_util::page_box(&out, id);
                let actual_rot = pdf_util::page_rotation(&out, id);
                if !same_rect(&actual_box, &p.page_box) || actual_rot != p.base_rotation {
                    return Err(CoreError::InvalidModel(format!(
                        "page {}: box/rotation differ from the source",
                        p.id
                    )));
                }
                id
            }
            SourceKind::Image => {
                let Some(LoadedSource::Image { bytes, info }) = sources.get(&p.source_id) else {
                    return Err(CoreError::InvalidModel(format!(
                        "missing image {}",
                        p.source_id
                    )));
                };
                let fit = p.image_fit.unwrap_or(ImageFit::A4);
                let layout = *info.layout(fit);
                if !same_rect(&layout.page_box, &p.page_box) {
                    return Err(CoreError::InvalidModel(format!(
                        "page {}: box differs from the image layout",
                        p.id
                    )));
                }
                let img = match images.get(&p.source_id) {
                    Some(i) => *i,
                    None => {
                        let i = embed_image(&mut out, bytes)?;
                        images.insert(p.source_id.clone(), i);
                        i
                    }
                };
                let content = format!(
                    "q {} /Im0 Do Q\n",
                    cm(&orientation_matrix(img.orientation, &layout.image_rect))
                );
                let c = out.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
                out.add_object(dictionary! {
                    "Type" => "Page",
                    "MediaBox" => rect_to_object(&layout.page_box),
                    "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => img.id } },
                    "Contents" => c,
                })
            }
        };
        let page = out.get_dictionary_mut(page_id)?;
        page.set("Parent", pages_root);
        page.set("Rotate", i64::from(p.display_rotation().degrees()));
        page_ids.push(page_id);
    }

    out.objects.insert(
        pages_root,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().map(|id| Object::Reference(*id)).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );
    out.catalog_mut()?.set("Pages", pages_root);

    // Base pages that are not in the output are deleted together with references to them.
    let keep: HashSet<ObjectId> = page_ids.iter().copied().collect();
    for id in base_pages.into_iter().filter(|id| !keep.contains(id)) {
        out.delete_object(id);
    }

    set_producer(&mut out)?;
    Ok(Assembled { doc: out, page_ids })
}

/// Writes `/Producer` (app name and version only; never a user name, SPEC 7.1).
fn set_producer(doc: &mut Document) -> Result<()> {
    let producer = Object::string_literal(crate::PRODUCER);
    let info_id = match doc.trailer.get(b"Info").and_then(Object::as_reference) {
        Ok(id) if doc.get_dictionary(id).is_ok() => id,
        _ => {
            let id = doc.add_object(Dictionary::new());
            doc.trailer.set("Info", id);
            id
        }
    };
    doc.get_dictionary_mut(info_id)?.set("Producer", producer);
    Ok(())
}
