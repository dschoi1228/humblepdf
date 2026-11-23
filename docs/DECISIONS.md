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

- 결정: UI는 한국어·영어·일본어(D27). 문서(SPEC, DECISIONS, 보고서)는 한국어, README는 영어. 코드의 식별자와 주석은 영어, 커밋 메시지는 영어(미국식). UI 문자열은 `src/i18n/`의 언어별 사전에만 둔다.
- 이유: 나중에 영어 UI를 추가하기 쉽다. 저장소를 공개할 예정이라 커밋 기록은 영어로 둔다.
- 변경(M2 이후): 커밋 메시지를 한국어에서 영어로 바꿨다. 이전 커밋의 메시지도 영어로 다시 썼다(기록 재작성, 강제 푸시).

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

### D22. UI: Tailwind CSS + shadcn/ui (M1)

- 결정: 스타일은 Tailwind CSS 4(`@tailwindcss/vite`)로 한다. 부품은 shadcn/ui(Radix 기반) 중 필요한 것만 `src/components/ui/`에 복사해 쓴다: button, dialog, input, tooltip, scroll-area, separator, sonner, context-menu(M2, 이미 들어 있는 `radix-ui` 사용). 아이콘은 lucide-react, 알림은 sonner를 쓴다.
- 이유: 사용자가 UI 완성도를 우선했다(D2). 대화상자의 포커스와 키보드 처리 같은 접근성을 직접 구현하지 않아도 된다.
- 설정:
  - shadcn이 생성하는 `cn`은 shadcn 팀의 `cn` 패키지(MIT)다. `clsx`와 `tailwind-merge`를 대신하므로 둘은 넣지 않는다.
  - sonner 래퍼가 쓰는 `next-themes`는 빼고 밝은 테마로 고정했다. 다크 모드는 SPEC 6.2의 후순위다.
  - `shadcn` 패키지는 CSS(`shadcn/tailwind.css`)를 빌드할 때만 필요하므로 개발 의존성으로 둔다.
- 오프라인: 웹폰트를 쓰지 않는다. shadcn CLI는 부품을 추가할 때만 네트워크를 쓰고, 앱은 실행 중에 요청하지 않는다(E2E로 확인).

### D23. 상태 관리: Zustand (M1)

- 결정: 문서 모델과 소스 메타데이터(`documentStore`), 화면 상태(`viewStore`), 비밀번호 요청(`passwordPrompt`)을 Zustand 저장소로 둔다. 모델을 바꾸는 코드는 순수 함수(`src/state/model.ts`)로 두고 저장소가 호출한다.
- 이유: 구독 범위를 좁힐 수 있어 300쪽 문서에서도 다시 그리기를 줄인다. M2의 Undo는 순수 함수 위에 이력을 얹어 구현한다.
- 비밀번호는 `documentStore`의 소스 메타데이터에만 둔다. 메모리에만 있고 모델에는 넣지 않는다(SPEC 4).

### D24. 썸네일 끌어 옮기기는 직접 구현 (M2)

- 결정: 썸네일 정렬은 라이브러리 없이 포인터 이벤트로 구현한다(`src/viewer/thumbDrag.ts`, `ThumbnailPanel.tsx`).
  - 4px 넘게 움직이면 끌기를 시작한다.
  - 놓을 위치는 썸네일 레이아웃에서 계산한다. 포인터 아래, 가운데를 넘지 않은 첫 쪽의 앞이다.
  - 패널 가장자리 48px 안에서는 자동으로 스크롤한다. Esc를 누르면 취소한다.
  - HTML5 드래그 API는 쓰지 않는다(SPEC 6.3).
- 이유: 사용자 선택.
  - dnd-kit 안정판(`@dnd-kit/core` 6.3.1)은 2024-12 이후 갱신이 없다.
  - 새 API(`@dnd-kit/react`)는 0.5로 1.0 전이다.
  - dnd-kit의 정렬은 모든 항목이 DOM에 있다고 가정해, 보이는 썸네일만 그리는 가상 목록(300쪽)과 맞지 않는다.
- 비용: 키보드로 옮기는 기능은 없다. 키보드로는 회전, 삭제, 실행 취소만 할 수 있다.

### D25. Undo는 문서 스냅샷 이력 (M2)

- 결정: 모델을 바꾸는 순수 함수(`src/state/model.ts`)의 결과를 스냅샷으로 쌓는다(`src/state/history.ts`, 100칸).
  - 이력에 넣는 것: 파일 추가, 순서 변경, 삭제, 회전, 이미지 맞춤
  - 이력에 넣지 않는 것: 선택, 줌, 현재 쪽
  - 바뀐 것이 없는 동작은 기록하지 않는다.
  - "저장하지 않은 변경"은 현재 모델이 마지막으로 저장한 모델과 같은 객체인지로 판정한다. 그래서 저장한 상태로 Undo나 Redo를 해서 돌아오면 다시 "변경 없음"이 된다.
- 이유: 바뀌지 않은 페이지 객체를 스냅샷끼리 공유하므로 300쪽에서도 비용이 작다. 명령마다 되돌리는 코드를 따로 쓸 필요가 없다. M3 이후의 객체 편집도 같은 방식으로 얹는다.

### D26. 브라우저 모드 저장은 개발 서버의 `/__export` (M2)

- 결정: mock 백엔드의 저장은 개발 서버 경로 `/__export`에 모델을 보낸다. 서버는 디버그 CLI의 `export`를 실행한다.
  - 경로 변환: 소스 경로 `/__fixtures/…`, `/__out/…`를 실제 파일로 바꾼다.
  - 출력 위치: `/__out/` 아래만 허용한다. 예외로 소스 경로와 같은 출력은 그대로 넘겨 core가 거부하게 한다.
  - 저장 대화상자는 `window.prompt`로 대신한다.
- 이유: E2E에서도 실제 core로 저장 흐름 전체(경로 선택, 원본 거부, 진행 표시, 결과 검사)를 확인한다.
- 범위: `/__fixtures/`처럼 개발 서버 전용(`apply: "serve"`)이며 빌드에 들어가지 않는다. CLI가 빌드되어 있어야 한다(`npm run e2e`가 빌드한다).

### D27. 다국어 UI는 직접 만든 사전과 언어 저장소 (M2.5)

- 결정
  - 사전: `src/i18n/ko.ts`, `en.ts`, `ja.ts`. 한국어 사전이 키의 원본이고, 다른 사전은 그 모양(`Strings` 타입)을 그대로 채운다. 키가 빠지거나 남으면 타입 검사와 단위 테스트가 실패한다.
  - 숫자에 따라 말이 바뀌는 문구는 사전의 함수로 둔다(예: 영어 단수·복수).
  - 현재 언어는 Zustand 저장소 하나에 둔다. 컴포넌트는 `useStrings()`, 컴포넌트 밖 코드는 `strings()`를 쓴다.
  - 처음 언어: 저장해 둔 선택 → `navigator.languages`(WebView2는 Windows 표시 언어를 따른다)에서 처음 맞는 언어 → 영어.
  - 선택은 WebView의 `localStorage`에 둔다. 앱 데이터 폴더에 남으며 사용자 정보는 담지 않는다.
  - 창 제목은 Tauri `setTitle`로 바꾼다(권한 `core:window:allow-set-title`). `tauri.conf.json`의 기본 제목은 `PDF Editor`다.
- 이유: 문자열이 60여 개이고 이미 한 곳에 모여 있어 i18next 같은 의존성이 주는 이점이 작다. 직접 만들면 키 검사를 타입으로 할 수 있다.
- 범위 밖: 오른쪽에서 왼쪽으로 쓰는 언어, 날짜·숫자 형식 지역화(지금은 쓰는 곳이 없다). 일본어 번역은 공개 전에 원어민 검토가 필요하다.

### D28. 편집 오버레이: 객체마다 SVG 하나, 기하는 사용자 공간에서 (M3)

- 결정
  - 페이지마다 객체 하나당 `<svg>` 하나를 캔버스 위에 겹친다. 안쪽은 M0-5에서 검증한 `objectSvg`(`src/overlay/svg.ts`)로 그리고, 변환은 좌표 모듈의 페이지 변환을 그대로 쓴다. 화면의 그리는 코드는 이것 하나다.
  - 하이라이트 SVG에는 `mix-blend-mode: multiply`를 SVG 요소 자체에 건다. 그래야 아래 캔버스의 글자와 곱해진다. 객체마다 SVG를 따로 두어 앞뒤 순서도 지킨다.
  - 맞힘 판정, 이동, 크기 조절, 페이지 안에 가두기, 새 객체 만들기는 사용자 공간(pt)의 순수 함수다(`src/editor/geometry.ts`). 화면 픽셀과의 변환은 좌표 모듈만 한다(`deltaToUser`, `screenAxes`, `rectToScreen`을 더했다).
  - 끄는 동안의 임시 모양은 오버레이 컴포넌트 상태에만 두고, 놓을 때 `apply` 한 번으로 모델에 넣는다. 끌기 한 번, 방향키 한 번, 속성 변경 한 번이 각각 Undo 한 칸이다.
  - 현재 도구, 선택한 객체, 도구별 최근 속성은 편집 저장소(`src/editor/editorStore.ts`)에 두고 이력에 넣지 않는다. 객체가 사라지면(Undo, 페이지 삭제, 새 문서) 선택을 푼다.
  - 객체 편집으로 페이지 객체가 바뀌어도 PDF 캔버스는 다시 렌더링하지 않는다. 렌더링은 소스 페이지, 회전·맞춤, 배율이 바뀔 때만 한다.
  - core는 객체 값을 검증한다. 문서 안에서 겹치는 ID, 유한하지 않은 좌표, 범위 밖의 불투명도·색·선 두께(0.5~12pt), quad 없는 하이라이트, 뒤집힌 사각형, 선과 채움이 둘 다 없는 도형은 `InvalidModel`이다. 선 두께 범위는 모양 수치(`shape_spec`)에 두어 프런트엔드와 같은지 테스트한다.
- 이유: 화면과 출력의 일치(CLAUDE.md 규칙 5)를 검증된 렌더러 하나로 지킨다. 기하를 순수 함수로 두면 회전 4종을 단위 테스트로 확인할 수 있다.
- 검증: 실제 편집 화면의 오버레이와 저장한 PDF의 차이를 회전 0/90/180/270과 음수 원점 상자에서 1px 이하로 확인한다(`editor-screen-match.spec.ts`). 페이지 크기가 정수 픽셀이 아니면 캔버스가 소수점 이하로 늘어나 테두리가 흐려지므로, 오버레이는 캔버스를 숨기고 찍어 비교한다.

### D29. 도구와 편집 막대 (M3)

- 결정
  - 툴바 아래 둘째 줄에 편집 막대를 둔다. 왼쪽은 도구, 오른쪽은 속성이다. 속성은 선택한 객체가 있으면 그 객체의 값, 없으면 현재 그리기 도구의 값을 보여 준다. (사용자 선택)
  - 하이라이트 도구는 객체를 만든 뒤에도 남는다. 사각형·타원·직선·화살표는 만든 뒤 선택 도구로 돌아가고, 만든 객체가 선택된다. (사용자 선택)
  - 색: 하이라이트 4색(노랑, 초록, 분홍, 하늘), 도형과 선은 8색 팔레트(검정, 빨강, 주황, 노랑, 초록, 파랑, 보라, 흰색). 채움에는 "없음"이 있다.
  - 두께 0.5·1·2·3·4·6·8·12pt, 불투명도 10~100%(10% 단위). 기본값은 빨강 2pt, 채움 없음, 불투명도 100%(하이라이트 40%).
  - 최근 속성은 도구별로 세션 동안만 기억한다. 다시 켜도 남기는 것은 M7에서 한다.
  - 단축키 V, H, R, O, L, A는 수식키 없이 누를 때만 동작한다. 입력 칸과 대화상자에서는 막힌다.
- 이유: 기존 툴바가 1280px 폭에서 거의 찼다. 옆 패널보다 본문 폭을 덜 줄인다. 하이라이트는 여러 곳을 이어서 칠하는 일이 많다.

### D30. 서명 보관함 (M4)

- 결정
  - 위치: `%APPDATA%\com.pdfeditor.app\signatures\`(Tauri `app_data_dir` 아래). 서명마다 `<id>.png`, 목록은 `index.json`(id, 이름, 픽셀 크기, 등록 시각).
  - id는 무작위 영숫자(`sg-` + 16자리 16진수)다. 파일 이름이 되므로 core와 같은 문자만 허용한다. 이름은 1~100자다.
  - 쓰기는 모두 임시 파일 뒤 이름 바꾸기(core `write_atomic`)다.
  - 등록할 때 core의 `signature::normalize`가 PNG·JPG를 읽어 EXIF 방향을 반영하고, 긴 변을 2000px 이하로 줄여(Lanczos3) RGBA PNG로 만든다. 고른 원본 파일은 읽기만 한다.
  - 목록 관리 코드는 `src-tauri/src/signatures.rs`의 폴더를 인자로 받는 함수이고, Tauri 명령은 별도 스레드에서 이 함수를 부른다. 저장할 때 `export_document`가 이 폴더를 core의 `signature_dir`로 넘긴다.
  - 서명 이름과 경로는 로그에 남기지 않는다(D12).
  - 브라우저 모드는 메모리 보관함을 쓴다(`?signatures=`로 미리 넣는다). 저장할 때 쓰인 서명 PNG를 `/__export`에 함께 보내고, 개발 서버가 임시 폴더에 써서 CLI `--signatures`로 넘긴다(D26 확장).
  - 서명 파일이 없으면 core가 `signature_missing` 오류를 낸다.
- 이유: 서명은 개인정보라 앱 데이터 폴더에만 둔다. 정규화를 core에 두면 `cargo test`로 검증된다. 보관함은 src-tauri의 몫이라는 CLAUDE.md 구조를 따른다.

### D31. 서명 배치와 삭제 규칙 (M4)

- 결정
  - 서명 도구(S)를 고르면 편집 막대에 보관함 서명의 미리보기가 나온다. 페이지를 클릭하면 화면에 보이는 페이지 폭의 25%로, 클릭한 점을 중심으로, 페이지의 표시 회전 값을 `rotation`으로 놓는다(화면에서 똑바로). 너무 크면 비율을 유지한 채 줄여 페이지 안에 넣는다.
  - 서명 도구에서는 고른 서명의 미리보기가 마우스 포인터를 따라다닌다. 클릭하면 놓일 크기와 위치 그대로이고 반투명(60%)이다.
  - 놓은 뒤에도 서명 도구가 남는다(하이라이트와 같다). 클릭할 때마다 하나씩 놓이고, Esc나 V로 선택 도구로 돌아간다.
  - 변경(M4 사람 확인): 처음에는 놓은 뒤 선택 도구로 돌아가게 했다. 여러 번 서명할 때마다 도구를 다시 골라야 해 불편하다는 의견에 따라 바꾸고 미리보기를 더했다.
  - 크기 조절은 모서리 핸들 4개뿐이다. 비율을 유지하고 마주 보는 모서리를 고정한다. 최소 4pt다.
  - 지금 문서에 배치된 서명은 보관함에서 지울 수 없고, 그 쪽 번호를 알린다. 실행 취소 기록에만 남은 서명은 지울 수 있다. 그 배치를 되살려 저장하면 `signature_missing`을 알리고, 화면에는 그 자리에 빨간 점선 상자가 보인다.
  - 보관함이 비어 있으면 서명 도구를 고를 때 보관함 대화상자를 연다.
- 이유: 배치된 서명을 지우면 저장이 깨진다. 실행 취소 기록까지 막으면 지울 수 없는 이유를 알기 어렵다.

### D32. 일본어 폰트: Pretendard JP의 자주 쓰는 글자 서브셋 (M5)

- 결정
  - 일본어 글자는 Pretendard JP Regular(OFL 1.1)에서 가져온다. 원본은 `assets/fonts/source/PretendardJP-Regular.ttf`(5,462,268바이트)이고, 앱에 넣는 것은 서브셋 `assets/fonts/PretendardJP-Common.ttf`(2,012,212바이트)다.
  - 남기는 글자: JIS X 0208 전체(가나, 기호, 제1·제2수준 한자 6,355자), 반각 가타카나, 전각 영숫자. 요청 7,002자 중 6,831자가 들어 있다. 빠진 것은 원본에 없는 수학·괘선 기호와 반각 가타카나다. (사용자 선택: 제1+제2수준. 제1수준만은 0.88MB이지만 2010년 추가 상용한자 약 70자가 빠진다.)
  - 서브셋은 `npm run fonts`(fontTools, 개발 때만)로 만든다. 힌팅과 레이아웃 기능(GSUB/GPOS 규칙)은 넣지 않는다. 화면에 필요한 `cmap`을 남기기 위해 core의 `subsetter` 대신 fontTools를 쓴다.
  - 글자마다 Pretendard에 있으면 Pretendard, 없으면 Pretendard JP, 둘 다 없으면 빈칸이고 저장할 때 알린다. Pretendard에도 가나가 있어 가나는 Pretendard로, 한자는 Pretendard JP로 그려진다. 두 폰트는 같은 계열이라 섞여도 어울리고 세로 수치(어센트 1949, 디센트 494 / 2048)가 같다.
  - core는 쓰인 폰트만 각각 서브셋으로 넣는다(`FontSet`). 화면은 `font-family: PdfEditorText, PdfEditorTextJP`의 글자별 대체로 같은 결과를 낸다.
- 이유: 일본어 사용자도 텍스트를 쓸 수 있어야 한다. 한자 전체(약 1.4만 자 이상)를 넣으면 exe가 많이 커진다. 화면 디자인과 같은 계열 폰트다.
- 대안: Noto Sans JP(OFL)도 가능하지만 Pretendard와 모양이 다르고, Google Fonts 배포는 가변 폰트다.

### D33. 텍스트 편집 방식 (M5)

- 결정
  - 텍스트 도구(T)로 클릭하면 그 자리에 `textarea`가 뜬다. 번들 폰트, 같은 크기, 줄 간격 1.3, 같은 회전, 커닝·합자 끔으로 그려 확정 전후의 모습이 같다. 클릭한 점이 첫 줄의 위쪽이다.
  - Enter 줄바꿈, Ctrl+Enter나 바깥 클릭 확정, Esc 취소. 조합 중(`isComposing`)의 키는 입력기에 맡긴다.
  - 확정 한 번이 Undo 한 칸이다. 빈 글자는 만들지 않고, 다시 편집에서 모두 지우면 객체를 지운다. 확정하면 선택 도구로 돌아가고 그 텍스트가 선택된다.
  - 다시 편집은 선택 도구에서 더블클릭이다. 편집하는 동안 원래 객체는 숨긴다.
  - 크기 조절 핸들은 없다. 선택 상자는 가장 긴 줄의 폭(캔버스 측정)과 폰트의 어센트·디센트로 그린다.
  - 속성은 글자 크기(6~72pt)와 색(8색)이고 도구별로 기억한다(D29).
- 이유: 브라우저 입력 상자가 한글·일본어 조합을 가장 정확하게 처리한다. 직접 그리는 편집기는 IME 처리를 다시 만들어야 한다.

## 미정

| 항목 | 기본 제안 | 정할 시점 |
|---|---|---|
| 앱 이름과 식별자 | 가칭 `pdf-editor`, 식별자 `com.pdfeditor.app` | 공개 전. M0는 가칭으로 진행 |
| 라이선스 | MIT | 공개 전 |

확정된 항목: TypeScript 타입 생성(D15), E2E 도구(D20), 패키지 매니저 npm(M0-1), UI(D22), 상태 관리(D23), 썸네일 정렬(D24), 다국어 UI(D27), 편집 오버레이(D28), 도구와 편집 막대(D29), 서명 보관함(D30), 서명 배치(D31), 일본어 폰트(D32), 텍스트 편집(D33).
## 고정한 버전 (2026-11-13, M0·M1)

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
| zustand (M1) | 5.1.0 | MIT |
| tailwindcss, @tailwindcss/vite (M1) | 4.3.5 | MIT |
| radix-ui / cn / class-variance-authority (M1) | 1.8.1 / 0.5.2 / 0.7.1 | MIT / MIT / Apache-2.0 |
| lucide-react / sonner / tw-animate-css (M1) | 1.72.0 / 2.0.8 / 1.4.0 | ISC / MIT / MIT |
| shadcn (개발 의존성, M1) | 4.23.0 | MIT |

| 자산 | 버전 | 라이선스 |
|---|---|---|
| Pretendard Regular (TTF, `public/static/alternative/`) | 1.3.9 | OFL 1.1 (`assets/fonts/OFL.txt`) |
| Pretendard JP Regular (TTF, `packages/pretendard-jp/dist/public/static/alternative/`, M5) | 1.3.9 (main 브랜치, 2026-11-23 내려받음) | OFL 1.1 (`assets/fonts/OFL-PretendardJP.txt`) |
| fontTools (개발 때만, `npm run fonts`, M5) | 4.68.0 | MIT |

- D4의 대안 qpdf 크레이트는 0.3.7이다(도입하지 않음).
- `npm audit`: 실행 의존성은 0건이다. 개발 의존성에는 eslint → minimatch에서 moderate 10건이 있다.
