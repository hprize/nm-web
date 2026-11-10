# nm-web — nmcli 연결 프로파일 관리 웹앱

수업 과제용 프로젝트입니다. 브라우저 화면에서 NetworkManager의 **유선(ethernet) 연결 프로파일**을
만들고, 보고, 고치고, 켜고(up), 끄고(down), 복제하고, 지우는 앱입니다.
서버는 같은 컴퓨터(127.0.0.1)에서만 접속할 수 있고, 뒤에서 `nmcli` 를 대신 실행합니다.

## 기준 문서

- `docs/SPEC.md` — 기능 명세서. **모든 기능·API·보안 규칙의 기준.** 명세와 다르게 만들고 싶으면 먼저 사용자에게 물어볼 것.
- `docs/TASKS.md` — 작업 순서와 단계별 완료 기준. 이 순서대로 한 단계씩 진행.

## 환경

| 항목 | 내용 |
| --- | --- |
| 개발 | macOS (Claude Code). **맥에는 nmcli가 없음** → 가짜 nmcli(`dev/fake-nmcli`)로 개발 |
| 최종 테스트 | Windows의 VMware 가상머신, Rocky Linux 9.8. 테스트 전용 2번 네트워크 카드(Host-only)로만 실험 |
| 코드 이동 | git (맥 `git push` → Rocky `git pull` → `npm ci`) |
| 런타임 | Node.js 24 LTS, ES 모듈(`"type": "module"`) |
| 서버 | Express 5 |
| 입력 검사 | zod 4 |
| nmcli 실행 | `node:child_process` 의 `execFile` (셸 사용 금지) |
| 화면 | HTML + CSS + 순수 JavaScript (빌드 도구·프레임워크·외부 CDN 없음) |
| 테스트 | `node:test` (내장) |
| 권한 | root로 실행하지 않음. 전용 사용자 `nmweb` + polkit 규칙(SPEC 7.1) |

외부 라이브러리는 Express와 zod만 씁니다. **다른 패키지를 추가하려면 먼저 사용자에게 이유와 함께 물어볼 것.**

## 명령어 (TASKS 0단계에서 만들 것)

- `npm run dev` — 맥 개발용. `NMCLI_BIN=dev/fake-nmcli` 로 가짜 nmcli 사용
- `npm start` — 진짜 nmcli 사용 (Rocky)
- `npm test` — 전체 테스트 (`node --test`)

## 꼭 지킬 보안 규칙 (SPEC 7장)

1. 서버는 `127.0.0.1` 에만 연결 대기. `0.0.0.0` 이나 다른 주소로 바꿀 수 있는 설정을 만들지 않는다. (S-01)
2. `Host` 헤더가 `127.0.0.1:<포트>` 또는 `localhost:<포트>` 가 아니면 403. (S-02)
3. POST/PATCH/DELETE는 `Origin` 이 앱 자신일 때만 허용. CORS 허용 헤더를 보내지 않는다. (S-03)
4. 시작할 때 무작위 접속 토큰을 만들어 터미널에 `http://127.0.0.1:<포트>/?token=…` 로 출력하고, 이후 `HttpOnly`, `SameSite=Strict` 쿠키로 확인. (S-04)
5. nmcli는 반드시 `execFile(NMCLI_BIN, [인자 배열])` 로 실행. `exec`, `spawn({shell:true})`, 문자열 이어 붙이기 금지. (S-05)
6. 허용 목록 방식: SPEC 3장의 속성과 SPEC 4장의 하위 명령만 사용. `networking`, `radio`, `general reload`, `connection reload`, `device disconnect/delete` 같은 명령은 코드에 넣지 않는다. (S-06)
7. UUID는 `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` 만 통과. 이름·값이 `-` 로 시작하면 거부. (S-07)
8. `-s`(--show-secrets) 옵션을 쓰지 않는다. (S-08)
9. 모든 nmcli 실행에 환경변수 `LC_ALL=C` 를 준다.
10. nmcli 명령은 한 번에 하나만 실행(대기열). 시간 제한: up은 nmcli에 `-w 30` 을 주고 `execFile` 제한은 그보다 긴 35초, 나머지 명령은 `execFile` 15초.

## nmcli에 대해 이미 확인된 사실 (SPEC 2.3, 8장)

- 모든 명령은 이름이 아니라 `uuid <UUID>` 로 지정한다. (이름은 겹칠 수 있음)
- 목록의 TYPE은 `ethernet` 이 아니라 `802-3-ethernet` 으로 나온다.
- `-t` 출력에서 값 안의 `:` 는 `\:`, `\` 는 `\\` 로 바뀐다 → 파서가 되돌려야 한다. (SPEC 6.1 `splitTerse`)
- `connection modify` 는 저장된 설정만 바꾼다. 켜져 있는 연결에 반영하려면 다시 `up` 해야 한다.
- `gw4`, `con-name` 같은 별칭은 add/modify에서만 쓴다. 조회(`-f`, `-g`)에는 정식 이름(`ipv4.gateway`)만 쓴다.
- `ipv4.method manual` 인데 주소가 없으면 add가 **종료 코드 4**로 거부된다.
- 종료 코드는 숫자와 nmcli 오류 문구를 **함께** 보고 판단한다. (예: NetworkManager와 D-Bus가 꺼져 있으면 8이 아니라 1이 나온 적 있음)
- `connection.type` 은 생성 후 바꿀 수 없다.

## 작업 방식

1. `docs/TASKS.md` 의 단계를 **순서대로 하나씩** 진행한다. 한 번에 여러 단계를 몰아서 하지 않는다.
2. 단계를 시작할 때, 무엇을 만들지 3~5줄로 먼저 말한다.
3. 단계가 끝나면 **반드시 스스로 점검한다**: `npm test` 실행, 코드 다시 읽기, 명세(SPEC)와 대조.
   오류가 남아 있으면 고친 뒤 다시 점검한다. **오류가 없을 때만** 완료를 보고한다.
4. 완료 보고에는: 만든 것, 실행한 테스트와 결과, 사용자가 직접 확인할 방법(명령어·화면)을 적는다.
5. 단계가 끝날 때마다 git 커밋한다. 커밋 메시지는 한국어로 짧게 (예: `1단계: nmcli 실행·파서와 테스트`).
6. 프로젝트나 사용자 상황에 대해 모르는 것은 **추측하지 말고 물어본다.**
7. 맥에서 진짜 nmcli·sudo·systemctl을 실행하려 하지 않는다. Rocky에서 해야 할 일은 사용자가 따라 할 수 있게 명령어로 정리해 준다.

## 설명 방식

- 사용자에게는 **한국어로**, 처음 배우는 사람(초등학교 5학년)도 이해할 만큼 쉽게 설명한다.
- 가능하면 표나 짧은 예시를 쓴다.
- 코드 주석도 한국어로, 왜 그렇게 했는지 위주로 짧게 쓴다. (발표 때 설명하기 쉽게)
