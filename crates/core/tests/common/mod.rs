#![allow(dead_code)]

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use humblepdf_core::model::Rect;
use humblepdf_core::pdf_util;
use lopdf::{Document, Object, ObjectId};

pub const FIXTURE_PASSWORD: &str = "fixture-pass";

pub fn fixture(name: &str) -> PathBuf {
    [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "tests",
        "fixtures",
        name,
    ]
    .iter()
    .collect()
}

pub fn temp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pe-test-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub fn file_hash(p: &Path) -> u64 {
    let mut h = DefaultHasher::new();
    std::fs::read(p).unwrap().hash(&mut h);
    h.finish()
}

pub fn reparse(bytes: &[u8]) -> Document {
    Document::load_mem(bytes).expect("output must parse")
}

pub fn pages(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

pub fn page_box(doc: &Document, id: ObjectId) -> Rect {
    pdf_util::page_box(doc, id)
}

pub fn rotate(doc: &Document, id: ObjectId) -> u16 {
    pdf_util::page_rotation(doc, id).degrees()
}

pub fn approx(a: &Rect, b: &Rect) -> bool {
    (a.x0 - b.x0).abs() < 1e-3
        && (a.y0 - b.y0).abs() < 1e-3
        && (a.x1 - b.x1).abs() < 1e-3
        && (a.y1 - b.y1).abs() < 1e-3
}

/// Image XObjects drawn by a page (through its /Resources /XObject).
pub fn page_images(doc: &Document, id: ObjectId) -> Vec<(ObjectId, &lopdf::Stream)> {
    let page = doc.get_dictionary(id).unwrap();
    let res = page.get(b"Resources").unwrap();
    let res = pdf_util::resolve(doc, res).unwrap().as_dict().unwrap();
    let Ok(xo) = res.get(b"XObject") else {
        return vec![];
    };
    let xo = pdf_util::resolve(doc, xo).unwrap().as_dict().unwrap();
    xo.iter()
        .filter_map(|(_, v)| {
            let rid = v.as_reference().ok()?;
            let s = doc.get_object(rid).ok()?.as_stream().ok()?;
            (s.dict.get(b"Subtype").ok()?.as_name().ok()? == b"Image").then_some((rid, s))
        })
        .collect()
}

pub fn name<'a>(d: &'a lopdf::Dictionary, key: &[u8]) -> Option<&'a [u8]> {
    match d.get(key).ok()? {
        Object::Name(n) => Some(n.as_slice()),
        _ => None,
    }
}
