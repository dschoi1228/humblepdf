// English (US) UI strings. Keys must match ko.ts.
import type { Strings } from "./types";

export const en: Strings = {
  appTitle: "PDF Editor",
  fileFilterName: "PDFs and images",

  toolbar: {
    addFiles: "Add files",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomLevel: "Zoom level",
    fitWidth: "Fit width",
    fitPage: "Fit page",
    toggleThumbnails: "Thumbnail panel",
    newDocument: "New document",
    pageNumber: "Page number",
    pageOf: (total: number) => `/ ${total}`,
    language: "Language",
  },

  empty: {
    title: "Add a PDF or an image",
    hint: "Drag files onto the window or click the button below. PDF, JPG and PNG are supported.",
  },

  thumbnails: {
    label: "Page thumbnails",
    page: (n: number) => `Page ${n}`,
    dragging: (n: number) => (n === 1 ? "Moving 1 page" : `Moving ${n} pages`),
  },

  pages: {
    rotateLeft: "Rotate left",
    rotateRight: "Rotate right",
    delete: "Delete pages",
    imageFit: "Image fit",
    fitA4: "Fit to A4",
    fitImage: "Image size",
  },

  password: {
    title: "Password required",
    description: (name: string) => `"${name}" is password protected. Enter the password.`,
    wrong: "Incorrect password. Try again.",
    placeholder: "Password",
    ok: "Open",
    cancel: "Skip this file",
  },

  history: {
    undo: "Undo",
    redo: "Redo",
  },

  save: {
    save: "Save",
    saveAs: "Save as",
    title: "File name to save",
    defaultSuffix: "_edited",
    saving: "Saving…",
    savingDetail: "Creating the PDF. Please wait.",
    saved: (name: string) => `Saved to "${name}".`,
    savedDetail: (pages: number, bytes: string) => `${pages} ${pages === 1 ? "page" : "pages"}, ${bytes}`,
    notEncrypted: "The saved file is not password protected, even though a source file was.",
    failed: "Could not save.",
    outputIsSource: "You can't save over an open source file. Choose another name.",
    missingGlyphs: (chars: string) => `Some characters are not in the bundled font and were saved as blanks: ${chars}`,
  },

  unsaved: {
    title: "You have unsaved changes",
    newDocument: "Save the current document before starting a new one?",
    close: "Save the current document before closing the window?",
    save: "Save",
    discard: "Don't save",
    cancel: "Cancel",
  },

  addFailed: (name: string) => `Could not add "${name}".`,
  pageFailed: "Could not display this page.",

  errors: {
    password_required: "This PDF is password protected. A password is required.",
    wrong_password: "Incorrect password. Try again.",
    unknown_format: "Unsupported file type. Add PDF, JPG or PNG files.",
    unreadable_pdf: "Could not read the PDF. The file may be damaged.",
    unsupported: "This file uses a feature the app does not support.",
    invalid_image: "Could not read the image. The file may be damaged.",
    io: "Could not read or write the file. Check that the file exists, that no other program is using it, and that you can write to the folder.",
    output_is_source: "You can't save over an open source file. Choose another name.",
    invalid_model: "Could not save because the document state is invalid.",
    generic: "The operation could not be completed.",
  },
};
