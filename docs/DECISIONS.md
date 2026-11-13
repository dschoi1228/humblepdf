# 결정 기록

각 항목은 결정, 이유, 대안, 재검토 조건을 적는다. 결정을 바꿀 때는 기존 항목을 지우지 말고 "대체됨"으로 표시한 뒤 새 항목을 추가한다.

## 확정

### D1. 비파괴 편집 모델

- 결정: 편집 중에는 PDF를 수정하지 않는다. 페이지 목록과 페이지별 객체로 이뤄진 문서 모델만 바꾸고, 저장할 때 새 PDF를 만든다.
- 이유: 병합, 순서 변경, 삭제, 회전, Undo가 모두 모델 조작으로 단순해지고 원본이 안전하다.

### D2. Tauri 2 + React + TypeScript

- 결정: 앱 셸은 Tauri 2, UI는 React + TypeScript + Vite.
- 이유: 사용자가 UI 완성도를 우선했다. WebView2에서는 한글 입력이 운영체제 기본 방식으로 동작하고, 드래그·캔버스·스타일링 도구가 성숙해 있다.
- 비용: UI 코드는 Rust가 아니라 TypeScript다. PDF를 다루는 로직은 Rust 코어에 둔다.
- 대안: egui(순수 Rust). 2026-11 기준 Windows 한글 IME의 조합 표시에 해결되지 않은 문제가 있어 제외했다.

### D3. 렌더링은 프런트엔드의 PDF.js

- 결정: 페이지 렌더링은 `pdfjs-dist`로 WebView 안에서 한다.
- 이유: 비트맵을 프로세스 사이로 넘길 필요가 없어 줌과 스크롤 구현이 단순하다. 나중에 본문 글자에 붙는 하이라이트를 만들 때 텍스트 레이어를 쓸 수 있다. 네이티브 DLL이 필요 없다.
- 주의: 워커, cMap, 표준 폰트, wasm을 앱에 넣고 경로를 지정해야 한글 PDF와 일부 이미지 형식이 바르게 보인다.
- 대안: 백엔드에서 PDFium으로 렌더링해 이미지를 넘기는 방식.
- 재검토 조건: fixture나 실제 문서에서 PDF.js 렌더링 오류가 반복될 때.

### D4. PDF 쓰기는 lopdf

- 결정: 병합, 주석, 굽기, 폰트 포함을 모두 `lopdf`로 객체 수준에서 직접 쓴다.
- 이유: 주석 사전과 표시 모양, 서브셋 폰트를 직접 구성해야 하는데(D5), 고수준 편집 API로는 제어가 부족하다. 순수 Rust라서 exe 하나로 배포된다.
- 위험: 병합과 PDF 내부 구조를 직접 다뤄야 한다. 손상된 PDF에 대한 내성이 PDF.js보다 낮을 수 있다.
- 대안: 병합 단계에만 `qpdf` 크레이트(QPDF C++ 라이브러리 바인딩, 정적 빌드 가능) 또는 PDFium의 페이지 가져오기를 도입한다.
- 재검토 조건: M0-3의 fixture를 처리하지 못하거나, 실제 문서에서 "읽을 수 없음" 오류가 자주 날 때.

### D5. 저장 방식: 주석으로 남기고 서명은 굽는다

- 결정: 하이라이트, 도형, 텍스트는 표준 PDF 주석으로 저장해 다시 편집할 수 있게 한다. 서명은 저장할 때 페이지에 굽는다. 모든 객체를 굽는 "평탄화하여 내보내기"를 따로 둔다.
- 이유: 널리 쓰이는 프로그램의 관행을 따랐다.
  - Edge와 macOS 미리보기는 마크업을 주석으로 저장하고, 저장 뒤에도 다시 고칠 수 있다.
  - 미리보기와 Acrobat의 Fill & Sign은 서명을 저장 시점에 굽는다. Acrobat은 서명 전에 채운 내용까지 함께 굽는다.
  - 미리보기는 전체 평탄화를 일반 저장과 다른 경로(인쇄 → PDF로 저장)로 제공한다.
  - Firefox는 서명도 주석으로 둔다. 서명이 받는 쪽에서 쉽게 떼어지는 것을 피하려고 이 방식은 따르지 않았다.
- 참고
  - Apple 지원 문서, Annotate a PDF in Preview on Mac: https://support.apple.com/HT201740
  - Apple 커뮤니티, 서명만 저장 시 평탄화: https://discussions.apple.com/thread/255760777
  - Adobe 커뮤니티, Fill & Sign 저장 시 평탄화: https://community.adobe.com/questions-9/cannot-edit-document-after-signing-with-fill-and-sign-feature-1268842
  - Mozilla 지원 문서, Firefox PDF 뷰어: https://support.mozilla.org/en-US/kb/view-pdf-files-firefox-or-choose-another-viewer

### D6. 좌표는 PDF 사용자 공간 그대로

- 결정: 객체 좌표를 페이지의 PDF 사용자 공간으로 저장한다. 화면 변환은 프런트엔드의 한 모듈이 PDF.js 뷰포트로 한다. 코어는 변환하지 않는다.
- 이유: 회전과 CropBox를 따지는 변환 코드가 한 곳에만 있으면 화면과 출력이 어긋날 여지가 줄어든다.

### D7. 모양 XObject 하나로 주석과 굽기를 처리

- 결정: 객체의 모습을 Form XObject 하나로 만들고, 주석이면 표시 모양으로, 굽기면 페이지 콘텐츠에서 그린다.
- 이유: 그리는 코드가 하나라서 주석으로 저장한 결과와 구운 결과가 같다.

### D8. 폰트는 Pretendard Regular(TTF) 한 종

- 결정: Pretendard Regular의 TTF 파일 하나를 넣고 화면 미리보기와 PDF 임베딩에 같이 쓴다. PDF에는 쓰인 글자만 서브셋으로 넣는다. 자동 줄바꿈, 커닝, 합자는 쓰지 않는다.
- 이유: 화면과 출력에서 글자 위치가 같아야 한다. Pretendard는 OFL 1.1이라 앱에 넣어 배포하고 문서에 임베딩할 수 있다. TrueType 윤곽이면 폰트 구성 경로가 하나로 줄어든다.
- 재검토 조건: 폰트를 고를 수 있게 해 달라는 요구가 생길 때.

### D9. 출력은 첫 PDF 소스를 기준 문서로

- 결정: 페이지 목록에서 처음 나오는 PDF 소스의 문서를 기준으로 삼고 그 카탈로그를 유지한다. 다른 소스의 페이지는 객체를 복사해 붙인다.
- 이유: PDF 하나만 고치는 흔한 경우에 북마크, 양식, 메타데이터가 그대로 남는다.
- 한계: 다른 소스의 북마크와 양식 동작은 보존을 보장하지 않는다.

### D10. 원본에 쓰지 않는다

- 결정: 소스와 같은 경로로는 저장하지 않는다. 임시 파일에 쓴 뒤 이름을 바꾼다.
- 이유: 저장이 실패해도 원본과 기존 출력이 남는다. 모델과 소스가 어긋나는 일을 막는다.
- 재검토 조건: 원본에 바로 저장하는 기능을 넣기로 할 때. 그때는 저장 뒤 소스를 다시 읽는 절차가 필요하다.

### D11. 오프라인

- 결정: 네트워크 요청을 하지 않는다. 모든 자산을 앱에 넣는다.
- 이유: 서명과 문서를 다루는 프로그램이다. 사용자가 믿고 쓸 수 있어야 한다.

### D12. 서명과 개인정보

- 결정: 서명은 앱 데이터 폴더에만 둔다. 저장소, 테스트, 로그에 실제 서명과 실제 문서를 넣지 않는다. 출력 PDF에 사용자 이름을 쓰지 않는다.
- 이유: 저장소를 GitHub에 공개할 예정이다.

### D13. 배포 형태

- 결정: 지금은 설치 프로그램 없이 exe 하나로 쓴다. 저장소는 처음부터 공개할 수 있는 상태로 유지한다.
- 이유: Windows 11에는 WebView2가 들어 있어 exe만으로 실행된다. 공개 배포는 나중에 결정한다.
- 후순위: 설치 프로그램, 코드 서명, 자동 업데이트.

### D14. 언어

- 결정: UI와 문서는 한국어, 코드의 식별자와 주석은 영어, 커밋 메시지는 한국어. UI 문자열은 사전 파일 한 곳에 모은다.
- 이유: 나중에 영어 UI를 추가하기 쉽다.

### D15. TypeScript 타입은 ts-rs로 생성 (M0-1)

- 결정: `crates/core`의 serde 구조체에 `ts_rs::TS`를 붙이고 `src/bindings/`에 생성한다. 생성은 `npm run bindings`로 하고, `crates/core/tests/bindings.rs`가 커밋본이 최신인지 검사한다.
- 이유: ts-rs 12는 안정판(MIT)이다. tauri-specta v2는 아직 RC다.
- 대안: tauri-specta(명령 시그니처까지 생성). 안정판이 나오면 다시 본다.

### D16. 한글 폰트 임베딩은 subsetter + ttf-parser로 직접 구성 (M0-4)

- 결정: lopdf의 `font_embedding` 기능은 쓰지 않는다. 폰트는 다음과 같이 구성한다.
  - `subsetter`(기본 기능 끔)로 서브셋을 만들고, 새로 매긴 글리프 번호를 CID로 쓴다(`/CIDToGIDMap /Identity`).
  - Type0 + CIDFontType2 + `/W` + ToUnicode를 core(`font.rs`)에서 직접 쓴다.
  - 글자→글리프 매핑과 전진 폭은 원본 폰트에서 `ttf-parser`로 읽는다.
- 이유: lopdf 0.47의 `font_embedding`은 폰트 전체를 단순 TrueType + WinAnsi로 넣는다. 서브셋, Identity-H, `/W`, ToUnicode를 지원하지 않아 한글을 쓸 수 없다.
- 결과: 한글 20자 텍스트 하나로 늘어나는 크기는 약 4.8KB다(기준 100KB).
- 추가 의존성: `ttf-parser` 0.25.1 (MIT OR Apache-2.0).

### D17. 이미지 XObject는 core가 직접 만든다 (M0-3)

- 결정: lopdf `embed_image`를 쓰지 않는다. 이미지 XObject는 `image` 크레이트(png, jpeg 기능만)로 core에서 직접 만든다.
  - 회색조와 RGB JPEG는 DCTDecode로 그대로 넣는다.
  - CMYK JPEG와 PNG는 8비트 RGB로 풀고 Flate로 압축한다.
  - 알파는 SMask로 넣는다.
  - EXIF 방향은 `cm` 행렬로 반영한다.
- 이유: `embed_image`는 PNG 알파를 버리고, CMYK JPEG의 색 공간을 잘못 표시한다.

### D18. pdf.js 자산과 CSP (M0-2)

- 결정: 빌드할 때 `scripts/copy-pdfjs-assets.mjs`가 pdfjs-dist의 자산을 `public/pdfjs/`로 복사하고, `src/viewer/pdfjs.ts` 한 곳에서 경로를 지정한다.
  - 복사하는 자산: `pdf.worker.min.mjs`, `cmaps/`, `standard_fonts/`, `wasm/`(openjpeg, jbig2, qcms), `iccs/`
  - 넣지 않는 자산: PDF 스크립트용 `quickjs-eval`
- CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost`, 그 밖은 `'self'`·`blob:`·`data:`만 허용
- 이유: pdf.js 6은 CMYK 처리에 ICC 프로필(`iccUrl`)이 필요하다. 모든 자산 URL은 `/`로 끝나야 한다.

### D19. TypeScript 6.0 (M0-1)

- 결정: TypeScript는 6.0.3으로 고정한다.
- 이유: 최신판은 7.0.2(Go 포트)지만, typescript-eslint 8.72가 `<6.1`만 지원한다. Tauri 템플릿도 6.0을 쓴다.
- 재검토 조건: typescript-eslint가 7.x를 지원할 때.

### D20. 테스트 도구 (M0-2, M0-5)

- 단위 테스트: Vitest. Node에서 pdfjs-dist(legacy 빌드)를 돌려 core의 결과와 비교한다.
- E2E와 화면 일치: Playwright. 브라우저는 설치된 Microsoft Edge(`channel: msedge`)를 쓴다.
  - 브라우저를 따로 받을 필요가 없다.
  - WebView2와 같은 Chromium 엔진이다.
- E2E는 브라우저 모드(mock 백엔드)로 돈다. Vite 개발 서버가 `/__fixtures/`, `/__out/`를 제공하며, 이 경로는 개발 서버 전용이다.

### D21. 릴리스 빌드에서 panic은 unwind

- 결정: Tauri 템플릿의 `panic = "abort"`를 쓰지 않는다. 명령 경계에서 `catch_unwind`로 panic을 오류로 바꾼다.
- 이유: SPEC 8장(패닉으로 앱이 죽지 않게 한다). 파서 내부의 panic도 앱을 죽이지 않아야 한다.

## 미정

| 항목 | 기본 제안 | 정할 시점 |
|---|---|---|
| 앱 이름과 식별자 | 가칭 `pdf-editor`, 식별자 `com.pdfeditor.app` | 공개 전. M0는 가칭으로 진행 |
| 라이선스 | MIT | 공개 전 |
| UI 컴포넌트 | Tailwind CSS + shadcn/ui | M1 (M0에는 필요 없어 미룸) |
| 상태 관리 | Zustand | M1 |
| 썸네일 정렬 | dnd-kit | M2 |

확정된 항목: TypeScript 타입 생성(D15), E2E 도구(D20), 패키지 매니저 npm(M0-1).

## 고정한 버전 (2026-11-13, M0)

정확한 버전으로 고정한다(`Cargo.toml`의 `=`, `package.json`의 정확한 버전). crates.io의 `tauri` 최신판은 3.0.0-alpha이므로 2.x를 명시한다.

| Rust | 버전 | 라이선스 |
|---|---|---|
| tauri / tauri-build / tauri-plugin-dialog | 2.12.5 / 2.7.4 / 2.8.4 | MIT OR Apache-2.0 |
| lopdf (기본 기능 끔) | 0.47.0 | MIT |
| subsetter (기본 기능 끔) | 0.2.6 | MIT OR Apache-2.0 |
| ttf-parser | 0.25.1 | MIT OR Apache-2.0 |
| image (png, jpeg) | 0.25.10 | MIT OR Apache-2.0 |
| ts-rs | 12.0.1 | MIT |
| serde / serde_json / thiserror / clap | 1.0.229 / 1.0.154 / 2.0.21 / 4.6.7 | MIT OR Apache-2.0 |

| npm | 버전 | 라이선스 |
|---|---|---|
| @tauri-apps/api, cli / plugin-dialog | 2.12.4 / 2.8.4 | MIT OR Apache-2.0 |
| pdfjs-dist | 6.5.438 | Apache-2.0 (wasm: OpenJPEG BSD-2, PDFium jbig2 BSD-3, qcms MIT) |
| react, react-dom | 19.3.1 | MIT |
| vite / @vitejs/plugin-react | 8.3.8 / 6.3.0 | MIT |
| typescript | 6.0.3 | Apache-2.0 |
| vitest / @playwright/test | 5.1.0 / 1.65.0 | MIT / Apache-2.0 |
| eslint, typescript-eslint | 10.14.0, 8.72.2 | MIT |

| 자산 | 버전 | 라이선스 |
|---|---|---|
| Pretendard Regular (TTF, `public/static/alternative/`) | 1.3.9 | OFL 1.1 (`assets/fonts/OFL.txt`) |

- D4의 대안 qpdf 크레이트는 0.3.7이다(도입하지 않음).
- `npm audit`: 실행 의존성은 0건이다. 개발 의존성에는 eslint → minimatch에서 moderate 10건이 있다.
