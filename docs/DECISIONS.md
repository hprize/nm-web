# 명세 보충 결정 (2026-11-10 사용자 확인)

SPEC.md에 없거나 애매했던 부분을 아래처럼 정했습니다. 코드는 SPEC + 이 문서를 기준으로 합니다.

| # | 주제 | 결정 |
| --- | --- | --- |
| 1 | 명세 파일 이름 | `docs/SPEC.md.md` → `docs/SPEC.md` |
| 2 | 요청 JSON 키 | `autoconnectPriority`, `ipv4.dnsSearch`, `ipv4.ignoreAutoDns`, `ipv6.addresses/gateway/dns`, `ethernet: { mtu, macAddress, clonedMacAddress }` |
| 3 | 편집(PATCH) 형식 | 화면이 **바뀐 칸만** 생성과 같은 모양으로 보냄. 지우기는 `""` 또는 `[]` → nmcli에 빈 값 `""` |
| 4 | 유선이 아닌 프로파일 | 목록에는 보이되 읽기 전용. 변경 API는 `802-3-ethernet` 만 허용 |
| 5 | "아무 장치나" | 허용하되, 장치 없이 켜기 할 때 화면에서 경고. DEPLOY/체크리스트에 주의 사항 기록 |
| 6 | 저장 후 바로 적용 중 up 실패 | `ok:false` + `data.uuid` 포함, 안내 "저장은 됐지만 적용은 실패" |
| 7 | HTTP 상태 코드 | 입력 오류 400 / 토큰 없음 401 / Host·Origin 403 / nmcli 코드 10 → 404 / 그 밖의 nmcli 실패 500. 본문은 항상 공통 형식 |
| 8 | 확인 창 | 삭제만 이름 다시 입력. 해제는 확인 버튼 + 켜진 연결이면 경고 |
| 9 | DNS | `ipv4.dns` 는 IPv4만, `ipv6.dns` 는 IPv6만, 각각 최대 3개 |
| 10 | 추가 검사 규칙 | IPv6 주소 `node:net` 검사 + 접두사 0~128, MAC `xx:xx:xx:xx:xx:xx`, 우선순위 0~999 (S-07 때문에 음수 `-` 값은 받지 않음), IPv6 manual도 주소 필수 |
| 11 | 비밀값 가리기 | 속성 이름에 `psk / password / secret / 802-1x` 가 들어가면 값 `***` |
| 12 | 기록 파일 위치 | 기본 `logs/nm-web.log`, 환경변수 `LOG_DIR` 로 변경 (Rocky: systemd `LogsDirectory=` → `/var/log/nm-web`) |
| 13 | 조회 명령 기록 | 파일에는 전부. 화면 패널은 기본으로 변경 명령만 보여 주고 "조회도 보기" 선택 가능 |
| 14 | 시간 초과 / nmcli 없음 | 따로 구분 (`timedOut`, `notFound`) 해서 다른 안내 |
| 15 | Origin 없는 변경 요청 | 403 |
| 16 | 토큰 범위 | 정적 파일 포함 모든 요청에 필요. `/?token=…` 으로 오면 쿠키 주고 토큰 없는 `/` 로 이동 |
| 17 | up 의 장치 지정 | 요청 본문 `{ "ifname": "ens224" }` 선택 |
| 18 | 변경 후 응답 | `data` 에 `uuid` 와 다시 읽은 목록 `connections` 를 함께 |
| 19 | KICKOFF.md | git에 올리지 않음 |
