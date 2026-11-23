//! M0-4: annotations, baked signatures, subset font. Every test re-parses the output.

mod common;

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;

use common::*;
use humblepdf_core::export::annot::OBJECT_KEY;
use humblepdf_core::export::{ExportContext, ExportOptions, export_to_bytes};
use humblepdf_core::model::{
    Document as Model, PageObject, Point, Rect, Rotation, Signature, Text,
};
use humblepdf_core::pdf_util::resolve;
use humblepdf_core::source::build_model;
use lopdf::{Dictionary, Document, Object, ObjectId};

fn repo_root() -> PathBuf {
    [env!("CARGO_MANIFEST_DIR"), "..", ".."].iter().collect()
}

/// The sample model with source paths made absolute.
fn sample_model() -> Model {
    let text = std::fs::read_to_string(fixture("m0_sample.model.json")).unwrap();
    let mut m: Model = serde_json::from_str(&text).unwrap();
    for s in &mut m.sources {
        s.path = repo_root().join(&s.path).to_string_lossy().into_owned();
    }
    m
}

fn ctx() -> ExportContext {
    ExportContext {
        signature_dir: Some(fixture("signatures")),
        ..Default::default()
    }
}

fn deref<'a>(doc: &'a Document, o: &'a Object) -> &'a Object {
    resolve(doc, o).unwrap()
}

/// Annotations on a page, made by this app (they carry the private key).
fn app_annots(doc: &Document, page: ObjectId) -> Vec<&Dictionary> {
    let p = doc.get_dictionary(page).unwrap();
    let Ok(a) = p.get(b"Annots") else {
        return vec![];
    };
    deref(doc, a)
        .as_array()
        .unwrap()
        .iter()
        .map(|o| deref(doc, o).as_dict().unwrap())
        .filter(|d| d.has(OBJECT_KEY.as_bytes()))
        .collect()
}

fn decode_text_string(o: &Object) -> String {
    let b = o.as_str().unwrap();
    if b.starts_with(&[0xFE, 0xFF]) {
        let u: Vec<u16> = b[2..]
            .chunks(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16(&u).unwrap()
    } else {
        String::from_utf8(b.to_vec()).unwrap()
    }
}

fn nums(o: &Object) -> Vec<f64> {
    o.as_array()
        .unwrap()
        .iter()
        .map(|v| humblepdf_core::pdf_util::as_number(v).unwrap())
        .collect()
}

#[test]
fn sample_has_standard_annotations_with_appearances() {
    let model = sample_model();
    let (bytes, warnings) = export_to_bytes(&model, &ctx()).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let doc = reparse(&bytes);
    let ids = pages(&doc);

    let annots = app_annots(&doc, ids[0]);
    let subtypes: Vec<&[u8]> = annots
        .iter()
        .map(|a| a.get(b"Subtype").unwrap().as_name().unwrap())
        .collect();
    assert_eq!(
        subtypes,
        vec![
            &b"Highlight"[..],
            b"FreeText",
            b"Square",
            b"Circle",
            b"Line"
        ],
        "signatures must not be annotations"
    );

    let page1_objects: Vec<&PageObject> = model.pages[0]
        .objects
        .iter()
        .filter(|o| !matches!(o, PageObject::Signature(_)))
        .collect();
    for (a, obj) in annots.iter().zip(page1_objects) {
        // Common keys (SPEC 7.4).
        assert_eq!(a.get(b"F").unwrap().as_i64().unwrap(), 4);
        assert_eq!(decode_text_string(a.get(b"NM").unwrap()), obj.id());
        assert!(a.has(b"M"));
        assert!(!a.has(b"T"), "no author");
        // Private key holds the object JSON.
        let json = decode_text_string(a.get(OBJECT_KEY.as_bytes()).unwrap());
        let back: PageObject = serde_json::from_str(&json).unwrap();
        assert_eq!(&back, obj);
        // /AP /N is a Form XObject whose BBox equals /Rect, Matrix identity.
        let ap = deref(&doc, a.get(b"AP").unwrap()).as_dict().unwrap();
        let n = deref(&doc, ap.get(b"N").unwrap()).as_stream().unwrap();
        assert_eq!(n.dict.get(b"Subtype").unwrap().as_name().unwrap(), b"Form");
        assert_eq!(
            nums(n.dict.get(b"BBox").unwrap()),
            nums(a.get(b"Rect").unwrap())
        );
        assert_eq!(
            nums(n.dict.get(b"Matrix").unwrap()),
            vec![1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
        );
    }

    // Highlight: Acrobat quad order, Multiply blend, no transparency group.
    let hl = annots[0];
    assert_eq!(
        nums(hl.get(b"QuadPoints").unwrap()),
        vec![55.0, 734.0, 340.0, 734.0, 55.0, 702.0, 340.0, 702.0]
    );
    let ap = deref(&doc, hl.get(b"AP").unwrap()).as_dict().unwrap();
    let n = deref(&doc, ap.get(b"N").unwrap()).as_stream().unwrap();
    assert!(
        !n.dict.has(b"Group"),
        "highlight appearance must not be a transparency group"
    );
    let res = deref(&doc, n.dict.get(b"Resources").unwrap())
        .as_dict()
        .unwrap();
    let gs = deref(&doc, res.get(b"ExtGState").unwrap())
        .as_dict()
        .unwrap();
    let (_, g) = gs.iter().next().unwrap();
    let g = deref(&doc, g).as_dict().unwrap();
    assert_eq!(g.get(b"BM").unwrap().as_name().unwrap(), b"Multiply");

    // Line with closed arrow at the end.
    let line = annots[4];
    let le: Vec<&[u8]> = line
        .get(b"LE")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o.as_name().unwrap())
        .collect();
    assert_eq!(le, vec![&b"None"[..], b"ClosedArrow"]);
    assert_eq!(
        nums(line.get(b"L").unwrap()),
        vec![80.0, 300.0, 300.0, 350.0]
    );

    // FreeText keeps the original text with line breaks.
    let ft = annots[1];
    assert_eq!(
        decode_text_string(ft.get(b"Contents").unwrap()),
        "추가한 텍스트: 서명 확인을 마쳤습니다\n두 번째 줄 Second line 123"
    );
    assert!(ft.has(b"DA"));
}

/// Parses `<src> <dst>` bfchar pairs from a ToUnicode CMap.
fn to_unicode_map(cmap: &[u8]) -> BTreeMap<u16, String> {
    let text = String::from_utf8_lossy(cmap);
    let mut map = BTreeMap::new();
    let mut in_bfchar = false;
    for line in text.lines() {
        if line.ends_with("beginbfchar") {
            in_bfchar = true;
            continue;
        }
        if line == "endbfchar" {
            in_bfchar = false;
            continue;
        }
        if in_bfchar {
            let parts: Vec<&str> = line
                .split(['<', '>', ' '])
                .filter(|s| !s.is_empty())
                .collect();
            let cid = u16::from_str_radix(parts[0], 16).unwrap();
            let units: Vec<u16> = (0..parts[1].len() / 4)
                .map(|i| u16::from_str_radix(&parts[1][i * 4..i * 4 + 4], 16).unwrap())
                .collect();
            map.insert(cid, String::from_utf16(&units).unwrap());
        }
    }
    map
}

#[test]
fn text_uses_one_shared_subset_font_with_to_unicode() {
    let model = sample_model();
    let (bytes, _) = export_to_bytes(&model, &ctx()).unwrap();
    let doc = reparse(&bytes);

    // Type0 fonts created by this app (base name ends with the bundled font name).
    let fonts: Vec<&Dictionary> = doc
        .objects
        .values()
        .filter_map(|o| o.as_dict().ok())
        .filter(|d| {
            d.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Type0")
                && d.get(b"BaseFont")
                    .and_then(Object::as_name)
                    .is_ok_and(|n| n.ends_with(b"+Pretendard-Regular"))
        })
        .collect();
    // korean_embedded.pdf has its own subset too; the export adds exactly one shared font.
    assert_eq!(fonts.len(), 2, "source font + one shared export font");
    let mut seen_chars = HashSet::new();
    for f in &fonts {
        assert_eq!(
            f.get(b"Encoding").unwrap().as_name().unwrap(),
            b"Identity-H"
        );
        let tu = deref(&doc, f.get(b"ToUnicode").unwrap())
            .as_stream()
            .unwrap();
        let map = to_unicode_map(&tu.decompressed_content().unwrap());
        for s in map.values() {
            seen_chars.extend(s.chars());
        }
        let desc = deref(&doc, f.get(b"DescendantFonts").unwrap())
            .as_array()
            .unwrap();
        let cid = deref(&doc, &desc[0]).as_dict().unwrap();
        assert_eq!(
            cid.get(b"Subtype").unwrap().as_name().unwrap(),
            b"CIDFontType2"
        );
        assert!(cid.has(b"W"));
        let fd = deref(&doc, cid.get(b"FontDescriptor").unwrap())
            .as_dict()
            .unwrap();
        assert!(fd.has(b"FontFile2"));
    }
    // Every character typed by the user can be mapped back (copy/search, SPEC 7.6).
    for obj in model.pages.iter().flat_map(|p| &p.objects) {
        if let PageObject::Text(t) = obj {
            for c in t.lines.concat().chars().filter(|c| !c.is_whitespace()) {
                assert!(seen_chars.contains(&c), "ToUnicode lacks {c:?}");
            }
        }
    }
}

#[test]
fn signatures_are_baked_with_q_wrapping_and_one_image() {
    let mut model = sample_model();
    // Place the same signature a third time.
    model.pages[0]
        .objects
        .push(PageObject::Signature(Signature {
            id: "o-sg-3".into(),
            signature_id: "sig-demo".into(),
            rect: Rect::new(60.0, 60.0, 150.0, 90.0),
            rotation: Rotation::R0,
        }));
    let (bytes, _) = export_to_bytes(&model, &ctx()).unwrap();
    let doc = reparse(&bytes);
    let ids = pages(&doc);

    for id in &ids {
        let contents = doc.get_page_contents(*id);
        let first = doc.get_object(contents[0]).unwrap().as_stream().unwrap();
        assert_eq!(first.decompressed_content().unwrap(), b"q\n");
        let last = doc
            .get_object(*contents.last().unwrap())
            .unwrap()
            .as_stream()
            .unwrap();
        let text = String::from_utf8(last.decompressed_content().unwrap()).unwrap();
        assert!(text.starts_with("Q\n"), "{text}");
        assert!(text.contains("/PdfEdX0 Do"), "{text}");
    }

    // The signature PNG appears once as RGB + SMask, however often it is placed.
    let sig_images: Vec<_> = doc
        .objects
        .values()
        .filter_map(|o| o.as_stream().ok())
        .filter(|s| {
            s.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Image")
                && s.dict.get(b"Width").and_then(Object::as_i64).ok() == Some(600)
                && s.dict.has(b"SMask")
        })
        .collect();
    assert_eq!(sig_images.len(), 1);
}

#[test]
fn baking_does_not_touch_shared_resources_of_other_pages() {
    let mut model = build_model(&[(fixture("shared_resources.pdf").as_path(), None)]).unwrap();
    model.pages[0]
        .objects
        .push(PageObject::Signature(Signature {
            id: "sg".into(),
            signature_id: "sig-demo".into(),
            rect: Rect::new(100.0, 100.0, 280.0, 160.0),
            rotation: Rotation::R0,
        }));
    let (bytes, _) = export_to_bytes(&model, &ctx()).unwrap();
    let doc = reparse(&bytes);
    let ids = pages(&doc);
    let xobject_names = |id: ObjectId| -> Vec<Vec<u8>> {
        let p = doc.get_dictionary(id).unwrap();
        let res = deref(&doc, p.get(b"Resources").unwrap()).as_dict().unwrap();
        match res.get(b"XObject") {
            Ok(x) => deref(&doc, x)
                .as_dict()
                .unwrap()
                .iter()
                .map(|(k, _)| k.clone())
                .collect(),
            Err(_) => vec![],
        }
    };
    assert_eq!(xobject_names(ids[0]), vec![b"PdfEdX0".to_vec()]);
    assert!(xobject_names(ids[1]).is_empty());
    assert!(xobject_names(ids[2]).is_empty());
}

#[test]
fn flatten_bakes_everything() {
    let model = sample_model();
    let ctx = ExportContext {
        options: ExportOptions { flatten: true },
        ..ctx()
    };
    let (bytes, _) = export_to_bytes(&model, &ctx).unwrap();
    let doc = reparse(&bytes);
    for id in pages(&doc) {
        assert!(app_annots(&doc, id).is_empty());
    }
}

fn text_obj(lines: &[&str]) -> PageObject {
    PageObject::Text(Text {
        id: "t".into(),
        origin: Point { x: 60.0, y: 400.0 },
        rotation: Rotation::R0,
        font_size: 14.0,
        color: [0.0, 0.0, 0.0],
        lines: lines.iter().map(|s| s.to_string()).collect(),
    })
}

/// SPEC M0-4: one 20-character Korean text adds at most 100KB.
#[test]
fn korean_text_size_increase_is_small() {
    let base = build_model(&[(fixture("rotated.pdf").as_path(), None)]).unwrap();
    let (without, _) = export_to_bytes(&base, &ExportContext::default()).unwrap();
    let mut with = base.clone();
    let text = "가나다라마바사아자차카타파하거너더러머버";
    assert_eq!(text.chars().count(), 20);
    with.pages[0].objects.push(text_obj(&[text]));
    let (with_bytes, _) = export_to_bytes(&with, &ExportContext::default()).unwrap();
    let delta = with_bytes.len() as i64 - without.len() as i64;
    println!("size increase for 20 Korean characters: {delta} bytes");
    assert!(delta <= 100 * 1024, "increase {delta} bytes");
}

#[test]
fn missing_glyphs_are_reported() {
    let mut m = build_model(&[(fixture("rotated.pdf").as_path(), None)]).unwrap();
    m.pages[0].objects.push(text_obj(&["ok \u{A840}\u{A841}"]));
    let (_, warnings) = export_to_bytes(&m, &ExportContext::default()).unwrap();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].code, "missing_glyphs");
    assert_eq!(warnings[0].chars, vec!["\u{A840}", "\u{A841}"]);
}
