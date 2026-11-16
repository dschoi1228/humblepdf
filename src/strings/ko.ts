// All UI strings live here (CLAUDE.md, D14).
export const ko = {
  appTitle: "PDF 에디터",
  fileFilterName: "PDF와 이미지",

  toolbar: {
    addFiles: "파일 추가",
    zoomIn: "확대",
    zoomOut: "축소",
    zoomLevel: "배율",
    fitWidth: "너비 맞춤",
    fitPage: "쪽 맞춤",
    toggleThumbnails: "썸네일 패널",
    newDocument: "새 문서",
    pageNumber: "쪽 번호",
    pageOf: (total: number) => `/ ${total}`,
  },

  empty: {
    title: "PDF나 이미지를 추가하세요",
    hint: "파일을 창에 끌어다 놓거나 아래 단추를 누르세요. PDF, JPG, PNG를 지원합니다.",
  },

  thumbnails: {
    label: "페이지 썸네일",
    page: (n: number) => `${n}쪽`,
    dragging: (n: number) => `${n}쪽 옮기는 중`,
  },

  pages: {
    rotateLeft: "왼쪽으로 회전",
    rotateRight: "오른쪽으로 회전",
    delete: "페이지 삭제",
    imageFit: "이미지 맞춤",
    fitA4: "A4에 맞춤",
    fitImage: "이미지 크기",
  },

  password: {
    title: "비밀번호가 필요합니다",
    description: (name: string) => `"${name}" 파일은 암호가 걸려 있습니다. 비밀번호를 입력하세요.`,
    wrong: "비밀번호가 맞지 않습니다. 다시 입력하세요.",
    placeholder: "비밀번호",
    ok: "열기",
    cancel: "이 파일 건너뛰기",
  },

  history: {
    undo: "실행 취소",
    redo: "다시 실행",
  },

  save: {
    save: "저장",
    saveAs: "다른 이름으로 저장",
    title: "저장할 파일 이름",
    defaultSuffix: "_편집",
    saving: "저장 중…",
    savingDetail: "PDF를 만들고 있습니다. 잠시 기다려 주세요.",
    saved: (name: string) => `"${name}"에 저장했습니다.`,
    savedDetail: (pages: number, bytes: string) => `${pages}쪽, ${bytes}`,
    notEncrypted: "원본에 걸려 있던 암호는 저장한 파일에 걸리지 않습니다.",
    failed: "저장하지 못했습니다.",
    outputIsSource: "열려 있는 원본 파일에는 저장할 수 없습니다. 다른 이름을 고르세요.",
    missingGlyphs: (chars: string) => `번들 폰트에 없는 글자가 있어 빈칸으로 저장했습니다: ${chars}`,
  },

  unsaved: {
    title: "저장하지 않은 변경이 있습니다",
    newDocument: "새 문서를 시작하기 전에 지금 문서를 저장할까요?",
    close: "창을 닫기 전에 지금 문서를 저장할까요?",
    save: "저장",
    discard: "저장 안 함",
    cancel: "취소",
  },

  addFailed: (name: string) => `"${name}" 파일을 추가하지 못했습니다.`,
  pageFailed: "이 페이지를 표시하지 못했습니다.",

  errors: {
    password_required: "암호가 걸린 PDF입니다. 비밀번호가 필요합니다.",
    wrong_password: "비밀번호가 맞지 않습니다. 다시 입력하세요.",
    unknown_format: "지원하지 않는 파일 형식입니다. PDF, JPG, PNG 파일을 추가하세요.",
    unreadable_pdf: "PDF를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.",
    unsupported: "이 앱이 지원하지 않는 기능이 들어 있는 파일입니다.",
    invalid_image: "이미지를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.",
    io: "파일을 읽거나 쓸 수 없습니다. 파일이 있는지, 다른 프로그램이 쓰고 있지 않은지, 폴더에 쓸 권한이 있는지 확인하세요.",
    output_is_source: "열려 있는 원본 파일에는 저장할 수 없습니다. 다른 이름을 고르세요.",
    invalid_model: "문서 상태가 올바르지 않아 저장하지 못했습니다.",
    generic: "작업을 완료하지 못했습니다.",
  } as Record<string, string>,
} as const;

export type Strings = typeof ko;

export function errorMessage(code: string): string {
  return ko.errors[code] ?? ko.errors.generic;
}
