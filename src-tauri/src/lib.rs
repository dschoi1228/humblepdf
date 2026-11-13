//! Tauri shell. Commands stay thin: they call pdf-editor-core and do file I/O.

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use pdf_editor_core::error::{CoreError, ErrorPayload};
use pdf_editor_core::source::{self, SourceInfo};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, State};

/// Sources opened in this session. Passwords live only here, in memory (SPEC 4).
#[derive(Default)]
struct Sources {
    next_id: AtomicU64,
    entries: Mutex<HashMap<String, SourceEntry>>,
}

struct SourceEntry {
    path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedSource {
    source_id: String,
    path: String,
    /// File name for display.
    name: String,
    info: SourceInfo,
}

/// Runs core code, turning both errors and panics into an error payload (SPEC 8).
fn guarded<T>(f: impl FnOnce() -> Result<T, CoreError>) -> Result<T, ErrorPayload> {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => {
            eprintln!("core error: {e}");
            Err(ErrorPayload::from(&e))
        }
        Err(_) => Err(ErrorPayload {
            code: "internal",
            message: "internal error".into(),
        }),
    }
}

#[tauri::command]
fn open_source(
    path: String,
    password: Option<String>,
    sources: State<'_, Sources>,
) -> Result<OpenedSource, ErrorPayload> {
    let p = PathBuf::from(&path);
    let info = guarded(|| source::inspect_path(&p, password.as_deref()))?;
    let id = format!("s{}", sources.next_id.fetch_add(1, Ordering::Relaxed) + 1);
    sources
        .entries
        .lock()
        .map_err(|_| ErrorPayload {
            code: "internal",
            message: "state lock poisoned".into(),
        })?
        .insert(id.clone(), SourceEntry { path: p.clone() });
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    Ok(OpenedSource {
        source_id: id,
        name,
        path,
        info,
    })
}

/// Raw bytes for rendering. Sent as a binary response, not JSON (SPEC 3).
#[tauri::command]
fn source_bytes(source_id: String, sources: State<'_, Sources>) -> Result<Response, ErrorPayload> {
    let path = {
        let map = sources.entries.lock().map_err(|_| ErrorPayload {
            code: "internal",
            message: "state lock poisoned".into(),
        })?;
        map.get(&source_id)
            .map(|e| e.path.clone())
            .ok_or(ErrorPayload {
                code: "unknown_source",
                message: format!("unknown source {source_id}"),
            })?
    };
    let bytes = guarded(|| std::fs::read(&path).map_err(CoreError::from))?;
    Ok(Response::new(bytes))
}

/// M0 measurement hook: when PDF_EDITOR_BENCH is set to a PDF path, the frontend opens it,
/// reports the time to first page through `bench_report`, and the app exits.
#[tauri::command]
fn bench_config() -> Option<String> {
    std::env::var("PDF_EDITOR_BENCH").ok()
}

#[tauri::command]
fn bench_report(report: String, app: AppHandle) {
    match std::env::var("PDF_EDITOR_BENCH_OUT") {
        Ok(out) => {
            if let Err(e) = std::fs::write(&out, &report) {
                eprintln!("bench: cannot write {out}: {e}");
            }
        }
        Err(_) => println!("{report}"),
    }
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Sources::default())
        .invoke_handler(tauri::generate_handler![
            open_source,
            source_bytes,
            bench_config,
            bench_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
