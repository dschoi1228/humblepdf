//! The TypeScript model types in `src/bindings/` are generated from the Rust structs.
//! This test fails when they are out of date. Regenerate with `npm run bindings`
//! (sets UPDATE_BINDINGS=1 and runs this test).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn read_dir_ts(dir: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "ts") {
                let name = p.file_name().unwrap().to_string_lossy().into_owned();
                let text = std::fs::read_to_string(&p).unwrap().replace("\r\n", "\n");
                out.insert(name, text);
            }
        }
    }
    out
}

#[test]
fn bindings_are_up_to_date() {
    let repo_dir: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "src", "bindings"]
        .iter()
        .collect();

    if std::env::var("UPDATE_BINDINGS").is_ok_and(|v| v == "1") {
        if repo_dir.exists() {
            for (name, _) in read_dir_ts(&repo_dir) {
                std::fs::remove_file(repo_dir.join(name)).unwrap();
            }
        }
        humblepdf_core::model::export_bindings(&repo_dir).unwrap();
        return;
    }

    let tmp = std::env::temp_dir().join(format!("humblepdf-bindings-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    humblepdf_core::model::export_bindings(&tmp).unwrap();
    let generated = read_dir_ts(&tmp);
    let committed = read_dir_ts(&repo_dir);
    let _ = std::fs::remove_dir_all(&tmp);

    assert_eq!(
        generated.keys().collect::<Vec<_>>(),
        committed.keys().collect::<Vec<_>>(),
        "binding file list differs; run `npm run bindings`"
    );
    for (name, text) in &generated {
        assert_eq!(
            Some(text),
            committed.get(name),
            "{name} is out of date; run `npm run bindings`"
        );
    }
}
