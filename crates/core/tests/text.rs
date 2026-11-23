//! M5: text objects are FreeText annotations drawn with the bundled fonts (D32): each
//! character uses Pretendard when it has the glyph, else Pretendard JP. Both are embedded as
//! subsets only when used, with /W and ToUnicode. Every test re-parses the output.

mod common;

use std::collections::BTreeMap;
use std::path::Path;

use common::*;
use humblepdf_core::export::annot::OBJECT_KEY;
use humblepdf_core::export::{ExportContext, export_to_bytes};
use humblepdf_core::font::{FontSet, JP_FONT};
use humblepdf_core::model::{Document as Model, PageObject, Point, Text};
use humblepdf_core::pdf_util::resolve;
use humblepdf_core::source::build_model;
use lopdf::{Dictionary, Document, Object, ObjectId};

fn deref<'a>(doc: &'a Document, o: &'a Object) -> &'a Object {
    resolve(doc, o).unwrap()
}

fn text_obj(
    id: &str,
    at: Point,
    rotation: humblepdf_core::model::Rotation,
    lines: &[&str],
) -> PageObject {
    PageObject::Text(Text {
        id: id.into(),
        origin: at,
        rotation,
        font_size: 14.0,
        color: [0.1, 0.1, 0.5],
        lines: lines.iter().map(|s| s.to_string()).collect(),
    })
}

/// rotated.pdf pages 1-4 (0/90/180/270), each with `lines` placed upright.
fn model_with(lines: &[&str]) -> Model {
    let mut m = build_model(&[(fixture("rotated.pdf").as_path(), None)]).unwrap();
    m.pages.truncate(4);
    for (i, p) in m.pages.iter_mut().enumerate() {
        let b = p.page_box;
        let r = p.display_rotation();
        p.objects = vec![text_obj(
            &format!("t{i}"),
            Point {
                x: b.x0 + 200.0,
                y: b.y0 + 300.0,
            },
            r,
            lines,
        )];
    }
    m
}

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

/// BaseFont (without the subset tag) and ToUnicode map of a Type0 font, checking its parts.
fn font_info(doc: &Document, id: ObjectId) -> (String, BTreeMap<u16, String>) {
    let f = doc.get_dictionary(id).unwrap();
    assert_eq!(f.get(b"Subtype").unwrap().as_name().unwrap(), b"Type0");
    assert_eq!(
        f.get(b"Encoding").unwrap().as_name().unwrap(),
        b"Identity-H"
    );
    let base = String::from_utf8(f.get(b"BaseFont").unwrap().as_name().unwrap().to_vec()).unwrap();
    let (tag, name) = base.split_once('+').expect("subset tag");
    assert_eq!(tag.len(), 6);
    let desc = deref(
        doc,
        &f.get(b"DescendantFonts").unwrap().as_array().unwrap()[0],
    )
    .as_dict()
    .unwrap();
    assert_eq!(
        desc.get(b"Subtype").unwrap().as_name().unwrap(),
        b"CIDFontType2"
    );
    assert!(desc.has(b"W"));
    let fd = deref(doc, desc.get(b"FontDescriptor").unwrap())
        .as_dict()
        .unwrap();
    assert!(fd.has(b"FontFile2"));
    let tu = deref(doc, f.get(b"ToUnicode").unwrap())
        .as_stream()
        .unwrap();
    (
        name.to_owned(),
        to_unicode_map(&tu.decompressed_content().unwrap()),
    )
}

/// The app's annotations of a page.
fn annots(doc: &Document, page: ObjectId) -> Vec<&Dictionary> {
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

/// Lines of text read back from an appearance stream through the fonts' ToUnicode maps.
fn read_back(doc: &Document, ap: &lopdf::Stream) -> (Vec<String>, Vec<String>) {
    let fonts = deref(doc, ap.dict.get(b"Resources").unwrap())
        .as_dict()
        .unwrap()
        .get(b"Font")
        .unwrap();
    let fonts = deref(doc, fonts).as_dict().unwrap();
    let mut maps = BTreeMap::new();
    let mut names = Vec::new();
    for (k, v) in fonts.iter() {
        let (name, map) = font_info(doc, v.as_reference().unwrap());
        names.push(name);
        maps.insert(String::from_utf8(k.clone()).unwrap(), map);
    }
    let content = String::from_utf8(ap.decompressed_content().unwrap()).unwrap();
    let mut lines = Vec::new();
    for l in content.lines() {
        if l.ends_with(" Tm") {
            lines.push(String::new());
        } else if let Some(rest) = l.strip_suffix("> Tj") {
            let (head, hex) = rest.split_once(" Tf <").unwrap();
            let font = head.trim_start_matches('/').split(' ').next().unwrap();
            let map = &maps[font];
            for i in (0..hex.len()).step_by(4) {
                let cid = u16::from_str_radix(&hex[i..i + 4], 16).unwrap();
                lines.last_mut().unwrap().push_str(&map[&cid]);
            }
        }
    }
    (lines, names)
}

const MIXED: [&str; 2] = ["한글 English 日本語のテキスト", "カタカナ 漢字 123"];

#[test]
fn mixed_korean_english_japanese_text_on_every_rotation() {
    let m = model_with(&MIXED);
    let source = Path::new(&m.sources[0].path).to_path_buf();
    let before = file_hash(&source);
    let (bytes, warnings) = export_to_bytes(&m, &ExportContext::default()).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let out = reparse(&bytes);
    for (i, (page, id)) in m.pages.iter().zip(pages(&out)).enumerate() {
        assert_eq!(rotate(&out, id), page.display_rotation().degrees());
        let list = annots(&out, id);
        assert_eq!(list.len(), 1, "page {i}");
        let a = list[0];
        assert_eq!(a.get(b"Subtype").unwrap().as_name().unwrap(), b"FreeText");
        let ap_id = a
            .get(b"AP")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"N")
            .unwrap()
            .as_reference()
            .unwrap();
        let ap = out.get_object(ap_id).unwrap().as_stream().unwrap();
        let (lines, mut names) = read_back(&out, ap);
        assert_eq!(lines, MIXED, "page {i}: text read back through ToUnicode");
        names.sort();
        assert_eq!(
            names,
            ["Pretendard-Regular", "PretendardJP-Common"],
            "page {i}"
        );
        let PageObject::Text(t) = &page.objects[0] else {
            unreachable!()
        };
        let back: PageObject =
            serde_json::from_slice(&decode(a.get(OBJECT_KEY.as_bytes()).unwrap())).unwrap();
        assert_eq!(back, page.objects[0]);
        assert_eq!(decode_str(a.get(b"Contents").unwrap()), t.lines.join("\n"));
    }
    assert_eq!(file_hash(&source), before);
}

fn decode(o: &Object) -> Vec<u8> {
    decode_str(o).into_bytes()
}

fn decode_str(o: &Object) -> String {
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

/// Export fonts (subset-tagged Type0 fonts) in the document.
fn export_fonts(doc: &Document) -> Vec<String> {
    let mut v: Vec<String> = doc
        .objects
        .values()
        .filter_map(|o| o.as_dict().ok())
        .filter(|d| d.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Type0"))
        .filter_map(|d| d.get(b"BaseFont").and_then(Object::as_name).ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .filter_map(|n| n.split_once('+').map(|(_, b)| b.to_owned()))
        .collect();
    v.sort();
    v
}

#[test]
fn only_the_fonts_a_document_uses_are_embedded() {
    let (ko, _) = export_to_bytes(
        &model_with(&["한글만 있는 텍스트"]),
        &ExportContext::default(),
    )
    .unwrap();
    assert_eq!(export_fonts(&reparse(&ko)), ["Pretendard-Regular"]);
    // Kanji are not in Pretendard: only the Japanese font is needed.
    let (kanji, _) =
        export_to_bytes(&model_with(&["日本語漢字"]), &ExportContext::default()).unwrap();
    assert_eq!(export_fonts(&reparse(&kanji)), ["PretendardJP-Common"]);
}

#[test]
fn characters_no_font_has_are_reported() {
    // U+2000B is outside the subset; U+2200 (for all) is not in either font.
    let (_, warnings) = export_to_bytes(
        &model_with(&["漢字 \u{2000B} \u{2200}"]),
        &ExportContext::default(),
    )
    .unwrap();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].code, "missing_glyphs");
    assert_eq!(warnings[0].chars, ["\u{2200}", "\u{2000B}"]);
}

#[test]
fn twenty_characters_add_less_than_100kb() {
    let base = model_with(&[]);
    let empty = {
        let mut m = base.clone();
        for p in &mut m.pages {
            p.objects.clear();
        }
        export_to_bytes(&m, &ExportContext::default())
            .unwrap()
            .0
            .len()
    };
    for (name, text) in [
        ("Korean", "한글 스무 글자를 넣어서 파일 크기를 잰다"),
        ("Japanese", "日本語の文章で二十文字のファイル大きさを測る"),
    ] {
        let mut m = base.clone();
        for p in &mut m.pages {
            p.objects = vec![text_obj(
                "t",
                Point {
                    x: p.page_box.x0 + 50.0,
                    y: p.page_box.y0 + 50.0,
                },
                p.display_rotation(),
                &[text],
            )];
        }
        m.pages.truncate(1);
        let mut e = base.clone();
        e.pages.truncate(1);
        for p in &mut e.pages {
            p.objects.clear();
        }
        let empty_one = export_to_bytes(&e, &ExportContext::default())
            .unwrap()
            .0
            .len();
        let with = export_to_bytes(&m, &ExportContext::default())
            .unwrap()
            .0
            .len();
        let grew = with - empty_one;
        println!("{name}: +{grew} bytes (document without text: {empty_one}, four pages: {empty})");
        assert!(grew <= 100 * 1024, "{name}: {grew} bytes");
    }
}

#[test]
fn the_japanese_font_has_the_common_characters() {
    assert!(JP_FONT.len() < 2_500_000, "{} bytes", JP_FONT.len());
    let face = ttf_parser::Face::parse(JP_FONT, 0).unwrap();
    assert!(face.tables().glyf.is_some(), "TrueType outlines");
    let has = |c: char| face.glyph_index(c).is_some_and(|g| g.0 != 0);
    let missing: String = ('\u{3041}'..='\u{3093}')
        .chain('\u{30A1}'..='\u{30F6}')
        .filter(|c| !has(*c))
        .collect();
    assert!(missing.is_empty(), "kana missing: {missing}");
    // JIS level 1 and 2, and 2010 joyo additions that are in level 2.
    for c in ['亜', '腕', '弌', '熙', '嗅', '喩', '鬱', '々', '〆'] {
        assert!(has(c), "{c}");
    }
    // The source font has no halfwidth katakana: they are reported as missing.
    assert!(!has('ｱ'));
    // The set picks Pretendard first, then the Japanese font.
    let set = FontSet::bundled().unwrap();
    assert_eq!(set.font_for('한'), 0);
    assert_eq!(set.font_for('A'), 0);
    assert_eq!(set.font_for('漢'), 1);
    assert_eq!(set.font_for(' '), 0);
}
