//! Document model (SPEC 4). These serde structs are the single source of truth;
//! the TypeScript types in `src/bindings/` are generated from them with ts-rs.
//!
//! All coordinates are in the PDF user space of the page they belong to
//! (pt, y axis up). See SPEC 5. The core never transforms them.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

/// Current model schema version.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Document.ts")]
pub struct Document {
    #[ts(type = "1")]
    pub schema_version: u32,
    pub sources: Vec<Source>,
    /// Pages in output order.
    pub pages: Vec<Page>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export_to = "SourceKind.ts")]
pub enum SourceKind {
    Pdf,
    Image,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Source.ts")]
pub struct Source {
    pub id: String,
    pub kind: SourceKind,
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export_to = "ImageFit.ts")]
pub enum ImageFit {
    /// A4 paper, orientation chosen from the image aspect ratio, image centered without margin.
    A4,
    /// Page has the image aspect ratio, long side 841.89pt.
    Image,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Page.ts")]
pub struct Page {
    pub id: String,
    pub source_id: String,
    /// Page index (0-based) in a PDF source. 0 for images.
    pub page_index: u32,
    /// Only set for image pages.
    pub image_fit: Option<ImageFit>,
    /// Visible area (SPEC 5).
    #[serde(rename = "box")]
    #[ts(rename = "box")]
    pub page_box: Rect,
    pub base_rotation: Rotation,
    pub user_rotation: Rotation,
    /// Drawing order: later objects are on top.
    pub objects: Vec<PageObject>,
}

impl Page {
    /// Display rotation, clockwise (SPEC 5).
    pub fn display_rotation(&self) -> Rotation {
        self.base_rotation.plus(self.user_rotation)
    }
}

/// A rotation that is a multiple of 90 degrees. Serialized as the number 0, 90, 180 or 270.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, TS)]
#[ts(export_to = "Rotation.ts", type = "0 | 90 | 180 | 270")]
pub enum Rotation {
    #[default]
    R0,
    R90,
    R180,
    R270,
}

impl Rotation {
    pub fn degrees(self) -> u16 {
        match self {
            Rotation::R0 => 0,
            Rotation::R90 => 90,
            Rotation::R180 => 180,
            Rotation::R270 => 270,
        }
    }

    /// Accepts any multiple of 90 (including negative values, as found in some PDFs' /Rotate).
    pub fn from_degrees(deg: i64) -> Option<Rotation> {
        if deg % 90 != 0 {
            return None;
        }
        Some(match deg.rem_euclid(360) {
            0 => Rotation::R0,
            90 => Rotation::R90,
            180 => Rotation::R180,
            _ => Rotation::R270,
        })
    }

    pub fn plus(self, other: Rotation) -> Rotation {
        Rotation::from_degrees(i64::from(self.degrees()) + i64::from(other.degrees()))
            .unwrap_or_default()
    }
}

impl Serialize for Rotation {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u16(self.degrees())
    }
}

impl<'de> Deserialize<'de> for Rotation {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = i64::deserialize(d)?;
        match v {
            0 | 90 | 180 | 270 => Ok(Rotation::from_degrees(v).unwrap_or_default()),
            _ => Err(serde::de::Error::custom(format!(
                "rotation must be 0, 90, 180 or 270, got {v}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "Point.ts")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Axis-aligned rectangle with x0 < x1 and y0 < y1.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export_to = "Rect.ts")]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Rect {
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Rect {
        Rect {
            x0: x0.min(x1),
            y0: y0.min(y1),
            x1: x0.max(x1),
            y1: y0.max(y1),
        }
    }

    pub fn width(&self) -> f64 {
        self.x1 - self.x0
    }

    pub fn height(&self) -> f64 {
        self.y1 - self.y0
    }

    /// Grows the rectangle by `d` on every side.
    pub fn inflate(&self, d: f64) -> Rect {
        Rect {
            x0: self.x0 - d,
            y0: self.y0 - d,
            x1: self.x1 + d,
            y1: self.y1 + d,
        }
    }

    pub fn union(&self, o: &Rect) -> Rect {
        Rect {
            x0: self.x0.min(o.x0),
            y0: self.y0.min(o.y0),
            x1: self.x1.max(o.x1),
            y1: self.y1.max(o.y1),
        }
    }

    pub fn from_points(points: &[Point]) -> Option<Rect> {
        let first = points.first()?;
        let mut r = Rect {
            x0: first.x,
            y0: first.y,
            x1: first.x,
            y1: first.y,
        };
        for p in &points[1..] {
            r.x0 = r.x0.min(p.x);
            r.y0 = r.y0.min(p.y);
            r.x1 = r.x1.max(p.x);
            r.y1 = r.y1.max(p.y);
        }
        Some(r)
    }
}

/// Four points. Order follows the Acrobat convention used for /QuadPoints:
/// upper-left, upper-right, lower-left, lower-right (SPEC 7.4).
pub type Quad = [Point; 4];

/// RGB color, each component in 0..=1.
pub type Rgb = [f64; 3];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "lowercase")]
#[ts(export_to = "PageObject.ts")]
pub enum PageObject {
    Highlight(Highlight),
    Rect(Shape),
    Ellipse(Shape),
    Line(Line),
    Text(Text),
    Signature(Signature),
}

impl PageObject {
    pub fn id(&self) -> &str {
        match self {
            PageObject::Highlight(o) => &o.id,
            PageObject::Rect(o) | PageObject::Ellipse(o) => &o.id,
            PageObject::Line(o) => &o.id,
            PageObject::Text(o) => &o.id,
            PageObject::Signature(o) => &o.id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Highlight.ts")]
pub struct Highlight {
    pub id: String,
    pub quads: Vec<Quad>,
    pub color: Rgb,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Shape.ts")]
pub struct Shape {
    pub id: String,
    pub rect: Rect,
    pub stroke: Option<Rgb>,
    pub stroke_width: f64,
    pub fill: Option<Rgb>,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Line.ts")]
pub struct Line {
    pub id: String,
    pub from: Point,
    pub to: Point,
    pub stroke: Rgb,
    pub stroke_width: f64,
    pub arrow: bool,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Text.ts")]
pub struct Text {
    pub id: String,
    /// Baseline start of the first line.
    pub origin: Point,
    /// Counter-clockwise, in user space.
    pub rotation: Rotation,
    pub font_size: f64,
    pub color: Rgb,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "Signature.ts")]
pub struct Signature {
    pub id: String,
    pub signature_id: String,
    /// Bounding box after rotation.
    pub rect: Rect,
    /// Counter-clockwise, in user space.
    pub rotation: Rotation,
}

/// Exports every model type to `dir` as TypeScript files.
pub fn export_bindings(dir: &std::path::Path) -> Result<(), ts_rs::ExportError> {
    let cfg = ts_rs::Config::new().with_out_dir(dir);
    Document::export_all(&cfg)?;
    crate::source::SourceInfo::export_all(&cfg)?;
    crate::export::ExportOptions::export_all(&cfg)?;
    crate::export::ExportSummary::export_all(&cfg)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_roundtrip() {
        for r in [0, 90, 180, 270] {
            let v: Rotation = serde_json::from_str(&r.to_string()).unwrap();
            assert_eq!(serde_json::to_string(&v).unwrap(), r.to_string());
        }
        assert!(serde_json::from_str::<Rotation>("45").is_err());
        assert_eq!(Rotation::from_degrees(-90), Some(Rotation::R270));
        assert_eq!(Rotation::R270.plus(Rotation::R180), Rotation::R90);
    }

    #[test]
    fn page_object_json_shape() {
        let o = PageObject::Rect(Shape {
            id: "a".into(),
            rect: Rect::new(0.0, 0.0, 10.0, 10.0),
            stroke: Some([1.0, 0.0, 0.0]),
            stroke_width: 2.0,
            fill: None,
            opacity: 1.0,
        });
        let v = serde_json::to_value(&o).unwrap();
        assert_eq!(v["type"], "rect");
        assert_eq!(v["strokeWidth"], 2.0);
        assert!(v["fill"].is_null());
    }
}
