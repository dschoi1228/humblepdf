//! The frontend and the core must use the same shape numbers (CLAUDE.md rule 5).

use pdf_editor_core::shape_spec::*;

#[test]
fn frontend_constants_match_core() {
    let path: std::path::PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "src",
        "shapes",
        "spec.ts",
    ]
    .iter()
    .collect();
    let ts = std::fs::read_to_string(path).unwrap();
    let value = |name: &str| -> f64 {
        let prefix = format!("export const {name} = ");
        let line = ts
            .lines()
            .find(|l| l.starts_with(&prefix))
            .unwrap_or_else(|| panic!("{name} missing in spec.ts"));
        line[prefix.len()..].trim_end_matches(';').parse().unwrap()
    };
    assert_eq!(value("ARROW_MIN_LENGTH"), ARROW_MIN_LENGTH);
    assert_eq!(value("ARROW_LENGTH_PER_WIDTH"), ARROW_LENGTH_PER_WIDTH);
    assert_eq!(value("ARROW_BASE_RATIO"), ARROW_BASE_RATIO);
    assert_eq!(value("LINE_HEIGHT"), LINE_HEIGHT);
    assert_eq!(value("ELLIPSE_KAPPA"), ELLIPSE_KAPPA);
}
