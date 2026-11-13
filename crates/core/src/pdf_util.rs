//! Small helpers on top of lopdf.

use lopdf::{Dictionary, Document, Object, ObjectId};

use crate::model::{Rect, Rotation};

/// Attributes a page may inherit from its ancestors in the page tree (ISO 32000-1, 7.7.3.4).
pub const INHERITABLE: [&[u8]; 4] = [b"Resources", b"MediaBox", b"CropBox", b"Rotate"];

/// US Letter, the default pdf.js uses when a page has no usable MediaBox.
pub const LETTER_MEDIABOX: Rect = Rect {
    x0: 0.0,
    y0: 0.0,
    x1: 612.0,
    y1: 792.0,
};

/// Resolves a reference to the object it points to. Non-references are returned as is.
pub fn resolve<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Object> {
    doc.dereference(obj).ok().map(|(_, o)| o)
}

/// Looks up `key` on the page or, failing that, on its ancestors.
pub fn inherited<'a>(doc: &'a Document, page_id: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut current = doc.get_dictionary(page_id).ok()?;
    // Guard against cycles in malformed page trees.
    for _ in 0..64 {
        if let Ok(v) = current.get(key) {
            return resolve(doc, v);
        }
        let parent = current.get(b"Parent").ok()?.as_reference().ok()?;
        current = doc.get_dictionary(parent).ok()?;
    }
    None
}

pub fn as_number(obj: &Object) -> Option<f64> {
    match obj {
        Object::Integer(i) => Some(*i as f64),
        // lopdf stores reals as f32. Go through the shortest decimal form so that
        // "595.276" reads as 595.276 (as pdf.js does), not 595.2760009765625.
        Object::Real(r) => r.to_string().parse::<f64>().ok(),
        _ => None,
    }
}

/// Parses a rectangle array and normalizes it. Returns None for degenerate rectangles,
/// like pdf.js `_getBoundingBox`.
pub fn rect_from_object(doc: &Document, obj: &Object) -> Option<Rect> {
    let arr = resolve(doc, obj)?.as_array().ok()?;
    if arr.len() != 4 {
        return None;
    }
    let mut v = [0.0; 4];
    for (i, o) in arr.iter().enumerate() {
        v[i] = as_number(resolve(doc, o)?)?;
    }
    let r = Rect::new(v[0], v[1], v[2], v[3]);
    if r.width() > 0.0 && r.height() > 0.0 {
        Some(r)
    } else {
        None
    }
}

pub fn rect_to_object(r: &Rect) -> Object {
    Object::Array(vec![real(r.x0), real(r.y0), real(r.x1), real(r.y1)])
}

/// A number object: an integer when the value is integral, otherwise a real.
pub fn real(v: f64) -> Object {
    if v.fract() == 0.0 && v.abs() < 1e9 {
        Object::Integer(v as i64)
    } else {
        Object::Real(v as f32)
    }
}

/// Visible area of a page: CropBox ∩ MediaBox, the same as pdf.js `page.view` (SPEC 5).
pub fn page_box(doc: &Document, page_id: ObjectId) -> Rect {
    let media = inherited(doc, page_id, b"MediaBox")
        .and_then(|o| rect_from_object(doc, o))
        .unwrap_or(LETTER_MEDIABOX);
    let crop = inherited(doc, page_id, b"CropBox").and_then(|o| rect_from_object(doc, o));
    match crop {
        Some(c) if c != media => intersect(&c, &media).unwrap_or(media),
        _ => media,
    }
}

pub fn intersect(a: &Rect, b: &Rect) -> Option<Rect> {
    let r = Rect {
        x0: a.x0.max(b.x0),
        y0: a.y0.max(b.y0),
        x1: a.x1.min(b.x1),
        y1: a.y1.min(b.y1),
    };
    if r.x0 < r.x1 && r.y0 < r.y1 {
        Some(r)
    } else {
        None
    }
}

/// Page /Rotate normalized like pdf.js: values that are not multiples of 90 become 0.
pub fn page_rotation(doc: &Document, page_id: ObjectId) -> Rotation {
    inherited(doc, page_id, b"Rotate")
        .and_then(as_number)
        .and_then(|v| Rotation::from_degrees(v as i64))
        .unwrap_or_default()
}

pub fn user_unit(doc: &Document, page_id: ObjectId) -> f64 {
    doc.get_dictionary(page_id)
        .ok()
        .and_then(|d| d.get(b"UserUnit").ok())
        .and_then(|o| resolve(doc, o))
        .and_then(as_number)
        .unwrap_or(1.0)
}

/// Returns a mutable page dictionary.
pub fn page_dict_mut(doc: &mut Document, page_id: ObjectId) -> lopdf::Result<&mut Dictionary> {
    doc.get_object_mut(page_id)?.as_dict_mut()
}
