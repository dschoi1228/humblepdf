//! Baking appearance XObjects into page content (SPEC 7.5).
//!
//! The existing content is wrapped in `q` ... `Q` so graphics state left behind by the
//! original cannot move the baked objects, then a stream drawing the XObjects follows.
//! Resources are copied onto the page before being changed (shared dictionaries stay
//! untouched) and new names use the app prefix.

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

use crate::error::Result;
use crate::export::appearance::RES_PREFIX;
use crate::pdf_util::resolve;

fn resolved_dict(doc: &Document, obj: Option<&Object>) -> Dictionary {
    obj.and_then(|o| resolve(doc, o))
        .and_then(|o| o.as_dict().ok())
        .cloned()
        .unwrap_or_default()
}

/// Draws `xobjects` (in order) on top of the page content.
pub fn bake(doc: &mut Document, page_id: ObjectId, xobjects: &[ObjectId]) -> Result<()> {
    if xobjects.is_empty() {
        return Ok(());
    }

    // Copy the page's resources (and its /XObject sub-dictionary) before changing them.
    let page = doc.get_dictionary(page_id)?;
    let mut resources = resolved_dict(doc, page.get(b"Resources").ok());
    let mut xo = resolved_dict(doc, resources.get(b"XObject").ok());

    let mut draw = String::new();
    let mut counter = 0usize;
    for id in xobjects {
        let name = loop {
            let candidate = format!("{RES_PREFIX}X{counter}");
            counter += 1;
            if !xo.has(candidate.as_bytes()) {
                break candidate;
            }
        };
        xo.set(name.as_bytes(), Object::Reference(*id));
        draw.push_str(&format!("q /{name} Do Q\n"));
    }
    resources.set("XObject", xo);

    // Existing content stream references, in order.
    let contents: Vec<Object> = match page.get(b"Contents") {
        Ok(Object::Reference(r)) => match doc.get_object(*r) {
            Ok(Object::Array(a)) => a.clone(),
            _ => vec![Object::Reference(*r)],
        },
        Ok(Object::Array(a)) => a.clone(),
        _ => Vec::new(),
    };

    let open = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
    let close = doc.add_object(Stream::new(
        Dictionary::new(),
        format!("Q\n{draw}").into_bytes(),
    ));
    let mut new_contents = Vec::with_capacity(contents.len() + 2);
    new_contents.push(Object::Reference(open));
    new_contents.extend(contents);
    new_contents.push(Object::Reference(close));

    let page = doc.get_dictionary_mut(page_id)?;
    page.set("Resources", resources);
    page.set("Contents", new_contents);
    Ok(())
}
