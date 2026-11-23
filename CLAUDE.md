# PDF 에디터 (가칭 `pdf-editor`)

Windows 11용 오프라인 PDF 편집기다. 여러 PDF와 이미지의 병합, 페이지 정리, 서명 이미지 배치, 텍스트·하이라이트·도형 추가를 지원한다.

- 기능과 수용 기준: `docs/SPEC.md`
- 결정 사항과 이유: `docs/DECISIONS.md`

작업을 시작하기 전에 두 문서에서 해당 마일스톤과 관련 절을 읽는다.

## 스택

| 영역 | 선택 |
|---|---|
| 앱 셸 | Tauri 2 (Windows 11, WebView2) |
| UI | React + TypeScript + Vite |
| 페이지 렌더링 | PDF.js (`pdfjs-dist`), 프런트엔드에서 실행 |
| 코어 | Rust. PDF 읽기·쓰기 `lopdf`, 폰트 서브셋 `subsetter`, 이미지 `image` |
| 번들 폰트 | Pretendard Regular (TTF, OFL 1.1) |

버전은 작업 시점의 최신 안정판을 직접 확인해 고정한다. 이 스택의 라이브러리는 API가 자주 바뀐다. 기억에 의존하지 말고 현재 문서를 확인한 뒤 코드를 쓴다.

## 구조

```
crates/core/    순수 Rust 라이브러리. 문서 모델, 소스 검사, 내보내기. Tauri·UI 의존 금지
crates/cli/     core를 명령줄로 실행. 헤드리스 검증용
src-tauri/      Tauri 명령. core 호출, 파일 I/O, 서명 보관함
src/            프런트엔드. 뷰어, 오버레이, 상태, UI
assets/fonts/   번들 폰트. 프런트엔드와 core가 같은 파일을 쓴다
tests/fixtures/ 합성 테스트 파일
docs/           SPEC, DECISIONS, 마일스톤 보고서
out/            사람이 열어볼 샘플 출력 (git 제외)
```

## 명령

처음 한 번 `npm install`을 한 뒤 쓴다. 저장소 루트에서 실행한다. PowerShell 실행 정책이 `npm.ps1`을 막는 PC에서는 `npm` 대신 `npm.cmd`를 쓴다.

```
npm run tauri dev            앱 실행 (개발 빌드)
npm run dev                  브라우저 모드(백엔드 mock)로 프런트엔드만 실행. http://localhost:1420
                             ?open=/__fixtures/a.pdf,/__fixtures/b.pdf 로 fixture를 연다(개발 서버 전용 경로).
                             &signatures=/__fixtures/signatures/sig-demo.png 로 메모리 서명 보관함에 합성 서명을 넣는다.
                             브라우저 모드의 이미지는 core가 계산한 레이아웃(out/e2e/info/)이 있어야 열린다.
                             npm run e2e를 한 번 돌리면 생긴다. 저장은 out/ 아래에만 하며 디버그 CLI가 필요하다(같은 명령이 빌드)
npm run build:exe            포터블 exe 빌드 → target/release/pdf-editor.exe (설치 프로그램 없음)
cargo test --workspace       코어·CLI 테스트 (출력 PDF 재파싱 테스트 포함)
npm test                     프런트엔드 단위 테스트 (Vitest. 좌표 변환, core 상자 vs pdf.js)
npm run e2e                  E2E·화면 일치 테스트 (Playwright, 설치된 Edge 사용). 준비 단계가 CLI를 빌드해 쓴다
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
npm run lint                 ESLint + tsc 타입 검사

npm run fixtures             합성 fixture 재생성 (tests/fixtures/, 50MB 파일은 tests/fixtures/large/)
npm run bindings             Rust 모델 → src/bindings/*.ts 재생성
npm run sample               out/m0_sample.pdf, out/m2_sample.pdf, out/m3_sample.pdf, out/m4_sample.pdf 생성 (사람 확인용, 확인 목록 출력)
cargo run -p pdf-editor-cli -- inspect <파일> [--password <pw>]
cargo run -p pdf-editor-cli -- model <파일...>          모든 쪽을 담은 모델 JSON 출력
cargo run -p pdf-editor-cli -- export --model <json> --out <pdf> [--signatures <폴더>] [--password <소스ID>=<pw>] [--flatten]
```

- 측정용 훅: 환경 변수 `PDF_EDITOR_BENCH=<pdf 경로>`로 exe를 실행하면 첫 쪽 표시 시간을 `PDF_EDITOR_BENCH_OUT` 파일(없으면 stdout)에 쓰고 종료한다.
- 암호 fixture의 비밀번호는 `fixture-pass`다(합성 파일 전용).

개발 환경은 Windows 11이다. 자동화는 npm 스크립트나 Rust로 작성하고 bash 전용 문법에 의존하지 않는다.

## 반드시 지킬 규칙

1. **비파괴 편집.** 편집 중에는 어떤 PDF 파일도 수정하지 않는다. 문서 모델(페이지 목록과 페이지별 객체)만 바꾸고, 저장할 때 새 파일을 만든다. 원본 경로에는 쓰지 않는다.
2. **경계.** PDF 바이트를 만들거나 고치는 코드는 `crates/core`에만 둔다. 프런트엔드는 렌더링과 편집 UI만 맡는다. `src-tauri`의 명령은 얇게 유지한다.
3. **모델의 원본은 Rust.** 문서 모델 타입은 core의 serde 구조체가 원본이고 TypeScript 타입은 거기서 생성한다. 손으로 따로 정의하지 않는다.
4. **좌표.** 객체 좌표는 그 페이지의 PDF 사용자 공간(pt, y축 위 방향) 그대로 저장한다. 화면 좌표 변환은 프런트엔드의 좌표 모듈 한 곳에서만 한다. core는 좌표를 변환하지 않는다. (SPEC 5장)
5. **화면과 출력의 일치.** 오버레이에 보이는 모습과 저장한 PDF를 렌더링한 모습이 같아야 한다. 객체 모양을 정하는 수치(화살촉, 줄 간격 등)는 SPEC의 값을 양쪽에서 똑같이 쓴다.
6. **저장 방식.** 하이라이트·도형·텍스트는 표준 PDF 주석으로 저장하고, 서명은 페이지 콘텐츠로 굽는다. (SPEC 7장)
7. **오프라인.** 네트워크 요청을 하지 않는다. 폰트와 PDF.js의 워커·cMap·표준 폰트·wasm을 모두 앱에 넣는다. CDN 주소를 쓰지 않는다.
8. **개인정보.** 실제 서명, 실제 문서, 사용자 이름을 저장소·테스트·로그에 넣지 않는다. 테스트 파일은 합성해서 만든다. 출력 PDF에 사용자 계정 이름을 기록하지 않는다.
9. **라이선스.** 의존성은 MIT, Apache-2.0, BSD, OFL처럼 허용적인 것만 쓴다. GPL·AGPL 계열(MuPDF 등)은 쓰지 않는다. 의존성을 추가할 때는 이유와 라이선스를 DECISIONS에 적는다.
10. **범위.** SPEC의 비목표와 후순위 항목은 요청 없이 구현하지 않는다. 필요해 보이면 제안만 한다.

## 작업 방식

- 한 번에 한 마일스톤만 진행한다. 시작할 때 계획을 제시하고 승인을 받은 뒤 구현한다.
- 스택, 구조, 저장 방식을 바꿔야 할 것 같으면 바꾸기 전에 이유와 대안을 적어 묻는다.
- 결정이 생기거나 바뀌면 `docs/DECISIONS.md`를 같은 커밋에서 갱신한다.
- 수용 기준은 테스트로 확인한다. 통과하지 못한 항목은 통과한 것처럼 처리하지 말고 실패 내용과 원인 추정을 보고한다.
- 사람이 확인해야 하는 항목(다른 뷰어에서 열어 보기)은 `out/`에 샘플을 만들고 확인할 목록을 알려 준다.
- 작은 단위로 커밋한다. 커밋 메시지는 영어(미국식), 코드의 식별자와 주석은 영어로 쓴다. UI 문자열은 `src/i18n/`의 사전(ko, en, ja)에만 두고, 새 문자열은 세 언어 모두에 추가한다. 키의 원본은 `ko.ts`다.

## 완료 기준

- 해당 마일스톤의 수용 기준을 모두 확인했다.
- `cargo fmt`, `cargo clippy`, `cargo test`, 프런트엔드 lint와 테스트가 통과한다.
- 새 동작에 테스트가 있다. core의 내보내기 기능에는 출력 PDF를 다시 파싱해 검증하는 테스트가 있다.
- 문서(SPEC, DECISIONS, 이 파일의 명령 절)가 실제와 일치한다.
