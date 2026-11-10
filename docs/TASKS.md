# 작업 순서 (TASKS)

`docs/SPEC.md` 를 기준으로, 아래 단계를 **순서대로 하나씩** 진행합니다.
각 단계의 "완료 기준"을 모두 만족하고 `npm test` 가 통과해야 다음 단계로 넘어갑니다.
괄호 안의 ID(F-01, S-01 등)는 SPEC의 기능·보안 번호입니다.

---

## 0단계 — 프로젝트 뼈대

- [ ] `package.json`: `"type": "module"`, Node 24 이상(`engines`), 스크립트 `dev` / `start` / `test`
- [ ] 의존성: `express@5`, `zod@4` 만 설치
- [ ] `.gitignore`: `node_modules/`, 실행 기록 파일, `.DS_Store`
- [ ] SPEC 6.1의 폴더 구조대로 빈 폴더·파일 만들기 (`server.js`, `lib/`, `routes/`, `public/`, `test/`, `dev/`)
- [ ] `git init` 후 첫 커밋

**완료 기준:** `npm install` 과 `npm test` 가 오류 없이 끝남 (테스트가 0개여도 됨)

---

## 1단계 — nmcli 실행 도구와 가짜 nmcli

- [ ] `lib/nmcli.js`
  - `runNmcli(args, timeoutMs)` — SPEC 6.1 코드 기반. 실행 파일은 `process.env.NMCLI_BIN || 'nmcli'`
  - `splitTerse(line)` — `-t` 출력 한 줄 나누기 (`\:` `\\` 되돌리기)
  - 대기열: 한 번에 하나만 실행
- [ ] `dev/fake-nmcli` — 맥 개발용 가짜 nmcli (`#!/usr/bin/env node`, 실행 권한 부여)
  - SPEC 4.1 표의 명령에 대해 **진짜 nmcli와 같은 형식**으로 출력 (`-t`, `-f`, `-g` 포함)
  - 프로파일 목록을 `dev/fake-state.json` 에 저장해서 add / modify / clone / delete 결과가 유지되게
  - 진짜와 같은 종료 코드 흉내: 없는 UUID → 10, manual인데 주소 없음 → 4, 잘못된 IP → 2
  - 장치 예시: `ens160`(연결됨), `ens224`(테스트용) — 가짜 데이터라는 주석 달기
  - `fake-state.json` 은 `.gitignore` 에 추가
- [ ] 테스트 `test/nmcli.test.js`: `splitTerse`(콜론·역슬래시 포함 이름), 가짜 nmcli로 add → show → delete 흐름, 종료 코드 전달

**완료 기준:** 이름이 `my:lan; echo HACK` 인 프로파일도 글자 그대로 저장·조회됨을 테스트로 확인

---

## 2단계 — 서버 뼈대와 보안 검사 (S-01 ~ S-04, S-10)

- [ ] `server.js`: Express 시작, **`127.0.0.1` 에만 바인딩**, 포트는 환경변수 `PORT`(기본 8080)
- [ ] 시작 시 무작위 토큰 생성(`crypto.randomBytes`) → 터미널에 `http://127.0.0.1:<포트>/?token=…` 출력
- [ ] 미들웨어: Host 검사(403) → 토큰/쿠키 검사(401) → 변경 요청의 Origin 검사(403)
- [ ] `public/` 정적 파일 제공 (외부 CDN 없음)
- [ ] 보안 응답 헤더 직접 설정: `Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- [ ] 테스트: 잘못된 Host → 403, 토큰 없음 → 401, 다른 Origin의 POST → 403, 정상 요청 → 200

**완료 기준:** 위 4가지 테스트 통과, 서버가 `0.0.0.0` 으로 열리지 않음을 코드에서 확인

---

## 3단계 — 입력 검사 (S-06, S-07, SPEC 5장 표)

- [ ] `lib/schema.js` (zod)
  - 생성 요청 JSON 형식: SPEC 6장 예시와 동일 (`type`, `name`, `ifname`, `autoconnect`, `ipv4`, `ipv6`, `activate`)
  - `type` 은 `ethernet` 만 허용
  - 이름 1~64자, 제어문자 금지, `-` 로 시작 금지 / IPv4 `주소/0~32` / 게이트웨이 / DNS 최대 3개 / MTU 576~9000
  - `ipv4.method` 가 `manual` 이면 주소 필수
  - UUID 정규식
- [ ] `toNmcliArgs()` — 검사를 통과한 JSON을 nmcli 인자 배열로 변환 (허용 목록에 없는 키는 버림)
  - add의 공통 옵션 `type`, `con-name`, `ifname` 은 그대로 쓰고, 나머지는 **SPEC 3장 정식 속성 이름**으로
  - "아무 장치나"를 고르면 `ifname` 인자를 아예 넣지 않음
  - DNS 여러 개는 공백으로 이은 **한 개의 인자**로 (`"8.8.8.8 1.1.1.1"`)
  - modify에서는 공통 옵션 대신 정식 이름만 사용 (`connection.id`, `connection.interface-name` 등)
- [ ] 테스트: 올바른 입력 / 틀린 입력 각각, 변환 결과 배열 확인

**완료 기준:** SPEC 6장 생성 요청 예시(office-lan)가 아래 배열로 변환됨 (실제 nmcli에서 성공 확인된 형태)

```js
['connection', 'add', 'type', 'ethernet', 'con-name', 'office-lan', 'ifname', 'eth0',
 'connection.autoconnect', 'no',
 'ipv4.method', 'manual', 'ipv4.addresses', '192.168.10.50/24',
 'ipv4.gateway', '192.168.10.1', 'ipv4.dns', '8.8.8.8 1.1.1.1',
 'ipv6.method', 'disabled']
```

---

## 4단계 — 조회 API (F-01, F-02, F-09, F-10)

- [ ] `GET /api/status`, `/api/devices`, `/api/connections`, `/api/connections/:uuid`
- [ ] 응답 형식은 SPEC 6장 공통 형식 (`ok`, `data`, `nmcli.exitCode`, `nmcli.message`)
- [ ] 화면용으로 TYPE `802-3-ethernet` → `유선` 표시값 추가
- [ ] 테스트: 가짜 nmcli로 각 API 응답 확인, 없는 UUID → `ok:false` + 코드 10 + 쉬운 안내(hint)

**완료 기준:** 4개 API 모두 테스트 통과

---

## 5단계 — 변경 API (F-03 ~ F-08)

- [ ] `POST /api/connections` (생성, `activate:true` 면 이어서 up)
- [ ] `PATCH /api/connections/:uuid` (바뀐 값만 modify, `connection.type` 변경 거부)
- [ ] `POST …/up` (nmcli `-w 30`, `execFile` 제한 35초 — nmcli가 먼저 코드 3으로 끝나게), `POST …/down`, `DELETE …`, `POST …/clone`
- [ ] 종료 코드 → 한국어 안내(hint) 변환표: SPEC 8장 표 그대로
- [ ] 변경 후 목록을 다시 읽어서 응답 (SPEC 8장 "실행 후 다시 읽기")
- [ ] 테스트: 생성 → 수정 → 복제 → 삭제 전체 흐름, 각 실패 경우

**완료 기준:** 전체 흐름 테스트 통과, 모든 nmcli 호출이 `uuid <UUID>` 형식인지 코드 검색으로 확인

---

## 6단계 — 실행 기록 (F-11, S-08, S-09)

- [ ] `lib/log.js`: 시간 · 명령(인자 배열) · 종료 코드 · 결과 문구를 파일과 메모리에 기록
- [ ] 비밀이 될 수 있는 값은 `***` 로 가리기
- [ ] `GET /api/logs` (최근 100개)
- [ ] 테스트: 기록 형식, 가리기 동작

---

## 7단계 — 화면 (SPEC 5장 S-1 ~ S-5)

- [ ] S-1 목록: 상태 표시줄, 프로파일 표(이름·유형·장치·켜짐), 행별 켜기/끄기, 새로 만들기, 새로고침
- [ ] S-2 상세: 공통 / IPv4 / IPv6 / 유선 칸, 편집·복제·삭제·켜기/끄기 버튼
- [ ] S-3 생성·편집 폼: IPv4 방식에 따라 주소 칸 표시/숨김, 빨간 안내, "저장 후 바로 적용" 체크
- [ ] S-4 확인 창: 삭제는 이름 다시 입력, 켜져 있는 연결 변경 시 "인터넷이 끊길 수 있어요" 경고
- [ ] S-5 실행 기록 패널
- [ ] 화면에서도 서버와 같은 입력 규칙으로 미리 안내 (최종 판단은 서버)
- [ ] 변경 요청은 `fetch` 로 같은 출처에서만 보냄 (Origin 검사 통과)

**완료 기준:** `npm run dev` 로 맥 브라우저에서 생성 → 수정 → 적용 → 해제 → 복제 → 삭제를 끝까지 해 볼 수 있음. 사용자가 직접 확인할 순서를 적어 줄 것

---

## 8단계 — Rocky 배포 준비 (사용자가 VMware에서 실행)

- [ ] `deploy/50-nmweb.rules` — SPEC 7.1 polkit 규칙 그대로
- [ ] `deploy/nm-web.service` — systemd 서비스 (`User=nmweb`, `Group=nmweb`, `Environment=PORT=8080`)
- [ ] `docs/DEPLOY.md` — 사용자가 따라 할 명령어 순서 (한 줄씩 설명 포함)
  1. VMware에 테스트용 2번 네트워크 카드(Host-only) 추가, `nmcli device` 로 이름 확인
  2. `nmcli --version`, Node.js 24 설치(`dnf module list nodejs` 로 스트림 확인)
  3. `nmweb` 그룹·사용자 만들기, polkit 규칙 복사, `sudo -u nmweb nmcli general permissions` 로 확인
  4. `git clone` → `npm ci` → 서비스 등록·시작
  5. 화면 접속 방법 (가상머신 안 Firefox 또는 Windows PowerShell `ssh -L 8080:127.0.0.1:8080 …`)
- [ ] `docs/TEST-CHECKLIST.md` — VMware에서 확인할 항목표: F-01~F-11 각각, **2번 카드에서만** 실험, 1번 카드는 건드리지 않기

---

## 9단계 — 마무리

- [ ] `npm test` 전체 통과
- [ ] SPEC 4장 P1 기능 11개, 7장 보안 S-01~S-10 각각 "어디서 구현했는지(파일)" 대조표를 `docs/CHECK.md` 로 작성
- [ ] `README.md`: 과제 소개, 실행 방법, 화면 설명, 보안 설계 요약 (발표 자료로 쓸 수 있게)
