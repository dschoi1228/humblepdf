//! M4: signature images are normalized for the library (SPEC 6.8), and placed signatures are
//! baked into the page content with one image, whatever the page rotation (SPEC 7.5).
//! Export tests re-parse the output (CLAUDE.md completion criteria).

mod common;

use std::io::Cursor;
use std::path::Path;

use common::*;
use image::{GenericImageView, ImageFormat, Rgba, RgbaImage};
use lopdf::{Document, Object, ObjectId};
use pdf_editor_core::CoreError;
use pdf_editor_core::export::annot::OBJECT_KEY;
use pdf_editor_core::export::{ExportContext, export_to_bytes};
use pdf_editor_core::model::{Document as Model, PageObject, Rect, Rotation, Signature};
use pdf_editor_core::pdf_util::{as_number, resolve};
use pdf_editor_core::signature::{MAX_SIDE, normalize};
use pdf_editor_core::source::{build_model, image_header};

fn png_bytes(img: &RgbaImage) -> Vec<u8> {
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .unwrap();
    out
}

#[test]
fn normalize_makes_an_rgba_png_with_orientation_applied() {
    // JPEG with EXIF orientation 6 (rotate 90): stored landscape, shown portrait.
    let jpg = std::fs::read(fixture("exif_rotate90.jpg")).unwrap();
    let (sw, sh, _) = image_header(&jpg).unwrap();
    let n = normalize(&jpg).unwrap();
    assert_eq!((n.width, n.height), (sh, sw), "orientation applied");
    let img = image::load_from_memory_with_format(&n.png, ImageFormat::Png).unwrap();
    assert_eq!(img.dimensions(), (n.width, n.height));
    assert!(img.color().has_alpha());
}

#[test]
fn normalize_keeps_transparency() {
    let n = normalize(&std::fs::read(fixture("alpha.png")).unwrap()).unwrap();
    let img = image::load_from_memory(&n.png).unwrap().to_rgba8();
    assert!(img.pixels().any(|p| p.0[3] == 0), "transparent pixels kept");
    assert!(img.pixels().any(|p| p.0[3] == 255), "opaque pixels kept");
}

#[test]
fn normalize_reduces_the_long_side_to_2000px() {
    let mut big = RgbaImage::from_pixel(8000, 400, Rgba([0, 0, 0, 0]));
    for x in 0..8000 {
        big.put_pixel(x, 200, Rgba([10, 20, 200, 255]));
    }
    let n = normalize(&png_bytes(&big)).unwrap();
    assert_eq!((n.width, n.height), (MAX_SIDE, 100));
    // A small image is kept as is.
    let small = RgbaImage::from_pixel(300, 120, Rgba([1, 2, 3, 128]));
    let n = normalize(&png_bytes(&small)).unwrap();
    assert_eq!((n.width, n.height), (300, 120));
}

#[test]
fn normalize_refuses_other_files() {
    let pdf = std::fs::read(fixture("rotated.pdf")).unwrap();
    assert!(matches!(normalize(&pdf), Err(CoreError::UnknownFormat)));
    let mut broken = std::fs::read(fixture("alpha.png")).unwrap();
    broken.truncate(60);
    assert!(matches!(
        normalize(&broken),
        Err(CoreError::InvalidImage(_))
    ));
}

/// rotated.pdf pages 1-4 (0/90/180/270) and an image page, each with the same signature
/// placed upright (rotation = the page's display rotation), twice on the first page.
fn model() -> Model {
    let files = [fixture("rotated.pdf"), fixture("photo.jpg")];
    let list: Vec<(&Path, Option<&str>)> = files.iter().map(|f| (f.as_path(), None)).collect();
    let mut m = build_model(&list).unwrap();
    m.pages
        .retain(|p| p.source_id != m.sources[0].id || p.page_index < 4);
    for (i, page) in m.pages.iter_mut().enumerate() {
        let b = page.page_box;
        let r = page.display_rotation();
        // 120 x 40 pt upright on screen: swapped in user space at 90/270.
        let (w, h) = if matches!(r, Rotation::R90 | Rotation::R270) {
            (40.0, 120.0)
        } else {
            (120.0, 40.0)
        };
        let at = |x: f64, y: f64| Rect::new(b.x0 + x, b.y0 + y, b.x0 + x + w, b.y0 + y + h);
        page.objects.push(PageObject::Signature(Signature {
            id: format!("sig-{i}-a"),
            signature_id: "sig-demo".into(),
            rect: at(60.0, 80.0),
            rotation: r,
        }));
        if i == 0 {
            page.objects.push(PageObject::Signature(Signature {
                id: format!("sig-{i}-b"),
                signature_id: "sig-demo".into(),
                rect: at(250.0, 300.0),
                rotation: r,
            }));
        }
    }
    m
}

fn ctx() -> ExportContext {
    ExportContext {
        signature_dir: Some(fixture("signatures")),
        ..Default::default()
    }
}

fn form_xobjects(doc: &Document, page: ObjectId) -> Vec<(Vec<u8>, ObjectId)> {
    let p = doc.get_dictionary(page).unwrap();
    let res = resolve(doc, p.get(b"Resources").unwrap())
        .unwrap()
        .as_dict()
        .unwrap();
    let Ok(x) = res.get(b"XObject") else {
        return vec![];
    };
    resolve(doc, x)
        .unwrap()
        .as_dict()
        .unwrap()
        .iter()
        .filter(|(k, _)| k.starts_with(b"PdfEdX"))
        .map(|(k, v)| (k.clone(), v.as_reference().unwrap()))
        .collect()
}

#[test]
fn signatures_are_baked_once_per_image_on_every_rotation() {
    let m = model();
    let sources: Vec<_> = m.sources.iter().map(|s| s.path.clone()).collect();
    let before: Vec<u64> = sources.iter().map(|p| file_hash(Path::new(p))).collect();

    let (bytes, warnings) = export_to_bytes(&m, &ctx()).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    let out = reparse(&bytes);
    let ids = pages(&out);
    assert_eq!(ids.len(), m.pages.len());

    for (i, (page, id)) in m.pages.iter().zip(&ids).enumerate() {
        assert_eq!(rotate(&out, *id), page.display_rotation().degrees());
        // Not annotations.
        let annots = out
            .get_dictionary(*id)
            .unwrap()
            .get(b"Annots")
            .ok()
            .and_then(|a| resolve(&out, a))
            .and_then(|a| a.as_array().ok())
            .map(|a| a.len())
            .unwrap_or(0);
        assert_eq!(annots, 0, "page {i}: signatures must not be annotations");
        // The original content is wrapped in q ... Q before the signature is drawn.
        let contents = out.get_page_contents(*id);
        let first = out.get_object(contents[0]).unwrap().as_stream().unwrap();
        assert_eq!(first.decompressed_content().unwrap(), b"q\n", "page {i}");
        let last = out
            .get_object(*contents.last().unwrap())
            .unwrap()
            .as_stream()
            .unwrap();
        let text = String::from_utf8(last.decompressed_content().unwrap()).unwrap();
        assert!(text.starts_with("Q\n"), "page {i}: {text}");
        // One form XObject per placed signature, with the object's rect as its BBox.
        let forms = form_xobjects(&out, *id);
        assert_eq!(forms.len(), page.objects.len(), "page {i}");
        for (o, (name, fid)) in page.objects.iter().zip(&forms) {
            let PageObject::Signature(s) = o else {
                unreachable!()
            };
            assert!(
                text.contains(&format!("/{} Do", String::from_utf8_lossy(name))),
                "page {i}: {text}"
            );
            let form = out.get_object(*fid).unwrap().as_stream().unwrap();
            assert!(!form.dict.has(OBJECT_KEY.as_bytes()));
            let bbox: Vec<f64> = form
                .dict
                .get(b"BBox")
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .map(|v| as_number(v).unwrap())
                .collect();
            let r = s.rect;
            assert!(
                bbox.iter()
                    .zip([r.x0, r.y0, r.x1, r.y1])
                    .all(|(a, b)| (a - b).abs() < 1e-3),
                "page {i}: BBox {bbox:?} vs {r:?}"
            );
        }
    }

    // One image (RGB + SMask) for all six placements.
    let sig_images = out
        .objects
        .values()
        .filter_map(|o| o.as_stream().ok())
        .filter(|s| {
            s.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Image")
                && s.dict.get(b"Width").and_then(Object::as_i64).ok() == Some(600)
                && s.dict.has(b"SMask")
        })
        .count();
    assert_eq!(sig_images, 1);

    let after: Vec<u64> = sources.iter().map(|p| file_hash(Path::new(p))).collect();
    assert_eq!(before, after, "sources must not change");
}

#[test]
fn a_missing_signature_file_is_reported() {
    let dir = temp_dir("no-signatures");
    let ctx = ExportContext {
        signature_dir: Some(dir.clone()),
        ..Default::default()
    };
    let r = export_to_bytes(&model(), &ctx);
    assert!(
        matches!(&r, Err(CoreError::SignatureMissing(id)) if id == "sig-demo"),
        "{:?}",
        r.map(|_| ())
    );
    assert_eq!(
        CoreError::SignatureMissing("x".into()).code(),
        "signature_missing"
    );
    let _ = std::fs::remove_dir_all(dir);
}
