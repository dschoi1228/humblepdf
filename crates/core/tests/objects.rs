//! M3: highlights, rectangles, ellipses, lines and arrows made by the editor are saved as
//! standard annotations on pages of every rotation and on an image page. The output is
//! re-parsed (CLAUDE.md completion criteria); invalid object values are refused.

mod common;

use std::path::Path;

use common::*;
use humblepdf_core::CoreError;
use humblepdf_core::export::annot::OBJECT_KEY;
use humblepdf_core::export::{ExportContext, export_to_bytes};
use humblepdf_core::model::{
    Document as Model, Highlight, Line, PageObject, Point, Quad, Rect, Shape,
};
use humblepdf_core::pdf_util::{as_number, resolve};
use humblepdf_core::shape_spec::arrow_length;
use humblepdf_core::source::build_model;
use lopdf::{Dictionary, Document, Object, ObjectId};

const YELLOW: [f64; 3] = [1.0, 0.92, 0.23];
const RED: [f64; 3] = [0.898, 0.224, 0.208];
const BLUE: [f64; 3] = [0.118, 0.533, 0.898];

/// The five M3 object kinds, placed relative to the page box (which may not start at 0).
fn objects_for(page: usize, b: &Rect) -> Vec<PageObject> {
    let p = |x: f64, y: f64| Point {
        x: b.x0 + x,
        y: b.y0 + y,
    };
    let quad: Quad = [
        p(40.0, 120.0),
        p(240.0, 120.0),
        p(40.0, 100.0),
        p(240.0, 100.0),
    ];
    // A second, shorter line below it: highlights over page text have one quad per line (M13).
    let second: Quad = [p(40.0, 95.0), p(180.0, 95.0), p(40.0, 75.0), p(180.0, 75.0)];
    vec![
        PageObject::Highlight(Highlight {
            id: format!("h{page}"),
            quads: vec![quad, second],
            color: YELLOW,
            opacity: 0.4,
        }),
        PageObject::Rect(Shape {
            id: format!("r{page}"),
            rect: Rect::new(b.x0 + 50.0, b.y0 + 150.0, b.x0 + 200.0, b.y0 + 250.0),
            stroke: Some(RED),
            stroke_width: 2.0,
            fill: None,
            opacity: 1.0,
        }),
        PageObject::Ellipse(Shape {
            id: format!("e{page}"),
            rect: Rect::new(b.x0 + 220.0, b.y0 + 150.0, b.x0 + 380.0, b.y0 + 260.0),
            stroke: None,
            stroke_width: 2.0,
            fill: Some(BLUE),
            opacity: 0.6,
        }),
        PageObject::Line(Line {
            id: format!("l{page}"),
            from: p(50.0, 300.0),
            to: p(300.0, 320.0),
            stroke: RED,
            stroke_width: 0.5,
            arrow: false,
            opacity: 1.0,
        }),
        PageObject::Line(Line {
            id: format!("a{page}"),
            from: p(50.0, 360.0),
            to: p(250.0, 460.0),
            stroke: BLUE,
            stroke_width: 12.0,
            arrow: true,
            opacity: 0.8,
        }),
    ]
}

/// rotated.pdf pages 1-4 (/Rotate 0, 90, 180, 270) and an image page, with user rotations.
fn model() -> Model {
    let files = [fixture("rotated.pdf"), fixture("photo.jpg")];
    let list: Vec<(&Path, Option<&str>)> = files.iter().map(|f| (f.as_path(), None)).collect();
    let mut m = build_model(&list).unwrap();
    m.pages
        .retain(|p| p.source_id != m.sources[0].id || p.page_index < 4);
    assert_eq!(m.pages.len(), 5);
    for (i, page) in m.pages.iter_mut().enumerate() {
        page.objects = objects_for(i, &page.page_box);
    }
    m
}

fn annots(doc: &Document, page: ObjectId) -> Vec<&Dictionary> {
    let p = doc.get_dictionary(page).unwrap();
    let Ok(a) = p.get(b"Annots") else {
        return vec![];
    };
    resolve(doc, a)
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|o| resolve(doc, o).unwrap().as_dict().unwrap())
        .filter(|d| d.has(OBJECT_KEY.as_bytes()))
        .collect()
}

fn nums(d: &Dictionary, key: &[u8]) -> Vec<f64> {
    d.get(key)
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| as_number(v).unwrap())
        .collect()
}

fn num(d: &Dictionary, key: &[u8]) -> f64 {
    as_number(d.get(key).unwrap()).unwrap()
}

fn close(a: &[f64], b: &[f64]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-3)
}

fn text(o: &Object) -> String {
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

/// `/Rect` covers the geometry and adds at most the stroke (and the arrowhead) around it.
fn check_rect(d: &Dictionary, geometry: &Rect, margin: f64, what: &str) {
    let r = nums(d, b"Rect");
    let (x0, y0, x1, y1) = (r[0], r[1], r[2], r[3]);
    assert!(
        x0 <= geometry.x0 + 1e-3
            && y0 <= geometry.y0 + 1e-3
            && x1 >= geometry.x1 - 1e-3
            && y1 >= geometry.y1 - 1e-3,
        "{what}: /Rect {r:?} must cover {geometry:?}"
    );
    assert!(
        geometry.x0 - x0 <= margin + 1e-3
            && geometry.y0 - y0 <= margin + 1e-3
            && x1 - geometry.x1 <= margin + 1e-3
            && y1 - geometry.y1 <= margin + 1e-3,
        "{what}: /Rect {r:?} is wider than {geometry:?} + {margin}"
    );
}

#[test]
fn objects_on_rotated_and_image_pages_are_standard_annotations() {
    let m = model();
    let sources: Vec<_> = m.sources.iter().map(|s| s.path.clone()).collect();
    let before: Vec<u64> = sources.iter().map(|p| file_hash(Path::new(p))).collect();

    let (bytes, warnings) = export_to_bytes(&m, &ExportContext::default()).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let out = reparse(&bytes);
    let ids = pages(&out);
    assert_eq!(ids.len(), m.pages.len());

    for (i, (page, id)) in m.pages.iter().zip(&ids).enumerate() {
        assert_eq!(
            rotate(&out, *id),
            page.display_rotation().degrees(),
            "page {i}"
        );
        let list = annots(&out, *id);
        assert_eq!(list.len(), page.objects.len(), "page {i} annotation count");
        for (a, obj) in list.iter().zip(&page.objects) {
            let what = format!("page {i} {}", obj.id());
            // Order, id and the private JSON copy of the object.
            assert_eq!(text(a.get(b"NM").unwrap()), obj.id(), "{what}");
            let back: PageObject =
                serde_json::from_str(&text(a.get(OBJECT_KEY.as_bytes()).unwrap())).unwrap();
            assert_eq!(&back, obj, "{what}");
            assert_eq!(a.get(b"F").unwrap().as_i64().unwrap(), 4, "{what}");
            assert!(a.get(b"AP").unwrap().as_dict().unwrap().has(b"N"), "{what}");
            let subtype = a.get(b"Subtype").unwrap().as_name().unwrap();
            match obj {
                PageObject::Highlight(h) => {
                    assert_eq!(subtype, b"Highlight", "{what}");
                    // Eight numbers per quad, in order; /Rect covers them all.
                    let qp: Vec<f64> = h.quads.iter().flatten().flat_map(|p| [p.x, p.y]).collect();
                    assert_eq!(qp.len(), 8 * h.quads.len(), "{what}");
                    assert!(close(&nums(a, b"QuadPoints"), &qp), "{what}");
                    assert!(close(&nums(a, b"C"), &h.color), "{what}");
                    assert!((num(a, b"CA") - h.opacity).abs() < 1e-3, "{what}");
                    let all: Vec<Point> = h.quads.iter().flatten().copied().collect();
                    let g = Rect::from_points(&all).unwrap();
                    check_rect(a, &g, 0.0, &what);
                }
                PageObject::Rect(s) | PageObject::Ellipse(s) => {
                    let expected: &[u8] = if matches!(obj, PageObject::Rect(_)) {
                        b"Square"
                    } else {
                        b"Circle"
                    };
                    assert_eq!(subtype, expected, "{what}");
                    let c = nums(a, b"C");
                    match &s.stroke {
                        Some(stroke) => assert!(close(&c, stroke), "{what}"),
                        None => assert!(c.is_empty(), "{what}: no stroke color"),
                    }
                    match &s.fill {
                        Some(f) => assert!(close(&nums(a, b"IC"), f), "{what}"),
                        None => assert!(!a.has(b"IC"), "{what}"),
                    }
                    let bs = a.get(b"BS").unwrap().as_dict().unwrap();
                    let w = if s.stroke.is_some() {
                        s.stroke_width
                    } else {
                        0.0
                    };
                    assert!((num(bs, b"W") - w).abs() < 1e-3, "{what}");
                    assert!((num(a, b"CA") - s.opacity).abs() < 1e-3, "{what}");
                    check_rect(a, &s.rect, w / 2.0, &what);
                }
                PageObject::Line(l) => {
                    assert_eq!(subtype, b"Line", "{what}");
                    assert!(
                        close(&nums(a, b"L"), &[l.from.x, l.from.y, l.to.x, l.to.y]),
                        "{what}"
                    );
                    let le: Vec<&[u8]> = a
                        .get(b"LE")
                        .unwrap()
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|n| n.as_name().unwrap())
                        .collect();
                    let end: &[u8] = if l.arrow { b"ClosedArrow" } else { b"None" };
                    assert_eq!(le, vec![&b"None"[..], end], "{what}");
                    assert!(close(&nums(a, b"C"), &l.stroke), "{what}");
                    let bs = a.get(b"BS").unwrap().as_dict().unwrap();
                    assert!((num(bs, b"W") - l.stroke_width).abs() < 1e-3, "{what}");
                    assert!((num(a, b"CA") - l.opacity).abs() < 1e-3, "{what}");
                    let margin = if l.arrow {
                        arrow_length(l.stroke_width)
                    } else {
                        l.stroke_width / 2.0
                    };
                    check_rect(
                        a,
                        &Rect::new(l.from.x, l.from.y, l.to.x, l.to.y),
                        margin,
                        &what,
                    );
                }
                _ => unreachable!(),
            }
        }
    }

    let after: Vec<u64> = sources.iter().map(|p| file_hash(Path::new(p))).collect();
    assert_eq!(before, after, "sources must not change");
}

#[test]
fn invalid_object_values_are_refused() {
    type Change = fn(&mut Vec<PageObject>);
    let cases: [(&str, Change); 7] = [
        ("duplicate id", |o| {
            let first = o[0].clone();
            o.push(first);
        }),
        ("NaN coordinate", |o| {
            if let PageObject::Line(l) = &mut o[3] {
                l.to.x = f64::NAN;
            }
        }),
        ("opacity above 1", |o| {
            if let PageObject::Highlight(h) = &mut o[0] {
                h.opacity = 2.0;
            }
        }),
        ("no stroke and no fill", |o| {
            if let PageObject::Ellipse(s) = &mut o[2] {
                s.fill = None;
            }
        }),
        ("stroke width above 12", |o| {
            if let PageObject::Rect(s) = &mut o[1] {
                s.stroke_width = 13.0;
            }
        }),
        ("highlight without quads", |o| {
            if let PageObject::Highlight(h) = &mut o[0] {
                h.quads.clear();
            }
        }),
        ("inverted rect", |o| {
            if let PageObject::Rect(s) = &mut o[1] {
                std::mem::swap(&mut s.rect.x0, &mut s.rect.x1);
            }
        }),
    ];
    for (name, change) in cases {
        let mut m = model();
        change(&mut m.pages[0].objects);
        let r = export_to_bytes(&m, &ExportContext::default());
        assert!(
            matches!(r, Err(CoreError::InvalidModel(_))),
            "{name}: {:?}",
            r.map(|_| ())
        );
    }
    // Duplicate ids across pages are refused too.
    let mut m = model();
    let copy = m.pages[0].objects[1].clone();
    m.pages[1].objects.push(copy);
    assert!(matches!(
        export_to_bytes(&m, &ExportContext::default()),
        Err(CoreError::InvalidModel(_))
    ));
}
