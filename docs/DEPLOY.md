# Rocky Linux 9.8 배포 안내 (VMware 가상머신)

맥에서 만든 nm-web을 Windows의 VMware 가상머신(Rocky Linux 9.8)에서 실제 nmcli로 실행하는 순서입니다.
명령은 **위에서부터 한 줄씩** 따라 하세요. `$` 는 입력하지 않습니다.

> ⚠️ 실험은 **테스트용 2번 네트워크 카드**로만 합니다. 1번 카드(평소 인터넷·SSH에 쓰는 카드)의 프로파일은 건드리지 마세요.

| 단계 | 하는 일 | 걸리는 시간 |
| --- | --- | --- |
| 1 | VMware에 2번 카드(Host-only) 달기 | 5분 |
| 2 | nmcli 버전 확인, Node.js 24·git 설치 | 5분 |
| 3 | 전용 사용자 `nmweb` + polkit 권한 규칙 | 5분 |
| 4 | 코드 받기 → `npm ci` → 테스트 → 서비스 등록 | 5분 |
| 5 | 브라우저로 접속 | 2분 |

---

## 1. VMware에 테스트용 2번 네트워크 카드 달기

1. VMware에서 가상머신을 **끕니다** (Power Off).
2. **VM → Settings → Add… → Network Adapter → Finish**.
3. 새로 생긴 Network Adapter 를 고르고 **Host-only** 를 선택 → OK.
4. 가상머신을 켜고 로그인합니다.

장치 이름 확인:

```bash
$ nmcli device
```

| 보이는 예 | 뜻 |
| --- | --- |
| `ens160  ethernet  connected  ens160` | 1번 카드 — **건드리지 않기** |
| `ens224  ethernet  connected  Wired connection 1` 또는 `disconnected` | 2번 카드 — **실험용** (이름은 `ens224`, `ens256` 등 다를 수 있음) |

2번 카드가 쓰는 주소 대역 확인 (고정 IP 실험 때 같은 대역을 씀):

```bash
$ ip -4 addr show ens224      # 예: inet 192.168.56.128/24 → 대역은 192.168.56.0/24
```

> 2번 카드에 NetworkManager가 자동으로 만든 `Wired connection 1` 이 붙어 있을 수 있어요. 실험용이라 지우거나 꺼도 괜찮습니다.

---

## 2. 버전 확인, Node.js 24·git 설치

```bash
$ nmcli --version                 # NetworkManager 버전 (명세는 1.46에서 확인함 — 숫자를 적어 두세요)
$ cat /etc/rocky-release          # Rocky Linux release 9.8 인지 확인
$ dnf module list nodejs          # 쓸 수 있는 Node.js 버전(스트림) 목록
```

목록에 `24` 가 보이면:

```bash
$ sudo dnf module reset -y nodejs          # 이전에 고른 버전이 있으면 초기화
$ sudo dnf module enable -y nodejs:24      # 24 버전 고르기
$ sudo dnf install -y nodejs git           # Node.js 와 git 설치
$ node -v                                  # v24.x.x 이면 성공
```

> 목록에 `24` 가 없으면 `dnf search nodejs` 결과를 알려 주세요. 다른 설치 방법을 정해야 합니다.

---

## 3. 전용 사용자 `nmweb` 과 polkit 권한 (SPEC 7.1)

앱은 root가 아닌 `nmweb` 사용자로 돌고, polkit 규칙으로 **연결 관리 권한 2개만** 받습니다.

```bash
$ sudo groupadd nmweb                                   # nmweb 그룹 만들기
$ sudo useradd -r -g nmweb -s /sbin/nologin nmweb       # 로그인할 수 없는 시스템 사용자 만들기
```

규칙 파일은 4단계에서 코드를 받은 뒤 복사합니다 (아래 4-2).

---

## 4. 코드 받기 → 설치 → 테스트 → 서비스 등록

### 4-1. 코드 받기 (`/opt/nm-web`)

앱 파일은 root 소유로 두고 `nmweb` 은 읽기만 합니다 (앱이 자기 코드를 바꿀 수 없게).

```bash
$ sudo git clone https://github.com/hprize/nm-web.git /opt/nm-web     # 맥에서 git push 한 저장소
$ cd /opt/nm-web
$ sudo npm ci                                   # package-lock.json 그대로 express·zod 설치
$ npm test                                      # 가짜 nmcli 로 하는 전체 테스트 — 모두 pass 여야 함
```

### 4-2. polkit 규칙 넣기와 확인

```bash
$ sudo install -m 644 deploy/50-nmweb.rules /etc/polkit-1/rules.d/50-nmweb.rules   # 규칙 복사
$ sudo restorecon -v /etc/polkit-1/rules.d/50-nmweb.rules                          # SELinux 이름표 맞추기
$ sleep 3                                                                          # polkit 이 규칙을 다시 읽을 시간
$ sudo -u nmweb nmcli general permissions                                          # 권한 확인
```

아래 두 줄이 `yes` 이면 성공입니다 (나머지는 `no` 또는 `auth` 여도 됩니다).

```text
org.freedesktop.NetworkManager.network-control           yes
org.freedesktop.NetworkManager.settings.modify.system    yes
```

### 4-3. 서비스 등록과 시작

```bash
$ sudo install -m 644 deploy/nm-web.service /etc/systemd/system/nm-web.service   # 서비스 파일 복사
$ sudo systemd-analyze verify /etc/systemd/system/nm-web.service                 # 서비스 파일 검사 (아무것도 안 나오면 정상)
$ sudo systemctl daemon-reload                     # systemd 가 새 파일을 읽게
$ sudo systemctl enable --now nm-web               # 지금 켜고, 부팅할 때도 자동으로 켜기
$ systemctl status nm-web --no-pager               # active (running) 이면 성공
$ ss -ltnp | grep 8080                             # 127.0.0.1:8080 만 보여야 함 (0.0.0.0 이면 안 됨)
```

---

## 5. 브라우저로 접속

서버는 켜질 때마다 **새 접속 토큰**을 만들어 기록(journal)에 적습니다.

```bash
$ sudo journalctl -u nm-web -n 20 --no-pager | grep token
#  http://127.0.0.1:8080/?token=xxxxxxxx…   ← 이 주소 전체를 복사
```

### 방법 A — 가상머신 안의 Firefox (GUI가 있을 때)

가상머신 안에서 Firefox를 열고 위 주소를 붙여 넣습니다.

### 방법 B — Windows 에서 SSH 터널로

Windows PowerShell:

```powershell
ssh -L 8080:127.0.0.1:8080 <사용자>@<가상머신 IP>
```

이 창을 열어 둔 채로 Windows 브라우저에서 `http://127.0.0.1:8080/?token=…` 을 엽니다.

> 왼쪽 포트(내 컴퓨터 쪽)도 **꼭 8080** 이어야 합니다. 다른 번호(예: 9090)로 열면 보안 검사(Host 확인, S-02)에 걸려 403 이 납니다.
> `http://<가상머신 IP>:8080` 으로는 접속되지 않는 것이 **정상**입니다 (127.0.0.1 전용, S-01).

---

## 6. 업데이트·멈추기·되돌리기

| 하고 싶은 일 | 명령 |
| --- | --- |
| 맥에서 고친 코드 반영 | `cd /opt/nm-web && sudo git pull && sudo npm ci && sudo systemctl restart nm-web` |
| 새 토큰 주소 보기 (재시작 후) | `sudo journalctl -u nm-web -n 20 --no-pager \| grep token` |
| 실행 기록 파일 보기 | `sudo tail -n 20 /var/log/nm-web/nm-web.log` |
| 잠깐 멈추기 | `sudo systemctl stop nm-web` |
| 완전히 지우기 | `sudo systemctl disable --now nm-web && sudo rm /etc/systemd/system/nm-web.service /etc/polkit-1/rules.d/50-nmweb.rules && sudo systemctl daemon-reload` |

---

## 7. 문제가 생기면

| 증상 | 원인과 해결 |
| --- | --- |
| 화면에 "접속 토큰이 없어요" (401) | 서버가 다시 켜져 토큰이 바뀜 → 5번의 `journalctl` 로 새 주소 확인 |
| "허용되지 않은 주소(Host)" (403) | `localhost:8080` 또는 `127.0.0.1:8080` 으로만 접속. SSH 터널 포트를 8080 으로 |
| "권한이 없어요. polkit 규칙…" | 4-2 다시 확인. `sudo -u nmweb nmcli general permissions` 에서 두 줄이 `yes` 인지 |
| "NetworkManager가 꺼져 있어요" | `systemctl status NetworkManager` |
| 서비스가 안 켜짐 | `sudo journalctl -u nm-web -n 50 --no-pager` 로 오류 확인 (예: `node` 위치가 `/usr/bin/node` 가 아님 → `which node`) |
| "nmcli 프로그램을 찾을 수 없어요" | `which nmcli` 확인 (보통 `/usr/bin/nmcli`) |
