//! Reopening (SPEC 7.7, D36): the app's annotations carry their object as JSON under
//! `/PdfEditorObject`. An annotation is restorable when that JSON parses and drawing the
//! object again gives the annotation's `/Rect` (within RECT_TOLERANCE). Otherwise another
//! program changed it, and it stays an ordinary annotation. The same test decides what
//! `open_source` restores, what the rendering bytes leave out, and what an export removes
//! before writing the current objects, so the three always agree.

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::error::Result;
use crate::export::annot::OBJECT_KEY;
use crate::export::appearance;
use crate::font::FontSet;
use crate::model::{PageObject, Rect};
use crate::pdf_util::{rect_from_object, resolve};

/// Largest difference (pt) between `/Rect` and the redrawn box of a restorable annotation.
pub const RECT_TOLERANCE: f64 = 0.01;

/// Decodes a PDF text string: UTF-16BE with a BOM, else bytes as Latin-1 (our JSON is ASCII
/// then).
pub fn decode_text_string(o: &Object) -> Option<String> {
    let b = o.as_str().ok()?;
    if let Some(rest) = b.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = rest
            .chunks(2)
            .filter(|c| c.len() == 2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16(&units).ok()
    } else {
        Some(b.iter().map(|&c| char::from(c)).collect())
    }
}

/// The box the export draws for `o` (its annotation `/Rect`); `None` for signatures, which
/// are never annotations.
fn drawn_box(o: &PageObject, fonts: &mut Option<FontSet>) -> Option<Rect> {
    Some(match o {
        PageObject::Highlight(h) => appearance::highlight(h).bbox,
        PageObject::Rect(s) => appearance::rect(s).bbox,
        PageObject::Ellipse(s) => appearance::ellipse(s).bbox,
        PageObject::Line(l) => appearance::line(l).bbox,
        PageObject::Text(t) => {
            if fonts.is_none() {
                *fonts = FontSet::bundled().ok();
            }
            let set = fonts.as_mut()?;
            let lines: Vec<_> = t.lines.iter().map(|l| set.encode_line(l)).collect();
            appearance::text(t, &lines, &[None, None], set.metrics()).bbox
        }
        PageObject::Signature(_) => return None,
    })
}

fn close(a: &Rect, b: &Rect) -> bool {
    [(a.x0, b.x0), (a.y0, b.y0), (a.x1, b.x1), (a.y1, b.y1)]
        .iter()
        .all(|(p, q)| (p - q).abs() <= RECT_TOLERANCE)
}

/// The object an annotation restores to, if it is one of ours and unchanged.
fn restore_one(
    doc: &Document,
    annot: &Dictionary,
    fonts: &mut Option<FontSet>,
) -> Option<PageObject> {
    let json = decode_text_string(annot.get(OBJECT_KEY.as_bytes()).ok()?)?;
    let object: PageObject = serde_json::from_str(&json).ok()?;
    let rect = rect_from_object(doc, annot.get(b"Rect").ok()?)?;
    let expected = drawn_box(&object, fonts)?;
    close(&rect, &expected).then_some(object)
}

fn annots(doc: &Document, page_id: ObjectId) -> Vec<Object> {
    doc.get_dictionary(page_id)
        .ok()
        .and_then(|p| p.get(b"Annots").ok())
        .and_then(|a| resolve(doc, a))
        .and_then(|a| a.as_array().ok())
        .cloned()
        .unwrap_or_default()
}

/// Restorable annotations of a page, in `/Annots` order: (index in `/Annots`, object).
pub fn restorable(doc: &Document, page_id: ObjectId) -> Vec<(usize, PageObject)> {
    let mut fonts = None;
    annots(doc, page_id)
        .iter()
        .enumerate()
        .filter_map(|(i, a)| {
            let d = resolve(doc, a)?.as_dict().ok()?;
            restore_one(doc, d, &mut fonts).map(|o| (i, o))
        })
        .collect()
}

/// Removes the restorable annotations from a page's `/Annots`. Returns how many it removed.
/// The annotation objects themselves go away when the document is pruned.
pub fn remove_restorable(doc: &mut Document, page_id: ObjectId) -> Result<usize> {
    let found = restorable(doc, page_id);
    if found.is_empty() {
        return Ok(0);
    }
    let drop: std::collections::HashSet<usize> = found.iter().map(|(i, _)| *i).collect();
    let kept: Vec<Object> = annots(doc, page_id)
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !drop.contains(i))
        .map(|(_, a)| a)
        .collect();
    let page = doc.get_dictionary_mut(page_id)?;
    if kept.is_empty() {
        page.remove(b"Annots");
    } else {
        page.set("Annots", kept);
    }
    Ok(found.len())
}
