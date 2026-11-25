//! M6: reopening a PDF saved by the app restores its annotations as objects (SPEC 7.7,
//! D36); annotations another program moved stay as they are; save → reopen → save keeps
//! the objects; the rendering bytes leave restored annotations out; flattening leaves none.

mod common;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use common::*;
use humblepdf_core::export::annot::OBJECT_KEY;
use humblepdf_core::export::{ExportContext, ExportOptions, export_to_file};
use humblepdf_core::model::{
    Document as Model, Highlight, Line, PageObject, Point, Quad, Rect, Shape, Signature, Text,
};
use humblepdf_core::pdf_util::resolve;
use humblepdf_core::source::{build_model, inspect_path, render_bytes, with_id};
use lopdf::{Document, Object, ObjectId, dictionary};

fn objects_for(i: usize, p: &humblepdf_core::model::Page) -> Vec<PageObject> {
    let b = p.page_box;
    let at = |x: f64, y: f64| Point {
        x: b.x0 + x,
        y: b.y0 + y,
    };
    let quad: Quad = [
        at(40.0, 120.0),
        at(240.0, 120.0),
        at(40.0, 100.0),
        at(240.0, 100.0),
    ];
    // One quad per line, as a highlight over page text has (M13).
    let second: Quad = [
        at(40.0, 95.0),
        at(180.0, 95.0),
        at(40.0, 75.0),
        at(180.0, 75.0),
    ];
    vec![
        PageObject::Highlight(Highlight {
            id: format!("h{i}"),
            quads: vec![quad, second],
            color: [1.0, 0.92, 0.23],
            opacity: 0.4,
        }),
        PageObject::Rect(Shape {
            id: format!("r{i}"),
            rect: Rect::new(b.x0 + 50.0, b.y0 + 150.0, b.x0 + 200.0, b.y0 + 250.0),
            stroke: Some([0.9, 0.2, 0.2]),
            stroke_width: 2.0,
            fill: None,
            opacity: 1.0,
        }),
        PageObject::Ellipse(Shape {
            id: format!("e{i}"),
            rect: Rect::new(b.x0 + 220.0, b.y0 + 150.0, b.x0 + 380.0, b.y0 + 260.0),
            stroke: None,
            stroke_width: 2.0,
            fill: Some([0.1, 0.5, 0.9]),
            opacity: 0.6,
        }),
        PageObject::Line(Line {
            id: format!("l{i}"),
            from: at(50.0, 300.0),
            to: at(300.0, 320.0),
            stroke: [0.2, 0.2, 0.2],
            stroke_width: 1.0,
            arrow: false,
            opacity: 1.0,
        }),
        PageObject::Line(Line {
            id: format!("a{i}"),
            from: at(50.0, 360.0),
            to: at(250.0, 460.0),
            stroke: [0.1, 0.5, 0.9],
            stroke_width: 6.0,
            arrow: true,
            opacity: 0.8,
        }),
        PageObject::Text(Text {
            id: format!("t{i}"),
            origin: at(60.0, 520.0),
            rotation: p.display_rotation(),
            font_size: 14.0,
            color: [0.0, 0.0, 0.0],
            lines: vec!["한글 English".into(), "日本語のテキスト".into()],
        }),
        PageObject::Signature(Signature {
            id: format!("s{i}"),
            signature_id: "sig-demo".into(),
            rect: Rect::new(b.x0 + 300.0, b.y0 + 40.0, b.x0 + 420.0, b.y0 + 80.0),
            rotation: humblepdf_core::model::Rotation::R0,
        }),
    ]
}

fn ctx() -> ExportContext {
    ExportContext {
        signature_dir: Some(fixture("signatures")),
        ..Default::default()
    }
}

/// rotated.pdf p1-4 and photo.jpg, every object kind on each page.
fn model_from(files: &[(PathBuf, Option<&str>)]) -> Model {
    let list: Vec<(&Path, Option<&str>)> = files.iter().map(|(f, p)| (f.as_path(), *p)).collect();
    let mut m = build_model(&list).unwrap();
    m.pages.retain(|p| p.page_index < 4);
    for (i, p) in m.pages.iter_mut().enumerate() {
        let objs = objects_for(i, p);
        p.objects = objs;
    }
    m
}

/// Objects without ids (and without signatures, which are baked, not annotations).
fn comparable(objects: &[PageObject]) -> Vec<PageObject> {
    objects
        .iter()
        .filter(|o| !matches!(o, PageObject::Signature(_)))
        .map(|o| with_id(o, String::new()))
        .collect()
}

/// The model of a saved file as the app sees it when the file is added again.
fn reopen(path: &Path) -> Model {
    build_model(&[(path, None)]).unwrap()
}

fn app_annots(doc: &Document, page: ObjectId) -> Vec<Object> {
    let Ok(a) = doc.get_dictionary(page).unwrap().get(b"Annots") else {
        return vec![];
    };
    resolve(doc, a)
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| {
            resolve(doc, o)
                .and_then(|o| o.as_dict().ok())
                .is_some_and(|d| d.has(OBJECT_KEY.as_bytes()))
        })
        .cloned()
        .collect()
}

fn all_annots(doc: &Document, page: ObjectId) -> usize {
    doc.get_dictionary(page)
        .unwrap()
        .get(b"Annots")
        .ok()
        .and_then(|a| resolve(doc, a))
        .and_then(|a| a.as_array().ok())
        .map_or(0, |a| a.len())
}

#[test]
fn save_reopen_save_keeps_every_object() {
    let dir = temp_dir("reopen-roundtrip");
    let m = model_from(&[(fixture("rotated.pdf"), None), (fixture("photo.jpg"), None)]);
    let first = dir.join("first.pdf");
    export_to_file(&m, &ctx(), &first).unwrap();

    let r1 = reopen(&first);
    assert_eq!(r1.pages.len(), m.pages.len());
    for (a, b) in m.pages.iter().zip(&r1.pages) {
        assert_eq!(
            comparable(&b.objects),
            comparable(&a.objects),
            "first reopen"
        );
    }
    // Restored ids are unique in the model.
    let ids: Vec<&str> = r1
        .pages
        .iter()
        .flat_map(|p| p.objects.iter().map(|o| o.id()))
        .collect();
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len());

    // Saving the reopened model does not double the annotations.
    let second = dir.join("second.pdf");
    export_to_file(&r1, &ctx(), &second).unwrap();
    let out = reparse(&std::fs::read(&second).unwrap());
    for (p, id) in r1.pages.iter().zip(pages(&out)) {
        assert_eq!(
            app_annots(&out, id).len(),
            p.objects.len(),
            "annotations on {}",
            p.id
        );
    }
    let r2 = reopen(&second);
    for (a, b) in m.pages.iter().zip(&r2.pages) {
        assert_eq!(
            comparable(&b.objects),
            comparable(&a.objects),
            "second reopen"
        );
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn deleted_objects_disappear_and_signatures_are_not_restored() {
    let dir = temp_dir("reopen-delete");
    let m = model_from(&[(fixture("rotated.pdf"), None)]);
    let first = dir.join("first.pdf");
    export_to_file(&m, &ctx(), &first).unwrap();
    let mut r = reopen(&first);
    assert!(r.pages.iter().all(|p| {
        p.objects
            .iter()
            .all(|o| !matches!(o, PageObject::Signature(_)))
    }));
    let before = r.pages[0].objects.len();
    r.pages[0].objects.remove(1);
    let second = dir.join("second.pdf");
    export_to_file(&r, &ctx(), &second).unwrap();
    assert_eq!(reopen(&second).pages[0].objects.len(), before - 1);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_annotation_moved_by_another_program_stays_an_annotation() {
    let dir = temp_dir("reopen-moved");
    let m = model_from(&[(fixture("rotated.pdf"), None)]);
    let first = dir.join("first.pdf");
    export_to_file(&m, &ctx(), &first).unwrap();

    // Another program moves the rectangle annotation on page 1 by 10 pt.
    let mut doc = Document::load(&first).unwrap();
    let page = pages(&doc)[0];
    let target = app_annots(&doc, page)
        .into_iter()
        .map(|o| o.as_reference().unwrap())
        .find(|id| {
            doc.get_dictionary(*id)
                .unwrap()
                .get(b"Subtype")
                .unwrap()
                .as_name()
                .unwrap()
                == b"Square"
        })
        .unwrap();
    let d = doc.get_dictionary_mut(target).unwrap();
    let r: Vec<f32> = d
        .get(b"Rect")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_float().unwrap())
        .collect();
    d.set(
        "Rect",
        vec![
            (r[0] + 10.0).into(),
            r[1].into(),
            (r[2] + 10.0).into(),
            r[3].into(),
        ],
    );
    let moved = dir.join("moved.pdf");
    doc.save(&moved).unwrap();

    let restored = reopen(&moved);
    let kinds: Vec<&str> = restored.pages[0]
        .objects
        .iter()
        .map(|o| match o {
            PageObject::Rect(_) => "rect",
            _ => "other",
        })
        .collect();
    assert!(
        !kinds.contains(&"rect"),
        "the moved rectangle is not restored"
    );
    assert_eq!(
        restored.pages[0].objects.len(),
        comparable(&m.pages[0].objects).len() - 1
    );

    // It is still drawn (rendering bytes keep it) and saving keeps it as an annotation.
    let rendered = reparse(
        &render_bytes(&std::fs::read(&moved).unwrap(), None)
            .unwrap()
            .unwrap(),
    );
    assert_eq!(app_annots(&rendered, pages(&rendered)[0]).len(), 1);
    let second = dir.join("second.pdf");
    export_to_file(&restored, &ctx(), &second).unwrap();
    let out = reparse(&std::fs::read(&second).unwrap());
    let p0 = pages(&out)[0];
    assert_eq!(
        app_annots(&out, p0).len(),
        restored.pages[0].objects.len() + 1
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn rendering_bytes_drop_restored_annotations_and_keep_links() {
    let dir = temp_dir("reopen-render");
    // A source with a link annotation on page 1.
    let mut src = Document::load(fixture("rotated.pdf")).unwrap();
    let p1 = pages(&src)[0];
    let link = src.add_object(dictionary! {
        "Type" => "Annot", "Subtype" => "Link",
        "Rect" => vec![10.into(), 10.into(), 100.into(), 30.into()],
        "A" => dictionary! { "S" => "URI", "URI" => Object::string_literal("https://example.invalid/") },
    });
    src.get_dictionary_mut(p1)
        .unwrap()
        .set("Annots", vec![Object::Reference(link)]);
    let linked = dir.join("linked.pdf");
    src.save(&linked).unwrap();

    // No app annotations yet: nothing to change.
    assert!(
        render_bytes(&std::fs::read(&linked).unwrap(), None)
            .unwrap()
            .is_none()
    );
    assert!(
        render_bytes(&std::fs::read(fixture("photo.jpg")).unwrap(), None)
            .unwrap()
            .is_none()
    );

    let m = model_from(&[(linked.clone(), None)]);
    let saved = dir.join("saved.pdf");
    export_to_file(&m, &ctx(), &saved).unwrap();
    let out = reparse(&std::fs::read(&saved).unwrap());
    assert_eq!(
        all_annots(&out, pages(&out)[0]),
        1 + comparable(&m.pages[0].objects).len()
    );

    let rendered = reparse(
        &render_bytes(&std::fs::read(&saved).unwrap(), None)
            .unwrap()
            .unwrap(),
    );
    for id in pages(&rendered) {
        assert!(app_annots(&rendered, id).is_empty());
    }
    assert_eq!(
        all_annots(&rendered, pages(&rendered)[0]),
        1,
        "the link stays"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn flattening_leaves_no_app_annotations() {
    let dir = temp_dir("reopen-flatten");
    let m = model_from(&[(fixture("rotated.pdf"), None)]);
    let flat = dir.join("flat.pdf");
    let ctx = ExportContext {
        options: ExportOptions { flatten: true },
        ..ctx()
    };
    export_to_file(&m, &ctx, &flat).unwrap();
    let out = reparse(&std::fs::read(&flat).unwrap());
    for (p, id) in m.pages.iter().zip(pages(&out)) {
        assert!(app_annots(&out, id).is_empty(), "{}", p.id);
        // Every object is baked: one form XObject per object.
        let res = out.get_dictionary(id).unwrap().get(b"Resources").unwrap();
        let res = resolve(&out, res).unwrap().as_dict().unwrap();
        let xo = resolve(&out, res.get(b"XObject").unwrap())
            .unwrap()
            .as_dict()
            .unwrap();
        let baked = xo.iter().filter(|(k, _)| k.starts_with(b"PdfEdX")).count();
        assert_eq!(baked, p.objects.len(), "{}", p.id);
    }
    assert!(reopen(&flat).pages.iter().all(|p| p.objects.is_empty()));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_encrypted_source_round_trips() {
    let dir = temp_dir("reopen-encrypted");
    let mut m = model_from(&[(fixture("encrypted_aes256.pdf"), Some(FIXTURE_PASSWORD))]);
    m.pages.truncate(1);
    let ctx = ExportContext {
        passwords: HashMap::from([(m.sources[0].id.clone(), FIXTURE_PASSWORD.to_owned())]),
        ..ctx()
    };
    let out = dir.join("out.pdf");
    export_to_file(&m, &ctx, &out).unwrap();
    let info = inspect_path(&out, None).unwrap();
    assert!(!info.encrypted);
    assert_eq!(
        comparable(&info.pages[0].objects),
        comparable(&m.pages[0].objects)
    );
    let _ = std::fs::remove_dir_all(dir);
}
