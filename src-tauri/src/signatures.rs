//! Signature library (SPEC 6.8, D30): `<id>.png` files and an `index.json` in one folder
//! under the app data directory. Functions take the folder, so they are tested without
//! Tauri. Images are normalized by the core when added; the chosen file is only read.
//! Names and paths are never logged (D12).

use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use humblepdf_core::error::{CoreError, ErrorPayload};
use humblepdf_core::signature::normalize;
use humblepdf_core::write::write_atomic;
use serde::{Deserialize, Serialize};

const INDEX: &str = "index.json";
/// Longest allowed name, in characters.
pub const MAX_NAME: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureMeta {
    pub id: String,
    pub name: String,
    /// Pixel size of the stored PNG.
    pub width: u32,
    pub height: u32,
    /// Seconds since the Unix epoch.
    pub added: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    version: u32,
    signatures: Vec<SignatureMeta>,
}

fn fail(code: &'static str, message: impl Into<String>) -> ErrorPayload {
    ErrorPayload {
        code,
        message: message.into(),
    }
}

fn core(e: CoreError) -> ErrorPayload {
    ErrorPayload::from(&e)
}

fn io(e: std::io::Error) -> ErrorPayload {
    core(CoreError::Io(e))
}

/// Ids become file names (and the core accepts only this alphabet).
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    // RandomState is seeded randomly per instance.
    let r = RandomState::new().hash_one((nanos, n, std::process::id()));
    format!("sg-{r:016x}")
}

fn clean_name(name: &str) -> Result<String, ErrorPayload> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(fail(
            "invalid_name",
            "the name must have 1 to 100 characters",
        ));
    }
    Ok(name.to_owned())
}

fn png_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.png"))
}

fn read_index(dir: &Path) -> Result<Index, ErrorPayload> {
    match std::fs::read(dir.join(INDEX)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| fail("io", format!("the signature list is damaged: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Index {
            version: 1,
            signatures: vec![],
        }),
        Err(e) => Err(io(e)),
    }
}

fn write_index(dir: &Path, index: &Index) -> Result<(), ErrorPayload> {
    let bytes = serde_json::to_vec_pretty(index).map_err(|e| fail("io", e.to_string()))?;
    write_atomic(&dir.join(INDEX), &bytes).map_err(core)
}

/// Signatures in the order they were added.
pub fn list(dir: &Path) -> Result<Vec<SignatureMeta>, ErrorPayload> {
    Ok(read_index(dir)?.signatures)
}

/// Normalizes the image at `source` and adds it under `name`.
pub fn add(dir: &Path, source: &Path, name: &str) -> Result<SignatureMeta, ErrorPayload> {
    let name = clean_name(name)?;
    let bytes = std::fs::read(source).map_err(io)?;
    let n = normalize(&bytes).map_err(core)?;
    std::fs::create_dir_all(dir).map_err(io)?;
    let mut index = read_index(dir)?;
    let meta = SignatureMeta {
        id: new_id(),
        name,
        width: n.width,
        height: n.height,
        added: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    write_atomic(&png_path(dir, &meta.id), &n.png).map_err(core)?;
    index.signatures.push(meta.clone());
    write_index(dir, &index)?;
    Ok(meta)
}

fn position(index: &Index, id: &str) -> Result<usize, ErrorPayload> {
    if !valid_id(id) {
        return Err(fail("unknown_signature", "invalid signature id"));
    }
    index
        .signatures
        .iter()
        .position(|s| s.id == id)
        .ok_or_else(|| fail("unknown_signature", "no such signature"))
}

pub fn rename(dir: &Path, id: &str, name: &str) -> Result<SignatureMeta, ErrorPayload> {
    let name = clean_name(name)?;
    let mut index = read_index(dir)?;
    let i = position(&index, id)?;
    index.signatures[i].name = name;
    write_index(dir, &index)?;
    Ok(index.signatures[i].clone())
}

/// Removes the signature from the list, then its image.
pub fn delete(dir: &Path, id: &str) -> Result<(), ErrorPayload> {
    let mut index = read_index(dir)?;
    let i = position(&index, id)?;
    index.signatures.remove(i);
    write_index(dir, &index)?;
    match std::fs::remove_file(png_path(dir, id)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(e)),
        _ => Ok(()),
    }
}

/// The stored PNG.
pub fn bytes(dir: &Path, id: &str) -> Result<Vec<u8>, ErrorPayload> {
    let index = read_index(dir)?;
    position(&index, id)?;
    std::fs::read(png_path(dir, id)).map_err(io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    fn fixture(name: &str) -> PathBuf {
        [env!("CARGO_MANIFEST_DIR"), "..", "tests", "fixtures", name]
            .iter()
            .collect()
    }

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pe-sig-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn hash(p: &Path) -> u64 {
        let mut h = DefaultHasher::new();
        std::fs::read(p).unwrap().hash(&mut h);
        h.finish()
    }

    #[test]
    fn add_list_rename_delete_and_reload() {
        let dir = temp("cycle");
        assert!(
            list(&dir).unwrap().is_empty(),
            "missing folder is an empty list"
        );

        let src = fixture("exif_rotate90.jpg");
        let before = hash(&src);
        let a = add(&dir, &src, "  First  ").unwrap();
        let b = add(&dir, &fixture("signatures/sig-demo.png"), "Second").unwrap();
        assert_eq!(hash(&src), before, "the chosen file is only read");
        assert_eq!(a.name, "First");
        assert_ne!(a.id, b.id);
        assert!(valid_id(&a.id));
        assert!(dir.join(format!("{}.png", a.id)).exists());
        // Stored as PNG, orientation applied (portrait).
        let png = bytes(&dir, &a.id).unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(a.height > a.width);

        let renamed = rename(&dir, &a.id, "서명 하나").unwrap();
        assert_eq!(renamed.name, "서명 하나");
        // Survives a "restart": everything is read back from the folder.
        let listed = list(&dir).unwrap();
        assert_eq!(
            listed.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["서명 하나", "Second"]
        );

        delete(&dir, &a.id).unwrap();
        assert!(!dir.join(format!("{}.png", a.id)).exists());
        assert_eq!(list(&dir).unwrap(), vec![b]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bad_input_is_refused() {
        let dir = temp("bad");
        let ok = add(&dir, &fixture("signatures/sig-demo.png"), "x").unwrap();
        assert_eq!(
            add(&dir, &fixture("rotated.pdf"), "pdf").unwrap_err().code,
            "unknown_format"
        );
        assert_eq!(
            add(&dir, &fixture("alpha.png"), "   ").unwrap_err().code,
            "invalid_name"
        );
        let long = "x".repeat(MAX_NAME + 1);
        assert_eq!(
            rename(&dir, &ok.id, &long).unwrap_err().code,
            "invalid_name"
        );
        for id in ["..\\index", "../x", "", "nope"] {
            assert_eq!(
                bytes(&dir, id).unwrap_err().code,
                "unknown_signature",
                "{id:?}"
            );
            assert_eq!(
                delete(&dir, id).unwrap_err().code,
                "unknown_signature",
                "{id:?}"
            );
        }
        assert_eq!(list(&dir).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
