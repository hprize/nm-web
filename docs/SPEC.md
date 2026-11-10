# nmcli 연결 프로파일 관리 웹앱 — 기능 명세서

Nov 10, 2026 · @오키더키

## 1. 개요

이 앱은 리눅스 컴퓨터의 **네트워크 연결 설정(연결 프로파일)** 을 웹 브라우저 화면에서 만들고, 보고, 고치고, 켜고, 지울 수 있게 해 주는 도구입니다. 화면 뒤에서는 `nmcli` 명령을 대신 실행하며, 보안을 위해 **같은 컴퓨터(localhost, 127.0.0.1)에서만** 접속할 수 있습니다.

쉽게 비유하면, 연결 프로파일은 "유선랜 접속 방법을 적어 둔 **설정 카드**"이고, nmcli는 그 카드를 관리하는 **명령어 리모컨**입니다. 이 앱은 그 리모컨을 **버튼이 달린 화면**으로 바꿔 주는 것입니다.

### 1.1 용어

| 용어 | 쉬운 설명 | 예시 |
| --- | --- | --- |
| NetworkManager | 리눅스에서 네트워크 연결을 관리하는 프로그램(백그라운드에서 항상 실행) | 컴퓨터가 켜지면 유선랜에 자동으로 연결되는 것 |
| nmcli | NetworkManager에게 명령을 내리는 터미널 도구 | `nmcli connection show` |
| 연결 프로파일 (connection) | 어떤 장치로, 어떤 IP·DNS로 접속할지 적어 둔 설정 묶음 | "사무실 유선랜: 192.168.10.50 고정 IP" |
| 장치 (device) | 실제 네트워크 부품(랜카드, 와이파이 카드) | `eth0`, `wlan0` |
| 활성화 (up) / 비활성화 (down) | 프로파일을 장치에 실제로 적용 / 해제 | 유선랜 연결 켜기 / 끄기 |
| UUID | 프로파일마다 붙는 고유 번호(이름은 같을 수 있지만 UUID는 하나뿐) | `1115a96e-50aa-…` |

### 1.2 범위

| 구분 | 내용 |
| --- | --- |
| 포함 (1차) | 연결 프로파일 목록·상세 보기, 생성, 편집, 적용(up), 해제(down), 삭제, 복제, 장치 목록 보기 |
| 포함 (1차 유형) | 유선(ethernet)만 — IPv4/IPv6 자동(DHCP)·수동(고정 IP) |
| 제외 (2차 이후) | 와이파이, VPN 가져오기/내보내기, 본딩·브리지·VLAN 같은 고급 유형, 원격 접속, 여러 사용자 계정 |

### 1.3 실행 환경 (확정)

| 항목 | 내용 |
| --- | --- |
| 용도 | 수업 과제 |
| 대상 OS | **Rocky Linux 9.8** ([2026-05-27 출시](https://rockylinux.org/news/rocky-linux-9-8-ga-release)) |
| 개발 / 최종 테스트 | 맥에서 개발 → Windows의 VMware 가상머신(Rocky Linux 9.8)에서 최종 테스트. 테스트용 네트워크 카드를 하나 더 달아서 그 카드로만 실험 |
| 백엔드 | Node.js 24 LTS (Rocky 9.8 기본 저장소에 포함) — 자세한 스택은 6.1 |
| 권한 방식 | polkit 규칙 (7장) |
| 다루는 연결 | 유선(ethernet)만 |
| 프로파일 저장 위치 | `/etc/NetworkManager/system-connections/` 의 keyfile 형식 ([Red Hat RHEL 9 문서](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/considerations_in_adopting_rhel_9/assembly_networking_considerations-in-adopting-rhel-9)). 앱은 파일을 직접 건드리지 않고 **항상 nmcli만 사용** |

- 이 명세의 명령은 Ubuntu 24.04 + NetworkManager 1.46.0 테스트 환경에서 실행해 확인했습니다. Rocky 9.8 장비에서 `nmcli --version` 으로 버전을 한 번 확인하고, 같은 명령을 다시 시험해 보세요.

## 2. nmcli 기능 조사 결과

nmcli는 `nmcli [옵션] 오브젝트 명령` 형태로 씁니다. 이 앱이 주로 쓰는 것은 **connection(연결 프로파일)** 오브젝트이고, 장치 정보를 보여 줄 때 **device** 오브젝트를 함께 씁니다. ([nmcli 공식 문서](https://networkmanager.dev/docs/api/latest/nmcli.html))

### 2.1 오브젝트 7가지

| 오브젝트 | 하는 일 | 앱에서 사용 |
| --- | --- | --- |
| general | NetworkManager 전체 상태 확인 | 사용 (상태 표시줄) |
| networking | 네트워크 전체 켜기/끄기 | 사용 안 함 (위험) |
| radio | 와이파이·모바일 무선 스위치 | 사용 안 함 |
| **connection** | **연결 프로파일 관리** | **핵심 기능** |
| device | 장치(랜카드 등) 상태·제어 | 사용 (장치 목록·선택) |
| agent | 비밀번호 입력 도우미 | 사용 안 함 |
| monitor | 변화 실시간 감시 | 2차 (자동 새로고침) |

### 2.2 connection 하위 명령 13가지

| 명령 | 하는 일 (쉽게) | 문법 예시 | 1차 구현 |
| --- | --- | --- | --- |
| show | 프로파일 목록 / 한 개의 상세 보기 | `nmcli connection show` / `nmcli connection show uuid <UUID>` | O |
| add | 새 프로파일 만들기 | `nmcli connection add type ethernet con-name office-lan ifname eth0 …` | O |
| modify | 프로파일 값 바꾸기 (`+` 추가, `-` 빼기) | `nmcli connection modify uuid <UUID> ipv4.addresses 192.168.10.60/24` | O |
| up | 프로파일 적용(접속) | `nmcli connection up uuid <UUID>` | O |
| down | 프로파일 해제(접속 끊기) | `nmcli connection down uuid <UUID>` | O |
| delete | 프로파일 지우기 | `nmcli connection delete uuid <UUID>` | O |
| clone | 프로파일 복사(새 UUID 생성) | `nmcli connection clone uuid <UUID> <새이름>` | O |
| reload | 디스크의 설정 파일 전부 다시 읽기 | `nmcli connection reload` | X (root만 가능 — polkit 방식에서 거부됨을 확인) |
| edit | 터미널 대화형 편집기 | `nmcli connection edit …` | X (대화형이라 웹에 부적합) |
| load | 특정 설정 파일만 다시 읽기 | `nmcli connection load <파일>` | X |
| import | 외부 설정 가져오기 (**VPN만** 지원) | `nmcli connection import type openvpn file a.ovpn` | X (2차) |
| export | 설정 내보내기 (**VPN만** 지원) | `nmcli connection export <ID> 파일` | X (2차) |
| monitor | 프로파일 변화 감시 | `nmcli connection monitor <ID>` | X (2차) |

### 2.3 앱이 꼭 알아야 할 nmcli 성질 (직접 실행해서 확인)

| 성질 | 확인 결과 | 앱 설계에 주는 의미 |
| --- | --- | --- |
| modify는 **저장된 설정만** 바꿈 | 이미 켜진 연결은 다시 `up` 해야 반영됨 ([Red Hat 문서](https://docs.redhat.com/de/documentation/red_hat_enterprise_linux/10/html/configuring_and_managing_networking/configuring-an-ethernet-connection)도 modify 뒤 up 실행) | 편집 후 "지금 적용" 버튼을 따로 둠 |
| 이름은 겹칠 수 있음 | 이름 대신 UUID는 항상 하나뿐 | 모든 명령은 `uuid <UUID>` 로 지정 |
| 기계용 출력 `-t`, `-g` | `-t -f NAME,UUID,TYPE,DEVICE,ACTIVE connection show` → `office-lan:1115a96e-…:802-3-ethernet::no` | 화면 데이터는 이 형식을 파싱 |
| 이름에 `:` 가 있으면 `\:` 로 바뀜 | 이름 `my:lan` → `my\:lan` 로 출력 | 파서가 `\:` `\\` 를 되돌려야 함 |
| 목록의 TYPE은 긴 이름 | `ethernet` 이 아니라 `802-3-ethernet` 으로 출력 | 화면에는 "유선"처럼 바꿔 표시 |
| 별칭은 add/modify에서만 | `gw4`, `con-name` 같은 별칭은 add/modify에서만 됨. `-f` 조회에 쓰면 오류(`gw4`)가 나거나, 전혀 다른 뜻(`ip4` = 현재 켜진 IP 정보)이 됨 | 조회는 정식 이름(예: `ipv4.gateway`)만 사용 |
| 비밀번호는 기본으로 숨김 | `-s`(--show-secrets)를 줘야 보임 | 앱은 `-s` 를 쓰지 않음 |
| 출력 언어가 바뀜 | 공식 문서가 스크립트에는 `LC_ALL=C` 권장 | 백엔드는 항상 `LC_ALL=C` 로 실행 |
| `--offline` 옵션 | NetworkManager 없이 add/modify 결과를 설정 파일 형식으로만 출력 (실제 적용 X) | "적용 전 미리보기" 기능에 활용 가능 |

## 3. 앱에서 다룰 설정 항목

프로파일의 각 값은 `설정이름.속성이름` 형태입니다(예: `ipv4.method`). 아래 이름은 모두 nmcli 1.46에서 실제로 넣어 보고 오류 없이 저장되는 것을 확인했습니다. 앱은 **정식 이름**만 사용합니다.

### 3.1 공통 (connection)

| 화면 이름 | 정식 속성 | 입력 형태 / 값 | 필수 |
| --- | --- | --- | --- |
| 프로파일 이름 | `connection.id` (add 별칭 `con-name`) | 글자 1\~64자 | O |
| 유형 | `connection.type` (add 별칭 `type`) | `ethernet` (유선만 지원) | O (생성 후 변경 불가) |
| 연결할 장치 | `connection.interface-name` (add 별칭 `ifname`) | 장치 목록에서 선택, 또는 "아무 장치나" | 선택 |
| 자동 연결 | `connection.autoconnect` | yes / no | 선택 (기본 yes) |
| 자동 연결 우선순위 | `connection.autoconnect-priority` | 정수 (클수록 먼저) | 선택 |

### 3.2 IPv4 / IPv6

| 화면 이름 | 정식 속성 | 입력 형태 / 값 | 비고 |
| --- | --- | --- | --- |
| IPv4 방식 | `ipv4.method` | `auto`(DHCP) / `manual`(고정) / `link-local` / `disabled` | manual이면 주소 필수 |
| IPv4 주소 | `ipv4.addresses` | `192.168.10.50/24` (여러 개 가능) | add 별칭 `ip4` |
| IPv4 게이트웨이 | `ipv4.gateway` | `192.168.10.1` | add 별칭 `gw4` |
| IPv4 DNS | `ipv4.dns` | `8.8.8.8 1.1.1.1` (여러 개) | 조회 시 쉼표로 출력됨 |
| DNS 검색 도메인 | `ipv4.dns-search` | `example.com` | 선택 |
| 자동 DNS 무시 | `ipv4.ignore-auto-dns` | yes / no | DHCP에서 직접 DNS만 쓰고 싶을 때 |
| IPv6 방식 | `ipv6.method` | `auto` / `manual` / `dhcp` / `link-local` / `ignore` / `disabled` |  |
| IPv6 주소·게이트웨이·DNS | `ipv6.addresses`, `ipv6.gateway`, `ipv6.dns` | `2001:db8::5/64` 등 | add 별칭 `ip6`, `gw6` |

### 3.3 유형별

| 유형 | 화면 이름 | 정식 속성 | 값 |
| --- | --- | --- | --- |
| 유선 | MTU | `802-3-ethernet.mtu` | 숫자 (예: 1500) |
| 유선 | 고정할 MAC | `802-3-ethernet.mac-address` | `52:54:00:12:34:56` |
| 유선 | 바꿔 쓸 MAC | `802-3-ethernet.cloned-mac-address` | MAC 또는 `random`, `stable` |

> 예시 — 사무실 고정 IP 유선랜을 만드는 실제 명령(확인 완료): `nmcli connection add type ethernet con-name office-lan ifname eth0 autoconnect no ipv4.method manual ipv4.addresses 192.168.10.50/24 ipv4.gateway 192.168.10.1 ipv4.dns "8.8.8.8 1.1.1.1"`

## 4. 구현할 기능 명세

1차 버전은 아래 **필수(P1) 11개** 기능을 만듭니다. 각 기능은 표의 nmcli 명령 **하나**로 처리되며, `<UUID>` 자리에는 화면에서 고른 프로파일의 UUID가 들어갑니다.

### 4.1 기능 목록

| ID | 기능 | 하는 일 | 실행할 nmcli 명령 | 우선순위 |
| --- | --- | --- | --- | --- |
| F-01 | 프로파일 목록 | 모든 프로파일을 이름·유형·장치·켜짐 여부로 표시 | `nmcli -t -f NAME,UUID,TYPE,DEVICE,ACTIVE connection show` | P1 |
| F-02 | 프로파일 상세 | 한 프로파일의 설정값을 공통 / IPv4 / IPv6 / 유선 항목별로 표시 | `nmcli -t -f connection,ipv4,ipv6,802-3-ethernet connection show uuid <UUID>` | P1 |
| F-03 | 프로파일 생성 | 폼 입력값으로 새 프로파일 만들기 | `nmcli connection add type <유형> con-name <이름> [ifname <장치>] <속성> <값> …` | P1 |
| F-04 | 프로파일 편집 | 바뀐 항목만 골라 수정 | `nmcli connection modify uuid <UUID> <속성> <값> …` | P1 |
| F-05 | 적용 (켜기) | 프로파일을 장치에 적용해 접속 | `nmcli -w 30 connection up uuid <UUID> [ifname <장치>]` | P1 |
| F-06 | 해제 (끄기) | 켜진 프로파일의 접속 끊기 | `nmcli connection down uuid <UUID>` | P1 |
| F-07 | 프로파일 삭제 | 확인 후 프로파일 지우기 | `nmcli connection delete uuid <UUID>` | P1 |
| F-08 | 프로파일 복제 | 같은 설정으로 새 이름의 복사본 만들기 | `nmcli connection clone uuid <UUID> <새이름>` | P1 |
| F-09 | 장치 목록 | 생성 폼의 "연결할 장치" 선택지 제공 | `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status` | P1 |
| F-10 | 상태 표시 | NetworkManager가 켜져 있는지, 전체 상태 표시 | `nmcli -t -f STATE,CONNECTIVITY general status` | P1 |
| F-11 | 실행 기록 | 앱이 실행한 명령·결과·시간을 화면과 파일에 기록 (비밀번호는 `***`) | (앱 내부 기능) | P1 |
| F-12 | 설정 다시 읽기 | 파일을 직접 고친 뒤 다시 읽히기 — polkit 방식(일반 사용자)에서는 'access denied'로 거부되어 이번 범위에서 제외 | `nmcli connection reload` | 제외 |
| F-13 | 적용 전 미리보기 | 저장하기 전에 결과 설정 파일 모습 보여 주기 | `nmcli --offline connection add …` | P2 |
| F-14 | 자동 새로고침 | 바깥에서 바뀐 내용을 화면에 자동 반영 | `nmcli monitor` | P3 |
| F-15 | VPN 가져오기/내보내기 | .ovpn 등 VPN 파일 처리 | `nmcli connection import / export` | P3 |

### 4.2 기능별 세부 규칙

- **F-03 생성**: 유형을 먼저 고르면 그 유형에 맞는 칸만 보입니다. IPv4 방식이 `manual` 이면 주소 칸이 필수가 됩니다(비워 두면 nmcli도 "manual은 주소가 필요" 오류로 거부함을 확인). 저장 직후에는 켜지지 않고, "저장 후 바로 적용" 체크 시에만 F-05를 이어서 실행합니다.
- **F-04 편집**: 처음 불러온 값과 비교해 **바뀐 칸만** modify에 넣습니다. 유형(`connection.type`)은 바꿀 수 없음(nmcli가 거부함을 확인). 켜져 있는 프로파일을 저장하면 "저장만 됨 — 지금 적용할까요?" 안내를 띄웁니다.
- **F-05 적용**: nmcli의 기본 대기 시간은 90초라 화면이 너무 오래 멈춥니다. `-w 30` 으로 30초 뒤 시간 초과(종료 코드 3) 처리합니다.
- **F-07 삭제**: 프로파일 이름을 다시 입력해야 삭제 버튼이 눌리게 합니다. 지금 사용 중인 프로파일이면 경고를 한 번 더 보여 줍니다.
- **F-08 복제**: 복사본은 새 UUID를 받으며, 기본 이름은 `<원래이름>-copy` 로 제안합니다.
- **F-13 미리보기 주의**: `--offline` 은 NetworkManager 검사를 일부 건너뜁니다(예: 5자짜리 와이파이 비밀번호처럼 실제로는 거부될 값도 통과함을 확인). 그래서 미리보기는 "참고용"으로만 쓰고, 최종 판단은 실제 add 결과로 합니다.

## 5. 화면 구성

화면은 **목록 → 상세 → 생성/편집 폼** 3단계에, 확인 창과 실행 기록을 더한 구조입니다.

| 화면 | 보이는 것 | 할 수 있는 일 | 관련 기능 |
| --- | --- | --- | --- |
| S-1 목록 (첫 화면) | 위쪽 상태 표시줄(NetworkManager 상태), 프로파일 표: 이름 · 유형(유선) · 장치 · 켜짐 표시 | 새로 만들기, 행 클릭→상세, 행별 켜기/끄기 버튼, 새로고침 | F-01, F-05, F-06, F-10 |
| S-2 상세 | 공통 / IPv4 / IPv6 / 유선 칸으로 나눈 설정값, UUID | 편집, 복제, 삭제, 켜기/끄기 | F-02, F-05\~F-08 |
| S-3 생성·편집 폼 | 유형 선택 → 해당 칸만 표시. IPv4 방식에 따라 주소 칸 표시/숨김 | 입력 검사(빨간 안내), 저장, "저장 후 바로 적용" 체크 | F-03, F-04, F-09 |
| S-4 확인 창 | 삭제·해제·지금 사용 중인 연결 변경 시 경고 문구 | 이름 다시 입력 후 확인 / 취소 | F-06, F-07 |
| S-5 실행 기록 패널 | 시간 · 실행한 명령(비밀번호 `***`) · 결과(성공/실패, 종료 코드, 오류 문구) | 펼치기/접기, 지우기 | F-11 |

입력 검사는 **화면(브라우저)** 과 **서버** 두 곳에서 모두 합니다. 화면 검사는 편의용이고, 진짜 검사는 서버가 합니다.

| 칸 | 검사 규칙 | 틀렸을 때 안내 예시 |
| --- | --- | --- |
| 프로파일 이름 | 1\~64자, 줄바꿈·제어문자 금지 | "이름은 1\~64자로 입력하세요" |
| IPv4 주소 | `0~255.0~255.0~255.0~255/0~32` | "예: 192.168.10.50/24" |
| 게이트웨이 | 올바른 IPv4, 주소와 같은 네트워크 권장 | "게이트웨이가 다른 네트워크에 있어요" (경고만) |
| DNS | IPv4/IPv6 주소, 최대 3개 | "예: 8.8.8.8" |
| MTU | 576\~9000 정수 | "보통 1500을 써요" |

## 6. 백엔드 API 명세

브라우저 화면은 nmcli를 직접 실행할 수 없으므로, 같은 컴퓨터에서 도는 **작은 서버(백엔드)** 가 요청을 받아 nmcli를 대신 실행하고 결과를 JSON으로 돌려줍니다. 모든 주소는 `http://127.0.0.1:<포트>/api/...` 입니다.

| 메서드 | 경로 | 하는 일 | 실행 nmcli | 기능 |
| --- | --- | --- | --- | --- |
| GET | `/api/status` | NetworkManager 상태 | `general status` | F-10 |
| GET | `/api/devices` | 장치 목록 | `device status` | F-09 |
| GET | `/api/connections` | 프로파일 목록 | `connection show` | F-01 |
| GET | `/api/connections/{uuid}` | 프로파일 상세 | `connection show uuid` | F-02 |
| POST | `/api/connections` | 생성 | `connection add` | F-03 |
| PATCH | `/api/connections/{uuid}` | 바뀐 값만 수정 | `connection modify uuid` | F-04 |
| POST | `/api/connections/{uuid}/up` | 적용 | `connection up uuid` | F-05 |
| POST | `/api/connections/{uuid}/down` | 해제 | `connection down uuid` | F-06 |
| DELETE | `/api/connections/{uuid}` | 삭제 | `connection delete uuid` | F-07 |
| POST | `/api/connections/{uuid}/clone` | 복제 | `connection clone uuid` | F-08 |
| GET | `/api/logs` | 실행 기록 | (앱 내부) | F-11 |

**요청 예시 — 생성 (POST /api/connections)**

```json
{
  "type": "ethernet",
  "name": "office-lan",
  "ifname": "eth0",
  "autoconnect": false,
  "ipv4": { "method": "manual", "addresses": ["192.168.10.50/24"], "gateway": "192.168.10.1", "dns": ["8.8.8.8", "1.1.1.1"] },
  "ipv6": { "method": "disabled" },
  "activate": false
}
```

**응답 형식 (모든 API 공통)**

```json
{
  "ok": true,
  "data": { "uuid": "1115a96e-50aa-41b6-87c6-21a42abf2774" },
  "nmcli": { "exitCode": 0, "message": "Connection 'office-lan' (…) successfully added." }
}
```

실패하면 `"ok": false` 와 함께 `exitCode`, nmcli 오류 문구, 사람이 읽기 쉬운 한국어 안내(`hint`)를 돌려줍니다(8장 표 참고).

서버 쪽 처리 순서는 모든 요청이 같습니다: ① 접속 출처 검사(7장) → ② 입력값 검사 → ③ JSON을 nmcli 인자 **배열**로 변환(정해진 속성만 허용) → ④ `LC_ALL=C` 로 nmcli 실행 → ⑤ 종료 코드·출력 해석 → ⑥ 기록 남기고 응답.

### 6.1 기술 스택 (추천)

수업 과제라는 점을 고려해 **설치할 것은 적게, 설명하기는 쉽게** 골랐습니다. 외부 라이브러리는 Express와 zod 두 개뿐입니다.

| 영역 | 추천 | 고른 이유 |
| --- | --- | --- |
| 런타임 | **Node.js 24 LTS** | Rocky 9.8 공식 저장소에 포함. LTS(장기 지원) 버전이라 과제 기간 동안 안정적 ([Node.js 릴리스 표](https://nodejs.org/en/about/previous-releases)) |
| 웹 서버 | **Express 5** (현재 5.3.0) | 예제·자료가 가장 많아 막혔을 때 찾기 쉽고, 발표 때 설명하기 쉬움 |
| 입력 검사 | **zod 4** | "허용된 값만 통과"(S-06, S-07)를 짧은 코드로 표현. 화면과 서버가 같은 규칙을 공유 가능 |
| nmcli 실행 | Node 내장 `child_process.execFile` | 셸을 거치지 않아 명령어 주입 차단(S-05). 추가 설치 없음 |
| 화면 | HTML + CSS + 순수 JavaScript (빌드 도구 없음) | 화면이 5개뿐이라 React 같은 도구는 과함. 외부 CDN 없이 파일만으로 동작(S-10) |
| 테스트 | Node 내장 `node:test` | 추가 설치 없음. nmcli 결과 해석(파서)과 입력 검사를 테스트 |
| 실행 관리 | systemd 서비스 + 전용 사용자 `nmweb` | 부팅 시 자동 실행, polkit 그룹 권한과 연결(7장) |

대안으로 **Fastify**(입력 검사 기능 내장, 더 빠름)도 좋지만, 자료가 Express보다 적어 과제용으로는 Express를 추천합니다.

**폴더 구조 예시**

```text
nm-web/
├── server.js          # Express 시작, 127.0.0.1 바인딩, 보안 검사(S-01~S-04)
├── lib/
│   ├── nmcli.js       # nmcli 실행(execFile) + 결과 해석
│   ├── schema.js      # zod 입력 규칙 (3장 속성만 허용)
│   └── log.js         # 실행 기록(F-11), 비밀값 가리기
├── routes/api.js      # 6장 API 11개
├── public/            # index.html, app.js, style.css
└── test/              # node:test 테스트
```

**핵심 코드 — nmcli 실행과 결과 해석** (테스트 환경에서 일반 사용자 + polkit 규칙으로 실행 확인. 이름에 `; echo HACK` 을 넣어도 명령이 실행되지 않고 글자 그대로 저장됨)

```javascript
import { execFile } from 'node:child_process';

// nmcli를 셸 없이(인자 배열) 실행 — 명령어 주입 방지
export function runNmcli(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile('nmcli', args, { env: { ...process.env, LC_ALL: 'C' }, timeout: timeoutMs },
      (err, stdout, stderr) => {
        const exitCode = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
        resolve({ exitCode, stdout, stderr: stderr.trim() });
      });
  });
}

// -t(terse) 한 줄을 ':' 기준으로 나누되, '\:' 와 '\\' 는 글자로 되돌림
export function splitTerse(line) {
  const out = []; let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; }
    else if (c === ':') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
```

`exitCode` 가 `-1` 이면 시간 초과로 강제 종료된 경우입니다. 이 코드는 `import` 문법을 쓰므로 `package.json` 에 `"type": "module"` 을 넣어야 합니다.

## 7. 보안 요구사항

이 앱은 컴퓨터의 네트워크를 바꿀 수 있는 강한 권한을 다루므로, **"같은 컴퓨터 안에서, 허락된 화면만, 정해진 명령만"** 실행되게 막는 것이 핵심입니다. 127.0.0.1에만 열어도, 내 브라우저에 띄운 **다른 웹사이트**가 몰래 `127.0.0.1` 로 요청을 보낼 수 있어서 아래 S-02\~S-04가 꼭 필요합니다.

| ID | 요구사항 | 막는 위험 | 구현 방법 |
| --- | --- | --- | --- |
| S-01 | 서버는 `127.0.0.1` 에만 연결 대기 (`0.0.0.0` 금지) | 다른 컴퓨터에서 접속 | 바인딩 주소를 코드에 고정, 설정으로 바꿀 수 없게 함 |
| S-02 | `Host` 헤더가 `127.0.0.1:<포트>` 또는 `localhost:<포트>` 일 때만 응답 | DNS 리바인딩 공격(가짜 도메인으로 localhost 접근) | 모든 요청에서 검사, 다르면 403 |
| S-03 | 변경 요청(POST/PATCH/DELETE)은 `Origin` 이 앱 자신일 때만 허용 | 다른 사이트가 몰래 보내는 요청(CSRF) | Origin 검사 + CORS 허용 안 함 |
| S-04 | 시작할 때 만든 무작위 **접속 토큰**이 있어야 API 사용 가능 | 같은 컴퓨터의 다른 프로그램·사이트의 무단 호출 | 터미널에 `http://127.0.0.1:<포트>/?token=…` 출력, 이후 쿠키(`HttpOnly`, `SameSite=Strict`)로 유지 |
| S-05 | **셸을 거치지 않고** 인자 배열로 nmcli 실행 | 명령어 주입 (예: 이름에 `; rm -rf /`) | Node 내장 `child_process.execFile` (6.1 핵심 코드) |
| S-06 | 허용 목록 방식: 정해진 하위 명령·속성 이름만 사용 | 위험한 명령(`networking off` 등) 실행 | 3장 표의 속성만 통과, 나머지는 400 오류 |
| S-07 | 값 검사: UUID는 정해진 형식만, 이름·값이 `-` 로 시작하면 거부 | 값이 옵션으로 잘못 해석됨 | 정규식 검사 (UUID: 8-4-4-4-12 16진수) |
| S-08 | 비밀번호는 화면·기록·응답 어디에도 다시 보여 주지 않음 | 비밀번호 유출 | `-s` 옵션 미사용, 기록에는 `***` |
| S-09 | 모든 변경 작업을 시간·명령·결과와 함께 기록 | 문제가 생겼을 때 원인 추적 | 기록 파일(F-11) |
| S-10 | 화면 파일(HTML/JS/CSS)은 앱 안에 포함, 외부 CDN 미사용 | 외부 스크립트 변조 | 정적 파일 직접 제공 |

### 7.1 권한: polkit 방식 (확정)

백엔드는 root가 아닌 **전용 사용자 `nmweb`** 으로 실행하고, polkit 규칙으로 `nmweb` 그룹에 **연결 관리에 필요한 권한 2개만** 줍니다. 규칙이 없으면 일반 사용자는 프로파일을 만들 수 없습니다(`Insufficient privileges` 확인).

규칙 파일 `/etc/polkit-1/rules.d/50-nmweb.rules`:

```javascript
// nmweb 그룹에게 NetworkManager 연결 관리 권한만 허용
polkit.addRule(function (action, subject) {
    var allowed = [
        "org.freedesktop.NetworkManager.settings.modify.system",
        "org.freedesktop.NetworkManager.network-control"
    ];
    if (allowed.indexOf(action.id) >= 0 && subject.isInGroup("nmweb")) {
        return polkit.Result.YES;
    }
});
```

| 권한 이름 | 허락하는 일 |
| --- | --- |
| `settings.modify.system` | 프로파일 생성·수정·복제·삭제 |
| `network-control` | 프로파일 적용(up)·해제(down) |

**테스트 결과** (일반 사용자 + 위 규칙):

| 명령 | 결과 |
| --- | --- |
| add / modify / clone / delete | 성공 |
| up | 권한은 통과 (테스트 장비에 랜카드가 없어 "장치 없음"으로 끝남) |
| connection reload | 거부 — root 전용 (그래서 F-12 제외) |
| networking off | 거부 — 네트워크 전체 끄기는 의도대로 막힘 |

**Rocky 9.8 설정 순서**

1. 그룹과 사용자 만들기: `sudo groupadd nmweb` → `sudo useradd -r -g nmweb -s /sbin/nologin nmweb`
2. 위 규칙 파일 저장 (polkit이 규칙 폴더를 자동으로 다시 읽음 — 테스트에서 3초 안에 반영됨)
3. 확인: `sudo -u nmweb nmcli general permissions` → `settings.modify.system`, `network-control` 두 줄이 `yes` 이면 성공

테스트는 Ubuntu의 polkit으로 했습니다. Rocky의 polkit도 같은 JavaScript 규칙 형식을 쓰지만, 3번 확인은 Rocky에서 꼭 해 보세요.

## 8. 오류 처리와 안전장치

nmcli는 끝날 때 **종료 코드(숫자)** 를 남깁니다. 앱은 이 숫자를 보고 사용자에게 쉬운 안내를 보여 줍니다. 아래 "직접 확인한 예"는 nmcli 1.46에서 실제로 나온 결과입니다. ([공식 종료 코드 목록](https://networkmanager.dev/docs/api/latest/nmcli.html))

| 코드 | 공식 의미 | 직접 확인한 예 | 화면 안내 (hint) |
| --- | --- | --- | --- |
| 0 | 성공 | add / modify / clone / delete 성공 | "완료했어요" |
| 1 | 알 수 없는 오류 | NetworkManager와 D-Bus가 모두 꺼져 있을 때 `Could not create NMClient object` | "NetworkManager가 실행 중인지 확인하세요" |
| 2 | 잘못된 입력·사용법 | IP `999.1.1.1` 입력, 유형 변경 시도 | "입력값을 확인하세요: (nmcli 문구)" |
| 3 | 시간 초과 | `-w 30` 을 넘긴 적용 | "30초 안에 연결되지 않았어요" |
| 4 | 연결 활성화 실패 | 쓸 수 있는 장치 없음 / manual인데 주소 없음 / 권한 없음(Insufficient privileges) | "적용(또는 저장)에 실패했어요: (nmcli 문구)" |
| 5 | 연결 비활성화 실패 | — | "연결을 끊지 못했어요" |
| 6 | 장치 연결 끊기 실패 | — (앱에서 device disconnect 미사용) | — |
| 7 | 연결 삭제 실패 | — | "삭제하지 못했어요" |
| 8 | NetworkManager 실행 안 됨 | — | "NetworkManager가 꺼져 있어요" |
| 10 | 연결·장치·AP가 없음 | 없는 프로파일 show/delete, 꺼진 프로파일 down | "이미 없거나 꺼져 있는 연결이에요" |

주의: 코드 4는 "활성화 실패"라는 이름이지만, 실제로는 **add가 거부될 때도** 4가 나왔습니다. 또 NetworkManager와 시스템 메시지 버스(D-Bus)가 모두 꺼진 테스트에서는 공식 문서의 8이 아니라 1이 나왔습니다. 그래서 앱은 **숫자 + nmcli 오류 문구를 함께** 보고 판단하고, 원래 문구도 항상 화면에 보여 줍니다.

### 안전장치

- **지금 쓰는 연결 보호**: ACTIVE가 `yes` 인 프로파일을 해제·삭제·IP 변경할 때 "인터넷이 끊길 수 있어요" 경고를 띄웁니다. 이 앱은 localhost에서 돌기 때문에 네트워크가 끊겨도 앱 화면 자체는 계속 쓸 수 있습니다.
- **한 번에 하나씩**: nmcli 명령은 동시에 하나만 실행합니다(대기열). 버튼을 여러 번 눌러도 중복 실행되지 않습니다.
- **시간 제한**: 적용(up)은 `-w 30`, 나머지 명령은 서버에서 15초가 지나면 중단하고 오류로 처리합니다.
- **실행 후 다시 읽기**: 모든 변경 뒤에는 목록·상세를 nmcli로 다시 읽어서 화면이 실제 상태와 같도록 합니다.

## 9. 확정 사항과 다음 단계

2026-11-10에 아래 내용이 확정되어 1\~8장에 반영했습니다.

| 질문 | 결정 | 반영한 곳 |
| --- | --- | --- |
| 리눅스 배포판 | Rocky Linux 9.8 | 1.3 |
| 백엔드 언어 | Node.js (24 LTS + Express 5 + zod 추천) | 6.1 |
| 권한 방식 | polkit 규칙 (전용 사용자 `nmweb`) | 7.1 |
| 와이파이 | 다루지 않음 — 유선만 | 1.2, 3.3, 4, 5 |
| 용도 | 수업 과제, 필수 기능은 4장 P1 그대로 | 1.3 |

### 다음 단계

1. Rocky 9.8 장비에서 확인: `nmcli --version`, Node.js 24 설치(`dnf module list nodejs` 로 스트림 확인), polkit 규칙 적용 후 `nmcli general permissions`
2. 화면 설계(S-1\~S-5) 그림 만들기
3. 백엔드 뼈대: 127.0.0.1 서버 + 보안 검사(S-01\~S-07) + F-01 목록부터 구현
4. 나머지 기능(F-02\~F-11) 순서대로 구현 및 테스트

## 출처

- [nmcli 공식 문서 (networkmanager.dev)](https://networkmanager.dev/docs/api/latest/nmcli.html) — 명령, 옵션, 종료 코드
- [Red Hat: Configuring an Ethernet connection](https://docs.redhat.com/de/documentation/red_hat_enterprise_linux/10/html/configuring_and_managing_networking/configuring-an-ethernet-connection) — modify 후 up으로 적용하는 절차, ipv4/ipv6 속성
- [Red Hat: RHEL 9 네트워킹 변경 사항](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/considerations_in_adopting_rhel_9/assembly_networking_considerations-in-adopting-rhel-9) — 프로파일 저장 위치(keyfile)
- [Rocky Linux 9.8 출시 공지](https://rockylinux.org/news/rocky-linux-9-8-ga-release) — 출시일, Node.js 24 포함
- [Node.js 릴리스 표](https://nodejs.org/en/about/previous-releases) — v24 LTS 상태
- 직접 실행 확인: Ubuntu 24.04 + NetworkManager 1.46.0 + polkit 테스트 환경에서 이 문서의 nmcli 명령·속성·종료 코드, polkit 규칙, Node.js 핵심 코드를 실행해 봄. npm 버전(Express 5.3.0, zod 4.6.7)은 2026-11-10 npm 저장소 기준. 실제 랜카드가 없어 `up` 은 "장치 없음" 실패(코드 4)까지만 확인
