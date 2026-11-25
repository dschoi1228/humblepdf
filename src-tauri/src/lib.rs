//! Tauri shell. Commands stay thin: they call humblepdf-core and do file I/O.

mod signatures;

use std::collections::HashMap;
use std::ffi::OsString;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use humblepdf_core::error::{CoreError, ErrorPayload};
use humblepdf_core::export::{self, ExportContext, ExportSummary};
use humblepdf_core::model::Document;
use humblepdf_core::source::{self, SourceInfo};
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_window_state::StateFlags;

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

/// Builds the document for printing (D45): the same PDF as a flattened export, kept in
/// memory and handed to the WebView's PDF viewer. Nothing is written to disk.
#[tauri::command]
async fn print_document(
    model: Document,
    passwords: HashMap<String, String>,
    app: AppHandle,
) -> Result<Response, ErrorPayload> {
    let signature_dir = signature_dir(&app)?;
    let job = move || {
        let ctx = ExportContext {
            passwords,
            signature_dir: Some(signature_dir),
            options: export::ExportOptions { flatten: true },
        };
        guarded(|| export::export_to_bytes(&model, &ctx)).map(|(bytes, _)| Response::new(bytes))
    };
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|_| ErrorPayload {
            code: "internal",
            message: "print task failed".into(),
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

/// Adds an image file; `remove_white` is the white removal strength, or none (D44).
#[tauri::command]
async fn signature_add(
    path: String,
    name: String,
    remove_white: Option<u8>,
    app: AppHandle,
) -> Result<signatures::SignatureMeta, ErrorPayload> {
    let dir = signature_dir(&app)?;
    blocking(move || signatures::add(&dir, &PathBuf::from(path), &name, remove_white)).await
}

/// Adds a drawn signature (PNG bytes from the drawing pad, D44).
#[tauri::command]
async fn signature_add_png(
    png: Vec<u8>,
    name: String,
    app: AppHandle,
) -> Result<signatures::SignatureMeta, ErrorPayload> {
    let dir = signature_dir(&app)?;
    blocking(move || signatures::add_bytes(&dir, &png, &name, None)).await
}

/// The image as it would be stored, reduced for the dialog's preview, as PNG (D44).
#[tauri::command]
async fn signature_preview(
    path: String,
    remove_white: Option<u8>,
) -> Result<Response, ErrorPayload> {
    blocking(move || signatures::preview(&PathBuf::from(path), remove_white).map(Response::new))
        .await
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

/// Files each window opens when it starts, by window label: the command line for "main"
/// (Windows runs `HumblePDF.exe <path>` for a double-click or "Open with", D42), and the files
/// a new window was opened with (D46).
#[derive(Default)]
struct StartupFiles(Mutex<HashMap<String, Vec<String>>>);

/// The window that last had the focus: files from a second launch go there (D46).
struct LastFocused(Mutex<String>);

/// Labels of the windows opened after "main".
static NEXT_WINDOW: AtomicU64 = AtomicU64::new(2);

/// Event carrying files from a second launch to a running window (D46).
const OPEN_FILES_EVENT: &str = "open-files";

/// Existing files among the arguments (without the program name), as absolute paths.
/// Relative paths are resolved against `cwd`; flags and missing paths are skipped.
fn startup_files_from(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .map(PathBuf::from)
        .filter(|p| !p.to_string_lossy().starts_with('-'))
        .map(|p| if p.is_absolute() { p } else { cwd.join(p) })
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// The calling window's startup files, handed out once: a reload does not add them again.
#[tauri::command]
fn startup_files(window: tauri::WebviewWindow, state: State<'_, StartupFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(window.label())
        .unwrap_or_default()
}

/// Shows a window that starts hidden if its frontend has not shown it after a few seconds
/// (D42).
fn show_later<R: tauri::Runtime>(window: tauri::WebviewWindow<R>) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
        }
    });
}

/// Opens `files` in a new window (D46), placed a little below and right of the caller.
/// Only existing files are passed on.
#[tauri::command]
async fn open_window(
    files: Vec<String>,
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, StartupFiles>,
) -> Result<(), ErrorPayload> {
    let files: Vec<String> = files
        .into_iter()
        .filter(|f| Path::new(f).is_file())
        .collect();
    let label = format!("doc-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    state
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(label.clone(), files);
    let internal = |e: tauri::Error| ErrorPayload {
        code: "internal",
        message: e.to_string(),
    };
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("HumblePDF")
            .inner_size(1200.0, 800.0)
            .visible(false);
    if let (Ok(pos), Ok(scale)) = (window.outer_position(), window.scale_factor()) {
        let p = pos.to_logical::<f64>(scale);
        builder = builder.position(p.x + 32.0, p.y + 32.0);
    }
    let new = builder.build().map_err(internal)?;
    show_later(new);
    Ok(())
}

/// The files of a second launch: its arguments after the program name, resolved against
/// the working directory it was started in (not this process's).
fn second_launch_files(argv: Vec<String>, cwd: &str) -> Vec<String> {
    startup_files_from(argv.into_iter().skip(1).map(OsString::from), Path::new(cwd))
}

/// A second launch (double-click while the app runs): bring the last focused window to the
/// front and hand it the files; it opens them or asks how (D46).
fn second_launch(app: &AppHandle, argv: Vec<String>, cwd: String) {
    let files = second_launch_files(argv, &cwd);
    let label = app
        .state::<LastFocused>()
        .0
        .lock()
        .map(|l| l.clone())
        .unwrap_or_else(|_| "main".into());
    let window = app
        .get_webview_window(&label)
        .or_else(|| app.webview_windows().into_values().next());
    let Some(window) = window else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    if !files.is_empty() {
        use tauri::Emitter;
        let _ = window.emit_to(window.label(), OPEN_FILES_EVENT, files);
    }
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
        // First: a second launch hands its files to this process and exits (D46).
        .plugin(tauri_plugin_single_instance::init(second_launch))
        .plugin(tauri_plugin_dialog::init())
        // Window position, size and maximized state are restored at start (D38). The plugin
        // does not show the window: the frontend shows it once the first screen is drawn
        // (with the startup files, if any), so no empty window flashes first (D42). Only the
        // main window's state is kept; extra windows open next to the one they came from.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_filter(|label| label == "main")
                .build(),
        )
        .manage(Sources::default())
        .manage(StartupFiles(Mutex::new(HashMap::from([(
            "main".to_string(),
            startup_files_from(
                std::env::args_os().skip(1),
                &std::env::current_dir().unwrap_or_default(),
            ),
        )]))))
        .manage(LastFocused(Mutex::new("main".into())))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event
                && let Ok(mut last) = window.state::<LastFocused>().0.lock()
            {
                *last = window.label().to_string();
            }
        })
        .setup(|app| {
            // The window starts hidden (tauri.conf.json) and the frontend shows it.
            if let Some(window) = app.get_webview_window("main") {
                show_later(window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_source,
            source_bytes,
            export_document,
            print_document,
            signature_list,
            signature_add,
            signature_add_png,
            signature_preview,
            signature_rename,
            signature_delete,
            signature_bytes,
            bundled_font,
            startup_files,
            open_window,
            bench_config,
            bench_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_files_keep_existing_files_only() {
        let dir = std::env::temp_dir().join(format!("humblepdf-args-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub dir")).unwrap();
        let a = dir.join("sub dir").join("문서 a.pdf");
        std::fs::write(&a, b"%PDF-1.7").unwrap();
        std::fs::write(dir.join("b.png"), b"x").unwrap();
        let args = [
            OsString::from(&a),                  // absolute, with a space and Hangul
            OsString::from("b.png"),             // relative to the working directory
            OsString::from("missing.pdf"),       // does not exist
            OsString::from("--flag"),            // not a file
            OsString::from(dir.join("sub dir")), // a folder
        ];
        let got = startup_files_from(args, &dir);
        assert_eq!(
            got,
            vec![
                a.to_string_lossy().into_owned(),
                dir.join("b.png").to_string_lossy().into_owned()
            ]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn second_launch_files_skip_the_program_and_use_its_directory() {
        let dir = std::env::temp_dir().join(format!("humblepdf-second-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("c.pdf"), b"%PDF-1.7").unwrap();
        // The program path itself exists but is not a file to open.
        let exe = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let got = second_launch_files(
            vec![exe, "c.pdf".into(), "--x".into()],
            &dir.to_string_lossy(),
        );
        assert_eq!(got, vec![dir.join("c.pdf").to_string_lossy().into_owned()]);
        assert!(second_launch_files(vec!["HumblePDF.exe".into()], "C:\\").is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
