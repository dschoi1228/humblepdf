//! M0-3: merging PDFs and images, page-structure fixtures, encrypted sources.
//! Every test re-parses the output (CLAUDE.md completion criteria).

mod common;

use std::collections::HashMap;
use std::path::Path;

use common::*;
use pdf_editor_core::CoreError;
use pdf_editor_core::export::{ExportContext, export_to_bytes, export_to_file};
use pdf_editor_core::model::{Document as Model, ImageFit, Rotation};
use pdf_editor_core::source::{build_model, inspect_path};

fn model_of(files: &[&str]) -> Model {
    let paths: Vec<_> = files.iter().map(|f| fixture(f)).collect();
    let list: Vec<(&Path, Option<&str>)> = paths
        .iter()
        .map(|p| {
            let pw = p
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("encrypted")
                .then_some(FIXTURE_PASSWORD);
            (p.as_path(), pw)
        })
        .collect();
    build_model(&list).unwrap()
}

fn ctx_with_passwords(model: &Model) -> ExportContext {
    let passwords: HashMap<String, String> = model
        .sources
        .iter()
        .filter(|s| s.path.contains("encrypted"))
        .map(|s| (s.id.clone(), FIXTURE_PASSWORD.to_owned()))
        .collect();
    ExportContext {
        passwords,
        ..Default::default()
    }
}

/// Checks page count, order (by box and rotation) and that each page has resources.
fn assert_matches_model(model: &Model, bytes: &[u8]) {
    let out = reparse(bytes);
    let ids = pages(&out);
    assert_eq!(ids.len(), model.pages.len(), "page count");
    for (p, id) in model.pages.iter().zip(&ids) {
        assert!(
            approx(&page_box(&out, *id), &p.page_box),
            "page {}: box {:?} != {:?}",
            p.id,
            page_box(&out, *id),
            p.page_box
        );
        assert_eq!(
            rotate(&out, *id),
            p.display_rotation().degrees(),
            "page {} rotation",
            p.id
        );
        let page = out.get_dictionary(*id).unwrap();
        assert!(page.has(b"Resources"), "page {} resources", p.id);
        assert!(page.has(b"Contents"), "page {} contents", p.id);
    }
    assert!(!out.trailer.has(b"Encrypt"), "output must not be encrypted");
}

#[test]
fn merges_two_pdfs_a_jpeg_and_a_png() {
    let files = [
        "rotated.pdf",
        "mixed_sizes.pdf",
        "photo.jpg",
        "alpha.png",
        "exif_rotate90.jpg",
    ];
    let hashes: Vec<u64> = files.iter().map(|f| file_hash(&fixture(f))).collect();
    let model = model_of(&files);
    assert_eq!(model.pages.len(), 5 + 4 + 3);

    let dir = temp_dir("merge");
    let out_path = dir.join("병합 결과.pdf");
    let summary = export_to_file(&model, &ExportContext::default(), &out_path).unwrap();
    assert_eq!(summary.page_count, 12);
    let bytes = std::fs::read(&out_path).unwrap();
    assert_matches_model(&model, &bytes);

    let out = reparse(&bytes);
    let ids = pages(&out);
    // photo.jpg: JPEG passed through with DCTDecode, no re-encoding.
    let imgs = page_images(&out, ids[9]);
    assert_eq!(imgs.len(), 1);
    assert_eq!(name(&imgs[0].1.dict, b"Filter"), Some(&b"DCTDecode"[..]));
    assert_eq!(
        imgs[0].1.content,
        std::fs::read(fixture("photo.jpg")).unwrap()
    );
    // alpha.png: RGB + SMask.
    let imgs = page_images(&out, ids[10]);
    assert!(
        imgs[0].1.dict.has(b"SMask"),
        "PNG alpha must become an SMask"
    );
    // EXIF orientation 6: stored landscape, page is portrait A4.
    let b = page_box(&out, ids[11]);
    assert!(b.height() > b.width());

    // Producer only, no user name.
    let info = out.trailer.get(b"Info").unwrap().as_reference().unwrap();
    let info = out.get_dictionary(info).unwrap();
    assert_eq!(
        info.get(b"Producer").unwrap().as_str().unwrap(),
        pdf_editor_core::PRODUCER.as_bytes()
    );
    assert!(!info.has(b"Author"));

    // Sources are unchanged.
    for (f, h) in files.iter().zip(hashes) {
        assert_eq!(file_hash(&fixture(f)), h, "{f} changed");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn handles_every_page_structure_fixture() {
    for f in [
        "rotated.pdf",
        "cropbox.pdf",
        "mixed_sizes.pdf",
        "inherited.pdf",
        "shared_resources.pdf",
        "content_array.pdf",
        "korean_embedded.pdf",
        "korean_nonembedded.pdf",
    ] {
        let model = model_of(&[f]);
        let (bytes, _) = export_to_bytes(&model, &ExportContext::default())
            .unwrap_or_else(|e| panic!("{f}: {e}"));
        assert_matches_model(&model, &bytes);
    }
}

#[test]
fn reorders_deletes_and_rotates_with_inherited_attributes() {
    let mut model = model_of(&["inherited.pdf", "shared_resources.pdf"]);
    // inherited.pdf has 3 pages, shared_resources.pdf has 3.
    model.pages.swap(0, 4);
    model.pages.remove(2);
    model.pages[0].user_rotation = Rotation::R90;
    model.pages[1].user_rotation = Rotation::R270;
    let (bytes, _) = export_to_bytes(&model, &ExportContext::default()).unwrap();
    assert_matches_model(&model, &bytes);

    // The deleted page is gone, not just unlinked.
    let out = reparse(&bytes);
    assert_eq!(out.get_pages().len(), 5);
    let page_objects = out
        .objects
        .values()
        .filter(|o| {
            o.as_dict()
                .ok()
                .and_then(|d| d.get(b"Type").ok())
                .and_then(|t| t.as_name().ok())
                == Some(b"Page")
        })
        .count();
    assert_eq!(page_objects, 5, "unused pages must be removed");
}

#[test]
fn content_array_is_kept() {
    let model = model_of(&["content_array.pdf"]);
    let (bytes, _) = export_to_bytes(&model, &ExportContext::default()).unwrap();
    let out = reparse(&bytes);
    let id = pages(&out)[0];
    assert_eq!(out.get_page_contents(id).len(), 3);
}

#[test]
fn encrypted_sources_need_the_password_and_output_is_plain() {
    for f in ["encrypted_aes256.pdf", "encrypted_rc4.pdf"] {
        let p = fixture(f);
        assert!(
            matches!(inspect_path(&p, None), Err(CoreError::PasswordRequired)),
            "{f}"
        );
        assert!(
            matches!(
                inspect_path(&p, Some("nope")),
                Err(CoreError::WrongPassword)
            ),
            "{f}"
        );
        let info = inspect_path(&p, Some(FIXTURE_PASSWORD)).unwrap();
        assert!(info.encrypted);

        let model = model_of(&[f, "photo.jpg"]);
        // Without the password the export fails with a distinguishable error.
        assert!(matches!(
            export_to_bytes(&model, &ExportContext::default()),
            Err(CoreError::PasswordRequired)
        ));
        let (bytes, _) = export_to_bytes(&model, &ctx_with_passwords(&model)).unwrap();
        assert_matches_model(&model, &bytes);
    }
}

#[test]
fn image_only_document_and_fit_modes() {
    let mut model = model_of(&["photo.jpg", "alpha.png"]);
    let info = inspect_path(&fixture("alpha.png"), None).unwrap();
    model.pages[1].image_fit = Some(ImageFit::Image);
    model.pages[1].page_box = info.image.unwrap().image.page_box;
    let (bytes, _) = export_to_bytes(&model, &ExportContext::default()).unwrap();
    assert_matches_model(&model, &bytes);
}

#[test]
fn rejects_output_equal_to_a_source() {
    let dir = temp_dir("same");
    let src = dir.join("원본.pdf");
    std::fs::copy(fixture("rotated.pdf"), &src).unwrap();
    let model = build_model(&[(src.as_path(), None)]).unwrap();
    let before = file_hash(&src);
    let err = export_to_file(&model, &ExportContext::default(), &src).unwrap_err();
    assert!(matches!(err, CoreError::OutputIsSource));
    assert_eq!(file_hash(&src), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rejects_a_model_whose_box_differs_from_the_source() {
    let mut model = model_of(&["cropbox.pdf"]);
    model.pages[0].page_box.x1 += 5.0;
    assert!(matches!(
        export_to_bytes(&model, &ExportContext::default()),
        Err(CoreError::InvalidModel(_))
    ));
}
