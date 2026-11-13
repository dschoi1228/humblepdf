//! Safe file writing (SPEC 7.8, D10): refuse source paths, write a temporary file in the
//! same folder, then rename it over the target.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};

/// Absolute, normalized form of `p` for comparison. Works for files that do not exist yet.
fn comparable(p: &Path) -> PathBuf {
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|d| d.join(p))
            .unwrap_or_else(|_| p.to_path_buf())
    };
    if let Ok(c) = abs.canonicalize() {
        return c;
    }
    match (
        abs.parent().and_then(|d| d.canonicalize().ok()),
        abs.file_name(),
    ) {
        (Some(dir), Some(name)) => dir.join(name),
        _ => abs,
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    let (a, b) = (comparable(a), comparable(b));
    if cfg!(windows) {
        a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
    } else {
        a == b
    }
}

/// Fails with `OutputIsSource` when `out` is one of `sources`.
pub fn ensure_not_source<'a>(
    out: &Path,
    sources: impl IntoIterator<Item = &'a Path>,
) -> Result<()> {
    for s in sources {
        if same_path(out, s) {
            return Err(CoreError::OutputIsSource);
        }
    }
    Ok(())
}

/// Writes `bytes` to `path` through a temporary file in the same folder. On failure the
/// temporary file is removed and any existing file at `path` is left untouched.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| CoreError::Io(std::io::Error::other("output path has no file name")))?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_source_path_case_insensitively_on_windows() {
        let dir = std::env::temp_dir().join(format!("pe-write-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("원본 파일.pdf");
        std::fs::write(&src, b"x").unwrap();
        assert!(ensure_not_source(&src, [src.as_path()]).is_err());
        if cfg!(windows) {
            let upper = dir.join("원본 파일.PDF");
            assert!(ensure_not_source(&upper, [src.as_path()]).is_err());
        }
        let other = dir.join("출력.pdf");
        assert!(ensure_not_source(&other, [src.as_path()]).is_ok());

        write_atomic(&other, b"first").unwrap();
        write_atomic(&other, b"second").unwrap();
        assert_eq!(std::fs::read(&other).unwrap(), b"second");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
