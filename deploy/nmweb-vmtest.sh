#!/bin/bash
# nm-web 배포 + 실제 환경 테스트 (Rocky 9.8 VM, root 로 실행)
# docs/DEPLOY.md 2~5단계 + docs/TEST-CHECKLIST.md 를 자동으로 진행하고 결과를 /root/nm-web-test 에 남깁니다.
# 1번 카드(기본 경로가 있는 카드)는 절대 건드리지 않고, 2번 카드로만 실험합니다.
set -u
export LC_ALL=C
OUT=/root/nm-web-test; mkdir -p "$OUT"
LOG=$OUT/full.log; RES=$OUT/results.tsv; : > "$LOG"; : > "$RES"
REPO=https://github.com/hprize/nm-web.git; APP=/opt/nm-web; PORT=8080; BASE=http://127.0.0.1:$PORT
LOCAL=${NMWEB_LOCAL:-0}   # 1 이면 systemd 없이 직접 켬 (사전 점검용)

say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
res(){ printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RES"; printf '  %-4s %-8s %s\n' "$2" "$1" "$3" | tee -a "$LOG"; }
ok(){ if [ "$3" = 1 ]; then res "$1" PASS "$2"; else res "$1" FAIL "$2"; fi; }
run(){ echo "+ $*" >> "$LOG"; "$@" >> "$LOG" 2>&1; }
t(){ if eval "$1" >> "$LOG" 2>&1; then echo 1; else echo 0; fi; }   # 조건 → 1/0

# ---------- API 호출 도우미 ----------
api(){ # METHOD PATH [JSON]  → CODE, 본문은 $OUT/last.json
  local m=$1 p=$2 d=${3-}
  local a=(-s -m 70 -o "$OUT/last.json" -w '%{http_code}' -X "$m" -H "Cookie: nmweb_token=$TOKEN" -H "Origin: $BASE")
  [ -n "$d" ] && a+=(-H 'Content-Type: application/json' --data "$d")
  CODE=$(curl "${a[@]}" "$BASE$p")
  { echo "> $m $p $d"; echo "< $CODE $(head -c 700 "$OUT/last.json")"; } >> "$LOG"
}
j(){ node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));let v;try{v=(new Function("o","return ("+process.argv[2]+")"))(o)}catch(e){v="ERR"};console.log(typeof v==="object"&&v!==null?JSON.stringify(v):String(v))' "$OUT/last.json" "$1"; }
nm(){ nmcli "$@" 2>>"$LOG"; }
uuid_of(){ nmcli -t -f NAME,UUID connection show | node -e 'const n=process.argv[1];const L=require("fs").readFileSync(0,"utf8").split("\n");for(const l of L){const m=l.match(/^(.*):([0-9a-f-]{36})$/);if(m&&m[1].replace(/\\(.)/g,"$1")===n)console.log(m[2])}' "$1"; }

say "===== nm-web 배포 + 실제 환경 테스트 $(date '+%F %T') ====="

# ---------- 0. 환경과 카드 확인 ----------
REL=$(cat /etc/rocky-release 2>/dev/null || head -1 /etc/os-release)
NMV=$(nmcli --version | awk '{print $NF}')
DEFDEV=${NMWEB_DEFDEV:-$(ip route show default | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')}
TDEV=${NMWEB_TDEV:-$(nmcli -t -f DEVICE,TYPE device status | awk -F: -v d="$DEFDEV" '$2=="ethernet" && $1!=d {print $1; exit}')}
say "OS: $REL / NetworkManager $NMV / 1번 카드(건드리지 않음): ${DEFDEV:-없음} / 2번 카드(실험용): ${TDEV:-없음}"
if [ -z "$TDEV" ] || [ -z "$DEFDEV" ]; then
  say "!! 2번 카드를 찾지 못했어요. VMware 에서 Network Adapter 2 가 연결됐는지 확인하세요."; nmcli device | tee -a "$LOG"; exit 1
fi
MAINUUID=$(nmcli -t -f UUID,DEVICE connection show --active | awk -F: -v d="$DEFDEV" '$2==d{print $1; exit}')
ORIGUUID=$(nmcli -t -f UUID,DEVICE connection show --active | awk -F: -v d="$TDEV" '$2==d{print $1; exit}')
MAINIP=$(ip -4 -o addr show dev "$DEFDEV" | awk '{split($4,a,"/"); print a[1]; exit}')
MAIN_BEFORE=$(nmcli -g ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns connection show uuid "$MAINUUID" 2>/dev/null)
CIDR=$(ip -4 -o addr show dev "$TDEV" | awk '{print $4; exit}')
NET=$(echo "${CIDR%/*}" | cut -d. -f1-3); [ -z "$CIDR" ] && NET=192.168.250
TIP=$NET.70/24; TGW=$NET.1
say "2번 카드 대역: ${CIDR:-주소 없음} → 실험용 고정 IP $TIP"

# ---------- 1. 배포 (DEPLOY.md 2~4단계) ----------
say "== 배포 =="
if [ "$LOCAL" != 1 ]; then
  if ! node -v 2>/dev/null | grep -q '^v2[4-9]'; then
    run dnf -y module list nodejs
    run dnf -y module reset nodejs
    run dnf -y module enable nodejs:24
    run dnf -y install nodejs npm git || run dnf -y install nodejs git
  fi
  command -v git >/dev/null || run dnf -y install git
fi
NODEV=$(node -v 2>/dev/null)
ok D-node "Node.js $NODEV (24 이상)" "$(t 'node -v | grep -q "^v2[4-9]"')"
getent group nmweb >/dev/null || run groupadd nmweb
id nmweb >/dev/null 2>&1 || run useradd -r -g nmweb -s /sbin/nologin nmweb
ok D-user "nmweb 사용자·그룹" "$(t 'id nmweb | grep -q "(nmweb)"')"
if [ "$LOCAL" != 1 ]; then
  if [ -d "$APP/.git" ]; then run git -C "$APP" pull --ff-only; else run git clone "$REPO" "$APP"; fi
fi
COMMIT=$(git -C "$APP" log -1 --format='%h' 2>/dev/null)
ok D-clone "코드 받기 $APP (커밋 $COMMIT)" "$(t "[ -f $APP/server.js ]")"
( cd "$APP" && run npm ci --no-audit --no-fund )
ok D-npmci "npm ci (express·zod 설치)" "$(t "[ -d $APP/node_modules/express ] && [ -d $APP/node_modules/zod ]")"
( cd "$APP" && node --test --test-reporter=tap > "$OUT/npm-test.log" 2>&1 )
TP=$(grep -E '^# pass ' "$OUT/npm-test.log" | awk '{print $3}'); TF=$(grep -E '^# fail ' "$OUT/npm-test.log" | awk '{print $3}')
ok D-test "npm test: pass ${TP:-?} / fail ${TF:-?}" "$(t "[ '${TF:-x}' = 0 ] && [ '${TP:-0}' -gt 0 ]")"
run install -m 644 "$APP/deploy/50-nmweb.rules" /etc/polkit-1/rules.d/50-nmweb.rules
command -v restorecon >/dev/null && run restorecon -v /etc/polkit-1/rules.d/50-nmweb.rules
sleep 4
runuser -u nmweb -- nmcli -t general permissions > "$OUT/permissions.txt" 2>&1
ok D-polkit "polkit 권한 2개 yes (settings.modify.system, network-control)" \
  "$(t "grep -q 'settings.modify.system:yes' $OUT/permissions.txt && grep -q 'NetworkManager.network-control:yes' $OUT/permissions.txt")"
ok D-polkit2 "그 밖의 위험 권한은 yes 아님 (enable-disable-network 등)" \
  "$(t "! grep -qE 'enable-disable-network:yes|settings.modify.hostname:yes|settings.modify.global-dns:yes' $OUT/permissions.txt")"

if [ "$LOCAL" != 1 ]; then
  run install -m 644 "$APP/deploy/nm-web.service" /etc/systemd/system/nm-web.service
  VERIFY=$(systemd-analyze verify /etc/systemd/system/nm-web.service 2>&1); echo "verify: $VERIFY" >> "$LOG"
  ok D-verify "서비스 파일 검사 (출력 없음)" "$(t "[ -z \"\$VERIFY\" ]")"
  SINCE=$(date '+%F %T')
  run systemctl daemon-reload; run systemctl enable nm-web; run systemctl restart nm-web
  for i in $(seq 1 15); do
    TOKEN=$(journalctl -u nm-web --since "$SINCE" --no-pager -o cat | grep -o 'token=[A-Za-z0-9_-]*' | tail -1 | cut -d= -f2)
    [ -n "$TOKEN" ] && break; sleep 1
  done
  ok D-service "서비스 active (running)" "$(t 'systemctl is-active --quiet nm-web')"
else
  pkill -f "node $APP/server.js" 2>/dev/null; sleep 2; : > "$OUT/server.out"
  runuser -u nmweb -- env PORT=$PORT LOG_DIR=/tmp/nm-web-applog node "$APP/server.js" > "$OUT/server.out" 2>&1 &
  for i in $(seq 1 15); do
    TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' "$OUT/server.out" | tail -1 | cut -d= -f2)
    [ -n "$TOKEN" ] && break; sleep 1
  done
fi
LPID=$(ss -ltnpH "sport = :$PORT" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
PUSER=$(ps -o user= -p "${LPID:-1}" | tr -d ' ')
ok D-user2 "8080 을 연 프로세스의 사용자: $PUSER (nmweb 기대, root 아님)" "$(t "[ '$PUSER' = nmweb ]")"
ok D-token "접속 토큰 확인" "$(t "[ \${#TOKEN} -ge 32 ]")"
if [ -z "${TOKEN:-}" ]; then say "!! 서버가 켜지지 않았어요. journalctl -u nm-web -n 50 을 확인하세요."; tail -20 "$LOG"; exit 1; fi

# 지난번 실행에서 남은 실험 프로파일 정리
for n in lab-lan lab-lan-copy lab-bad 'my:lan; echo HACK' 'probe$(touch /tmp/nmweb_pwned)`touch /tmp/nmweb_pwned2`'; do
  for u in $(uuid_of "$n"); do nmcli connection delete uuid "$u" >> "$LOG" 2>&1; done
done
rm -f /tmp/nmweb_pwned /tmp/nmweb_pwned2

# ---------- 2. 기능 (F-01 ~ F-11) ----------
say "== 기능 =="
api GET /api/status
ok F-10 "상태: $(j 'o.data.state+" / "+o.data.connectivity')" "$(t "[ $CODE = 200 ] && [ \"\$(j 'o.ok&&o.data.running')\" = true ]")"

api GET /api/connections
A=$(j 'o.data.connections.map(c=>c.uuid).sort().join(",")'); B=$(nmcli -t -f UUID connection show | sort | paste -sd,)
ok F-01 "목록이 nmcli 와 같음 ($(j 'o.data.connections.length')개)" "$(t "[ $CODE = 200 ] && [ '$A' = '$B' ]")"
ok F-01b "유선은 '유선', 기본 카드 프로파일 켜짐 표시" "$(t "[ \"\$(j 'o.data.connections.find(c=>c.uuid===\"$MAINUUID\").typeLabel+o.data.connections.find(c=>c.uuid===\"$MAINUUID\").active')\" = 유선true ]")"
LOUUID=$(nmcli -t -f UUID,TYPE connection show | awk -F: '$2=="loopback"{print $1; exit}')

api GET "/api/connections/$MAINUUID"
M1=$(j 'o.data.connection.ipv4.method'); M2=$(nm -g ipv4.method connection show uuid "$MAINUUID")
G1=$(j 'o.data.connection.ipv4.gateway'); G2=$(nm -g ipv4.gateway connection show uuid "$MAINUUID")
MT=$(j 'o.data.connection.ethernet.mtu'); MT2=$(nm -g 802-3-ethernet.mtu connection show uuid "$MAINUUID")
ok F-02 "1번 카드 상세 = nmcli (method $M1, gateway '${G1}', mtu $MT/$MT2)" \
  "$(t "[ $CODE = 200 ] && [ '$M1' = '$M2' ] && [ '$G1' = '$G2' ] && [ '$G1' != '--' ]")"
ok F-02m "MTU 비어 있으면 자동(null) 으로" "$(t "[ '$MT2' != auto ] || [ '$MT' = null ]")"
if [ -n "$LOUUID" ]; then
  api GET "/api/connections/$LOUUID"
  ok F-02lo "lo 상세: 오류 없이 열림, 보기 전용 (ipv6 $(j 'o.data.connection.ipv6.addresses'))" \
    "$(t "[ $CODE = 200 ] && [ \"\$(j 'o.data.connection.editable')\" = false ]")"
  api DELETE "/api/connections/$LOUUID"
  ok F-02lo2 "lo 삭제 요청은 거부 (NOT_EDITABLE)" "$(t "[ $CODE = 400 ] && [ \"\$(j 'o.error')\" = NOT_EDITABLE ] && nmcli connection show uuid $LOUUID >/dev/null")"
else res F-02lo SKIP "lo 프로파일 없음"; fi

api GET /api/devices
ok F-09 "장치 목록에 $DEFDEV, $TDEV" "$(t "[ $CODE = 200 ] && [ \"\$(j 'o.data.devices.some(d=>d.device===\"$TDEV\")&&o.data.devices.some(d=>d.device===\"$DEFDEV\")')\" = true ]")"

api POST /api/connections "{\"type\":\"ethernet\",\"name\":\"lab-bad\",\"ifname\":\"$TDEV\",\"ipv4\":{\"method\":\"manual\",\"addresses\":[]}}"
ok F-03v "수동인데 주소 없음 → 400, 저장 안 됨 ($(j 'o.fields&&o.fields[0]&&o.fields[0].message'))" \
  "$(t "[ $CODE = 400 ] && [ -z \"\$(uuid_of lab-bad)\" ]")"

api POST /api/connections "{\"type\":\"ethernet\",\"name\":\"lab-lan\",\"ifname\":\"$TDEV\",\"autoconnect\":false,\"ipv4\":{\"method\":\"manual\",\"addresses\":[\"$TIP\"],\"dns\":[\"8.8.8.8\"]},\"ipv6\":{\"method\":\"disabled\"},\"activate\":false}"
LAB=$(j 'o.data&&o.data.uuid'); V=$(nm -g connection.id,connection.interface-name,ipv4.addresses,ipv4.dns,connection.autoconnect,ipv6.method connection show uuid "$LAB" | paste -sd'|')
ok F-03 "생성 lab-lan (켜지 않음): $V" "$(t "[ $CODE = 200 ] && [ '$V' = 'lab-lan|$TDEV|$TIP|8.8.8.8|no|disabled' ] && [ \"\$(j 'o.data.activated')\" = false ]")"

api POST /api/connections "{\"type\":\"ethernet\",\"name\":\"my:lan; echo HACK\",\"ifname\":\"$TDEV\",\"autoconnect\":false}"
W1=$(j 'o.data&&o.data.uuid'); WN=$(nm -g connection.id connection show uuid "$W1")
ok F-03n "이상한 이름이 글자 그대로 저장: '$WN'" "$(t "[ $CODE = 200 ] && [ '$WN' = 'my\\:lan; echo HACK' -o '$WN' = 'my:lan; echo HACK' ]")"
api POST /api/connections "{\"type\":\"ethernet\",\"name\":\"probe\$(touch /tmp/nmweb_pwned)\`touch /tmp/nmweb_pwned2\`\",\"ifname\":\"$TDEV\",\"autoconnect\":false}"
W2=$(j 'o.data&&o.data.uuid')
ok S-05 "명령어 주입 시도 이름 → 명령 실행 안 됨 (/tmp/nmweb_pwned 없음)" "$(t "[ ! -e /tmp/nmweb_pwned ] && [ ! -e /tmp/nmweb_pwned2 ]")"

api POST "/api/connections/$LAB/up" '{}'
sleep 2; ADDR=$(ip -4 -o addr show dev "$TDEV" | awk '{print $4}' | paste -sd,)
ok F-05 "켜기 → $TDEV 주소: $ADDR (exit $(j 'o.nmcli&&o.nmcli.exitCode'))" "$(t "[ $CODE = 200 ] && echo '$ADDR' | grep -q '${TIP}'")"
ok F-05b "목록에서 켜짐 표시" "$(t "[ \"\$(j 'o.data.connections.find(c=>c.uuid===\"$LAB\").active')\" = true ]")"

api PATCH "/api/connections/$LAB" '{"ipv4":{"dns":["1.1.1.1"]}}'
SAVED=$(nm -g ipv4.dns connection show uuid "$LAB")
ok F-04 "켜진 연결 편집 → 저장만 됨, needsReapply=$(j 'o.data.needsReapply') ($(j 'o.hint'))" "$(t "[ $CODE = 200 ] && [ \"\$(j 'o.data.needsReapply')\" = true ] && [ '$SAVED' = 1.1.1.1 ]")"
api POST "/api/connections/$LAB/up" '{}'
sleep 2; LIVE=$(nmcli -g IP4.DNS device show "$TDEV" | paste -sd,)
ok F-04a "지금 적용 → 장치에 DNS $LIVE 반영" "$(t "[ $CODE = 200 ] && echo '$LIVE' | grep -q 1.1.1.1")"
api PATCH "/api/connections/$LAB" '{"type":"ethernet"}'
ok F-04t "유형 변경 요청 → 400 거부" "$(t "[ $CODE = 400 ]")"

api PATCH "/api/connections/$LAB" "{\"ipv4\":{\"gateway\":\"$TGW\"},\"ethernet\":{\"mtu\":1400}}"
V=$(nm -g ipv4.gateway,802-3-ethernet.mtu connection show uuid "$LAB" | paste -sd'|')
ok F-04g "게이트웨이·MTU 저장: $V" "$(t "[ $CODE = 200 ] && [ '$V' = '$TGW|1400' ]")"
api PATCH "/api/connections/$LAB" '{"ipv4":{"gateway":""},"ethernet":{"mtu":null}}'
V=$(nm -g ipv4.gateway,802-3-ethernet.mtu connection show uuid "$LAB" | paste -sd'|')
api GET "/api/connections/$LAB"
D=$(j '"gw="+o.data.connection.ipv4.gateway+" mtu="+o.data.connection.ethernet.mtu')
ok F-04c "비우고 저장 → 게이트웨이 지워짐·MTU 자동 (nmcli '$V', 화면 $D)" "$(t "[ '$V' = '|auto' ] && [ '$D' = 'gw= mtu=null' ]")"

api POST "/api/connections/$LAB/down" '{}'
sleep 2; ADDR=$(ip -4 -o addr show dev "$TDEV" | awk '{print $4}' | paste -sd,)
ok F-06 "끄기 → $TDEV 에서 $TIP 사라짐 (지금: ${ADDR:-없음})" "$(t "[ $CODE = 200 ] && ! echo '$ADDR' | grep -q '${TIP}'")"
res F-05x SKIP "시간 초과/실패 (VMware 카드 연결 해제 필요) — 수동 확인"

api POST "/api/connections/$LAB/clone" '{}'
CL=$(j 'o.data&&o.data.uuid'); CN=$(nm -g connection.id connection show uuid "$CL")
SAME=$(t "[ \"\$(nmcli -g ipv4.addresses,ipv4.dns connection show uuid $CL)\" = \"\$(nmcli -g ipv4.addresses,ipv4.dns connection show uuid $LAB)\" ]")
ok F-08 "복제 → '$CN', 새 UUID, 설정 같음" "$(t "[ $CODE = 200 ] && [ '$CN' = lab-lan-copy ] && [ '$CL' != '$LAB' ] && [ $SAME = 1 ]")"
api DELETE "/api/connections/$CL"
ok F-07 "복제본 삭제 → nmcli 에서 사라짐" "$(t "[ $CODE = 200 ] && ! nmcli connection show uuid $CL >/dev/null 2>&1")"
api DELETE /api/connections/00000000-0000-4000-8000-000000000000
ok F-07x "없는 UUID 삭제 → 404, 코드 $(j 'o.nmcli&&o.nmcli.exitCode') ($(j 'o.hint'))" "$(t "[ $CODE = 404 ] && [ \"\$(j 'o.nmcli.exitCode')\" = 10 ]")"
api GET /api/connections/not-a-uuid
ok S-07 "UUID 형식이 아니면 400" "$(t "[ $CODE = 400 ]")"
api POST /api/connections '{"type":"ethernet","name":"-bad"}'
ok S-07b "이름이 '-' 로 시작 → 400" "$(t "[ $CODE = 400 ]")"
api POST /api/connections '{"type":"ethernet","name":"x1","foo":1}'
ok S-06 "모르는 항목(foo) → 400" "$(t "[ $CODE = 400 ] && [ -z \"\$(uuid_of x1)\" ]")"

api GET '/api/logs?all=1'
ok F-11 "실행 기록 $(j 'o.data.logs.length')개, 변경 명령 포함" "$(t "[ $CODE = 200 ] && [ \"\$(j '[\"add\",\"modify\",\"up\",\"down\",\"delete\",\"clone\"].every(k=>o.data.logs.some(l=>l.args.includes(k)))')\" = true ]")"
BADCMD=$(j 'o.data.logs.map(l=>l.args.filter(a=>!/^-/.test(a)||a==="-s").slice(0,0)).length>=0 && o.data.logs.filter(l=>{const a=l.args.filter((x,i)=>!(x==="-t"||x==="-f"||x==="-g"||x==="-w"||(i>0&&["-f","-g","-w"].includes(l.args[i-1]))));const s=a.slice(0,2).join(" ");return !(/^connection (show|add|modify|up|down|delete|clone)$/.test(s)||s==="device status"||s==="general status")}).map(l=>l.command).join(" | ")')
ok S-06b "기록된 명령이 모두 허용 목록 안 ${BADCMD:+(밖: $BADCMD)}" "$(t "[ -z '$BADCMD' ]")"
ok S-08 "-s/--show-secrets 옵션 사용 없음" "$(t "[ \"\$(j 'o.data.logs.some(l=>l.args.includes(\"-s\")||l.args.includes(\"--show-secrets\"))')\" = false ]")"
LF=$(ls /var/log/nm-web/*.log /tmp/nm-web-applog/*.log 2>/dev/null | head -1)
ok F-11f "기록 파일 $LF: 한 줄에 JSON 하나" "$(t "[ -n '$LF' ] && tail -n 5 '$LF' | node -e 'require(\"fs\").readFileSync(0,\"utf8\").trim().split(\"\n\").forEach(l=>JSON.parse(l))'")"

# 정리: 실험 프로파일을 앱으로 지우기
for u in "$LAB" "$W1" "$W2"; do [ -n "$u" ] && [ "$u" != null ] && api DELETE "/api/connections/$u"; done
ok F-07c "실험 프로파일 정리 (lab-lan 등 삭제)" "$(t "[ -z \"\$(uuid_of lab-lan)\" ] && [ -z \"\$(uuid_of 'my:lan; echo HACK')\" ]")"

# ---------- 3. 보안 (S-01 ~ S-10) ----------
say "== 보안 =="
L=$(ss -ltnH "sport = :$PORT" | awk '{print $4}' | paste -sd,)
ok S-01 "8080 은 127.0.0.1 에서만 대기: $L" "$(t "[ '$L' = '127.0.0.1:$PORT' ]")"
curl -s -m 5 -o /dev/null "http://$MAINIP:$PORT/"; RC=$?
ok S-01b "VM 바깥 주소 $MAINIP:$PORT 로는 접속 안 됨 (curl 코드 $RC)" "$(t "[ $RC -ne 0 ]")"
C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
ok S-04 "토큰 없이 접속 → $C (401 기대)" "$(t "[ $C = 401 ]")"
C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/?token=wrongtoken")
ok S-04b "틀린 토큰 → $C (401 기대)" "$(t "[ $C = 401 ]")"
H=$(curl -s -D - -o /dev/null "$BASE/?token=$TOKEN" | tr -d '\r')
ok S-04c "맞는 토큰 → 303 + HttpOnly·SameSite=Strict 쿠키" "$(t "echo \"\$H\" | grep -q '^HTTP/1.1 303' && echo \"\$H\" | grep -i '^set-cookie:' | grep -qi httponly && echo \"\$H\" | grep -i '^set-cookie:' | grep -qi 'samesite=strict'")"
C=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example.com' -H "Cookie: nmweb_token=$TOKEN" "$BASE/")
ok S-02 "가짜 Host → $C (403 기대)" "$(t "[ $C = 403 ]")"
C=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: 127.0.0.1:9090' -H "Cookie: nmweb_token=$TOKEN" "$BASE/")
ok S-02b "다른 포트 Host(9090) → $C (403 기대)" "$(t "[ $C = 403 ]")"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Cookie: nmweb_token=$TOKEN" -H 'Origin: http://evil.example.com' -H 'Content-Type: application/json' -d '{}' "$BASE/api/connections")
ok S-03 "다른 Origin 의 변경 요청 → $C (403 기대)" "$(t "[ $C = 403 ]")"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Cookie: nmweb_token=$TOKEN" -H 'Content-Type: application/json' -d '{}' "$BASE/api/connections")
ok S-03b "Origin 없는 변경 요청 → $C (403 기대)" "$(t "[ $C = 403 ]")"
H=$(curl -s -D - -o "$OUT/index.html" -H "Cookie: nmweb_token=$TOKEN" "$BASE/" | tr -d '\r')
EXT=$(grep -oiE '(src|href)="https?://[^"]*' "$OUT/index.html" | head -3 | paste -sd' ')
ok S-10 "화면이 외부 파일을 쓰지 않음 + CSP default-src 'self' ${EXT:+(외부: $EXT)}" "$(t "[ -z '$EXT' ] && echo \"\$H\" | grep -qi \"content-security-policy: default-src 'self'\"")"

# ---------- 4. 뒷정리와 1번 카드 확인 ----------
[ -n "$ORIGUUID" ] && nmcli connection up uuid "$ORIGUUID" >> "$LOG" 2>&1
MAIN_AFTER=$(nmcli -g ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns connection show uuid "$MAINUUID" 2>/dev/null)
DEF_AFTER=${NMWEB_DEFDEV:-$(ip route show default | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')}
ok Z-main "1번 카드 프로파일·기본 경로 그대로 ($DEF_AFTER)" "$(t "[ \"\$MAIN_BEFORE\" = \"\$MAIN_AFTER\" ] && [ '$DEF_AFTER' = '$DEFDEV' ]")"

# ---------- 요약 ----------
P=$(grep -c $'\tPASS\t' "$RES"); F=$(grep -c $'\tFAIL\t' "$RES"); S=$(grep -c $'\tSKIP\t' "$RES")
{
echo
echo "================ 결과 요약 ================"
echo "$REL | NM $NMV | node $NODEV | 커밋 $COMMIT"
echo "1번 카드 $DEFDEV (그대로) | 2번 카드 $TDEV ($TIP)"
echo "PASS $P   FAIL $F   SKIP $S"
if [ "$F" -gt 0 ]; then echo "--- FAIL ---"; grep $'\tFAIL\t' "$RES" | awk -F'\t' '{print $1": "$3}'; fi
echo "전체 기록: $OUT/full.log  결과표: $OUT/results.tsv"
echo "브라우저 주소: $BASE/?token=$TOKEN"
echo "==========================================="
} | tee -a "$LOG"
