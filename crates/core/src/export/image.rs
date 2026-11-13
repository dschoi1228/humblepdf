//! Image XObjects for image pages and signatures (SPEC 7.2, 7.5).
//!
//! - JPEG (gray/RGB) is embedded unchanged with DCTDecode. CMYK JPEG is converted to RGB.
//! - Everything else is decoded to 8-bit RGB; alpha becomes a soft mask (SMask).
//! - EXIF orientation is not baked into the pixels; `orientation_matrix` applies it.

use std::io::Cursor;

use image::metadata::Orientation;
use image::{ExtendedColorType, ImageDecoder};
use lopdf::{Document, Object, ObjectId, Stream, dictionary};

use crate::error::{CoreError, Result};
use crate::model::Rect;
use crate::source::image_header;

#[derive(Debug, Clone, Copy)]
pub struct EmbeddedImage {
    pub id: ObjectId,
    /// Stored pixel size (before orientation).
    pub width: u32,
    pub height: u32,
    pub orientation: Orientation,
    pub has_alpha: bool,
}

fn invalid(e: impl std::fmt::Display) -> CoreError {
    CoreError::InvalidImage(e.to_string())
}

pub fn embed_image(doc: &mut Document, bytes: &[u8]) -> Result<EmbeddedImage> {
    let (_, _, orientation) = image_header(bytes)?;
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        let dec = image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes)).map_err(invalid)?;
        let (w, h) = dec.dimensions();
        let color_space = match dec.original_color_type() {
            ExtendedColorType::L8 => Some("DeviceGray"),
            ExtendedColorType::Rgb8 => Some("DeviceRGB"),
            // CMYK (and anything unusual) is converted to RGB below.
            _ => None,
        };
        if let Some(cs) = color_space {
            let stream = Stream::new(
                dictionary! {
                    "Type" => "XObject", "Subtype" => "Image",
                    "Width" => i64::from(w), "Height" => i64::from(h),
                    "ColorSpace" => cs, "BitsPerComponent" => 8,
                    "Filter" => "DCTDecode",
                },
                bytes.to_vec(),
            )
            .with_compression(false);
            return Ok(EmbeddedImage {
                id: doc.add_object(stream),
                width: w,
                height: h,
                orientation,
                has_alpha: false,
            });
        }
    }

    let img = image::load_from_memory(bytes).map_err(invalid)?;
    let (w, h) = (img.width(), img.height());
    let has_alpha = img.color().has_alpha();
    let (rgb, alpha) = if has_alpha {
        let rgba = img.to_rgba8();
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        let mut a = Vec::with_capacity((w * h) as usize);
        for p in rgba.pixels() {
            rgb.extend_from_slice(&p.0[..3]);
            a.push(p.0[3]);
        }
        (rgb, Some(a))
    } else {
        (img.to_rgb8().into_raw(), None)
    };

    let mut dict = dictionary! {
        "Type" => "XObject", "Subtype" => "Image",
        "Width" => i64::from(w), "Height" => i64::from(h),
        "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
    };
    if let Some(a) = alpha {
        let mut mask = Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image",
                "Width" => i64::from(w), "Height" => i64::from(h),
                "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
            },
            a,
        );
        mask.compress()?;
        dict.set("SMask", doc.add_object(mask));
    }
    let mut stream = Stream::new(dict, rgb);
    stream.compress()?;
    Ok(EmbeddedImage {
        id: doc.add_object(stream),
        width: w,
        height: h,
        orientation,
        has_alpha,
    })
}

/// `cm` matrix that draws the image upright (EXIF orientation applied) into `r`.
///
/// The image XObject occupies the unit square; (u, v) with v = 1 at the stored top row.
/// For each orientation, (U, V) are the display unit coordinates.
pub fn orientation_matrix(o: Orientation, r: &Rect) -> [f64; 6] {
    // [a, b, c, d, e, f] for U = a*u + c*v + e, V = b*u + d*v + f
    let unit: [f64; 6] = match o {
        Orientation::NoTransforms => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        Orientation::FlipHorizontal => [-1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
        Orientation::Rotate180 => [-1.0, 0.0, 0.0, -1.0, 1.0, 1.0],
        Orientation::FlipVertical => [1.0, 0.0, 0.0, -1.0, 0.0, 1.0],
        // U = v, V = 1 - u
        Orientation::Rotate90 => [0.0, -1.0, 1.0, 0.0, 0.0, 1.0],
        // U = 1 - v, V = u
        Orientation::Rotate270 => [0.0, 1.0, -1.0, 0.0, 1.0, 0.0],
        // U = 1 - v, V = 1 - u
        Orientation::Rotate90FlipH => [0.0, -1.0, -1.0, 0.0, 1.0, 1.0],
        // U = v, V = u
        Orientation::Rotate270FlipH => [0.0, 1.0, 1.0, 0.0, 0.0, 0.0],
    };
    let (w, h) = (r.width(), r.height());
    [
        unit[0] * w,
        unit[1] * h,
        unit[2] * w,
        unit[3] * h,
        unit[4] * w + r.x0,
        unit[5] * h + r.y0,
    ]
}

pub fn fmt_num(v: f64) -> String {
    let s = format!("{v:.4}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

pub fn cm(m: &[f64; 6]) -> String {
    m.iter().map(|v| fmt_num(*v)).collect::<Vec<_>>().join(" ") + " cm"
}

/// Returns the object id as an `Object` reference.
pub fn reference(id: ObjectId) -> Object {
    Object::Reference(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(m: &[f64; 6], u: f64, v: f64) -> (f64, f64) {
        (m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5])
    }

    #[test]
    fn rotate90_puts_stored_top_on_the_right() {
        let r = Rect::new(10.0, 20.0, 110.0, 220.0);
        let m = orientation_matrix(Orientation::Rotate90, &r);
        // Stored top-left (u=0, v=1) -> display top-right.
        assert_eq!(apply(&m, 0.0, 1.0), (110.0, 220.0));
        // Stored bottom-left (u=0, v=0) -> display top-left.
        assert_eq!(apply(&m, 0.0, 0.0), (10.0, 220.0));
    }

    #[test]
    fn identity_fills_rect() {
        let r = Rect::new(10.0, 20.0, 110.0, 220.0);
        let m = orientation_matrix(Orientation::NoTransforms, &r);
        assert_eq!(m, [100.0, 0.0, 0.0, 200.0, 10.0, 20.0]);
    }

    #[test]
    fn number_format() {
        assert_eq!(fmt_num(1.0), "1");
        assert_eq!(fmt_num(-0.00001), "0");
        assert_eq!(fmt_num(12.3456789), "12.3457");
    }
}
