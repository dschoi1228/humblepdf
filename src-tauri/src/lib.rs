//! Tauri shell. Commands stay thin: they call humblepdf-core and do file I/O.

mod signatures;

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use humblepdf_core::error::{CoreError, ErrorPayload};
use humblepdf_core::export::{self, ExportContext, ExportSummary};
use humblepdf_core::model::Document;
use humblepdf_core::source::{self, SourceInfo};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

/// Sources opened in this session. Passwords live only here, in memory (SPEC 4).
#[derive(Default)]
struct Sources {
    next_id: AtomicU64,
    entries: Mutex<HashMap<String, SourceEntry>>,
}

struct SourceEntry {
    path: PathBuf,
    /// Needed again to build the rendering bytes of an encrypted source. Memory only.
    password: Option<String>,
    /// Rendering bytes without restored annotations (SPEC 7.7), built on first use;
    /// `Some(None)` when the file itself can be rendered.
    rendered: Option<Option<std::sync::Arc<Vec<u8>>>>,
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
        .insert(
            id.clone(),
            SourceEntry {
                path: p.clone(),
                password: password.clone(),
                rendered: None,
            },
        );
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
/// A file saved by this app renders without the annotations restored as objects
/// (SPEC 7.7); those bytes are built once per source and kept in memory.
fn source_bytes(source_id: String, sources: State<'_, Sources>) -> Result<Response, ErrorPayload> {
    let poisoned = || ErrorPayload {
        code: "internal",
        message: "state lock poisoned".into(),
    };
    let (path, password, rendered) = {
        let map = sources.entries.lock().map_err(|_| poisoned())?;
        let e = map.get(&source_id).ok_or(ErrorPayload {
            code: "unknown_source",
            message: format!("unknown source {source_id}"),
        })?;
        (e.path.clone(), e.password.clone(), e.rendered.clone())
    };
    let bytes = guarded(|| std::fs::read(&path).map_err(CoreError::from))?;
    let rendered = match rendered {
        Some(r) => r,
        None => {
            let r = guarded(|| source::render_bytes(&bytes, password.as_deref()))?
                .map(std::sync::Arc::new);
            if let Some(e) = sources
                .entries
                .lock()
                .map_err(|_| poisoned())?
                .get_mut(&source_id)
            {
                e.rendered = Some(r.clone());
            }
            r
        }
    };
    Ok(Response::new(match rendered {
        Some(r) => r.as_ref().clone(),
        None => bytes,
    }))
}

/// Writes the model to a new PDF (SPEC 6.9). Runs off the main thread so the UI keeps
/// drawing the progress indicator. Core refuses source paths and writes atomically.
#[tauri::command]
async fn export_document(
    model: Document,
    out_path: String,
    passwords: HashMap<String, String>,
    flatten: bool,
    app: AppHandle,
) -> Result<ExportSummary, ErrorPayload> {
    let signature_dir = signature_dir(&app)?;
    let job = move || {
        let ctx = ExportContext {
            passwords,
            signature_dir: Some(signature_dir),
            options: export::ExportOptions { flatten },
        };
        guarded(|| export::export_to_file(&model, &ctx, &PathBuf::from(&out_path)))
    };
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|_| ErrorPayload {
            code: "internal",
            message: "export task failed".into(),
        })?
}

/// The signature library folder: %APPDATA%<identifier>signatures (D30).
fn signature_dir(app: &AppHandle) -> Result<PathBuf, ErrorPayload> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("signatures"))
        .map_err(|e| ErrorPayload {
            code: "io",
            message: format!("no app data folder: {e}"),
        })
}

/// Runs blocking library work off the main thread (normalizing a large image takes time).
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, ErrorPayload> + Send + 'static,
) -> Result<T, ErrorPayload> {
    tauri::async_runtime::spawn_blocking(move || {
        catch_unwind(AssertUnwindSafe(job)).unwrap_or_else(|_| {
            Err(ErrorPayload {
                code: "internal",
                message: "internal error".into(),
            })
        })
    })
    .await
    .map_err(|_| ErrorPayload {
        code: "internal",
        message: "task failed".into(),
    })?
}

#[tauri::command]
async fn signature_list(app: AppHandle) -> Result<Vec<signatures::SignatureMeta>, ErrorPayload> {
    let dir = signature_dir(&app)?;
    blocking(move || signatures::list(&dir)).await
}

#[tauri::command]
async fn signature_add(
    path: String,
    name: String,
    app: AppHandle,
) -> Result<signatures::SignatureMeta, ErrorPayload> {
    let dir = signature_dir(&app)?;
    blocking(move || signatures::add(&dir, &PathBuf::from(path), &name)).await
}

#[tauri::command]
async fn signature_rename(
    id: String,
    name: String,
    app: AppHandle,
) -> Result<signatures::SignatureMeta, ErrorPayload> {
    let dir = signature_dir(&app)?;
    blocking(move || signatures::rename(&dir, &id, &name)).await
}

#[tauri::command]
async fn signature_delete(id: String, app: AppHandle) -> Result<(), ErrorPayload> {
    let dir = signature_dir(&app)?;
    blocking(move || signatures::delete(&dir, &id)).await
}

/// The stored PNG, as a binary response (SPEC 3).
#[tauri::command]
async fn signature_bytes(id: String, app: AppHandle) -> Result<Response, ErrorPayload> {
    let dir = signature_dir(&app)?;
    blocking(move || signatures::bytes(&dir, &id).map(Response::new)).await
}

/// A bundled font for the frontend's web fonts (D39), as a binary response.
#[tauri::command]
fn bundled_font(name: String) -> Result<Response, ErrorPayload> {
    humblepdf_core::font::bundled_font(&name)
        .map(|b| Response::new(b.to_vec()))
        .ok_or(ErrorPayload {
            code: "internal",
            message: format!("no bundled font {name}"),
        })
}

/// M0 measurement hook: when HUMBLEPDF_BENCH is set to a PDF path, the frontend opens it,
/// reports the time to first page through `bench_report`, and the app exits.
#[tauri::command]
fn bench_config() -> Option<String> {
    std::env::var("HUMBLEPDF_BENCH").ok()
}

#[tauri::command]
fn bench_report(report: String, app: AppHandle) {
    match std::env::var("HUMBLEPDF_BENCH_OUT") {
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
        // Window position, size and maximized state are restored at start (D38).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Sources::default())
        .invoke_handler(tauri::generate_handler![
            open_source,
            source_bytes,
            export_document,
            signature_list,
            signature_add,
            signature_rename,
            signature_delete,
            signature_bytes,
            bundled_font,
            bench_config,
            bench_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
