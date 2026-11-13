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
  },

  password: {
    title: "비밀번호가 필요합니다",
    description: (name: string) => `"${name}" 파일은 암호가 걸려 있습니다. 비밀번호를 입력하세요.`,
    wrong: "비밀번호가 맞지 않습니다. 다시 입력하세요.",
    placeholder: "비밀번호",
    ok: "열기",
    cancel: "이 파일 건너뛰기",
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
    io: "파일을 읽을 수 없습니다. 파일이 있는지, 다른 프로그램이 쓰고 있지 않은지 확인하세요.",
    generic: "작업을 완료하지 못했습니다.",
  } as Record<string, string>,
} as const;

export type Strings = typeof ko;

export function errorMessage(code: string): string {
  return ko.errors[code] ?? ko.errors.generic;
}
