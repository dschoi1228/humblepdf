//! Signature images (SPEC 6.8). Images are normalized when they are added to the signature
//! library: EXIF orientation applied, the long side reduced to `MAX_SIDE`, and stored as an
//! 8-bit RGBA PNG so transparency is kept.

use std::io::Cursor;

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};

use crate::error::{CoreError, Result};
use crate::source::image_header;

/// Longest side of a stored signature, in pixels.
pub const MAX_SIDE: u32 = 2000;

#[derive(Debug, Clone)]
pub struct NormalizedSignature {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

fn invalid(e: impl std::fmt::Display) -> CoreError {
    CoreError::InvalidImage(e.to_string())
}

/// Normalizes a PNG or JPEG file's bytes for the signature library.
pub fn normalize(bytes: &[u8]) -> Result<NormalizedSignature> {
    let format = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        ImageFormat::Png
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        ImageFormat::Jpeg
    } else {
        return Err(CoreError::UnknownFormat);
    };
    let (_, _, orientation) = image_header(bytes)?;
    let mut img = image::load_from_memory_with_format(bytes, format).map_err(invalid)?;
    img.apply_orientation(orientation);
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return Err(invalid("empty image"));
    }
    if w.max(h) > MAX_SIDE {
        let scale = f64::from(MAX_SIDE) / f64::from(w.max(h));
        let nw = ((f64::from(w) * scale).round() as u32).clamp(1, MAX_SIDE);
        let nh = ((f64::from(h) * scale).round() as u32).clamp(1, MAX_SIDE);
        img = img.resize_exact(nw, nh, FilterType::Lanczos3);
    }
    let rgba = DynamicImage::ImageRgba8(img.to_rgba8());
    let mut png = Vec::new();
    rgba.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(invalid)?;
    Ok(NormalizedSignature {
        png,
        width: rgba.width(),
        height: rgba.height(),
    })
}
