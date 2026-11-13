//! Source inspection (`open_source`): file type detection, page boxes and image layouts.

use std::io::Cursor;
use std::path::Path;

use image::ImageDecoder;
use image::metadata::Orientation;
use lopdf::{Document, LoadOptions};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{CoreError, Result};
use crate::model::{ImageFit, Rect, Rotation, SourceKind};
use crate::pdf_util;

/// A4 short side in pt.
pub const A4_SHORT: f64 = 595.276;
/// A4 long side in pt. Also the long side of `image` fit pages.
pub const A4_LONG: f64 = 841.89;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "SourceInfo.ts")]
pub struct SourceInfo {
    pub kind: SourceKind,
    pub pages: Vec<PageInfo>,
    /// True if the PDF was encrypted. The output is never encrypted (SPEC 6.1).
    pub encrypted: bool,
    /// Only for image sources.
    pub image: Option<ImageInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "PageInfo.ts")]
pub struct PageInfo {
    pub page_index: u32,
    /// Visible area for PDF pages; for image pages, the box of the default (`a4`) fit.
    #[serde(rename = "box")]
    #[ts(rename = "box")]
    pub page_box: Rect,
    pub base_rotation: Rotation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "ImageInfo.ts")]
pub struct ImageInfo {
    /// Pixel size after applying the EXIF orientation.
    pub pixel_width: u32,
    pub pixel_height: u32,
    /// EXIF orientation value (1..=8). 1 when absent.
    pub exif_orientation: u8,
    pub a4: ImageLayout,
    pub image: ImageLayout,
}

impl ImageInfo {
    pub fn layout(&self, fit: ImageFit) -> &ImageLayout {
        match fit {
            ImageFit::A4 => &self.a4,
            ImageFit::Image => &self.image,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "ImageLayout.ts")]
pub struct ImageLayout {
    /// Page box in pt, origin at 0,0.
    #[serde(rename = "box")]
    #[ts(rename = "box")]
    pub page_box: Rect,
    /// Where the upright image is drawn on the page.
    pub image_rect: Rect,
}

/// Detects the source kind from the file content, not the extension.
pub fn detect_kind(bytes: &[u8]) -> Option<SourceKind> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) || bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(SourceKind::Image);
    }
    // pdf.js accepts a header anywhere in the first 1024 bytes.
    let head = &bytes[..bytes.len().min(1024)];
    if head.windows(5).any(|w| w == b"%PDF-") {
        return Some(SourceKind::Pdf);
    }
    None
}

pub fn inspect_path(path: &Path, password: Option<&str>) -> Result<SourceInfo> {
    let bytes = std::fs::read(path)?;
    inspect_bytes(&bytes, password)
}

pub fn inspect_bytes(bytes: &[u8], password: Option<&str>) -> Result<SourceInfo> {
    match detect_kind(bytes) {
        Some(SourceKind::Pdf) => inspect_pdf(bytes, password),
        Some(SourceKind::Image) => inspect_image(bytes),
        None => Err(CoreError::UnknownFormat),
    }
}

/// Loads a PDF, decrypting it if needed. Distinguishes "password required" and
/// "wrong password" from other failures.
pub fn load_pdf(bytes: &[u8], password: Option<&str>) -> Result<Document> {
    let options = match password {
        Some(p) => LoadOptions::with_password(p),
        None => LoadOptions::default(),
    };
    let doc = match Document::load_mem_with_options(bytes, options) {
        Ok(d) => d,
        Err(lopdf::Error::InvalidPassword) => {
            return Err(if password.is_some() {
                CoreError::WrongPassword
            } else {
                CoreError::PasswordRequired
            });
        }
        Err(e) => return Err(CoreError::UnreadablePdf(e.to_string())),
    };
    if doc.is_encrypted() {
        return Err(if password.is_some() {
            CoreError::WrongPassword
        } else {
            CoreError::PasswordRequired
        });
    }
    Ok(doc)
}

fn inspect_pdf(bytes: &[u8], password: Option<&str>) -> Result<SourceInfo> {
    let doc = load_pdf(bytes, password)?;
    let pages = doc.get_pages();
    if pages.is_empty() {
        return Err(CoreError::UnreadablePdf("no pages".into()));
    }
    let mut out = Vec::with_capacity(pages.len());
    for (i, (_, page_id)) in pages.iter().enumerate() {
        let uu = pdf_util::user_unit(&doc, *page_id);
        if (uu - 1.0).abs() > 1e-9 {
            return Err(CoreError::Unsupported(format!(
                "page {} uses UserUnit {uu}",
                i + 1
            )));
        }
        out.push(PageInfo {
            page_index: i as u32,
            page_box: pdf_util::page_box(&doc, *page_id),
            base_rotation: pdf_util::page_rotation(&doc, *page_id),
        });
    }
    Ok(SourceInfo {
        kind: SourceKind::Pdf,
        pages: out,
        encrypted: doc.was_encrypted(),
        image: None,
    })
}

/// Reads the pixel size and EXIF orientation of an image without decoding the pixels.
pub fn image_header(bytes: &[u8]) -> Result<(u32, u32, Orientation)> {
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| CoreError::InvalidImage(e.to_string()))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| CoreError::InvalidImage(e.to_string()))?;
    let (w, h) = decoder.dimensions();
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    Ok((w, h, orientation))
}

/// True when the orientation swaps width and height.
pub fn orientation_swaps_axes(o: Orientation) -> bool {
    matches!(
        o,
        Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH
    )
}

fn inspect_image(bytes: &[u8]) -> Result<SourceInfo> {
    let (w, h, orientation) = image_header(bytes)?;
    if w == 0 || h == 0 {
        return Err(CoreError::InvalidImage("empty image".into()));
    }
    let (pw, ph) = if orientation_swaps_axes(orientation) {
        (h, w)
    } else {
        (w, h)
    };
    let info = ImageInfo {
        pixel_width: pw,
        pixel_height: ph,
        exif_orientation: orientation.to_exif(),
        a4: layout_a4(pw, ph),
        image: layout_image(pw, ph),
    };
    Ok(SourceInfo {
        kind: SourceKind::Image,
        pages: vec![PageInfo {
            page_index: 0,
            page_box: info.a4.page_box,
            base_rotation: Rotation::R0,
        }],
        encrypted: false,
        image: Some(info),
    })
}

/// `a4` fit: A4 paper, landscape when the image is wider than tall, image centered
/// and scaled to fit without margin (SPEC 6.1).
pub fn layout_a4(pw: u32, ph: u32) -> ImageLayout {
    let (w, h) = (f64::from(pw), f64::from(ph));
    let (page_w, page_h) = if w > h {
        (A4_LONG, A4_SHORT)
    } else {
        (A4_SHORT, A4_LONG)
    };
    let scale = (page_w / w).min(page_h / h);
    let (iw, ih) = (w * scale, h * scale);
    let x0 = (page_w - iw) / 2.0;
    let y0 = (page_h - ih) / 2.0;
    ImageLayout {
        page_box: Rect::new(0.0, 0.0, page_w, page_h),
        image_rect: Rect::new(x0, y0, x0 + iw, y0 + ih),
    }
}

/// `image` fit: page has the image's aspect ratio, long side A4_LONG.
pub fn layout_image(pw: u32, ph: u32) -> ImageLayout {
    let (w, h) = (f64::from(pw), f64::from(ph));
    let scale = A4_LONG / w.max(h);
    let r = Rect::new(0.0, 0.0, w * scale, h * scale);
    ImageLayout {
        page_box: r,
        image_rect: r,
    }
}

/// Builds a model with every page of the given files, in order, without objects.
/// Used by the CLI and tests; the app builds its model in the frontend from `open_source`.
pub fn build_model(files: &[(&Path, Option<&str>)]) -> Result<crate::model::Document> {
    use crate::model::{Document, Page, Source};
    let mut sources = Vec::new();
    let mut pages = Vec::new();
    for (i, (path, password)) in files.iter().enumerate() {
        let info = inspect_path(path, *password)?;
        let sid = format!("s{}", i + 1);
        for p in &info.pages {
            pages.push(Page {
                id: format!("p{}", pages.len() + 1),
                source_id: sid.clone(),
                page_index: p.page_index,
                image_fit: (info.kind == SourceKind::Image).then_some(ImageFit::A4),
                page_box: p.page_box,
                base_rotation: p.base_rotation,
                user_rotation: Rotation::R0,
                objects: Vec::new(),
            });
        }
        sources.push(Source {
            id: sid,
            kind: info.kind,
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(Document {
        schema_version: crate::model::SCHEMA_VERSION,
        sources,
        pages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_kinds() {
        assert_eq!(detect_kind(b"%PDF-1.7\n"), Some(SourceKind::Pdf));
        assert_eq!(detect_kind(b"\xEF\xBB\xBF%PDF-1.4"), Some(SourceKind::Pdf));
        assert_eq!(
            detect_kind(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(SourceKind::Image)
        );
        assert_eq!(
            detect_kind(b"\x89PNG\r\n\x1a\n...."),
            Some(SourceKind::Image)
        );
        assert_eq!(detect_kind(b"GIF89a"), None);
    }

    #[test]
    fn a4_layout_portrait_and_landscape() {
        let p = layout_a4(1000, 2000);
        assert_eq!(p.page_box, Rect::new(0.0, 0.0, A4_SHORT, A4_LONG));
        assert!((p.image_rect.height() - A4_LONG).abs() < 1e-9);
        assert!((p.image_rect.x0 - (A4_SHORT - A4_LONG / 2.0) / 2.0).abs() < 1e-9);

        let l = layout_a4(3000, 1000);
        assert_eq!(l.page_box, Rect::new(0.0, 0.0, A4_LONG, A4_SHORT));
        assert!((l.image_rect.width() - A4_LONG).abs() < 1e-9);
    }

    #[test]
    fn image_layout_long_side() {
        let l = layout_image(400, 300);
        assert!((l.page_box.width() - A4_LONG).abs() < 1e-9);
        assert!((l.page_box.height() - A4_LONG * 0.75).abs() < 1e-9);
    }
}
