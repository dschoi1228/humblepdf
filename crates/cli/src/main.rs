//! Headless front end of humblepdf-core.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use humblepdf_core::error::{CoreError, ErrorPayload};
use humblepdf_core::export::{ExportContext, ExportOptions};

#[derive(Parser)]
#[command(
    name = "humblepdf-cli",
    version,
    about = "HumblePDF core from the command line"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print source information (kind, page boxes, rotations, image layouts) as JSON.
    Inspect {
        file: PathBuf,
        #[arg(long)]
        password: Option<String>,
    },
    /// Print a document model containing every page of the given files, in order.
    Model {
        files: Vec<PathBuf>,
        /// Password for an encrypted source, as `<index>=<password>` (1-based).
        #[arg(long = "password", value_name = "N=PASSWORD")]
        passwords: Vec<String>,
    },
    /// Export a document model (JSON) to a new PDF and print a summary as JSON.
    Export {
        #[arg(long)]
        model: PathBuf,
        #[arg(long)]
        out: PathBuf,
        /// Folder with `<signatureId>.png` files.
        #[arg(long)]
        signatures: Option<PathBuf>,
        /// Password for an encrypted source, as `<sourceId>=<password>`.
        #[arg(long = "password", value_name = "SOURCE=PASSWORD")]
        passwords: Vec<String>,
        /// Bake all objects into the page content.
        #[arg(long)]
        flatten: bool,
    },
    /// Write the bytes the viewer renders: the PDF without the annotations restored as
    /// objects (SPEC 7.7), or an unchanged copy when there are none. Prints {"changed": bool}.
    RenderBytes {
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        password: Option<String>,
    },
    /// Normalize a signature image as the library stores it (PNG), optionally removing the
    /// white background with a strength of 0..=100 (D44). Prints {"width", "height"}.
    Signature {
        file: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=100))]
        remove_white: Option<u8>,
        /// Longest side in pixels (at most 2000).
        #[arg(long, default_value_t = humblepdf_core::signature::MAX_SIDE)]
        max_side: u32,
    },
}

fn split_pairs(pairs: &[String]) -> Result<HashMap<String, String>, CoreError> {
    pairs
        .iter()
        .map(|p| {
            p.split_once('=')
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .ok_or_else(|| CoreError::InvalidModel(format!("expected KEY=VALUE, got {p}")))
        })
        .collect()
}

fn print_json<T: serde::Serialize>(v: &T) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

fn run(command: Command) -> Result<(), CoreError> {
    match command {
        Command::RenderBytes {
            file,
            out,
            password,
        } => {
            let bytes = std::fs::read(&file)?;
            let rendered = humblepdf_core::source::render_bytes(&bytes, password.as_deref())?;
            let changed = rendered.is_some();
            std::fs::write(&out, rendered.unwrap_or(bytes))?;
            print_json(&serde_json::json!({ "changed": changed }));
        }
        Command::Signature {
            file,
            out,
            remove_white,
            max_side,
        } => {
            let bytes = std::fs::read(&file)?;
            let options = humblepdf_core::signature::NormalizeOptions {
                remove_white,
                max_side,
            };
            let n = humblepdf_core::signature::normalize_with(&bytes, &options)?;
            std::fs::write(&out, &n.png)?;
            print_json(&serde_json::json!({ "width": n.width, "height": n.height }));
        }
        Command::Inspect { file, password } => {
            let info = humblepdf_core::source::inspect_path(&file, password.as_deref())?;
            print_json(&info);
        }
        Command::Model { files, passwords } => {
            let pw = split_pairs(&passwords)?;
            let list: Vec<(&std::path::Path, Option<&str>)> = files
                .iter()
                .enumerate()
                .map(|(i, f)| {
                    (
                        f.as_path(),
                        pw.get(&(i + 1).to_string()).map(String::as_str),
                    )
                })
                .collect();
            print_json(&humblepdf_core::source::build_model(&list)?);
        }
        Command::Export {
            model,
            out,
            signatures,
            passwords,
            flatten,
        } => {
            let text = std::fs::read_to_string(&model)?;
            let doc: humblepdf_core::model::Document =
                serde_json::from_str(&text).map_err(|e| CoreError::InvalidModel(e.to_string()))?;
            let ctx = ExportContext {
                passwords: split_pairs(&passwords)?,
                signature_dir: signatures,
                options: ExportOptions { flatten },
            };
            let summary = humblepdf_core::export::export_to_file(&doc, &ctx, &out)?;
            print_json(&summary);
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli.command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            let payload = ErrorPayload::from(&e);
            eprintln!(
                "{}",
                serde_json::to_string(&payload).unwrap_or_else(|_| e.to_string())
            );
            ExitCode::FAILURE
        }
    }
}
