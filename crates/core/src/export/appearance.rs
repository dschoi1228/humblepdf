//! One "appearance" Form XObject per object (SPEC 7.3, D7). Content is drawn in page
//! user-space coordinates, `/Matrix` is the identity and `/BBox` is the area the object
//! covers, widened by half the stroke width. The same XObject is the annotation's
//! `/AP /N` or is drawn from the page content when baked.

use std::fmt::Write as _;

use lopdf::{Dictionary, Object, ObjectId, Stream, dictionary};

use crate::export::image::{fmt_num as n, reference};
use crate::font::TextRun;
use crate::model::{Highlight, Line, Point, Rect, Rgb, Rotation, Shape, Signature, Text};
use crate::pdf_util::rect_to_object;
use crate::shape_spec::{ARROW_BASE_RATIO, ELLIPSE_KAPPA, LINE_HEIGHT, arrow_length};

/// Resource name prefix used by this app (SPEC 7.5: never clash with the original).
pub const RES_PREFIX: &str = "PdfEd";

pub struct Appearance {
    pub stream: Stream,
    pub bbox: Rect,
}

fn rgb(c: &Rgb) -> String {
    format!("{} {} {}", n(c[0]), n(c[1]), n(c[2]))
}

fn ext_gstate(opacity: f64, multiply: bool) -> Dictionary {
    let mut gs = dictionary! {
        "Type" => "ExtGState",
        "CA" => Object::Real(opacity as f32),
        "ca" => Object::Real(opacity as f32),
    };
    if multiply {
        gs.set("BM", "Multiply");
    }
    gs
}

fn form(content: String, bbox: Rect, resources: Dictionary) -> Appearance {
    let stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "FormType" => 1,
            "BBox" => rect_to_object(&bbox),
            "Matrix" => vec![1.into(), 0.into(), 0.into(), 1.into(), 0.into(), 0.into()],
            "Resources" => resources,
        },
        content.into_bytes(),
    );
    Appearance { stream, bbox }
}

fn gs_resources(opacity: f64, multiply: bool) -> Dictionary {
    dictionary! {
        "ExtGState" => dictionary! { format!("{RES_PREFIX}GS0") => ext_gstate(opacity, multiply) },
    }
}

/// Highlight: filled quads with Multiply blend so the text below stays visible (SPEC 6.5).
/// No transparency group (SPEC 7.4).
pub fn highlight(h: &Highlight) -> Appearance {
    let mut c = format!("q /{RES_PREFIX}GS0 gs {} rg\n", rgb(&h.color));
    let mut pts = Vec::new();
    for q in &h.quads {
        // Quad order: UL, UR, LL, LR -> polygon UL, UR, LR, LL.
        let poly = [q[0], q[1], q[3], q[2]];
        let _ = write!(c, "{} {} m ", n(poly[0].x), n(poly[0].y));
        for p in &poly[1..] {
            let _ = write!(c, "{} {} l ", n(p.x), n(p.y));
        }
        c.push_str("h\n");
        pts.extend_from_slice(q);
    }
    c.push_str("f Q\n");
    let bbox = Rect::from_points(&pts).unwrap_or(Rect::new(0.0, 0.0, 0.0, 0.0));
    form(c, bbox, gs_resources(h.opacity, true))
}

fn paint_op(stroke: bool, fill: bool) -> &'static str {
    match (stroke, fill) {
        (true, true) => "B",
        (true, false) => "S",
        (false, true) => "f",
        (false, false) => "n",
    }
}

fn shape_prelude(s: &Shape) -> String {
    let mut c = format!("q /{RES_PREFIX}GS0 gs {} w 0 J 0 j\n", n(s.stroke_width));
    if let Some(st) = &s.stroke {
        let _ = writeln!(c, "{} RG", rgb(st));
    }
    if let Some(f) = &s.fill {
        let _ = writeln!(c, "{} rg", rgb(f));
    }
    c
}

fn shape_bbox(s: &Shape) -> Rect {
    if s.stroke.is_some() {
        s.rect.inflate(s.stroke_width / 2.0)
    } else {
        s.rect
    }
}

/// Rectangle. The stroke is centered on the rectangle's edge.
pub fn rect(s: &Shape) -> Appearance {
    let r = &s.rect;
    let mut c = shape_prelude(s);
    let _ = writeln!(
        c,
        "{} {} {} {} re {} Q",
        n(r.x0),
        n(r.y0),
        n(r.width()),
        n(r.height()),
        paint_op(s.stroke.is_some(), s.fill.is_some())
    );
    form(c, shape_bbox(s), gs_resources(s.opacity, false))
}

/// Ellipse inscribed in the rectangle, as four Bezier curves.
pub fn ellipse(s: &Shape) -> Appearance {
    let r = &s.rect;
    let (cx, cy) = ((r.x0 + r.x1) / 2.0, (r.y0 + r.y1) / 2.0);
    let (rx, ry) = (r.width() / 2.0, r.height() / 2.0);
    let (kx, ky) = (rx * ELLIPSE_KAPPA, ry * ELLIPSE_KAPPA);
    let mut c = shape_prelude(s);
    let _ = writeln!(c, "{} {} m", n(cx + rx), n(cy));
    let curves = [
        [(cx + rx, cy + ky), (cx + kx, cy + ry), (cx, cy + ry)],
        [(cx - kx, cy + ry), (cx - rx, cy + ky), (cx - rx, cy)],
        [(cx - rx, cy - ky), (cx - kx, cy - ry), (cx, cy - ry)],
        [(cx + kx, cy - ry), (cx + rx, cy - ky), (cx + rx, cy)],
    ];
    for cv in curves {
        let _ = writeln!(
            c,
            "{} {} {} {} {} {} c",
            n(cv[0].0),
            n(cv[0].1),
            n(cv[1].0),
            n(cv[1].1),
            n(cv[2].0),
            n(cv[2].1)
        );
    }
    let _ = writeln!(c, "h {} Q", paint_op(s.stroke.is_some(), s.fill.is_some()));
    form(c, shape_bbox(s), gs_resources(s.opacity, false))
}

/// Geometry of a line or arrow, shared with the overlay through the SPEC numbers.
pub struct LineGeometry {
    /// Where the drawn line segment ends (arrow base center, or `to`).
    pub line_end: Point,
    /// Arrowhead triangle: tip, base left, base right.
    pub head: Option<[Point; 3]>,
}

pub fn line_geometry(l: &Line) -> LineGeometry {
    if !l.arrow {
        return LineGeometry {
            line_end: l.to,
            head: None,
        };
    }
    let (dx, dy) = (l.to.x - l.from.x, l.to.y - l.from.y);
    let len = (dx * dx + dy * dy).sqrt();
    if len == 0.0 {
        return LineGeometry {
            line_end: l.to,
            head: None,
        };
    }
    let (ux, uy) = (dx / len, dy / len);
    let head_len = arrow_length(l.stroke_width);
    let half = head_len * ARROW_BASE_RATIO / 2.0;
    let base = Point {
        x: l.to.x - ux * head_len,
        y: l.to.y - uy * head_len,
    };
    let (px, py) = (-uy, ux);
    LineGeometry {
        line_end: base,
        head: Some([
            l.to,
            Point {
                x: base.x + px * half,
                y: base.y + py * half,
            },
            Point {
                x: base.x - px * half,
                y: base.y - py * half,
            },
        ]),
    }
}

/// Line or arrow: butt caps, the line stops at the arrowhead base (SPEC 6.6).
pub fn line(l: &Line) -> Appearance {
    let g = line_geometry(l);
    let col = rgb(&l.stroke);
    let mut c = format!(
        "q /{RES_PREFIX}GS0 gs {} w 0 J 0 j {col} RG {col} rg\n",
        n(l.stroke_width)
    );
    let _ = writeln!(
        c,
        "{} {} m {} {} l S",
        n(l.from.x),
        n(l.from.y),
        n(g.line_end.x),
        n(g.line_end.y)
    );
    let mut pts = vec![l.from, g.line_end];
    if let Some(h) = g.head {
        let _ = writeln!(
            c,
            "{} {} m {} {} l {} {} l h f",
            n(h[0].x),
            n(h[0].y),
            n(h[1].x),
            n(h[1].y),
            n(h[2].x),
            n(h[2].y)
        );
        pts.extend_from_slice(&h);
    } else {
        pts.push(l.to);
    }
    c.push_str("Q\n");
    let bbox = Rect::from_points(&pts)
        .unwrap_or(Rect::new(0.0, 0.0, 0.0, 0.0))
        .inflate(l.stroke_width / 2.0);
    form(c, bbox, gs_resources(l.opacity, false))
}

/// cos/sin of a counter-clockwise rotation.
fn ccw(r: Rotation) -> (f64, f64) {
    match r {
        Rotation::R0 => (1.0, 0.0),
        Rotation::R90 => (0.0, 1.0),
        Rotation::R180 => (-1.0, 0.0),
        Rotation::R270 => (0.0, -1.0),
    }
}

/// Font metrics needed to lay out text, in 1/1000 em.
#[derive(Debug, Clone, Copy)]
pub struct TextMetrics {
    pub ascent: f64,
    pub descent: f64,
}

/// Text: lines `i * LINE_HEIGHT * size` below the first, each drawn as runs that switch
/// between the bundled fonts (D32), using default advance widths only (SPEC 6.7, 7.6).
pub fn text(
    t: &Text,
    lines: &[Vec<TextRun>],
    font_ids: &[Option<ObjectId>; 2],
    metrics: TextMetrics,
) -> Appearance {
    let (cos, sin) = ccw(t.rotation);
    let size = t.font_size;
    let lh = LINE_HEIGHT * size;
    let mut c = format!("q BT {} rg\n", rgb(&t.color));
    let mut max_adv: f64 = 0.0;
    let mut used = [false; 2];
    for (i, runs) in lines.iter().enumerate() {
        // Local (unrotated) baseline start: (0, -i * lh).
        let ly = -(i as f64) * lh;
        let x = t.origin.x - sin * ly;
        let y = t.origin.y + cos * ly;
        let _ = writeln!(
            c,
            "{} {} {} {} {} {} Tm",
            n(cos),
            n(sin),
            n(-sin),
            n(cos),
            n(x),
            n(y)
        );
        // `Tj` advances by the run's /W widths, so the next run follows on.
        let mut adv = 0.0;
        for run in runs {
            used[run.font] = true;
            let hex: String = run.enc.codes.iter().map(|b| format!("{b:02X}")).collect();
            let _ = writeln!(c, "/{RES_PREFIX}F{} {} Tf <{hex}> Tj", run.font, n(size));
            adv += run.enc.advance;
        }
        max_adv = max_adv.max(adv * size / 1000.0);
    }
    c.push_str("ET Q\n");

    // Local box: x 0..max advance, y from the last line's descent to the first ascent.
    let n_lines = lines.len().max(1) as f64;
    let local = [
        (0.0, -(n_lines - 1.0) * lh + metrics.descent * size / 1000.0),
        (max_adv, metrics.ascent * size / 1000.0),
    ];
    let corners: Vec<Point> = [
        (local[0].0, local[0].1),
        (local[1].0, local[0].1),
        (local[0].0, local[1].1),
        (local[1].0, local[1].1),
    ]
    .iter()
    .map(|(lx, ly)| Point {
        x: t.origin.x + cos * lx - sin * ly,
        y: t.origin.y + sin * lx + cos * ly,
    })
    .collect();
    let bbox = Rect::from_points(&corners).unwrap_or(Rect::new(0.0, 0.0, 0.0, 0.0));
    let mut fonts = Dictionary::new();
    for (i, id) in font_ids.iter().enumerate() {
        if let (true, Some(id)) = (used[i], id) {
            fonts.set(format!("{RES_PREFIX}F{i}"), reference(*id));
        }
    }
    form(c, bbox, dictionary! { "Font" => fonts })
}

/// `cm` mapping the unit square (image upright) into `r` rotated counter-clockwise.
pub fn rotated_image_matrix(r: &Rect, rot: Rotation) -> [f64; 6] {
    let (w, h) = (r.width(), r.height());
    match rot {
        Rotation::R0 => [w, 0.0, 0.0, h, r.x0, r.y0],
        Rotation::R90 => [0.0, h, -w, 0.0, r.x1, r.y0],
        Rotation::R180 => [-w, 0.0, 0.0, -h, r.x1, r.y1],
        Rotation::R270 => [0.0, -h, w, 0.0, r.x0, r.y1],
    }
}

/// Signature image (RGB + SMask) drawn into its rectangle.
pub fn signature(s: &Signature, image_id: ObjectId) -> Appearance {
    let m = rotated_image_matrix(&s.rect, s.rotation);
    let c = format!("q {} /{RES_PREFIX}Im0 Do Q\n", crate::export::image::cm(&m));
    let res = dictionary! {
        "XObject" => dictionary! { format!("{RES_PREFIX}Im0") => reference(image_id) },
    };
    form(c, s.rect, res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrow_head_follows_spec_numbers() {
        let l = Line {
            id: "l".into(),
            from: Point { x: 0.0, y: 0.0 },
            to: Point { x: 100.0, y: 0.0 },
            stroke: [0.0, 0.0, 0.0],
            stroke_width: 3.0,
            arrow: true,
            opacity: 1.0,
        };
        let g = line_geometry(&l);
        // length max(8, 12) = 12, base width 7.2
        assert!((g.line_end.x - 88.0).abs() < 1e-9);
        let h = g.head.unwrap();
        assert!((h[1].y - h[2].y - 7.2).abs() < 1e-9);
    }

    #[test]
    fn rotated_image_matrix_keeps_rect() {
        let r = Rect::new(10.0, 20.0, 50.0, 100.0);
        for rot in [Rotation::R0, Rotation::R90, Rotation::R180, Rotation::R270] {
            let m = rotated_image_matrix(&r, rot);
            let pts: Vec<Point> = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
                .iter()
                .map(|(u, v)| Point {
                    x: m[0] * u + m[2] * v + m[4],
                    y: m[1] * u + m[3] * v + m[5],
                })
                .collect();
            assert_eq!(Rect::from_points(&pts).unwrap(), r, "{rot:?}");
        }
    }
}
