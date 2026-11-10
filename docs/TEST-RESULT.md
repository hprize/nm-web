# nm-web VMware 실제 환경 테스트 결과

Nov 11, 2026

## 1. 결론과 테스트 환경

실제 VMware 가상머신(Rocky Linux 9.8)에서 nm-web 을 배포하고 진짜 nmcli 로 시험한 결과, **54개 항목 중 53개 통과, 실패 0개, 건너뜀 1개**입니다. 건너뛴 1개(F-05 시간 초과)는 VMware 에서 카드를 직접 뽑아야 해서 사람이 확인할 항목입니다.

이후 브라우저 화면 확인 9개(5장)도 모두 통과했고, 건너뛴 F-05 시간 초과도 VMware 에서 카드를 끊어 확인했습니다. **TEST-CHECKLIST.md 의 모든 항목이 실제 환경에서 통과**했습니다.

| 항목 | 값 |
| --- | --- |
| 테스트 일시 | 2026-11-11 00:23 (한국 시간) |
| OS | Rocky Linux release 9.8 (Blue Onyx), Windows VMware Workstation 의 Rocky 9.8 VM1 |
| NetworkManager | 1.54.3-5.el9\_8 (명세는 1.46 에서 확인 — 새 버전에서도 모두 동작) |
| Node.js | v24.22.1 |
| 시험한 코드 | github.com/hprize/nm-web 커밋 `aa7065e` |
| 1번 카드 (건드리지 않음) | `ens160` — Bridged, 192.168.50.74, SSH·인터넷용 |
| 2번 카드 (실험용) | `ens224` — Host-only (이번에 새로 추가). 주소가 없어서 실험용 고정 IP `192.168.250.70/24` 사용 |
| 시험 방법 | 테스트 스크립트 [`deploy/nmweb-vmtest.sh`](../deploy/nmweb-vmtest.sh) (SHA-256 `cfedea9d45ee47e18177ee2b27eeb7482b20ac5973ffef85019eba7db805a93b` 확인 후 실행 — 저장소의 파일과 같음). 화면이 부르는 것과 같은 API 를 직접 호출하고, 매번 nmcli·ip 명령 결과와 비교 |
| 결과 파일 (VM 안) | `/root/nm-web-test/results.tsv`, `/root/nm-web-test/full.log` |

## 2. 배포 (DEPLOY.md 2\~4단계) — 11개 모두 통과

| ID | 확인한 것 | 실제 결과 |
| --- | --- | --- |
| D-node | Node.js 24 이상 | v24.22.1 |
| D-user | 전용 사용자·그룹 `nmweb` | 있음 |
| D-clone | 코드 받기 `/opt/nm-web` | 커밋 aa7065e |
| D-npmci | `npm ci` (express·zod) | 설치됨 |
| D-test | `npm test` (가짜 nmcli 테스트) | pass 67 / fail 0 |
| D-polkit | polkit 권한 2개 yes | settings.modify.system, network-control 모두 yes |
| D-polkit2 | 그 밖의 위험 권한은 yes 아님 | enable-disable-network 등 yes 없음 |
| D-verify | `systemd-analyze verify` 서비스 파일 검사 | 출력 없음 (정상) |
| D-service | 서비스 상태 | active (running) |
| D-user2 | 8080 을 연 프로세스의 사용자 | nmweb (root 아님) |
| D-token | 접속 토큰 생성 | journal 에서 확인됨 |

## 3. 기능 (F-01 \~ F-11) — 25개 통과, 1개 건너뜀

실험은 모두 2번 카드 `ens224` 로만 했고, 각 동작 뒤 `nmcli`·`ip` 명령으로 실제 설정을 다시 읽어 비교했습니다.

| ID | 확인한 것 | 실제 결과 |
| --- | --- | --- |
| F-10 | 상태 표시 | connected / full |
| F-01 | 목록이 `nmcli connection show` 와 같음 | 5개 모두 일치 |
| F-01b | 유선은 "유선", 1번 카드 프로파일 켜짐 표시 | 맞음 |
| F-02 | 1번 카드 상세 = nmcli 값 | method auto, gateway 빈 값(`--` 아님) |
| F-02m | MTU 가 비어 있으면 "자동" | nmcli auto → 화면 null(자동) |
| F-02lo | lo 상세가 오류 없이 열리고 보기 전용 | IPv6 `::1/128` 깨지지 않음 |
| F-02lo2 | lo 삭제 요청 거부 | 400 NOT\_EDITABLE, lo 그대로 |
| F-09 | 장치 목록 | ens160, ens224 보임 |
| F-03v | 수동인데 주소 없음 | 400 + "주소를 하나 이상 넣어야 해요", 저장 안 됨 |
| F-03 | 생성 `lab-lan` (켜지 않음) | lab-lan / ens224 / 192.168.250.70/24 / DNS 8.8.8.8 / 자동 연결 no / IPv6 disabled |
| F-03n | 이상한 이름 `my:lan; echo HACK` | 글자 그대로 저장 |
| F-05 | 켜기 | ens224 에 192.168.250.70/24 붙음, 코드 0 |
| F-05b | 목록에 켜짐 표시 | 맞음 |
| F-04 | 켜진 연결 편집 (DNS 1.1.1.1) | 저장만 됨, "지금 적용" 안내 (needsReapply=true) |
| F-04a | 지금 적용 | 장치에 DNS 1.1.1.1 반영 |
| F-04t | 유형 변경 요청 | 400 거부 |
| F-04g | 게이트웨이·MTU 저장 | 192.168.250.1 / 1400 |
| F-04c | 비우고 저장 | 게이트웨이 지워짐, MTU auto (화면도 빈 값·자동) |
| F-06 | 끄기 | ens224 에서 주소 사라짐 |
| F-05x | 시간 초과·실패 안내 | **건너뜀** — VMware 에서 카드 연결을 끊어야 해서 수동 확인 (5장) |
| F-08 | 복제 | `lab-lan-copy`, 새 UUID, 주소·DNS 같음 |
| F-07 | 복제본 삭제 | nmcli 에서 사라짐 |
| F-07x | 없는 UUID 삭제 | 404, 코드 10, "이미 없거나 꺼져 있는 연결이에요" |
| F-11 | 실행 기록 (화면용 API) | 39개, add·modify·up·down·delete·clone 모두 포함 |
| F-11f | 실행 기록 파일 | `/var/log/nm-web/nm-web.log`, 한 줄에 JSON 하나 |
| F-07c | 실험 프로파일 정리 | lab-lan 등 앱으로 삭제 완료 |

## 4. 보안 (S-01 \~ S-10) — 16개 모두 통과

| ID | 확인한 것 | 실제 결과 |
| --- | --- | --- |
| S-01 | 8080 이 127.0.0.1 에서만 대기 | `127.0.0.1:8080` 하나만 |
| S-01b | VM 바깥 주소로 접속 | 192.168.50.74:8080 연결 거부 (curl 코드 7) |
| S-04 | 토큰 없이 접속 | 401 |
| S-04b | 틀린 토큰 | 401 |
| S-04c | 맞는 토큰 | 303 + HttpOnly·SameSite=Strict 쿠키 |
| S-02 | 가짜 Host (evil.example.com) | 403 |
| S-02b | 다른 포트 Host (127.0.0.1:9090) | 403 |
| S-03 | 다른 Origin 의 변경 요청 | 403 |
| S-03b | Origin 없는 변경 요청 | 403 |
| S-05 | 명령어 주입 시도 이름 (`$(touch …)`, 백틱) | 명령 실행 안 됨 (`/tmp/nmweb_pwned` 없음) |
| S-06 | 모르는 항목(`foo`) | 400, 저장 안 됨 |
| S-06b | 기록된 nmcli 명령이 모두 허용 목록 안 | 밖의 명령 없음 |
| S-07 | UUID 형식이 아님 | 400 |
| S-07b | 이름이 `-` 로 시작 | 400 |
| S-08 | `-s` / `--show-secrets` 사용 | 없음 |
| S-10 | 외부 파일 사용 + CSP | 외부 주소 없음, `default-src 'self'` |

**1번 카드 보호 (Z-main) — 통과:** 테스트 전후로 `ens160` 프로파일(방식·주소·게이트웨이·DNS)과 기본 경로가 똑같고, SSH 연결도 끊기지 않았습니다.

## 5. 화면 직접 확인 — 9개 모두 통과 (2026-11-11 사용자 확인)

위 결과는 화면이 쓰는 API 를 직접 불러서 확인한 것이라, **화면에서만 보이는 것**(빨간 안내, 확인 창, 경고 문구)은 브라우저로 한 번 눌러 봐야 합니다. VM 안 Firefox 에서 `sudo journalctl -u nm-web -n 20 --no-pager | grep token` 으로 나온 주소를 열고, 실험은 **ens224** 로만 하세요.

- [x] F-03: IPv4 "수동" + 주소 비우고 만들기 → 빨간 안내가 보이고 저장되지 않음
- [x] F-04: 켜진 연결 편집 → "사용 중인 연결…" 경고 → 저장 후 "지금 적용할까요?" 창
- [x] F-04: 편집 화면에서 유형 칸이 막혀 있음
- [x] F-07: 삭제 창에서 이름을 틀리게 입력하면 삭제 버튼이 눌리지 않음
- [x] F-07: 1번 카드 프로파일의 삭제 창만 열어 "지금 사용 중인 연결이에요!" 확인 후 **취소** (절대 삭제하지 않기)
- [x] F-05 (건너뛴 항목): VMware 에서 Network Adapter 2 의 "Connected" 를 끄고 켜기 → 30초 안에 실패 안내(코드 3 또는 4)
- [x] F-11: 화면 아래 실행 기록 패널에 방금 한 명령이 보임
- [x] S-10: F12 → 네트워크 탭에서 모든 요청이 127.0.0.1:8080 으로만 감
- [x] S-01: Windows 브라우저에서 `http://192.168.50.74:8080` 이 열리지 않음 (참고: VM 안에서는 이미 거부됨을 확인)

## 6. VM 에 바뀐 것과 다시 실행하는 법

| 바뀐 것 | 위치 |
| --- | --- |
| 테스트용 2번 네트워크 카드 (Host-only) | VMware 의 Rocky 9.8 VM1 설정 → Network Adapter 2 |
| 앱 코드 | `/opt/nm-web` (root 소유) |
| 전용 사용자·그룹 | `nmweb` |
| polkit 규칙 | `/etc/polkit-1/rules.d/50-nmweb.rules` |
| 서비스 (부팅 시 자동 시작) | `/etc/systemd/system/nm-web.service` |
| 실행 기록 | `/var/log/nm-web/nm-web.log` |
| 테스트 스크립트·결과 | `/tmp/nmweb-vmtest.sh` (저장소의 `deploy/nmweb-vmtest.sh` 와 같은 파일), `/root/nm-web-test/` |

**다시 시험하기** (코드를 고친 뒤에도 그대로): 스크립트는 저장소에 들어 있으니, VM 에서 받아 root 로 실행합니다.

```bash
sudo git -C /opt/nm-web pull                                   # 최신 코드(스크립트 포함) 받기
sudo cp /opt/nm-web/deploy/nmweb-vmtest.sh /root/              # 실행 중 git pull 로 파일이 바뀌지 않게 복사해서 실행
sudo bash /root/nmweb-vmtest.sh                                # 결과: /root/nm-web-test/results.tsv, full.log
```

스크립트가 `git pull` → `npm ci` → 서비스 재시작 → 전체 시험 → 실험 프로파일 정리까지 한 번에 합니다. 약 10\~20초 걸립니다 (Node.js 가 이미 설치돼 있고 대부분 명령이 빠름).

| 환경변수 (선택) | 뜻 |
| --- | --- |
| `NMWEB_TDEV=ens224` | 실험용 2번 카드를 직접 지정 (기본: 기본 경로가 없는 유선 카드를 자동으로 찾음) |
| `NMWEB_DEFDEV=ens160` | 건드리지 않을 1번 카드를 직접 지정 (기본: 기본 경로가 있는 카드) |
| `NMWEB_LOCAL=1` | systemd 없이 서버를 직접 켜서 시험 (사전 점검용) |

**진행 중 있었던 일:** 처음에는 SSH 창에 긴 스크립트를 붙여넣었는데 글자가 섞여서, 그때 나온 결과는 버렸습니다. 이 문서의 결과는 파일을 `scp` 로 옮긴 뒤 체크섬을 확인하고 실행한 **두 번째 실행** 결과입니다. VMware 콘솔은 바깥에서 보낸 클릭·키 입력과 클립보드를 받지 않아서 화면 읽기로만 확인했습니다.
