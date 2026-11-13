// All UI strings live here (CLAUDE.md, D14).
export const ko = {
  appTitle: "PDF 에디터",
  m0Banner: "M0 기술 검증 화면",
  openFile: "파일 열기",
  dropHint: "PDF나 이미지 파일을 창에 끌어다 놓으세요.",
  droppedPaths: "끌어다 놓은 파일 경로",
  noFile: "열린 파일이 없습니다.",
  pageOf: (page: number, total: number) => `${page} / ${total}쪽`,
  firstPageTime: (ms: number) => `첫 쪽 표시까지 ${ms.toFixed(0)}ms`,
  fileFilterName: "PDF와 이미지",
  errors: {
    password_required: "암호가 걸린 PDF입니다. 비밀번호가 필요합니다.",
    wrong_password: "비밀번호가 맞지 않습니다. 다시 입력하세요.",
    unknown_format: "지원하지 않는 파일 형식입니다. PDF, JPG, PNG 파일을 추가하세요.",
    unreadable_pdf: "PDF를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.",
    unsupported: "이 앱이 지원하지 않는 PDF 기능이 있습니다.",
    invalid_image: "이미지를 읽을 수 없습니다.",
    generic: "작업을 완료하지 못했습니다.",
  } as Record<string, string>,
} as const;

export type Strings = typeof ko;
