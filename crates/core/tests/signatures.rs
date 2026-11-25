//! M4: signature images are normalized for the library (SPEC 6.8), and placed signatures are
//! baked into the page content with one image, whatever the page rotation (SPEC 7.5).
//! Export tests re-parse the output (CLAUDE.md completion criteria).

mod common;

use std::io::Cursor;
use std::path::Path;

use common::*;
use humblepdf_core::CoreError;
use humblepdf_core::export::annot::OBJECT_KEY;
use humblepdf_core::export::{ExportContext, export_to_bytes};
use humblepdf_core::model::{Document as Model, PageObject, Rect, Rotation, Signature};
use humblepdf_core::pdf_util::{as_number, resolve};
use humblepdf_core::signature::{MAX_SIDE, normalize};
use humblepdf_core::source::{build_model, image_header};
use image::{GenericImageView, ImageFormat, Rgba, RgbaImage};
use lopdf::{Document, Object, ObjectId};

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

// ---- White background removal (SPEC 6.8, D44) ----

use humblepdf_core::signature::{NormalizeOptions, normalize_with, remove_white};

/// A synthetic photo of a signature: grey paper with noise, a shadow band on the right,
/// a dark ink stroke in the middle and a soft (anti-aliased) edge next to it.
fn photo() -> image::RgbaImage {
    image::RgbaImage::from_fn(200, 100, |x, y| {
        let noise = ((x * 7 + y * 13) % 9) as u8; // 0..8
        let v = if (95..=105).contains(&x) && (20..80).contains(&y) {
            40 // ink
        } else if x == 106 && (20..80).contains(&y) {
            130 // edge: half ink, half paper
        } else if x >= 170 {
            190 + noise // shadow
        } else {
            218 + noise // paper
        };
        image::Rgba([v, v, v, 255])
    })
}

const PAPER: (u32, u32) = (20, 10);
const INK: (u32, u32) = (100, 50);
const EDGE: (u32, u32) = (106, 50);
const SHADOW: (u32, u32) = (185, 50);

fn alpha(img: &image::RgbaImage, (x, y): (u32, u32)) -> u8 {
    img.get_pixel(x, y)[3]
}

#[test]
fn white_removal_clears_paper_and_keeps_ink() {
    let mut img = photo();
    remove_white(&mut img, 50);
    assert_eq!(alpha(&img, PAPER), 0, "paper");
    assert_eq!(alpha(&img, INK), 255, "ink");
    assert_eq!(img.get_pixel(INK.0, INK.1)[0], 40, "ink colour is kept");
    let edge = img.get_pixel(EDGE.0, EDGE.1);
    assert!(
        edge[3] > 0 && edge[3] < 255,
        "the edge is partly transparent: {edge:?}"
    );
    assert!(
        edge[0] < 130,
        "the paper's share is taken out of the edge colour: {edge:?}"
    );
    assert_eq!(img.dimensions(), (200, 100));
}

#[test]
fn a_higher_strength_removes_darker_paper() {
    let shadow_alpha = |s| {
        let mut img = photo();
        remove_white(&mut img, s);
        alpha(&img, SHADOW)
    };
    let (low, mid, high) = (shadow_alpha(0), shadow_alpha(50), shadow_alpha(100));
    assert!(
        low > mid && mid >= high,
        "shadow alpha {low} > {mid} >= {high}"
    );
    assert_eq!(high, 0, "the strongest setting clears the shadow");
    assert!(low > 0, "the weakest setting keeps some of the shadow");
    // Ink stays at every strength.
    for s in [0, 50, 100] {
        let mut img = photo();
        remove_white(&mut img, s);
        assert_eq!(alpha(&img, INK), 255, "ink at strength {s}");
    }
}

#[test]
fn white_removal_keeps_existing_transparency() {
    let mut img = image::RgbaImage::from_fn(10, 10, |x, _| {
        if x < 5 {
            image::Rgba([0, 0, 0, 0])
        } else {
            image::Rgba([30, 30, 30, 255])
        }
    });
    remove_white(&mut img, 50);
    assert_eq!(img.get_pixel(0, 0)[3], 0);
    assert_eq!(
        img.get_pixel(9, 9)[3],
        255,
        "dark pixels of an image without paper stay"
    );
}

#[test]
fn normalize_with_removes_white_and_limits_the_preview_size() {
    let mut jpeg = Vec::new();
    image::DynamicImage::ImageRgb8(image::DynamicImage::ImageRgba8(photo()).to_rgb8())
        .write_to(&mut Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
        .unwrap();
    let plain = normalize_with(&jpeg, &NormalizeOptions::default()).unwrap();
    let decoded = image::load_from_memory(&plain.png).unwrap().to_rgba8();
    assert_eq!(
        alpha(&decoded, PAPER),
        255,
        "without removal the paper stays"
    );

    let opts = NormalizeOptions {
        remove_white: Some(50),
        max_side: 100,
    };
    let preview = normalize_with(&jpeg, &opts).unwrap();
    // Cropped to the ink (x 95..=106, y 20..80) with a 4 px margin; already under 100 px.
    assert_eq!((preview.width, preview.height), (20, 68));
    let decoded = image::load_from_memory(&preview.png).unwrap().to_rgba8();
    assert_eq!(alpha(&decoded, (1, 1)), 0, "the margin is transparent");
    assert_eq!(alpha(&decoded, (8, 34)), 255, "ink is opaque");
}

#[test]
fn white_removal_crops_to_the_ink_and_previews_match_the_stored_image() {
    use humblepdf_core::signature::crop_to_ink;
    // A small signature on a big sheet: 1000 x 600 paper, ink in a 100 x 40 box.
    let sheet = image::RgbaImage::from_fn(1000, 600, |x, y| {
        let ink = (400..500).contains(&x) && (300..340).contains(&y);
        let v = if ink { 30 } else { 220 + ((x + y) % 5) as u8 };
        image::Rgba([v, v, v, 255])
    });
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(sheet)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    let stored = normalize_with(
        &png,
        &NormalizeOptions {
            remove_white: Some(50),
            ..Default::default()
        },
    )
    .unwrap();
    // Margin: 2 % of 1000 = 20 px on each side.
    assert_eq!((stored.width, stored.height), (140, 80));
    let preview = normalize_with(
        &png,
        &NormalizeOptions {
            remove_white: Some(50),
            max_side: 70,
        },
    )
    .unwrap();
    assert_eq!(
        (preview.width, preview.height),
        (70, 40),
        "the stored image made smaller"
    );

    // Without removal nothing is cropped; an image without ink is kept whole.
    let plain = normalize_with(&png, &NormalizeOptions::default()).unwrap();
    assert_eq!((plain.width, plain.height), (1000, 600));
    let empty = image::RgbaImage::new(30, 20);
    assert_eq!(crop_to_ink(empty).dimensions(), (30, 20));
}
