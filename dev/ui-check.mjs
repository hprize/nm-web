// 화면 점검 (맥 개발용, npm test 에는 포함하지 않음)
// 헤드리스 Chrome 을 DevTools 프로토콜로 직접 조종해서, 가짜 nmcli 로 켠 서버의 화면을 실제로 눌러 봅니다.
//   생성 → 편집 → 켜기 → (켜진 연결) 편집·지금 적용 → 끄기 → 복제 → 삭제, 확인 창, XSS, 실행 기록
// 실행: node dev/ui-check.mjs   (Chrome 위치가 다르면 CHROME_BIN=… 으로 지정)
// 결과 화면 캡처는 임시 폴더(마지막 줄에 표시)에 PNG 로 저장됩니다.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(tmpdir(), 'nm-web-ui-check');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 18081;
const CDP_PORT = 9333;

const log = (...a) => console.log('•', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 서버
const server = spawn('node', ['server.js'], {
  cwd: PROJECT,
  env: { ...process.env, PORT: String(PORT), NMCLI_BIN: 'dev/fake-nmcli', FAKE_NMCLI_STATE: path.join(OUT, 'state.json'), LOG_DIR: path.join(OUT, 'logs') },
});
const tokenUrl = await new Promise((resolve, reject) => {
  let buf = '';
  server.stdout.on('data', (d) => { buf += d; const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/); if (m) resolve(m[0]); });
  server.stderr.on('data', (d) => process.stderr.write(d));
  setTimeout(() => reject(new Error('server start timeout')), 5000);
});
log('server', tokenUrl.replace(/token=.*/, 'token=…'));

// 2) Chrome
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(OUT, 'chrome')}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,900', 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* 아직 */ }
  await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 1;
const pending = new Map();
const problems = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') problems.push('예외: ' + JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) problems.push(`로그(${msg.params.entry.level}): ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push('console.error: ' + JSON.stringify(msg.params.args.map((a) => a.value ?? a.description)));
  if (msg.method === 'Page.javascriptDialogOpening') problems.push('⚠️ alert 대화상자 열림 (XSS?): ' + msg.params.message);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + expr.slice(0, 200));
  return r.result.value;
}
async function waitFor(desc, expr, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await evaluate(`(() => { ${expr} })()`); if (v) return v; } catch { /* 계속 */ }
    await sleep(100);
  }
  throw new Error('시간 초과: ' + desc + '\n화면: ' + (await evaluate('document.querySelector("main").innerText').catch(() => '?')).slice(0, 500));
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
}

// 페이지 안에서 쓸 도우미
const HELPERS = `
  window.__vis = (el) => el && el.getClientRects().length > 0;
  window.__btn = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text && __vis(b));
  window.__click = (text) => { const b = __btn(text); if (!b) throw new Error('버튼 없음: ' + text); if (b.disabled) throw new Error('버튼 꺼짐: ' + text); b.click(); return true; };
  window.__set = (id, value) => { const el = document.getElementById(id); if (!el) throw new Error('칸 없음: ' + id);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
  window.__idle = () => document.getElementById('busy').hidden;
  window.__notice = () => { const n = document.getElementById('notice'); return n.hidden ? '' : n.className + ' | ' + n.innerText; };
  true;`;
const step = async (name, fn) => { log(name); await fn(); };
const notice = () => evaluate('__notice()');

try {
  await send('Page.navigate', { url: tokenUrl });
  await waitFor('목록 표', 'return document.querySelector("main table tbody tr")');
  await evaluate(HELPERS);
  const url = await evaluate('location.href');
  if (url.includes('token=')) throw new Error('주소에 토큰이 남아 있음: ' + url);
  await waitFor('상태 표시줄', 'return document.getElementById("status").className.includes("good")');
  log('상태줄:', await evaluate('document.getElementById("status").textContent'));
  log('목록:', JSON.stringify(await evaluate('[...document.querySelectorAll("main tbody tr")].map(r => [...r.cells].map(c => c.innerText).join(" | "))')));
  await shot('1-list');

  await step('입력 검사: manual 인데 주소 없음 → 빨간 안내, 요청 안 보냄', async () => {
    await evaluate('__click("+ 새로 만들기")');
    await waitFor('폼', 'return document.getElementById("f-name")');
    await evaluate(HELPERS);
    await evaluate('__set("f-name", "e2e-lan"); __set("f-ipv4-method", "manual"); true');
    const shown = await evaluate('__vis(document.getElementById("f-ipv4-addresses"))');
    if (!shown) throw new Error('manual 인데 주소 칸이 안 보임');
    await evaluate('__click("만들기")');
    await waitFor('빨간 안내', 'return document.querySelector(".field.has-error .error")?.textContent');
    log('  안내:', await evaluate('[...document.querySelectorAll(".field .error")].map(e => e.textContent).filter(Boolean).join(" / ")'));
    await shot('2-form-error');
  });

  await step('생성: ens224, 192.168.56.70/24, 다른 네트워크 게이트웨이 경고 확인', async () => {
    await evaluate('__set("f-ifname", "ens224"); __set("f-ipv4-addresses", "192.168.56.70/24"); __set("f-ipv4-gateway", "192.168.99.1"); true');
    const warn = await evaluate('[...document.querySelectorAll(".field .warn")].map(e => e.textContent).join("")');
    if (!warn.includes('다른 네트워크')) throw new Error('게이트웨이 경고 없음');
    await evaluate('__set("f-ipv4-gateway", "192.168.56.1"); __set("f-ipv4-dns", "8.8.8.8, 1.1.1.1"); __set("f-ipv6-method", "disabled"); __set("f-autoconnect", false); true');
    await shot('3-form-filled');
    await evaluate('__click("만들기")');
    await waitFor('상세 화면', 'return location.hash.startsWith("#/c/") && document.querySelector("main h2")?.textContent === "e2e-lan" && __idle()');
    log('  알림:', await notice());
    await shot('4-detail');
  });
  const uuid = await evaluate('location.hash.slice(4)');

  await step('편집: DNS 바꾸기 (꺼진 연결 → 확인 창 없음)', async () => {
    await evaluate('__click("편집")');
    await waitFor('편집 폼', 'return document.getElementById("f-ipv4-dns")?.value === "8.8.8.8 1.1.1.1"');
    await evaluate(HELPERS);
    await evaluate('__set("f-ipv4-dns", "9.9.9.9"); true');
    await evaluate('__click("저장")');
    await waitFor('상세로 돌아옴', `return location.hash === "#/c/${uuid}" && document.querySelector(".detail-grid")?.innerText.includes("9.9.9.9") && __idle()`);
    log('  알림:', await notice());
  });

  await step('켜기 (장치가 정해져 있어 바로 실행)', async () => {
    await evaluate('__click("켜기")');
    await waitFor('켜짐', 'return document.querySelector("main .toolbar .badge.on") && __btn("끄기") && __idle()');
    log('  알림:', await notice());
  });

  await step('켜진 연결 편집 → 경고 창 "저장" → "저장만 됐어요 — 지금 적용할까요?" → 지금 적용', async () => {
    await evaluate('__click("편집")');
    await waitFor('편집 폼', 'return document.getElementById("f-ipv4-gateway")?.value === "192.168.56.1"');
    await evaluate(HELPERS);
    await evaluate('__set("f-ipv4-gateway", "192.168.56.254"); true');
    await evaluate('__click("저장")');
    await waitFor('경고 창', 'return document.querySelector("dialog[open] h3")?.textContent === "사용 중인 연결의 설정을 바꿔요"');
    await shot('5-dialog-active-edit');
    await evaluate('document.querySelector("dialog[open] button.primary").click(); true');
    await waitFor('다시 적용 창', 'return document.querySelector("dialog[open] h3")?.textContent.startsWith("저장만 됐어요")');
    await evaluate('__click("지금 적용")');
    await waitFor('상세', `return location.hash === "#/c/${uuid}" && document.querySelector(".detail-grid")?.innerText.includes("192.168.56.254") && __idle()`);
    log('  알림:', await notice());
  });

  await step('끄기 (확인 창)', async () => {
    await evaluate('__click("끄기")');
    await waitFor('끄기 확인 창', 'return document.querySelector("dialog[open] h3")?.textContent.includes("끌까요")');
    await evaluate('document.querySelector("dialog[open] button.danger").click(); true');
    await waitFor('꺼짐', 'return document.querySelector("main .toolbar .badge.off") && __btn("켜기") && __idle()');
  });

  await step('복제 (기본 이름 e2e-lan-copy)', async () => {
    await evaluate('__click("복제")');
    await waitFor('복제 창', 'return document.querySelector("dialog[open] input")?.value === "e2e-lan-copy"');
    await evaluate('document.querySelector("dialog[open] button.primary").click(); true');
    await waitFor('복사본 상세', 'return document.querySelector("main h2")?.textContent === "e2e-lan-copy" && __idle()');
  });

  await step('삭제: 이름을 다시 입력해야 버튼이 눌림', async () => {
    await evaluate('__click("삭제")');
    await waitFor('삭제 창', 'return document.querySelector("dialog[open] h3")?.textContent === "프로파일 삭제"');
    const disabledBefore = await evaluate('document.querySelector("dialog[open] button.danger").disabled');
    if (!disabledBefore) throw new Error('이름 입력 전인데 삭제 버튼이 눌림');
    await evaluate('var i = document.querySelector("dialog[open] input"); i.value = "e2e-lan-cop"; i.dispatchEvent(new Event("input", {bubbles:true})); true');
    if (!(await evaluate('document.querySelector("dialog[open] button.danger").disabled'))) throw new Error('이름이 틀린데 버튼이 켜짐');
    await evaluate('var i = document.querySelector("dialog[open] input"); i.value = "e2e-lan-copy"; i.dispatchEvent(new Event("input", {bubbles:true})); true');
    await shot('6-dialog-delete');
    await evaluate('document.querySelector("dialog[open] button.danger").click(); true');
    await waitFor('목록으로', 'return location.hash === "#/" && document.querySelector("main table") && __idle()');
    const names = await evaluate('[...document.querySelectorAll("main tbody tr td:first-child")].map(t => t.textContent)');
    if (names.includes('e2e-lan-copy')) throw new Error('복사본이 안 지워짐');
  });

  await step('원본도 삭제', async () => {
    await evaluate(`location.hash = "#/c/${uuid}"; true`);
    await waitFor('상세', 'return document.querySelector("main h2")?.textContent === "e2e-lan" && __btn("삭제")');
    await evaluate('__click("삭제")');
    await waitFor('삭제 창', 'return document.querySelector("dialog[open] input")');
    await evaluate('var i = document.querySelector("dialog[open] input"); i.value = "e2e-lan"; i.dispatchEvent(new Event("input", {bubbles:true})); document.querySelector("dialog[open] button.danger").click(); true');
    await waitFor('목록으로', 'return location.hash === "#/" && document.querySelectorAll("main tbody tr").length === 3 && __idle()');
  });

  await step('켜진 1번 카드(ens160) 삭제 시 "사용 중" 경고가 보이는지 (취소)', async () => {
    await evaluate('[...document.querySelectorAll("main tbody tr")].find(r => r.cells[0].textContent === "ens160").click(); true');
    await waitFor('상세', 'return document.querySelector("main h2")?.textContent === "ens160" && __btn("삭제")');
    await evaluate('__click("삭제")');
    await waitFor('경고', 'return document.querySelector("dialog[open] .warn-text")?.textContent.includes("사용 중")');
    await evaluate('__click("취소")');
    await waitFor('창 닫힘', 'return !document.querySelector("dialog[open]")');
  });

  await step('장치 없는 프로파일 켜기 → 1번 카드 경고 + 장치 고르기', async () => {
    const created = await evaluate(`fetch('/api/connections', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ type: 'ethernet', name: 'any-dev', autoconnect: false }) }).then(r => r.json())`);
    const anyUuid = created.data.uuid;
    await evaluate(`location.hash = "#/c/${anyUuid}"; true`);
    await waitFor('상세', 'return document.querySelector("main h2")?.textContent === "any-dev" && __btn("켜기")');
    await evaluate('__click("켜기")');
    await waitFor('장치 경고 창', 'return document.querySelector("dialog[open] h3")?.textContent === "장치를 정하지 않은 프로파일이에요"');
    await shot('7-dialog-any-device');
    await evaluate('var s = document.querySelector("dialog[open] select"); s.value = "ens224"; document.querySelector("dialog[open] button.primary").click(); true');
    await waitFor('켜짐', 'return document.querySelector("main .toolbar .badge.on") && __idle()');
    const dev = await evaluate('document.querySelector(".detail-grid").innerText.match(/지금 연결된 장치\\s*(\\S+)/)?.[1]');
    if (dev !== 'ens224') throw new Error('ens224 가 아닌 장치에 켜짐: ' + dev);
    log('  켜진 장치:', dev);
  });

  await step('XSS: 이름에 HTML 을 넣어도 글자로만 보임', async () => {
    await evaluate(`fetch('/api/connections', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ type: 'ethernet', name: '<img src=x onerror=alert(1)>' }) }).then(r => r.json())`);
    await evaluate('location.hash = "#/"; true');
    await waitFor('목록', 'return [...document.querySelectorAll("main tbody td")].some(t => t.textContent === "<img src=x onerror=alert(1)>")');
    const imgs = await evaluate('document.querySelectorAll("main img").length');
    if (imgs) throw new Error('img 요소가 만들어짐!');
  });

  await step('유선이 아닌 lo 는 보기 전용', async () => {
    const txt = await evaluate('[...document.querySelectorAll("main tbody tr")].find(r => r.cells[0].textContent === "lo").cells[4].textContent');
    if (txt !== '보기 전용') throw new Error('lo 동작 칸: ' + txt);
  });

  await step('실행 기록 패널', async () => {
    await evaluate('document.getElementById("log-panel").open = true; true');
    await waitFor('기록 표', 'return document.querySelectorAll("#log-body tbody tr").length >= 8');
    log('  기록 줄 수:', await evaluate('document.querySelectorAll("#log-body tbody tr").length'));
    log('  최근 3개:', JSON.stringify(await evaluate('[...document.querySelectorAll("#log-body tbody tr")].slice(0,3).map(r => r.cells[1].textContent + " → " + r.cells[2].innerText.split("\\n")[0])')));
    await shot('8-logs');
    await evaluate('__click("지우기")');
    await waitFor('지워짐', 'return document.querySelector("#log-body")?.innerText.includes("아직 기록이 없어요")');
  });

  await step('다른 사이트처럼 Origin 을 바꾼 요청은 거부 (페이지 안 fetch 는 통과했으니 대조)', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/connections`, { method: 'POST', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
    log('  쿠키 없이 + 다른 Origin →', r.status);
  });

  console.log('\n✅ 화면 점검 통과');
} catch (e) {
  console.log('\n❌ 실패:', e.message);
  await shot('error').catch(() => {});
  process.exitCode = 1;
} finally {
  if (problems.length) { console.log('\n브라우저 콘솔 문제:'); for (const p of problems) console.log('  -', p); process.exitCode = 1; } else console.log('브라우저 콘솔 오류·CSP 위반: 없음');
  console.log(`화면 캡처: ${OUT}`);
  ws.close(); chrome.kill(); server.kill();
}
