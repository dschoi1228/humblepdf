//! Core of pdf-editor: the document model, source inspection and PDF export.
//!
//! This crate must not depend on Tauri or any UI code. All PDF bytes are produced here.
//! Public functions return `Result` and never panic on bad input (SPEC 8).

pub mod error;
pub mod export;
pub mod font;
pub mod model;
pub mod pdf_util;
pub mod shape_spec;
pub mod source;
pub mod write;

pub use error::{CoreError, Result};

/// Value written to `/Producer` (SPEC 7.1). Never contains a user name.
pub const PRODUCER: &str = concat!("pdf-editor ", env!("CARGO_PKG_VERSION"));
