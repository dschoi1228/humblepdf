//! Embedding the bundled font as a subset Type0 / CIDFontType2 font (SPEC 7.6).
//!
//! Glyphs are renumbered by `subsetter`; the new glyph id is used as the CID with
//! `/CIDToGIDMap /Identity`, so content-stream codes, `/W` keys and ToUnicode keys are
//! all new glyph ids. cmap lookups and advance widths come from the original font
//! (the subset has no cmap). Only default advance widths are used: no kerning,
//! ligatures or shaping.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use lopdf::{Dictionary, Document, Object, ObjectId, Stream, dictionary};
use subsetter::GlyphRemapper;

use crate::error::{CoreError, Result};

/// The bundled font. The frontend loads the same file (CLAUDE.md, D8).
pub static BUNDLED_FONT: &[u8] = include_bytes!("../../../assets/fonts/Pretendard-Regular.ttf");
pub const BUNDLED_FONT_NAME: &str = "Pretendard-Regular";
/// Japanese companion: Pretendard JP cut to common characters (D32, `npm run fonts`).
pub static JP_FONT: &[u8] = include_bytes!("../../../assets/fonts/PretendardJP-Common.ttf");
pub const JP_FONT_NAME: &str = "PretendardJP-Common";

/// The bundled font files by name ("main" or "jp"), for the frontend to load as web fonts
/// (D39): the app carries each font once, in the core.
pub fn bundled_font(name: &str) -> Option<&'static [u8]> {
    match name {
        "main" => Some(BUNDLED_FONT),
        "jp" => Some(JP_FONT),
        _ => None,
    }
}

/// Collects the glyphs used by a document and writes the subset font once.
pub struct FontSubsetBuilder<'a> {
    data: &'a [u8],
    face: ttf_parser::Face<'a>,
    name: String,
    remapper: GlyphRemapper,
    /// new gid -> text it represents (for ToUnicode)
    unicode: BTreeMap<u16, String>,
    /// new gid -> advance in 1/1000 em
    widths: BTreeMap<u16, f64>,
    missing: BTreeSet<char>,
}

/// A piece of text encoded for the subset font.
#[derive(Debug, Clone)]
pub struct EncodedText {
    /// Two-byte big-endian CIDs, ready for a `Tj` string.
    pub codes: Vec<u8>,
    /// Total advance in 1/1000 em.
    pub advance: f64,
}

impl<'a> FontSubsetBuilder<'a> {
    pub fn new(data: &'a [u8], name: &str) -> Result<Self> {
        let face = ttf_parser::Face::parse(data, 0).map_err(|e| CoreError::Font(format!("{e}")))?;
        if face.tables().glyf.is_none() {
            return Err(CoreError::Font("font has no TrueType outlines".into()));
        }
        Ok(FontSubsetBuilder {
            data,
            face,
            name: name.to_owned(),
            remapper: GlyphRemapper::new(),
            unicode: BTreeMap::new(),
            widths: BTreeMap::new(),
            missing: BTreeSet::new(),
        })
    }

    pub fn bundled() -> Result<FontSubsetBuilder<'static>> {
        FontSubsetBuilder::new(BUNDLED_FONT, BUNDLED_FONT_NAME)
    }

    pub fn units_per_em(&self) -> f64 {
        f64::from(self.face.units_per_em())
    }

    /// Ascent and descent (hhea) in 1/1000 em.
    pub fn metrics(&self) -> crate::export::appearance::TextMetrics {
        let k = 1000.0 / self.units_per_em();
        crate::export::appearance::TextMetrics {
            ascent: f64::from(self.face.ascender()) * k,
            descent: f64::from(self.face.descender()) * k,
        }
    }

    fn advance_1000(&self, gid: ttf_parser::GlyphId) -> f64 {
        let adv = self.face.glyph_hor_advance(gid).unwrap_or(0);
        f64::from(adv) * 1000.0 / self.units_per_em()
    }

    /// Advance width of `text` in 1/1000 em, without registering glyphs.
    pub fn measure(&self, text: &str) -> f64 {
        text.chars()
            .map(|c| self.advance_1000(self.glyph_for(c).unwrap_or(self.blank_glyph())))
            .sum()
    }

    /// True when the font has a glyph for `c`.
    pub fn has(&self, c: char) -> bool {
        self.glyph_for(c).is_some()
    }

    fn glyph_for(&self, c: char) -> Option<ttf_parser::GlyphId> {
        self.face.glyph_index(c).filter(|g| g.0 != 0)
    }

    /// Glyph used for characters the font does not have: the space glyph (no outline).
    fn blank_glyph(&self) -> ttf_parser::GlyphId {
        self.face.glyph_index(' ').unwrap_or(ttf_parser::GlyphId(0))
    }

    /// Registers the glyphs of `text` and returns its encoding.
    pub fn encode(&mut self, text: &str) -> EncodedText {
        let mut codes = Vec::with_capacity(text.len() * 2);
        let mut advance = 0.0;
        for c in text.chars() {
            let gid = match self.glyph_for(c) {
                Some(g) => g,
                None => {
                    if !c.is_whitespace() {
                        self.missing.insert(c);
                    }
                    self.blank_glyph()
                }
            };
            let new = self.remapper.remap(gid.0);
            let w = self.advance_1000(gid);
            self.widths.insert(new, w);
            if gid == self.blank_glyph() {
                self.unicode.entry(new).or_insert_with(|| " ".into());
            } else {
                self.unicode.entry(new).or_insert_with(|| c.to_string());
            }
            codes.extend_from_slice(&new.to_be_bytes());
            advance += w;
        }
        EncodedText { codes, advance }
    }

    /// Characters the font does not contain, collected for the warning list.
    pub fn missing_chars(&self) -> &BTreeSet<char> {
        &self.missing
    }

    /// Writes the subset font into `doc` and returns the Type0 font object id.
    pub fn write(&self, doc: &mut Document) -> Result<ObjectId> {
        let subset = subsetter::subset(self.data, 0, &self.remapper)
            .map_err(|e| CoreError::Font(format!("subsetting failed: {e:?}")))?;
        let base_font = format!("{}+{}", self.subset_tag(), self.name);

        let mut file = Stream::new(dictionary! { "Length1" => subset.len() as i64 }, subset);
        file.compress().map_err(CoreError::from)?;
        let file_id = doc.add_object(file);

        let upem = self.units_per_em();
        let s = |v: i16| Object::Integer((f64::from(v) * 1000.0 / upem).round() as i64);
        let bbox = self.face.global_bounding_box();
        let descriptor = dictionary! {
            "Type" => "FontDescriptor",
            "FontName" => Object::Name(base_font.clone().into_bytes()),
            // Symbolic: glyphs are addressed by CID, not a standard encoding.
            "Flags" => 4,
            "FontBBox" => vec![s(bbox.x_min), s(bbox.y_min), s(bbox.x_max), s(bbox.y_max)],
            "ItalicAngle" => 0,
            "Ascent" => s(self.face.ascender()),
            "Descent" => s(self.face.descender()),
            "CapHeight" => s(self.face.capital_height().unwrap_or(self.face.ascender())),
            "StemV" => 80,
            "FontFile2" => file_id,
        };
        let descriptor_id = doc.add_object(descriptor);

        let cid_font = dictionary! {
            "Type" => "Font",
            "Subtype" => "CIDFontType2",
            "BaseFont" => Object::Name(base_font.clone().into_bytes()),
            "CIDSystemInfo" => dictionary! {
                "Registry" => Object::string_literal("Adobe"),
                "Ordering" => Object::string_literal("Identity"),
                "Supplement" => 0,
            },
            "FontDescriptor" => descriptor_id,
            "DW" => 1000,
            "W" => self.width_array(),
            "CIDToGIDMap" => "Identity",
        };
        let cid_font_id = doc.add_object(cid_font);

        let mut to_unicode = Stream::new(Dictionary::new(), self.to_unicode_cmap().into_bytes());
        to_unicode.compress().map_err(CoreError::from)?;
        let to_unicode_id = doc.add_object(to_unicode);

        let type0 = dictionary! {
            "Type" => "Font",
            "Subtype" => "Type0",
            "BaseFont" => Object::Name(base_font.into_bytes()),
            "Encoding" => "Identity-H",
            "DescendantFonts" => vec![Object::Reference(cid_font_id)],
            "ToUnicode" => to_unicode_id,
        };
        Ok(doc.add_object(type0))
    }

    /// `/W` as `[c [w] c [w] ...]`, grouping consecutive CIDs.
    fn width_array(&self) -> Vec<Object> {
        let mut out = Vec::new();
        let mut run_start: Option<u16> = None;
        let mut run: Vec<Object> = Vec::new();
        let mut prev: Option<u16> = None;
        for (&cid, &w) in &self.widths {
            if prev.is_some_and(|p| p + 1 == cid) {
                run.push(Object::Integer(w.round() as i64));
            } else {
                if let Some(start) = run_start {
                    out.push(Object::Integer(i64::from(start)));
                    out.push(Object::Array(std::mem::take(&mut run)));
                }
                run_start = Some(cid);
                run.push(Object::Integer(w.round() as i64));
            }
            prev = Some(cid);
        }
        if let Some(start) = run_start {
            out.push(Object::Integer(i64::from(start)));
            out.push(Object::Array(run));
        }
        out
    }

    fn to_unicode_cmap(&self) -> String {
        let mut s = String::from(
            "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n\
             /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
             /CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n\
             1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n",
        );
        let entries: Vec<_> = self.unicode.iter().collect();
        for chunk in entries.chunks(100) {
            let _ = writeln!(s, "{} beginbfchar", chunk.len());
            for (cid, text) in chunk {
                let utf16: String = text.encode_utf16().map(|u| format!("{u:04X}")).collect();
                let _ = writeln!(s, "<{cid:04X}> <{utf16}>");
            }
            s.push_str("endbfchar\n");
        }
        s.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
        s
    }

    /// Six uppercase letters derived from the glyph set (ISO 32000-1, 9.6.4).
    fn subset_tag(&self) -> String {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for g in self.remapper.remapped_gids() {
            for b in g.to_be_bytes() {
                h ^= u64::from(b);
                h = h.wrapping_mul(0x0100_0000_01b3);
            }
        }
        (0..6)
            .map(|i| char::from(b'A' + ((h >> (i * 5)) % 26) as u8))
            .collect()
    }
}

/// Encodes bytes as a PDF hex string object for `Tj`.
pub fn hex_string(codes: &[u8]) -> Object {
    Object::String(codes.to_vec(), lopdf::StringFormat::Hexadecimal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_korean_and_reports_missing() {
        let mut b = FontSubsetBuilder::bundled().unwrap();
        let e = b.encode("한글 ABC");
        assert_eq!(e.codes.len(), 6 * 2);
        assert!(e.advance > 0.0);
        assert!(b.missing_chars().is_empty());
        // Phags-pa letter: not in Pretendard.
        b.encode("\u{A840}");
        assert_eq!(
            b.missing_chars().iter().copied().collect::<Vec<_>>(),
            vec!['\u{A840}']
        );
    }

    #[test]
    fn writes_small_subset() {
        let mut b = FontSubsetBuilder::bundled().unwrap();
        b.encode("가나다라마바사아자차카타파하 테스트 문장입니다");
        let mut doc = Document::with_version("1.7");
        let id = b.write(&mut doc).unwrap();
        let font = doc.get_dictionary(id).unwrap();
        assert_eq!(font.get(b"Subtype").unwrap().as_name().unwrap(), b"Type0");
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        assert!(
            bytes.len() < 100_000,
            "subset document is {} bytes",
            bytes.len()
        );
    }
}

/// Characters drawn with one font of a [`FontSet`].
#[derive(Debug, Clone)]
pub struct TextRun {
    /// Index into the set: 0 = Pretendard, 1 = Pretendard JP.
    pub font: usize,
    pub enc: EncodedText,
}

/// The bundled fonts in fallback order (D32): each character is drawn with the first font
/// that has it, the way CSS `font-family` fallback picks glyphs on screen. Characters no
/// font has are drawn blank with the first font and reported.
pub struct FontSet {
    fonts: [FontSubsetBuilder<'static>; 2],
    used: [bool; 2],
}

impl FontSet {
    pub fn bundled() -> Result<FontSet> {
        Ok(FontSet {
            fonts: [
                FontSubsetBuilder::new(BUNDLED_FONT, BUNDLED_FONT_NAME)?,
                FontSubsetBuilder::new(JP_FONT, JP_FONT_NAME)?,
            ],
            used: [false; 2],
        })
    }

    /// Index of the font that draws `c`.
    pub fn font_for(&self, c: char) -> usize {
        if c.is_whitespace() || self.fonts[0].has(c) {
            0
        } else if self.fonts[1].has(c) {
            1
        } else {
            0
        }
    }

    /// Encodes one line as runs of consecutive characters that share a font.
    pub fn encode_line(&mut self, text: &str) -> Vec<TextRun> {
        let mut runs: Vec<(usize, String)> = Vec::new();
        for c in text.chars() {
            let f = self.font_for(c);
            match runs.last_mut() {
                Some((font, s)) if *font == f => s.push(c),
                _ => runs.push((f, c.to_string())),
            }
        }
        runs.into_iter()
            .map(|(font, s)| {
                self.used[font] = true;
                TextRun {
                    font,
                    enc: self.fonts[font].encode(&s),
                }
            })
            .collect()
    }

    /// Ascent (largest) and descent (lowest) over the fonts, in 1/1000 em.
    pub fn metrics(&self) -> crate::export::appearance::TextMetrics {
        let (a, b) = (self.fonts[0].metrics(), self.fonts[1].metrics());
        crate::export::appearance::TextMetrics {
            ascent: a.ascent.max(b.ascent),
            descent: a.descent.min(b.descent),
        }
    }

    pub fn missing_chars(&self) -> BTreeSet<char> {
        self.fonts
            .iter()
            .flat_map(|f| f.missing_chars().iter().copied())
            .collect()
    }

    /// Writes the fonts that some text used; `None` for the others.
    pub fn write(&self, doc: &mut Document) -> Result<[Option<ObjectId>; 2]> {
        let mut ids = [None; 2];
        for (i, f) in self.fonts.iter().enumerate() {
            if self.used[i] {
                ids[i] = Some(f.write(doc)?);
            }
        }
        Ok(ids)
    }
}
