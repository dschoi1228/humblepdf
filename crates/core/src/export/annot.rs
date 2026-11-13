//! Objects saved as standard annotations (SPEC 7.4). The appearance XObject is `/AP /N`.

use std::time::{SystemTime, UNIX_EPOCH};

use lopdf::{Dictionary, Document, Object, ObjectId, StringFormat, dictionary};

use crate::error::Result;
use crate::export::image::reference;
use crate::model::{PageObject, Rect, Rgb};
use crate::pdf_util::{real, rect_to_object, resolve};

/// Private key holding the object JSON so the app can restore it later (SPEC 7.7).
pub const OBJECT_KEY: &str = "PdfEditorObject";

fn color(c: &Rgb) -> Object {
    Object::Array(c.iter().map(|v| real(*v)).collect())
}

/// PDF text string: PDFDocEncoding-compatible ASCII as is, otherwise UTF-16BE with BOM.
pub fn text_string(s: &str) -> Object {
    if s.is_ascii() {
        Object::String(s.as_bytes().to_vec(), StringFormat::Literal)
    } else {
        let mut b = vec![0xFE, 0xFF];
        for u in s.encode_utf16() {
            b.extend_from_slice(&u.to_be_bytes());
        }
        Object::String(b, StringFormat::Hexadecimal)
    }
}

/// `D:YYYYMMDDHHmmSSZ` in UTC, without depending on the local time zone.
pub fn pdf_date_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "D:{y:04}{m:02}{d:02}{:02}{:02}{:02}Z",
        rem / 3600,
        (rem / 60) % 60,
        rem % 60
    )
}

/// Builds the annotation dictionary for an object. `ap` is its appearance XObject.
pub fn annotation(
    obj: &PageObject,
    page_id: ObjectId,
    ap: ObjectId,
    bbox: &Rect,
    date: &str,
) -> Result<Dictionary> {
    let json = serde_json::to_string(obj)
        .map_err(|e| crate::CoreError::Pdf(format!("object json: {e}")))?;
    let mut d = dictionary! {
        "Type" => "Annot",
        "Rect" => rect_to_object(bbox),
        "AP" => dictionary! { "N" => reference(ap) },
        // Print flag.
        "F" => 4,
        "NM" => text_string(obj.id()),
        "M" => Object::string_literal(date),
        "P" => reference(page_id),
        OBJECT_KEY => text_string(&json),
    };
    match obj {
        PageObject::Highlight(h) => {
            d.set("Subtype", "Highlight");
            // Acrobat convention: UL, UR, LL, LR for each quad (SPEC 7.4).
            let qp: Vec<Object> = h
                .quads
                .iter()
                .flat_map(|q| q.iter().flat_map(|p| [real(p.x), real(p.y)]))
                .collect();
            d.set("QuadPoints", qp);
            d.set("C", color(&h.color));
            d.set("CA", Object::Real(h.opacity as f32));
        }
        PageObject::Rect(s) | PageObject::Ellipse(s) => {
            d.set(
                "Subtype",
                if matches!(obj, PageObject::Rect(_)) {
                    "Square"
                } else {
                    "Circle"
                },
            );
            d.set(
                "C",
                s.stroke
                    .as_ref()
                    .map(color)
                    .unwrap_or(Object::Array(vec![])),
            );
            if let Some(f) = &s.fill {
                d.set("IC", color(f));
            }
            let w = if s.stroke.is_some() {
                s.stroke_width
            } else {
                0.0
            };
            d.set(
                "BS",
                dictionary! { "Type" => "Border", "W" => real(w), "S" => "S" },
            );
            // /RD: difference between /Rect and the shape's own rectangle.
            let inset = if s.stroke.is_some() {
                s.stroke_width / 2.0
            } else {
                0.0
            };
            d.set(
                "RD",
                vec![real(inset), real(inset), real(inset), real(inset)],
            );
            d.set("CA", Object::Real(s.opacity as f32));
        }
        PageObject::Line(l) => {
            d.set("Subtype", "Line");
            d.set(
                "L",
                vec![real(l.from.x), real(l.from.y), real(l.to.x), real(l.to.y)],
            );
            let end = if l.arrow { "ClosedArrow" } else { "None" };
            d.set(
                "LE",
                vec![
                    Object::Name(b"None".to_vec()),
                    Object::Name(end.as_bytes().to_vec()),
                ],
            );
            d.set("C", color(&l.stroke));
            if l.arrow {
                d.set("IC", color(&l.stroke));
            }
            d.set(
                "BS",
                dictionary! { "Type" => "Border", "W" => real(l.stroke_width), "S" => "S" },
            );
            d.set("CA", Object::Real(l.opacity as f32));
        }
        PageObject::Text(t) => {
            d.set("Subtype", "FreeText");
            d.set("Contents", text_string(&t.lines.join("\n")));
            let c = &t.color;
            d.set(
                "DA",
                Object::string_literal(format!(
                    "/Helv {} Tf {} {} {} rg",
                    crate::export::image::fmt_num(t.font_size),
                    crate::export::image::fmt_num(c[0]),
                    crate::export::image::fmt_num(c[1]),
                    crate::export::image::fmt_num(c[2])
                )),
            );
            // No border.
            d.set("BS", dictionary! { "Type" => "Border", "W" => 0 });
            d.set("Border", vec![0.into(), 0.into(), 0.into()]);
        }
        PageObject::Signature(_) => {
            return Err(crate::CoreError::Pdf(
                "signatures are always baked, never annotations".into(),
            ));
        }
    }
    Ok(d)
}

/// Appends annotation references to the page's /Annots, copying a shared or indirect
/// array into the page first.
pub fn append_annots(doc: &mut Document, page_id: ObjectId, annots: &[ObjectId]) -> Result<()> {
    let existing: Vec<Object> = {
        let page = doc.get_dictionary(page_id)?;
        match page.get(b"Annots") {
            Ok(a) => resolve(doc, a)
                .and_then(|o| o.as_array().ok())
                .cloned()
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    };
    let mut all = existing;
    all.extend(annots.iter().map(|id| Object::Reference(*id)));
    doc.get_dictionary_mut(page_id)?.set("Annots", all);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_format() {
        let d = pdf_date_now();
        assert_eq!(d.len(), "D:20261113120000Z".len());
        assert!(d.starts_with("D:20"));
    }

    #[test]
    fn text_strings() {
        assert_eq!(
            text_string("abc"),
            Object::String(b"abc".to_vec(), StringFormat::Literal)
        );
        match text_string("한") {
            Object::String(b, _) => assert_eq!(b, vec![0xFE, 0xFF, 0xD5, 0x5C]),
            _ => panic!(),
        }
    }
}
