// Japanese UI strings. Keys must match ko.ts. Needs a review by a native speaker before
// release (M2.5 report).
import type { Strings } from "./types";

export const ja: Strings = {
  appTitle: "PDF エディター",
  fileFilterName: "PDF と画像",

  toolbar: {
    addFiles: "ファイルを追加",
    zoomIn: "拡大",
    zoomOut: "縮小",
    zoomLevel: "倍率",
    fitWidth: "幅に合わせる",
    fitPage: "ページに合わせる",
    toggleThumbnails: "サムネイルパネル",
    newDocument: "新規ドキュメント",
    pageNumber: "ページ番号",
    pageOf: (total: number) => `/ ${total}`,
    language: "言語",
  },

  empty: {
    title: "PDF または画像を追加してください",
    hint: "ファイルをウィンドウにドラッグ＆ドロップするか、下のボタンを押してください。PDF、JPG、PNG に対応しています。",
  },

  thumbnails: {
    label: "ページのサムネイル",
    page: (n: number) => `${n} ページ`,
    dragging: (n: number) => `${n} ページを移動中`,
  },

  pages: {
    rotateLeft: "左に回転",
    rotateRight: "右に回転",
    delete: "ページを削除",
    imageFit: "画像の配置",
    fitA4: "A4 に合わせる",
    fitImage: "画像のサイズ",
  },

  password: {
    title: "パスワードが必要です",
    description: (name: string) => `「${name}」はパスワードで保護されています。パスワードを入力してください。`,
    wrong: "パスワードが違います。もう一度入力してください。",
    placeholder: "パスワード",
    ok: "開く",
    cancel: "このファイルをスキップ",
  },

  history: {
    undo: "元に戻す",
    redo: "やり直し",
  },

  save: {
    save: "保存",
    saveAs: "名前を付けて保存",
    title: "保存するファイル名",
    defaultSuffix: "_編集",
    saving: "保存中…",
    savingDetail: "PDF を作成しています。しばらくお待ちください。",
    saved: (name: string) => `「${name}」に保存しました。`,
    savedDetail: (pages: number, bytes: string) => `${pages} ページ、${bytes}`,
    notEncrypted: "元のファイルにかかっていたパスワードは、保存したファイルにはかかりません。",
    failed: "保存できませんでした。",
    outputIsSource: "開いている元のファイルには保存できません。別の名前を選んでください。",
    missingGlyphs: (chars: string) => `同梱フォントにない文字があるため、空白として保存しました: ${chars}`,
  },

  unsaved: {
    title: "保存されていない変更があります",
    newDocument: "新しいドキュメントを始める前に、現在のドキュメントを保存しますか？",
    close: "ウィンドウを閉じる前に、現在のドキュメントを保存しますか？",
    save: "保存",
    discard: "保存しない",
    cancel: "キャンセル",
  },

  addFailed: (name: string) => `「${name}」を追加できませんでした。`,
  pageFailed: "このページを表示できませんでした。",

  errors: {
    password_required: "パスワードで保護された PDF です。パスワードが必要です。",
    wrong_password: "パスワードが違います。もう一度入力してください。",
    unknown_format: "対応していないファイル形式です。PDF、JPG、PNG ファイルを追加してください。",
    unreadable_pdf: "PDF を読み込めません。ファイルが破損している可能性があります。",
    unsupported: "このアプリが対応していない機能を含むファイルです。",
    invalid_image: "画像を読み込めません。ファイルが破損している可能性があります。",
    io: "ファイルを読み書きできません。ファイルが存在するか、他のプログラムが使用していないか、フォルダーへの書き込み権限があるかを確認してください。",
    output_is_source: "開いている元のファイルには保存できません。別の名前を選んでください。",
    invalid_model: "ドキュメントの状態が正しくないため、保存できませんでした。",
    generic: "操作を完了できませんでした。",
  },
};
