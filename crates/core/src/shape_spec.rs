//! Numbers that define how objects look (SPEC 6.6, 6.7). The frontend uses the same
//! values from `src/shapes/spec.ts`; `tests/shape_spec.rs` checks that they match.

/// Arrowhead length is `max(ARROW_MIN_LENGTH, ARROW_LENGTH_PER_WIDTH * stroke width)` pt.
pub const ARROW_MIN_LENGTH: f64 = 8.0;
pub const ARROW_LENGTH_PER_WIDTH: f64 = 4.0;
/// Arrowhead base width as a fraction of its length.
pub const ARROW_BASE_RATIO: f64 = 0.6;
/// Text line spacing as a multiple of the font size.
pub const LINE_HEIGHT: f64 = 1.3;
/// Bezier constant for a quarter ellipse.
pub const ELLIPSE_KAPPA: f64 = 0.552_284_749_830_793_6;

pub fn arrow_length(stroke_width: f64) -> f64 {
    ARROW_MIN_LENGTH.max(ARROW_LENGTH_PER_WIDTH * stroke_width)
}
