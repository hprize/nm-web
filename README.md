# nm-web — 브라우저로 관리하는 유선 연결 프로파일

리눅스의 **유선랜 연결 설정(연결 프로파일)** 을 웹 화면에서 만들고, 보고, 고치고, 켜고, 끄고, 복제하고, 지우는 앱입니다.
화면 뒤에서는 NetworkManager의 `nmcli` 명령을 대신 실행하고, 보안을 위해 **같은 컴퓨터(127.0.0.1)에서만** 접속할 수 있습니다. (수업 과제)

> 비유: 연결 프로파일은 "유선랜 접속 방법을 적어 둔 **설정 카드**", nmcli는 그 카드를 관리하는 **명령어 리모컨**,
> 이 앱은 그 리모컨을 **버튼이 달린 화면**으로 바꿔 준 것입니다.

## 어떻게 동작하나요?

```text
브라우저 화면 (public/)          서버 (Node.js + Express)                         NetworkManager
───────────────────────          ─────────────────────────────────────            ──────────────
버튼 클릭 ── fetch(JSON) ──▶  ① 출처 검사 (Host·토큰·Origin)                     
                               ② 입력 검사 (zod, 허용된 칸만)
                               ③ JSON → nmcli 인자 "배열"
                               ④ execFile('nmcli', [...])  ── 셸 없이 ──▶  nmcli ─▶ 설정 변경
                               ⑤ 종료 코드 + 문구 → 쉬운 한국어 안내
화면 갱신 ◀── JSON 응답 ──────  ⑥ 실행 기록 남기고 응답
```

| 구분 | 사용한 것 | 고른 이유 |
| --- | --- | --- |
| 런타임 | Node.js 24 LTS | Rocky 9.8 저장소에 있음 |
| 서버 | Express 5 | 자료가 많고 설명하기 쉬움 |
| 입력 검사 | zod 4 | "허용된 값만 통과"를 짧게 표현 |
| nmcli 실행 | `node:child_process` `execFile` | 셸을 거치지 않아 명령어 주입 차단 |
| 화면 | HTML + CSS + 순수 JavaScript | 빌드 도구·외부 CDN 없음 |
| 테스트 | `node:test` (내장) | 추가 설치 없음 |

외부 라이브러리는 **Express와 zod 두 개뿐**입니다.

## 할 수 있는 일 (SPEC 4장 P1 기능 11개)

| 기능 | 화면에서 | nmcli |
| --- | --- | --- |
| 목록 (F-01) | 첫 화면 표: 이름·유형(유선)·장치·켜짐 | `connection show` |
| 상세 (F-02) | 행 클릭 → 공통 / IPv4 / IPv6 / 유선 | `connection show uuid …` |
| 생성 (F-03) | **+ 새로 만들기** (방식이 "수동"일 때만 주소 칸이 보임) | `connection add …` |
| 편집 (F-04) | **편집** → 바뀐 칸만 저장 | `connection modify uuid …` |
| 켜기 (F-05) | **켜기** / 켜진 연결은 **지금 적용** | `connection up uuid …` (30초 제한) |
| 끄기 (F-06) | **끄기** (확인 창) | `connection down uuid …` |
| 삭제 (F-07) | **삭제** (이름을 다시 입력해야 눌림) | `connection delete uuid …` |
| 복제 (F-08) | **복제** (기본 이름 `<이름>-copy`) | `connection clone uuid …` |
| 장치 목록 (F-09) | 폼의 "연결할 장치" 선택지 | `device status` |
| 상태 표시 (F-10) | 맨 위 상태줄 | `general status` |
| 실행 기록 (F-11) | 화면 아래 **실행 기록** 패널 + 파일 | (앱 내부) |

## 화면

| 화면 | 보이는 것 |
| --- | --- |
| S-1 목록 | 상태줄, 프로파일 표, 행마다 켜기/끄기. 유선이 아닌 것(예: `lo`)은 "보기 전용" |
| S-2 상세 | 4개 칸(공통·IPv4·IPv6·유선), 편집·복제·삭제·켜기/끄기 버튼 |
| S-3 생성·편집 폼 | 입력하는 동안 빨간 안내, 게이트웨이가 다른 네트워크면 노란 경고, "저장 후 바로 적용" |
| S-4 확인 창 | 삭제(이름 다시 입력), 끄기, 사용 중인 연결 변경("인터넷이 끊길 수 있어요"), 장치를 안 정한 프로파일 켜기 |
| S-5 실행 기록 | 시간 · 실행한 명령 · 성공/실패(종료 코드, nmcli 문구) |

## 실행 방법

### 맥에서 개발 (가짜 nmcli)

맥에는 nmcli가 없어서 `dev/fake-nmcli`(진짜와 같은 모양으로 출력하는 흉내쟁이)를 씁니다. 진짜 네트워크는 건드리지 않습니다.

```bash
npm install          # express, zod 설치
npm run dev          # 가짜 nmcli 로 서버 시작 → 터미널에 찍힌 http://127.0.0.1:8080/?token=… 을 브라우저로 열기
npm test             # 전체 테스트 (67개)
node dev/ui-check.mjs  # (선택) 헤드리스 Chrome 으로 화면을 끝까지 눌러 보는 점검
```

가짜 데이터를 처음으로 되돌리려면 `dev/fake-state.json` 을 지우면 됩니다.

### Rocky Linux 9.8 (진짜 nmcli)

[docs/DEPLOY.md](docs/DEPLOY.md) 를 순서대로 따라 하고, [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) 로 확인합니다.
요약: 전용 사용자 `nmweb` + polkit 규칙 → `/opt/nm-web` 에 받기 → `npm ci` → systemd 서비스 → `journalctl` 에서 접속 주소 확인.

## 보안 설계 요약

이 앱은 컴퓨터의 네트워크를 바꿀 수 있어서, **"같은 컴퓨터 안에서, 허락된 화면만, 정해진 명령만"** 실행되게 여러 겹으로 막았습니다.

| 막는 위험 | 방법 | 어디 |
| --- | --- | --- |
| 다른 컴퓨터에서 접속 (S-01) | `127.0.0.1` 에만 연결 대기, 주소를 코드에 고정 | `server.js` |
| 가짜 도메인으로 우회 — DNS 리바인딩 (S-02) | `Host` 가 `127.0.0.1:<포트>`/`localhost:<포트>` 가 아니면 403 | `server.js` |
| 다른 사이트가 몰래 보내는 요청 — CSRF (S-03) | 바꾸는 요청은 `Origin` 이 이 앱일 때만, CORS 허용 안 함 | `server.js` |
| 같은 컴퓨터의 다른 프로그램 (S-04) | 켤 때마다 새 무작위 토큰 → `HttpOnly`·`SameSite=Strict` 쿠키 | `server.js` |
| 명령어 주입 (S-05) | 셸 없이 `execFile` + 인자 배열 (이름에 `; echo HACK` 을 넣어도 글자 그대로 저장) | `lib/nmcli.js` |
| 위험한 명령 (S-06) | 허용 목록 **두 겹**: 입력 검사(모르는 칸 400) + 실행 직전 검문(`checkArgs`) | `lib/schema.js`, `lib/nmcli.js` |
| 값이 옵션으로 오해됨 (S-07) | UUID 정규식, `-` 로 시작하는 이름·값 거부, 모든 명령은 `uuid <UUID>` 로 | `lib/nmcli.js`, `public/rules.js` |
| 비밀번호 유출 (S-08) | `-s` 를 쓰지 않음, 기록에서 `***` | `lib/log.js` |
| 원인 추적 (S-09) | 모든 실행을 시간·명령·결과와 함께 파일에 기록 | `lib/log.js` |
| 외부 스크립트 변조 (S-10) | 화면 파일을 앱이 직접 제공, CSP `default-src 'self'`, `innerHTML` 미사용 | `public/` |
| 너무 큰 권한 | root 가 아닌 `nmweb` 사용자 + polkit 으로 **권한 2개만** (`settings.modify.system`, `network-control`) | `deploy/` |

그 밖의 안전장치: nmcli는 **한 번에 하나만** 실행(대기열), 켜기는 30초 / 나머지는 15초 시간 제한,
변경 뒤에는 목록을 다시 읽어 화면과 실제 상태를 맞춤, 사용 중인 연결을 끄기·지우기·바꾸기 할 때 경고.

## 폴더 구조

```text
nm-web/
├── server.js            # 서버 시작, 127.0.0.1 바인딩, 보안 검사(S-01~S-04)
├── routes/api.js        # API 11개 (SPEC 6장)
├── lib/
│   ├── nmcli.js         # nmcli 실행(execFile)·대기열·허용 목록 검문·출력 해석
│   ├── schema.js        # zod 입력 규칙 + JSON → nmcli 인자 배열
│   ├── profile.js       # nmcli 출력 → 화면용 JSON
│   ├── hints.js         # 종료 코드 + 문구 → 한국어 안내 (SPEC 8장)
│   └── log.js           # 실행 기록, 비밀값 가리기
├── public/              # 화면: index.html, app.js, formlogic.js, rules.js(서버와 공유), style.css …
├── test/                # node:test 테스트 (npm test)
├── dev/                 # 가짜 nmcli, 화면 점검 도구 (맥 개발용)
├── deploy/              # polkit 규칙, systemd 서비스 (Rocky 용)
└── docs/                # SPEC(명세), TASKS(작업 순서), DECISIONS(보충 결정), DEPLOY, TEST-CHECKLIST, CHECK(대조표)
```

## 문서

- [docs/SPEC.md](docs/SPEC.md) — 기능 명세서 (기준 문서)
- [docs/DECISIONS.md](docs/DECISIONS.md) — 명세에서 애매했던 부분의 결정
- [docs/CHECK.md](docs/CHECK.md) — 명세 대조표 (기능·보안이 어디에 구현됐는지)
- [docs/DEPLOY.md](docs/DEPLOY.md) — Rocky 배포 안내
- [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) — VMware 확인표
