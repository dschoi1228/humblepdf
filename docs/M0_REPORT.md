# M0 기술 검증 보고서

2026-11-13 · 범위: SPEC 10장 M0 (M0-1 ~ M0-6)

## 요약

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| M0-1 골격 | 통과 | `cargo test`, `npm run lint`, `npm test`, `build:exe`, exe를 다른 폴더(한글·공백 경로)로 옮겨 실행 |
| M0-2 뷰어 | 통과. 끌어다 놓기만 사람 확인이 남음 | Playwright(E2E), exe 측정 훅 |
| M0-3 병합 | 통과 | `crates/core/tests/merge.rs`(재파싱), `tests/unit/box.test.ts`(pdf.js 비교) |
| M0-4 주석과 굽기 | 자동 검증 통과. 뷰어 세 종 확인은 사람 확인이 남음 | `crates/core/tests/annotations.rs`, `out/m0_sample.pdf` |
| M0-5 화면 일치 | 통과 (최대 오차 1px) | `tests/e2e/screen-match.spec.ts` |
| M0-6 보고 | 이 문서, DECISIONS D15–D21, CLAUDE.md 명령 절 | |

스택을 바꿀 필요는 없었다. 다만 lopdf의 폰트·이미지 기능 플래그는 쓰지 않고, 같은 일을 core에서 직접 구현했다(D16, D17). SPEC이 이미 대안으로 적어 둔 경로다.

**커밋:** 작성자 정보가 정해질 때까지 미뤘다가 M0 항목별로 6개 커밋으로 나눠 넣었다. 커밋은 최종 상태의 파일을 항목별로 나눈 것이다. 그래서 중간 커밋 하나만 꺼내면 빌드되지 않을 수 있다. 예를 들어 M0-1 커밋의 `lib.rs`는 뒤 커밋에서 추가되는 모듈을 참조한다. 마지막 커밋은 모든 검사를 통과한다.

## 환경

- Windows 11 Pro 10.0.26300
- Rust 1.100.0 stable (x86_64-pc-windows-msvc), clippy, rustfmt
- Visual Studio Community 2026 (18.10), C++ 도구
- Windows SDK 10.0.26100: 작업 중 설치했다. 처음에는 없어서 링크할 수 없었다.
- Node.js 24.21.0 LTS, npm 11.19.0
- WebView2 157.0.4341.46, Edge·Chrome 설치됨
- Acrobat Reader: 설치되지 않음. 사람 확인 전에 설치가 필요하다.

## 측정값

| 측정 | 값 | 비고 |
|---|---|---|
| exe 크기 | 12,107,264바이트 (약 11.5MiB) | `target/release/pdf-editor.exe`, 프런트엔드 포함, 설치 프로그램 없음 |
| exe를 다른 폴더로 옮겨 실행 | 성공 | `…\포터블 실행 검사\pdf-editor.exe`. 창 제목 "PDF 에디터", 메모리 약 41MB |
| 50MB PDF 첫 쪽 표시 | 약 0.69초 (691.7 / 693.9 / 687.4ms) | 릴리스 exe, 3회. 소스 열기 → `source_bytes` 원시 바이트 응답 → pdf.js 첫 쪽 렌더링 |
| 한글 20자 텍스트 하나로 늘어나는 파일 크기 | 4,827바이트 | 기준 100KB 이하. 서브셋 폰트, `/W`, ToUnicode 포함 |
| `out/m0_sample.pdf` | 25,313바이트, 2쪽 | |
| 화면 일치 최대 오차 | 1px | 객체 6종 × 5쪽(회전 0/90/180/270, 음수 원점 CropBox). 30건 중 15건이 0px, 15건이 1px |

50MB 측정에서 시간이 가장 많이 든 단계는 바이트 전달(약 0.55초)이었다. 렌더링은 0.13초다. M1에서 큰 파일 체감이 문제가 되면 범위 요청 방식(`PDFDataRangeTransport`)을 검토할 수 있다. 지금은 필요하지 않다.

## 항목별 결과

### M0-1 골격

- **구조:** Cargo 워크스페이스는 `crates/core`, `crates/cli`, `src-tauri`로 구성했다. React 19 + TypeScript 6.0 + Vite 8 프런트엔드를 붙였다.
- **모델 타입:** 원본은 core의 serde 구조체다. ts-rs로 `src/bindings/`를 생성하고, `tests/bindings.rs`가 최신 여부를 검사한다(D15).
- **백엔드 호출:** `src/backend/`의 `Backend` 인터페이스 뒤에 Tauri 구현과 mock 구현을 둔다.
- **UI 문자열:** `src/strings/ko.ts` 한 곳에 모은다.
- **포터블 exe:** `npm run build:exe`(`tauri build --no-bundle`, `bundle.active=false`)로 만든다.
  - exe는 루트 `target/release/`에 나온다. 워크스페이스 구조 때문이다.
  - 실행 확인은 PowerShell로 했다: 프로세스가 살아 있고 창 제목이 맞다.

### M0-2 뷰어

- **한글 PDF 2종:** 폰트를 포함한 PDF와 포함하지 않은 PDF(Adobe-Korea1 + `UniKS-UCS2-H`)를 Edge에서 PDF.js로 렌더링했다. 결과는 `tests/e2e/viewer.spec.ts`가 확인한다.
  - 페이지에 글자 픽셀이 그려진다.
  - 텍스트를 추출하면 원문과 같다.
  - 콘솔 경고와 오류가 없다.
  - 실패한 요청(4xx/5xx)이 없다.
  - **`localhost` 밖으로 나간 요청이 0건**이다.
  - 화면 캡처: `out/m0/korean_*.png`
- **배포 빌드:** CSP를 켠 상태(D18)에서 워커·wasm·cMap이 로드되고, 50MB 파일의 첫 쪽이 렌더링되었다(측정 훅 결과 `ok: true`).
- **끌어다 놓기:** `getCurrentWebview().onDragDropEvent`로 경로를 받아 화면에 표시하도록 구현했다. 자동화하지 못해 **사람 확인으로 남겼다**(아래 점검표).

### M0-3 병합

- **재파싱 테스트:** `crates/core/tests/merge.rs`의 8개 테스트가 통과했다.
  - PDF 2개 + JPG + PNG + EXIF 회전 JPG를 병합한다. 쪽수, 순서, 상자, 회전을 확인한다.
  - JPEG는 원본 바이트 그대로 DCTDecode로 들어간다.
  - PNG의 알파는 SMask가 된다.
  - `/Producer`만 쓰고 `/Author`는 쓰지 않는다.
  - 원본 파일의 해시가 바뀌지 않는다.
- **페이지 구조 fixture 6종:** 회전, CropBox, 크기 혼합, 상속 속성, Resources 공유, 콘텐츠 배열을 모두 처리한다. 한글 PDF 2종도 처리한다.
- **순서 변경·삭제·사용자 회전:**
  - 상속 속성이 각 페이지에 그대로 써진다.
  - 삭제한 페이지 객체는 출력에서 제거된다.
- **암호 PDF(AES-256, RC4 128):**
  - 비밀번호가 없으면 `password_required`, 틀리면 `wrong_password`로 구분해 알린다.
  - 맞는 비밀번호로 열면 암호 없는 출력이 나온다.
- **경로 검사:** 소스와 같은 경로로 저장하면 거부한다. 대소문자만 다르거나 한글 경로여도 거부한다. 임시 파일에 쓴 뒤 이름을 바꾼다.
- **상자 비교:** core가 계산한 상자와 회전은 PDF.js `page.view`, `page.rotate`와 일치한다. fixture 10종과, 이를 모두 병합하고 사용자 회전을 섞어 내보낸 출력에서 확인했다(`tests/unit/box.test.ts`).

### M0-4 주석과 굽기

- **표준 주석:** `crates/core/tests/annotations.rs`의 7개 테스트가 통과했다.
  - 하이라이트, 텍스트, 사각형, 타원, 화살표가 각각 `/Highlight`, `/FreeText`, `/Square`, `/Circle`, `/Line`(`/LE [/None /ClosedArrow]`)로 저장된다.
  - 공통 키를 확인한다: `/AP /N`(Form, BBox = `/Rect`, 항등 Matrix), `/F 4`, `/NM`, `/M`. `/T`는 쓰지 않는다.
  - 전용 키 `/PdfEditorObject`의 JSON을 되읽으면 원래 객체와 같다.
- **하이라이트:**
  - QuadPoints는 Acrobat 순서(왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래)다.
  - ExtGState `/BM /Multiply`를 쓴다.
  - 투명 그룹(`/Group`)은 없다.
- **텍스트:**
  - 내보낸 텍스트는 한 서브셋 폰트를 공유한다(Type0, Identity-H, CIDFontType2, `/W`, FontFile2).
  - ToUnicode가 입력한 모든 글자를 되돌려 준다.
  - FreeText `/Contents`는 줄바꿈을 포함한 원문이다.
- **서명:**
  - 주석이 아니라 페이지에 구워진다.
  - 원래 콘텐츠는 `q` … `Q`로 감싸고, 그 뒤에 `/PdfEdX0 Do`가 온다.
  - 같은 서명을 세 번 배치해도 이미지(RGB + SMask)는 한 번만 들어간다.
- **공유 Resources:** 다른 페이지와 공유하던 Resources는 복사한 뒤 고친다. 공유하는 다른 페이지는 바뀌지 않는다.
- **평탄화 내보내기:** 이 앱의 주석이 남지 않는다.
- **빠진 글자 경고:** 폰트에 없는 글자를 `missing_glyphs` 경고로 돌려준다.
- **샘플:** `npm run sample`로 `out/m0_sample.pdf`를 만든다. PDF.js 렌더링은 `out/m0/m0_sample_p*_pdfjs.png`에 있다.
- **사람 확인:** Acrobat Reader·Edge·Chrome에서 같은 모습으로 보이는지, 주석으로 인식되는지, 글자 복사가 되는지는 **확인 전**이다.

### M0-5 화면 일치

- **방법:** `tests/e2e/screen-match.spec.ts`는 객체 종류마다 모델을 만들어 CLI로 내보낸 뒤 Edge에서 세 가지를 렌더링한다.
  - (가) 원본 페이지만
  - (나) 원본 페이지 + 모델을 그린 SVG 오버레이
  - (다) 내보낸 PDF

  (나)와 (다)를 각각 (가)와 비교해 객체 경계 상자를 구한다. 배율은 100%, DPR은 1이다.
- **결과:** 30건 모두 각 변 오차 1px 이하(`out/m0/match/results.json`, 캡처 `out/m0/match/*.png`)
- **좌표 모듈:** `src/coords`의 변환은 PDF.js 뷰포트와 같다. 회전 4종 × 상자 3종(A4, CropBox, 음수 원점) × 배율 2종을 비교했다(Vitest 24건).
- **모양 수치:** 화살촉, 줄 간격, 타원 상수는 `crates/core/src/shape_spec.rs`와 `src/shapes/spec.ts`에 같은 값으로 두고, `tests/shape_spec.rs`가 둘이 같은지 검사한다.

## 틀린 가정과 바뀐 점

1. **lopdf `font_embedding`은 한글을 처리하지 못한다.** 폰트 전체를 단순 TrueType + WinAnsi로 넣고, 서브셋·Identity-H·`/W`·ToUnicode를 만들지 않는다. SPEC 7.6의 대안 경로로 구현했고, `ttf-parser` 의존성을 추가했다(D16).
2. **lopdf `embed_image`는 알파를 버린다.** CMYK JPEG의 색 공간도 잘못 표시한다. 이미지 XObject는 core가 직접 만든다(D17).
3. **lopdf에는 병합 API가 없다.** 상속 속성 실체화, 객체 번호 재지정, 페이지 트리 재구성을 core에서 구현했다(D4의 위험이 실제였으나 처리 가능했다).
4. **lopdf는 실수를 f32로 읽는다.** 그대로 쓰면 `595.276`이 `595.2760009765625`가 되어 PDF.js 값과 어긋난다. 가장 짧은 십진 표현을 거쳐 f64로 읽도록 했다(`pdf_util::as_number`).
5. **RC4 암호화 fixture를 만들려면 trailer `/ID`가 필요하다**(lopdf `MissingFileID`).
6. **pdf.js 6의 자산이 바뀌었다.**
   - `iccs/`(ICC 프로필)가 더 필요하다.
   - 모든 자산 URL은 `/`로 끝나야 한다.
   - `isEvalSupported`와 `*Factory` 옵션이 없어졌다.
   - `PageViewport`는 더 이상 export되지 않는다. 좌표 테스트는 실제 페이지의 `getViewport()`와 비교한다.
   - `getViewport({rotation})`의 rotation은 `/Rotate`에 더해지는 값이 아니라 절대값이다.
7. **TypeScript 최신판(7.0)은 쓸 수 없다.** typescript-eslint가 6.1 미만만 지원한다. 6.0.3으로 고정했다(D19).
8. **crates.io의 `tauri` 최신판은 3.0.0-alpha다.** 버전을 지정하지 않고 추가하면 안 되므로 2.12.5로 고정했다.
9. **exe 위치가 다르다.** 워크스페이스 구조라 `src-tauri/target/`이 아니라 루트 `target/release/`에 나온다.
10. **Tauri 템플릿의 `panic = "abort"`는 SPEC 8장과 맞지 않는다.** unwind로 두고 명령 경계에서 `catch_unwind`한다(D21).
11. **React StrictMode가 effect를 두 번 실행한다.** 그래서 같은 캔버스에 PDF.js 렌더링이 겹쳐 실패했다. 이전 렌더링 작업을 취소하도록 `renderPage`를 고쳤다. M1 뷰어에서도 필요한 처리다.
12. **확인된 가정:** SPEC 6.3의 드래그 충돌이 맞다. Tauri의 `dragDropEnabled`(기본값)는 Windows에서 HTML5 드래그를 막는다는 것이 공식 문서에 있다. 썸네일 정렬은 계획대로 포인터 이벤트로 구현한다.

## 남은 위험과 다음 마일스톤 참고

- **오버레이와 PDF의 모양 차이:** 경계 위치는 일치하지만 아래 차이가 있다. M3에서 오버레이를 만들 때 맞춘다.
  - 불투명도: SVG는 그룹 단위로, PDF는 그리기 연산 단위(`/CA`, `/ca`)로 적용한다. 선과 채움이 겹친 곳의 색이 조금 다를 수 있다.
  - 하이라이트의 곱하기 블렌드: 화면에서는 페이지 캔버스 위에 CSS `mix-blend-mode`를 써야 한다. M0 측정은 캔버스 합성으로 했다.
- **아직 만들지 않은 fixture:** SPEC 9장 중 M0 통과 기준에 없는 것은 만들지 않았다. 다음 마일스톤에서 추가한다.
  - CMYK JPEG, 16비트·팔레트 PNG, 8000px 이미지: CMYK 변환 코드는 있으나 테스트하지 않았다.
  - 링크·주석·양식 위젯이 있는 페이지: 원본 주석 유지는 M2·M6에서 확인한다.
  - 300쪽 문서: M1
- **FreeText `/DA`:** `/Helv`로 적었다. 다른 프로그램이 이 주석을 편집하면 모양을 다시 만들면서 번들 폰트가 아닌 글꼴로 바뀔 수 있다. 사람 확인 결과를 보고 M5에서 정한다.
- **50MB 파일:** 전체 바이트를 한 번에 넘긴다. 메모리와 시간이 문제가 되면 범위 요청을 검토한다(위 측정값 참고).

## 스택 변경 제안

없음. lopdf + subsetter + ttf-parser + image 조합으로 M0 기준을 모두 자동 검증했다. D4의 대안(qpdf, PDFium)은 도입할 필요가 없었다.

## 사람 확인 점검표

Acrobat Reader가 없으면 먼저 설치한다. 아래 명령을 터미널에서 실행한다.

```
winget install Adobe.Acrobat.Reader.64-bit
```

`npm run sample`로 만든 `out/m0_sample.pdf`를 Acrobat Reader, Edge, Chrome에서 열어 다음을 본다. 1쪽은 한글 본문 위에 객체를 놓은 페이지이고, 2쪽은 90° 회전 페이지다.

1. 한글 텍스트, 하이라이트, 사각형, 타원, 화살표, 서명이 세 뷰어에서 같은 위치와 모습으로 보이는가. 참고 이미지: `out/m0/m0_sample_p1_pdfjs.png`, `out/m0/m0_sample_p2_pdfjs.png`
2. 노란 하이라이트 아래 "다람쥐 헌 쳇바퀴에 타고파"가 읽히는가.
3. 추가한 텍스트("추가한 텍스트: 서명 확인을 마쳤습니다")를 선택해 복사하면 원문이 나오는가.
4. Acrobat Reader와 Edge에서 하이라이트, 도형, 텍스트가 주석으로 선택되는가. 서명은 선택되지 않는가.
5. 2쪽의 텍스트와 서명이 화면에서 똑바로 보이는가.

`npm run tauri dev`로 연 창에 PDF 파일을 끌어다 놓으면 "끌어다 놓은 파일 경로"에 경로가 나타나고 첫 쪽이 표시되는가.
