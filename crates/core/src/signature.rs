//! Signature images (SPEC 6.8). Images are normalized when they are added to the signature
//! library: EXIF orientation applied, the long side reduced to `MAX_SIDE`, and stored as an
//! 8-bit RGBA PNG so transparency is kept. The white background of a photographed or scanned
//! signature can be made transparent on the way in (SPEC 6.8, D44).

use std::io::Cursor;

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, RgbaImage};

use crate::error::{CoreError, Result};
use crate::source::image_header;

/// Longest side of a stored signature, in pixels.
pub const MAX_SIDE: u32 = 2000;
/// Strength range of the white background removal (the UI slider).
pub const MAX_STRENGTH: u8 = 100;

#[derive(Debug, Clone)]
pub struct NormalizedSignature {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// How an image is normalized. The library stores images with the defaults and an optional
/// white background removal; previews use a smaller `max_side` with the same processing.
#[derive(Debug, Clone, Copy)]
pub struct NormalizeOptions {
    /// Make the paper transparent, with this strength (0..=100).
    pub remove_white: Option<u8>,
    pub max_side: u32,
}

impl Default for NormalizeOptions {
    fn default() -> Self {
        Self {
            remove_white: None,
            max_side: MAX_SIDE,
        }
    }
}

// White background removal (D44). Brightness is Rec. 601 luma. The paper level is the 95th
// percentile of the brightness of the visible pixels, so grey paper and photos with a
// shadow work without a fixed threshold. Pixels at least as bright as `hi` become
// transparent, pixels at most `lo` keep their alpha, and the range between is a linear ramp:
//   hi = paper * (1 - HI_DROP * strength / 100), lo = hi - RAMP * paper
// A higher strength removes darker (shadowed, greyer) paper. Pixels on the ramp get the
// paper's share taken out of their colour, so edges do not keep a grey halo. An image whose
// paper level is below MIN_PAPER has no paper (ink on a transparent background) and is kept.
const PAPER_PERCENTILE: f32 = 0.95;
const HI_DROP: f32 = 0.30;
const RAMP: f32 = 0.35;
/// Below this paper level there is no paper to remove (e.g. ink on a transparent background).
const MIN_PAPER: f32 = 128.0;

fn invalid(e: impl std::fmt::Display) -> CoreError {
    CoreError::InvalidImage(e.to_string())
}

/// Normalizes a PNG or JPEG file's bytes for the signature library.
pub fn normalize(bytes: &[u8]) -> Result<NormalizedSignature> {
    normalize_with(bytes, &NormalizeOptions::default())
}

/// Normalizes with options: a smaller longest side (previews) and white background removal.
pub fn normalize_with(bytes: &[u8], options: &NormalizeOptions) -> Result<NormalizedSignature> {
    let max_side = options.max_side.clamp(1, MAX_SIDE);
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
    if w.max(h) > max_side {
        let scale = f64::from(max_side) / f64::from(w.max(h));
        let nw = ((f64::from(w) * scale).round() as u32).clamp(1, max_side);
        let nh = ((f64::from(h) * scale).round() as u32).clamp(1, max_side);
        img = img.resize_exact(nw, nh, FilterType::Lanczos3);
    }
    let mut pixels = img.to_rgba8();
    if let Some(strength) = options.remove_white {
        remove_white(&mut pixels, strength);
    }
    let rgba = DynamicImage::ImageRgba8(pixels);
    let mut png = Vec::new();
    rgba.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(invalid)?;
    Ok(NormalizedSignature {
        png,
        width: rgba.width(),
        height: rgba.height(),
    })
}

fn luma(p: &image::Rgba<u8>) -> f32 {
    0.299 * f32::from(p[0]) + 0.587 * f32::from(p[1]) + 0.114 * f32::from(p[2])
}

/// The paper's brightness: the 95th percentile of the visible pixels' brightness.
fn paper_level(img: &RgbaImage) -> f32 {
    let mut hist = [0u64; 256];
    let mut total = 0u64;
    for p in img.pixels().filter(|p| p[3] > 0) {
        hist[luma(p).round().clamp(0.0, 255.0) as usize] += 1;
        total += 1;
    }
    if total == 0 {
        return 255.0;
    }
    let target = (total as f64 * f64::from(PAPER_PERCENTILE)).ceil() as u64;
    let mut seen = 0;
    for (level, n) in hist.iter().enumerate() {
        seen += n;
        if seen >= target {
            return (level as f32).max(1.0);
        }
    }
    255.0
}

/// Makes the paper of a signature image transparent (D44). `strength` is 0..=100.
pub fn remove_white(img: &mut RgbaImage, strength: u8) {
    let k = f32::from(strength.min(MAX_STRENGTH)) / f32::from(MAX_STRENGTH);
    let paper = paper_level(img);
    if paper < MIN_PAPER {
        return;
    }
    let hi = paper * (1.0 - HI_DROP * k);
    let ramp = RAMP * paper;
    let lo = hi - ramp;
    for p in img.pixels_mut() {
        if p[3] == 0 {
            continue;
        }
        let l = luma(p);
        let a = if l >= hi {
            0.0
        } else if l <= lo {
            1.0
        } else {
            (hi - l) / ramp
        };
        if a < 1.0 && a > 0.0 {
            // Take the paper's share out: c = a * ink + (1 - a) * paper.
            for c in 0..3 {
                let v = (f32::from(p[c]) - paper * (1.0 - a)) / a;
                p[c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
        p[3] = (f32::from(p[3]) * a).round() as u8;
    }
}
