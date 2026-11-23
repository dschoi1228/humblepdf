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

  editor: {
    label: "編集ツール",
    tools: {
      select: "選択",
      highlight: "ハイライト",
      rect: "四角形",
      ellipse: "楕円",
      line: "直線",
      arrow: "矢印",
      text: "テキスト",
      signature: "署名",
    },
    color: "色",
    stroke: "線の色",
    fill: "塗りつぶし",
    none: "なし",
    strokeWidth: "線の太さ",
    fontSize: "文字サイズ",
    opacity: "不透明度",
    deleteObject: "オブジェクトを削除",
    hint: "オブジェクトをクリックすると選択できます。ツールを選んでページ上でドラッグすると作成できます。",
    colors: {
      black: "黒",
      red: "赤",
      orange: "オレンジ",
      yellow: "黄",
      green: "緑",
      blue: "青",
      purple: "紫",
      white: "白",
      pink: "ピンク",
      sky: "水色",
    },
  },

  signatures: {
    title: "署名ライブラリ",
    description: "PNG または JPG の署名画像を登録しておき、ページに配置します。署名はこのコンピューターのアプリデータフォルダーにのみ保存されます。",
    manage: "署名の管理",
    add: "署名を追加",
    empty: "登録された署名はありません。「署名を追加」を押して画像を選んでください。",
    pick: "配置する署名",
    placeHint: "ページをクリックすると、選んだ署名が配置されます。",
    name: "名前",
    rename: "名前を変更",
    delete: "削除",
    confirmDelete: (name: string) => `署名「${name}」をライブラリから削除しますか？`,
    inUse: (pages: string) => `ドキュメントに配置されている署名は削除できません。先に ${pages} ページからこの署名を削除してください。`,
    added: (name: string) => `署名「${name}」を追加しました。`,
    failed: "署名を処理できませんでした。",
    fileFilterName: "署名画像",
    save: "保存",
    cancel: "キャンセル",
    close: "閉じる",
    missing: "署名画像がありません",
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
    signature_missing: "署名画像が見つかりません。ライブラリから削除した署名がドキュメントに残っている場合は、それを削除してから保存してください。",
    unknown_signature: "ライブラリにない署名です。",
    invalid_name: "名前は 1～100 文字で入力してください。",
    generic: "操作を完了できませんでした。",
  },
};
