# HumblePDF

A humble little PDF tool: merge, sign, mark up. Fully offline.

HumblePDF is an offline PDF editor for Windows 11. It merges PDFs and images into one document, organizes
pages, and adds highlights, shapes, text and signature images. Edits are non-destructive:
source files are never modified, and saving always writes a new PDF.

The UI is available in English, Korean and Japanese. It follows the Windows display language
and can be changed from the toolbar.

> **Status:** in development. Viewing, merging, page organization, annotations, signatures,
> text, reopening saved files for editing and flattened export work (milestones M0–M6).
> Finishing and release preparation are next (M7). See [docs/SPEC.md](docs/SPEC.md) for the
> specification and milestones (in Korean).

## Features

Working now:

- Add PDFs (including password-protected ones) and JPG/PNG images, merged into one document
- Continuous scrolling viewer with thumbnails and zoom from 25% to 400%
- Reorder pages by dragging thumbnails, select multiple pages, delete and rotate them, and
  choose how image pages fit (A4 or image size), with undo and redo
- Highlights, rectangles, ellipses, lines and arrows, saved as standard PDF annotations
- Text in Korean, English and Japanese, saved as FreeText annotations with embedded font
  subsets
- A signature library (PNG/JPG) and signature placement; signatures are baked into the page
- Copy, paste and duplicate objects
- Save as a new PDF. Saving over an open source file is refused
- Reopen a file saved by HumblePDF: its highlights, shapes and text come back editable
- Export a flattened copy with every object baked into the pages
- Fully offline: no network requests. Fonts and PDF.js assets are bundled

Planned:

- Finishing touches and release preparation (license, notices, CI, portable release)

## Tech stack

| Area | Choice |
|---|---|
| App shell | [Tauri 2](https://tauri.app/) (WebView2) |
| UI | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Page rendering | [PDF.js](https://mozilla.github.io/pdf.js/) |
| Core | Rust: `lopdf` (PDF read/write), `subsetter` (font subsetting), `image` |
| Bundled fonts | Pretendard Regular and Pretendard JP (common characters), OFL 1.1 |

PDF bytes are produced only in the Rust core (`crates/core`). The frontend renders pages and
handles the editing UI. The document model's source of truth is a set of Rust types; the
TypeScript types are generated from them.

## Building

Requirements: Windows 11, Node.js, the Rust toolchain, and Microsoft Edge (for end-to-end
tests).

```
npm install
npm run tauri dev        # run the app (development build)
npm run build:exe        # portable exe at target/release/HumblePDF.exe
```

If PowerShell's execution policy blocks `npm.ps1`, use `npm.cmd` instead of `npm`.

## Testing

```
cargo test --workspace                                 # core and CLI, including re-parsing exported PDFs
npm test                                               # frontend unit tests (Vitest)
npm run e2e                                            # end-to-end tests (Playwright, installed Edge)
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
npm run lint                                           # ESLint and TypeScript
```

All test files are synthetic. Run `npm run fixtures` to regenerate them.

## Repository layout

```
crates/core/    Rust library: document model, source inspection, PDF export
crates/cli/     Command-line front end to the core, for headless checks
src-tauri/      Tauri commands (thin wrappers around the core)
src/            Frontend: viewer, page organization, state, UI
src/i18n/       UI strings (ko, en, ja)
assets/fonts/   Bundled font
tests/          Fixtures, unit tests and end-to-end tests
docs/           Specification, decision log and milestone reports (Korean)
```

## Contributing translations

UI strings live in `src/i18n/`. `ko.ts` defines the keys, and `en.ts` and `ja.ts` must have
exactly the same keys; the type checker and `src/i18n/i18n.test.ts` enforce this. The Japanese
translation has not yet been reviewed by a native speaker, and corrections are welcome.

## License

To be decided before the first public release. Dependencies are limited to permissive licenses
(MIT, Apache-2.0, BSD, OFL).
