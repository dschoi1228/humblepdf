//! Generates the synthetic test fixtures (SPEC 9). No real documents are used.
//!
//!   cargo run -p humblepdf-core --example gen_fixtures --release [-- --large]
//!
//! Small fixtures go to tests/fixtures/ (committed). `--large` also writes the
//! ~50MB PDF to tests/fixtures/large/ (git-ignored).

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use humblepdf_core::font::{FontSubsetBuilder, hex_string};
use image::{ImageBuffer, Rgb, Rgba};
use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
use lopdf::{
    Dictionary, Document, EncryptionState, EncryptionVersion, Object, ObjectId, Permissions,
    Stream, dictionary,
};

/// Password of the encrypted fixtures. Synthetic, used only by tests.
const FIXTURE_PASSWORD: &str = "fixture-pass";

type Box4 = [f64; 4];

fn num(v: f64) -> Object {
    humblepdf_core::pdf_util::real(v)
}

fn rect(b: Box4) -> Object {
    Object::Array(b.iter().map(|v| num(*v)).collect())
}

fn helvetica() -> Dictionary {
    dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    }
}

/// Content that makes position and orientation visible: a frame inset 10pt from the
/// visible box, a filled "up" triangle near the top edge, and a label.
fn marker_content(visible: Box4, label: &str) -> Vec<u8> {
    let [x0, y0, x1, y1] = visible;
    let cx = (x0 + x1) / 2.0;
    format!(
        "q 0.2 0.3 0.8 RG 2 w {fx} {fy} {fw} {fh} re S Q\n\
         q 0.85 0.2 0.2 rg {cx} {ty} m {lx} {by} l {rx} {by} l f Q\n\
         BT /F1 18 Tf 0 g {tx} {tyy} Td ({label}) Tj ET\n",
        fx = x0 + 10.0,
        fy = y0 + 10.0,
        fw = x1 - x0 - 20.0,
        fh = y1 - y0 - 20.0,
        ty = y1 - 30.0,
        by = y1 - 60.0,
        lx = cx - 20.0,
        rx = cx + 20.0,
        tx = x0 + 30.0,
        tyy = y1 - 90.0,
        label = label.replace('(', "\\(").replace(')', "\\)"),
    )
    .into_bytes()
}

struct PageSpec {
    media: Box4,
    crop: Option<Box4>,
    rotate: Option<i64>,
    label: String,
}

fn visible(p: &PageSpec) -> Box4 {
    match p.crop {
        Some(c) => [
            c[0].max(p.media[0]),
            c[1].max(p.media[1]),
            c[2].min(p.media[2]),
            c[3].min(p.media[3]),
        ],
        None => p.media,
    }
}

fn finish(mut doc: Document, pages_id: ObjectId, kids: Vec<ObjectId>) -> Document {
    let count = kids.len() as i64;
    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => kids.into_iter().map(Object::Reference).collect::<Vec<_>>(),
        "Count" => count,
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc
}

/// One page per spec, each with its own Resources and a single content stream.
fn simple_doc(specs: &[PageSpec]) -> Document {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(helvetica());
    let mut kids = Vec::new();
    for s in specs {
        let content = doc.add_object(Stream::new(
            Dictionary::new(),
            marker_content(visible(s), &s.label),
        ));
        let mut page = dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => rect(s.media),
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
            "Contents" => content,
        };
        if let Some(c) = s.crop {
            page.set("CropBox", rect(c));
        }
        if let Some(r) = s.rotate {
            page.set("Rotate", r);
        }
        kids.push(doc.add_object(page));
    }
    finish(doc, pages_id, kids)
}

const A4: Box4 = [0.0, 0.0, 595.276, 841.89];
const LETTER: Box4 = [0.0, 0.0, 612.0, 792.0];

fn spec(media: Box4, crop: Option<Box4>, rotate: Option<i64>, label: &str) -> PageSpec {
    PageSpec {
        media,
        crop,
        rotate,
        label: label.to_owned(),
    }
}

fn rotated() -> Document {
    simple_doc(&[
        spec(A4, None, None, "rotate 0"),
        spec(A4, None, Some(90), "rotate 90"),
        spec(A4, None, Some(180), "rotate 180"),
        spec(A4, None, Some(270), "rotate 270"),
        spec(A4, None, Some(-90), "rotate -90"),
    ])
}

fn cropbox() -> Document {
    simple_doc(&[
        spec(
            LETTER,
            Some([50.0, 60.0, 500.0, 700.0]),
            None,
            "crop inside",
        ),
        spec(
            [-100.0, -50.0, 500.0, 700.0],
            Some([-80.0, -40.0, 480.0, 690.0]),
            None,
            "negative origin",
        ),
        spec(
            LETTER,
            Some([300.0, 400.0, 900.0, 1000.0]),
            None,
            "crop overflow",
        ),
        spec(
            LETTER,
            Some([50.0, 60.0, 500.0, 700.0]),
            Some(90),
            "crop + rotate 90",
        ),
    ])
}

fn mixed_sizes() -> Document {
    simple_doc(&[
        spec(A4, None, None, "A4"),
        spec(LETTER, None, None, "Letter"),
        spec([0.0, 0.0, 595.276, 419.528], None, None, "A5 landscape"),
        spec([0.0, 0.0, 1190.55, 841.89], None, None, "A3 landscape"),
    ])
}

/// MediaBox, Rotate and Resources live on Pages nodes; CropBox on an intermediate node.
fn inherited() -> Document {
    let mut doc = Document::with_version("1.7");
    let root_id = doc.new_object_id();
    let mid_id = doc.new_object_id();
    let font = doc.add_object(helvetica());
    let mut mid_kids = Vec::new();
    for label in ["inherited 1", "inherited 2"] {
        let content = doc.add_object(Stream::new(
            Dictionary::new(),
            marker_content([40.0, 50.0, 560.0, 800.0], label),
        ));
        mid_kids.push(doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => mid_id, "Contents" => content,
        }));
    }
    let own_content = doc.add_object(Stream::new(
        Dictionary::new(),
        marker_content([0.0, 0.0, 400.0, 400.0], "own boxes"),
    ));
    let own = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => root_id, "Contents" => own_content,
        "MediaBox" => rect([0.0, 0.0, 400.0, 400.0]), "Rotate" => 0,
    });
    doc.objects.insert(
        mid_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Parent" => root_id,
            "Kids" => mid_kids.iter().map(|k| Object::Reference(*k)).collect::<Vec<_>>(),
            "Count" => mid_kids.len() as i64,
            "CropBox" => rect([40.0, 50.0, 560.0, 800.0]),
        }),
    );
    doc.objects.insert(
        root_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(mid_id), Object::Reference(own)],
            "Count" => 3,
            "MediaBox" => rect(A4),
            "Rotate" => 90,
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => root_id });
    doc.trailer.set("Root", catalog);
    doc
}

/// Three pages referencing one Resources dictionary object.
fn shared_resources() -> Document {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(helvetica());
    let res = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font } });
    let mut kids = Vec::new();
    for i in 1..=3 {
        let content = doc.add_object(Stream::new(
            Dictionary::new(),
            marker_content(A4, &format!("shared resources {i}")),
        ));
        kids.push(doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "MediaBox" => rect(A4),
            "Resources" => res, "Contents" => content,
        }));
    }
    finish(doc, pages_id, kids)
}

/// /Contents is an array; the last stream leaves an unbalanced `cm` behind,
/// which is what SPEC 7.5's q/Q wrapping protects against.
fn content_array() -> Document {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(helvetica());
    let body = marker_content(A4, "content array");
    let mid = body.len() / 2;
    let split = body[..mid]
        .iter()
        .rposition(|b| *b == b'\n')
        .map(|p| p + 1)
        .unwrap_or(0);
    let parts = [
        body[..split].to_vec(),
        body[split..].to_vec(),
        b"0.5 0 0 0.5 100 100 cm 1 0 0 RG\n".to_vec(),
    ];
    let ids: Vec<Object> = parts
        .into_iter()
        .map(|p| Object::Reference(doc.add_object(Stream::new(Dictionary::new(), p))))
        .collect();
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id, "MediaBox" => rect(A4),
        "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        "Contents" => ids,
    });
    finish(doc, pages_id, vec![page])
}

fn encrypt(mut doc: Document, aes256: bool) -> Document {
    let permissions = Permissions::PRINTABLE | Permissions::COPYABLE;
    let key = [7u8; 32];
    // The RC4/AES-128 key derivation needs the file identifier.
    let id = Object::String(
        b"pdf-editor-fixt".to_vec(),
        lopdf::StringFormat::Hexadecimal,
    );
    doc.trailer.set("ID", vec![id.clone(), id]);
    let version = if aes256 {
        let filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
        EncryptionVersion::V5 {
            encrypt_metadata: true,
            crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filter)]),
            file_encryption_key: &key,
            stream_filter: b"StdCF".to_vec(),
            string_filter: b"StdCF".to_vec(),
            owner_password: "fixture-owner",
            user_password: FIXTURE_PASSWORD,
            permissions,
        }
    } else {
        EncryptionVersion::V2 {
            document: &doc,
            owner_password: "fixture-owner",
            user_password: FIXTURE_PASSWORD,
            key_length: 128,
            permissions,
        }
    };
    let state = EncryptionState::try_from(version).expect("encryption state");
    doc.encrypt(&state).expect("encrypt");
    doc
}

/// Korean text with the bundled font embedded as a subset.
pub const KOREAN_TEXT: [&str; 3] = [
    "한글 렌더링 검사: 폰트 포함",
    "다람쥐 헌 쳇바퀴에 타고파",
    "가나다라마바사 0123456789",
];
/// Korean text with a non-embedded Adobe-Korea1 font (rendered through cMaps).
pub const KOREAN_TEXT_NOEMBED: [&str; 2] = [
    "한글 렌더링 검사: 폰트 미포함",
    "키스의 고유조건은 입술끼리 만나야",
];

fn korean_embedded() -> Document {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut font = FontSubsetBuilder::bundled().expect("font");
    let mut content = String::new();
    for (i, line) in KOREAN_TEXT.iter().enumerate() {
        let enc = font.encode(line);
        let hex: String = enc.codes.iter().map(|b| format!("{b:02X}")).collect();
        content.push_str(&format!(
            "BT /K1 24 Tf 60 {} Td <{hex}> Tj ET\n",
            760 - i * 50
        ));
    }
    let _ = hex_string; // same encoding as `hex_string`, written inline above
    let font_id = font.write(&mut doc).expect("write font");
    let c = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id, "MediaBox" => rect(A4),
        "Resources" => dictionary! { "Font" => dictionary! { "K1" => font_id } },
        "Contents" => c,
    });
    finish(doc, pages_id, vec![page])
}

fn korean_nonembedded() -> Document {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let descriptor = doc.add_object(dictionary! {
        "Type" => "FontDescriptor", "FontName" => "HYSMyeongJo-Medium", "Flags" => 6,
        "FontBBox" => vec![0.into(), Object::Integer(-148), 1001.into(), 880.into()],
        "ItalicAngle" => 0, "Ascent" => 880, "Descent" => -120, "CapHeight" => 880,
        "StemV" => 60,
    });
    let cid = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "CIDFontType0", "BaseFont" => "HYSMyeongJo-Medium",
        "CIDSystemInfo" => dictionary! {
            "Registry" => Object::string_literal("Adobe"),
            "Ordering" => Object::string_literal("Korea1"),
            "Supplement" => 2,
        },
        "FontDescriptor" => descriptor, "DW" => 1000,
    });
    let font = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type0", "BaseFont" => "HYSMyeongJo-Medium",
        "Encoding" => "UniKS-UCS2-H",
        "DescendantFonts" => vec![Object::Reference(cid)],
    });
    let mut content = String::new();
    for (i, line) in KOREAN_TEXT_NOEMBED.iter().enumerate() {
        let hex: String = line.encode_utf16().map(|u| format!("{u:04X}")).collect();
        content.push_str(&format!(
            "BT /K1 24 Tf 60 {} Td <{hex}> Tj ET\n",
            760 - i * 50
        ));
    }
    let c = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
    let page = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id, "MediaBox" => rect(A4),
        "Resources" => dictionary! { "Font" => dictionary! { "K1" => font } },
        "Contents" => c,
    });
    finish(doc, pages_id, vec![page])
}

/// ~50MB: four pages, each with an incompressible 2048x2048 RGB noise image.
fn large() -> Document {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut kids = Vec::new();
    for i in 0..4 {
        let side = 2048usize;
        let mut px = vec![0u8; side * side * 3];
        for b in px.iter_mut() {
            // xorshift64*
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            *b = (state.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 56) as u8;
        }
        let img = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image",
                "Width" => side as i64, "Height" => side as i64,
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
            },
            px,
        ));
        let mut content = b"q 595 0 0 842 0 0 cm /Im0 Do Q\n".to_vec();
        content.extend(marker_content(A4, &format!("large {}", i + 1)));
        let font = doc.add_object(helvetica());
        let c = doc.add_object(Stream::new(Dictionary::new(), content));
        kids.push(doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "MediaBox" => rect(A4),
            "Resources" => dictionary! {
                "XObject" => dictionary! { "Im0" => img },
                "Font" => dictionary! { "F1" => font },
            },
            "Contents" => c,
        }));
    }
    finish(doc, pages_id, kids)
}

fn save(mut doc: Document, path: &Path, compress: bool) {
    if compress {
        doc.compress();
    }
    let mut f = std::fs::File::create(path).expect("create fixture");
    doc.save_to(&mut f).expect("save fixture");
    println!(
        "{:>10} bytes  {}",
        std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        path.display()
    );
}

fn photo_jpeg() -> Vec<u8> {
    let img = ImageBuffer::from_fn(640, 480, |x, y| {
        Rgb::<u8>([(x * 255 / 640) as u8, (y * 255 / 480) as u8, 128])
    });
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85)
        .encode_image(&img)
        .expect("jpeg");
    out
}

/// A portrait "camera" JPEG stored landscape with EXIF orientation 6 (rotate 90 CW).
fn exif_rotated_jpeg() -> Vec<u8> {
    // Stored 600x400; an arrow-like band marks the stored top edge.
    let img = ImageBuffer::from_fn(600, 400, |x, y| {
        if y < 60 {
            Rgb::<u8>([220, 40, 40])
        } else {
            Rgb::<u8>([40, (x * 200 / 600) as u8 + 40, 200])
        }
    });
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .encode_image(&img)
        .expect("jpeg");
    // Minimal APP1 Exif segment (big-endian TIFF, one IFD entry: Orientation = 6).
    let tiff: [u8; 26] = [
        b'M', b'M', 0, 42, 0, 0, 0, 8, // header, IFD at 8
        0, 1, // one entry
        0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, // Orientation SHORT 1 = 6
        0, 0, 0, 0, // next IFD
    ];
    let mut app1 = b"Exif\0\0".to_vec();
    app1.extend_from_slice(&tiff);
    let len = (app1.len() + 2) as u16;
    let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&app1);
    out.extend_from_slice(&jpeg[2..]);
    out
}

/// RGBA PNG with a fully transparent border and a half-transparent band.
fn alpha_png(w: u32, h: u32) -> Vec<u8> {
    let img = ImageBuffer::from_fn(w, h, |x, y| {
        let border = x < w / 10 || y < h / 10 || x >= w - w / 10 || y >= h - h / 10;
        if border {
            Rgba::<u8>([0, 0, 0, 0])
        } else if y < h / 2 {
            Rgba::<u8>([20, 120, 60, 255])
        } else {
            Rgba::<u8>([20, 60, 160, 128])
        }
    });
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png");
    out
}

/// Synthetic "signature": a looping pen stroke on a transparent background.
fn synthetic_signature(w: u32, h: u32) -> Vec<u8> {
    let mut img = ImageBuffer::from_pixel(w, h, Rgba::<u8>([0, 0, 0, 0]));
    let (wf, hf) = (f64::from(w), f64::from(h));
    let steps = 4000;
    for i in 0..steps {
        let t = f64::from(i) / f64::from(steps);
        let x = 0.06 * wf + t * 0.88 * wf + (t * 40.0).sin() * 0.03 * wf;
        let y = hf / 2.0
            + (t * 14.0).sin() * 0.28 * hf * (1.0 - t * 0.5)
            + (t * 40.0).cos() * 0.08 * hf;
        let r = 3.0;
        for dy in -3i32..=3 {
            for dx in -3i32..=3 {
                let d = f64::from(dx * dx + dy * dy).sqrt();
                if d > r {
                    continue;
                }
                let (px, py) = (x as i32 + dx, y as i32 + dy);
                if px >= 0 && py >= 0 && (px as u32) < w && (py as u32) < h {
                    let a = (255.0 * (1.0 - d / (r + 1.0))) as u8;
                    let p = img.get_pixel_mut(px as u32, py as u32);
                    if a > p.0[3] {
                        *p = Rgba::<u8>([20, 30, 110, a]);
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png");
    out
}

/// 300 pages (M1): a large page number on each, sizes cycling A4 / Letter / A5 landscape,
/// every 7th page rotated 90.
fn pages_300() -> Document {
    let sizes = [A4, LETTER, [0.0, 0.0, 595.276, 419.528]];
    let specs: Vec<PageSpec> = (1..=300)
        .map(|n| {
            spec(
                sizes[(n - 1) % 3],
                None,
                (n % 7 == 0).then_some(90),
                &format!("Page {n} of 300"),
            )
        })
        .collect();
    let mut doc = simple_doc(&specs);
    // Big centered number so screenshots show which page is where.
    for (i, (_, page_id)) in doc.get_pages().into_iter().enumerate() {
        let b = sizes[i % 3];
        let content = format!(
            "BT /F1 120 Tf 0.75 g {} {} Td ({}) Tj ET\n",
            b[2] / 2.0 - 100.0,
            b[3] / 2.0 - 40.0,
            i + 1
        );
        let extra = doc.add_object(Stream::new(Dictionary::new(), content.into_bytes()));
        let page = doc.get_dictionary_mut(page_id).expect("page");
        let first = page.get(b"Contents").expect("contents").clone();
        page.set("Contents", vec![first, Object::Reference(extra)]);
    }
    doc
}

/// A PDF that cannot be parsed: header and the start of an object, then nothing.
fn broken_pdf() -> Vec<u8> {
    b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R\n".to_vec()
}

fn main() {
    let large_requested = std::env::args().any(|a| a == "--large");
    let root: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "tests", "fixtures"]
        .iter()
        .collect();
    std::fs::create_dir_all(&root).expect("fixtures dir");

    save(rotated(), &root.join("rotated.pdf"), true);
    save(pages_300(), &root.join("pages_300.pdf"), true);
    std::fs::write(root.join("broken.pdf"), broken_pdf()).expect("broken.pdf");
    save(cropbox(), &root.join("cropbox.pdf"), true);
    save(mixed_sizes(), &root.join("mixed_sizes.pdf"), true);
    save(inherited(), &root.join("inherited.pdf"), true);
    save(shared_resources(), &root.join("shared_resources.pdf"), true);
    save(content_array(), &root.join("content_array.pdf"), true);
    save(korean_embedded(), &root.join("korean_embedded.pdf"), true);
    save(
        korean_nonembedded(),
        &root.join("korean_nonembedded.pdf"),
        true,
    );
    save(
        encrypt(
            simple_doc(&[spec(A4, None, None, "encrypted AES-256")]),
            true,
        ),
        &root.join("encrypted_aes256.pdf"),
        false,
    );
    save(
        encrypt(
            simple_doc(&[spec(A4, None, Some(90), "encrypted RC4")]),
            false,
        ),
        &root.join("encrypted_rc4.pdf"),
        false,
    );

    for (name, bytes) in [
        ("photo.jpg", photo_jpeg()),
        ("exif_rotate90.jpg", exif_rotated_jpeg()),
        ("alpha.png", alpha_png(400, 300)),
        ("signatures/sig-demo.png", synthetic_signature(600, 200)),
    ] {
        if let Some(dir) = root.join(name).parent() {
            std::fs::create_dir_all(dir).expect("dir");
        }
        let p = root.join(name);
        std::fs::write(&p, &bytes).expect("write image");
        println!("{:>10} bytes  {}", bytes.len(), p.display());
    }

    if large_requested {
        let dir = root.join("large");
        std::fs::create_dir_all(&dir).expect("large dir");
        save(large(), &dir.join("large_50mb.pdf"), false);
    }
}
