# 명세 대조표

SPEC 4장 P1 기능 11개와 7장 보안 요구사항 10개를 **어디서 구현했고, 어떤 테스트로 확인했는지** 정리했습니다.
테스트는 모두 `npm test` 로 실행됩니다 (가짜 nmcli 사용). 화면은 `node dev/ui-check.mjs`(맥, 헤드리스 Chrome)로도 확인했습니다.

## 1. 기능 (SPEC 4장 P1)

| ID | 기능 | 실행하는 nmcli | 구현 | 테스트 |
| --- | --- | --- | --- | --- |
| F-01 | 프로파일 목록 | `-t -f NAME,UUID,TYPE,DEVICE,ACTIVE connection show` | `routes/api.js` `GET /connections`, `lib/profile.js` `parseList` / 화면 `public/app.js` `renderList` | `test/api-read.test.js` |
| F-02 | 프로파일 상세 | `-t -f connection,ipv4,ipv6,802-3-ethernet connection show uuid <UUID>` | `routes/api.js` `GET /connections/:uuid`·`readDetail`, `lib/profile.js` `parseDetail` / `renderDetail` | `test/api-read.test.js` |
| F-03 | 생성 | `connection add type ethernet con-name … [ifname …] <속성> <값> …` | `routes/api.js` `POST /connections`, `lib/schema.js` `createSchema`·`toNmcliArgs` / `renderForm`, `public/formlogic.js` `toCreateBody` | `test/schema.test.js`, `test/api-change.test.js`, `test/formlogic.test.js` |
| F-04 | 편집 (바뀐 칸만) | `connection modify uuid <UUID> <속성> <값> …` | `routes/api.js` `PATCH /connections/:uuid`, `lib/schema.js` `patchSchema`·`toModifyArgs`·`patchProblems` / `public/formlogic.js` `toPatch` | `test/schema.test.js`, `test/api-change.test.js`, `test/formlogic.test.js` |
| F-05 | 적용 (켜기) | `-w 30 connection up uuid <UUID> [ifname <장치>]` (execFile 35초) | `routes/api.js` `POST …/up`·`runUp` / `doUp` | `test/api-change.test.js` (시간 초과 코드 3 포함) |
| F-06 | 해제 (끄기) | `connection down uuid <UUID>` | `routes/api.js` `POST …/down` / `doDown` | `test/api-change.test.js` |
| F-07 | 삭제 | `connection delete uuid <UUID>` | `routes/api.js` `DELETE /connections/:uuid` / `doDelete` (이름 다시 입력, 사용 중 경고) | `test/api-change.test.js`, `dev/ui-check.mjs` |
| F-08 | 복제 | `connection clone uuid <UUID> <새이름>` | `routes/api.js` `POST …/clone` (기본 `<이름>-copy`) / `doClone` | `test/api-change.test.js` |
| F-09 | 장치 목록 | `-t -f DEVICE,TYPE,STATE,CONNECTION device status` | `routes/api.js` `GET /devices`, `lib/profile.js` `parseDevices` / 폼의 "연결할 장치" | `test/api-read.test.js` |
| F-10 | 상태 표시 | `-t -f STATE,CONNECTIVITY general status` | `routes/api.js` `GET /status` / `refreshStatus` | `test/api-read.test.js` (NetworkManager 꺼짐 8·1 포함) |
| F-11 | 실행 기록 | (앱 내부) | `lib/log.js`, `routes/api.js` `GET /logs` / 화면 아래 실행 기록 패널 | `test/log.test.js` |

## 2. 보안 (SPEC 7장)

| ID | 요구사항 | 구현 | 테스트 |
| --- | --- | --- | --- |
| S-01 | `127.0.0.1` 에만 연결 대기 | `server.js` `const HOST = '127.0.0.1'` (설정으로 못 바꿈) | `test/server.test.js` S-01 (실제 주소 + 코드 검사) |
| S-02 | Host 헤더 검사 → 403 | `server.js` ② Host 검사 (실제 접속 포트와 함께 비교) | `test/server.test.js` S-02 (Host 없음 포함) |
| S-03 | 변경 요청 Origin 검사, CORS 없음 | `server.js` ④ Origin 검사 (Origin 없어도 거부) | `test/server.test.js` S-03 |
| S-04 | 무작위 접속 토큰 → HttpOnly·SameSite=Strict 쿠키 | `server.js` ③ 토큰 검사, `startServer` (`crypto.randomBytes(32)`) | `test/server.test.js` S-04 |
| S-05 | 셸 없이 인자 배열로 실행 | `lib/nmcli.js` `runNmcli` → `execFile(NMCLI_BIN, args)` 한 곳뿐 | `test/nmcli.test.js` (`my:lan; echo HACK` 글자 그대로) |
| S-06 | 허용 목록 (정해진 명령·속성만) | `lib/schema.js` 모르는 키 400 + `PROPS` 표 / `lib/nmcli.js` `checkArgs` (`ALLOWED_COMMANDS`, `ALLOWED_PROPS`) — 이중 잠금 | `test/schema.test.js`, `test/nmcli.test.js` 허용 목록 |
| S-07 | UUID 형식, `-` 로 시작하는 이름·값 거부 | `lib/nmcli.js` `UUID_RE`·`checkArgs`, `public/rules.js` `isValidName` | `test/schema.test.js`, `test/api-read.test.js` |
| S-08 | 비밀값 미노출 | `-s` 를 쓰지 않음(`checkArgs` 가 거부), `lib/log.js` `maskArgs` (`***`) | `test/nmcli.test.js`, `test/log.test.js` |
| S-09 | 모든 변경 작업 기록 | `lib/log.js` (파일 `nm-web.log` + 메모리) | `test/log.test.js` |
| S-10 | 화면 파일 앱 안에 포함, CDN 없음 | `public/` 정적 제공, `Content-Security-Policy: default-src 'self'` | `test/static.test.js` |

## 3. CLAUDE.md 의 나머지 규칙

| 규칙 | 구현 |
| --- | --- |
| 모든 nmcli 실행에 `LC_ALL=C` | `lib/nmcli.js` `runNmcli` 의 `env` |
| 한 번에 하나만 실행 (대기열) | `lib/nmcli.js` `enqueue` — `test/nmcli.test.js` 대기열 |
| up `-w 30` + 35초, 나머지 15초 | `lib/nmcli.js` `UP_WAIT_SECONDS`·`UP_TIMEOUT_MS`·`DEFAULT_TIMEOUT_MS` |
| 모든 명령은 `uuid <UUID>` 로 지정 | `checkArgs` 가 강제 — `test/api-change.test.js` 가 실제 실행된 명령을 모두 검사 |
| 조회에는 정식 이름만 (`gw4` 같은 별칭 금지) | `lib/profile.js` `DETAIL_FIELDS`, modify 도 정식 이름만 (`toModifyArgs`) |
| 종료 코드 + 오류 문구를 함께 판단 | `lib/hints.js` `hintFor` (문구 규칙 먼저, 그다음 코드) |
| 보안 응답 헤더 | `server.js` ① (CSP, nosniff, X-Frame-Options DENY, Referrer-Policy same-origin) |
| root 로 실행하지 않음 | `deploy/nm-web.service` `User=nmweb` + `deploy/50-nmweb.rules` — `test/deploy.test.js` |

## 4. 명세를 보충한 결정

애매했던 부분은 `docs/DECISIONS.md` 에 사용자 확인을 받아 정리했습니다 (요청 JSON 키 이름, HTTP 상태 코드, 유선이 아닌 프로파일은 보기 전용 등).
