use serde::Serialize;

/// Errors returned by the public core API. The core never panics on bad input (SPEC 8).
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("the PDF is encrypted and needs a password")]
    PasswordRequired,
    #[error("the password is wrong")]
    WrongPassword,
    #[error("unsupported file format (only PDF, JPEG and PNG are supported)")]
    UnknownFormat,
    #[error("the PDF cannot be read: {0}")]
    UnreadablePdf(String),
    #[error("unsupported PDF feature: {0}")]
    Unsupported(String),
    #[error("the image cannot be read: {0}")]
    InvalidImage(String),
    #[error("invalid document model: {0}")]
    InvalidModel(String),
    #[error("the output path is one of the source files")]
    OutputIsSource,
    #[error("failed to build the PDF: {0}")]
    Pdf(String),
    #[error("font error: {0}")]
    Font(String),
    #[error("signature image not found: {0}")]
    SignatureMissing(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

impl CoreError {
    /// Stable machine-readable code for the frontend.
    pub fn code(&self) -> &'static str {
        match self {
            CoreError::PasswordRequired => "password_required",
            CoreError::WrongPassword => "wrong_password",
            CoreError::UnknownFormat => "unknown_format",
            CoreError::UnreadablePdf(_) => "unreadable_pdf",
            CoreError::Unsupported(_) => "unsupported",
            CoreError::InvalidImage(_) => "invalid_image",
            CoreError::InvalidModel(_) => "invalid_model",
            CoreError::OutputIsSource => "output_is_source",
            CoreError::Pdf(_) => "pdf",
            CoreError::Font(_) => "font",
            CoreError::SignatureMissing(_) => "signature_missing",
            CoreError::Io(_) => "io",
        }
    }
}

impl From<lopdf::Error> for CoreError {
    fn from(e: lopdf::Error) -> Self {
        CoreError::Pdf(e.to_string())
    }
}

/// Serialized form sent to the frontend: `{ code, message }`.
#[derive(Debug, Serialize)]
pub struct ErrorPayload {
    pub code: &'static str,
    pub message: String,
}

impl From<&CoreError> for ErrorPayload {
    fn from(e: &CoreError) -> Self {
        ErrorPayload {
            code: e.code(),
            message: e.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
