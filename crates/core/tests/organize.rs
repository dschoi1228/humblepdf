//! M2: a model changed the way the page panel changes it (move, delete, rotate, image fit)
//! is saved with the pages in model order, rotation and size; sources stay untouched and
//! cannot be the output. Every test re-parses the output (CLAUDE.md completion criteria).

mod common;

use std::collections::HashMap;
use std::path::Path;

use common::*;
use humblepdf_core::CoreError;
use humblepdf_core::export::{ExportContext, export_to_file};
use humblepdf_core::model::{Document as Model, ImageFit, Rotation};
use humblepdf_core::source::{build_model, inspect_path};

/// pages_300.pdf draws its page number as `(N) Tj` in a second content stream.
fn page_number(out: &lopdf::Document, id: lopdf::ObjectId) -> Option<u32> {
    let content = out.get_page_content(id);
    let text = String::from_utf8_lossy(&content);
    // The big number is the last text; the first one reads "Page N of 300".
    let end = text.rfind(") Tj ET")?;
    let start = text[..end].rfind('(')? + 1;
    text[start..end].parse().ok()
}

fn organized_model() -> (Model, ExportContext) {
    let files = [
        fixture("pages_300.pdf"),
        fixture("photo.jpg"),
        fixture("encrypted_aes256.pdf"),
    ];
    let list: Vec<(&Path, Option<&str>)> = vec![
        (files[0].as_path(), None),
        (files[1].as_path(), None),
        (files[2].as_path(), Some(FIXTURE_PASSWORD)),
    ];
    let mut model = build_model(&list).unwrap();
    assert_eq!(model.pages.len(), 302);
    let encrypted_id = model.sources[2].id.clone();

    // Keep pages 1..=10 of pages_300, the photo and the encrypted page (deletes 290 pages).
    let keep: Vec<_> = model
        .pages
        .iter()
        .filter(|p| p.source_id != model.sources[0].id || p.page_index < 10)
        .cloned()
        .collect();
    model.pages = keep;
    // Move the photo first and page 10 before page 2; delete page 5.
    let photo = model.pages.remove(10);
    model.pages.insert(0, photo);
    let ten = model.pages.remove(10);
    model.pages.insert(2, ten);
    model
        .pages
        .retain(|p| !(p.source_id == model.sources[0].id && p.page_index == 4));
    // Rotations: all four values, on pages with and without /Rotate.
    for (i, r) in [Rotation::R90, Rotation::R180, Rotation::R270, Rotation::R0]
        .into_iter()
        .enumerate()
    {
        model.pages[i + 1].user_rotation = r;
    }
    // Page 7 of pages_300 already has /Rotate 90; turn it further.
    for p in model.pages.iter_mut().filter(|p| p.page_index == 6) {
        p.user_rotation = Rotation::R270;
    }
    // Image page with the `image` fit: its box comes from the core layout.
    let info = inspect_path(&fixture("photo.jpg"), None).unwrap();
    let layout = info.image.unwrap();
    model.pages[0].image_fit = Some(ImageFit::Image);
    model.pages[0].page_box = layout.image.page_box;

    let ctx = ExportContext {
        passwords: HashMap::from([(encrypted_id, FIXTURE_PASSWORD.to_owned())]),
        ..Default::default()
    };
    (model, ctx)
}

#[test]
fn saved_pdf_matches_the_organized_model_and_sources_are_untouched() {
    let (model, ctx) = organized_model();
    let sources: Vec<_> = model.sources.iter().map(|s| s.path.clone()).collect();
    let before: Vec<u64> = sources.iter().map(|p| file_hash(Path::new(p))).collect();

    let dir = temp_dir("organize");
    let out_path = dir.join("정리 결과.pdf");
    let summary = export_to_file(&model, &ctx, &out_path).unwrap();
    assert_eq!(summary.page_count as usize, model.pages.len());

    let out = reparse(&std::fs::read(&out_path).unwrap());
    let ids = pages(&out);
    assert_eq!(ids.len(), model.pages.len(), "page count");
    assert!(!out.trailer.has(b"Encrypt"), "output must not be encrypted");

    let pdf300 = &model.sources[0].id;
    for (i, (p, id)) in model.pages.iter().zip(&ids).enumerate() {
        // Order: pages of pages_300 carry their number in the content.
        if &p.source_id == pdf300 {
            assert_eq!(
                page_number(&out, *id),
                Some(p.page_index + 1),
                "output page {}",
                i + 1
            );
        }
        assert_eq!(
            rotate(&out, *id),
            p.display_rotation().degrees(),
            "output page {} rotation",
            i + 1
        );
        let b = page_box(&out, *id);
        assert!(
            (b.width() - p.page_box.width()).abs() < 1e-3
                && (b.height() - p.page_box.height()).abs() < 1e-3,
            "output page {} size {b:?} != {:?}",
            i + 1,
            p.page_box
        );
    }
    // The image page uses the `image` fit: page proportions follow the photo.
    let photo_box = page_box(&out, ids[0]);
    assert!((photo_box.height().max(photo_box.width()) - 841.89).abs() < 1e-2);

    let after: Vec<u64> = sources.iter().map(|p| file_hash(Path::new(p))).collect();
    assert_eq!(before, after, "sources must not change");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn saving_over_any_source_is_refused_without_touching_it() {
    let (model, ctx) = organized_model();
    for s in &model.sources {
        let p = Path::new(&s.path);
        let before = file_hash(p);
        // Windows paths compare case-insensitively.
        let upper = p.with_file_name(p.file_name().unwrap().to_string_lossy().to_uppercase());
        for target in [p.to_path_buf(), upper] {
            let r = export_to_file(&model, &ctx, &target);
            assert!(
                matches!(r, Err(CoreError::OutputIsSource)),
                "{}",
                target.display()
            );
        }
        assert_eq!(file_hash(p), before, "{}", s.path);
    }
}
