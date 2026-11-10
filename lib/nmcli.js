// nmcli 실행 도구와 출력 해석기
// - 셸을 거치지 않고 execFile(실행 파일, [인자 배열]) 로만 실행 → 명령어 주입 차단 (S-05)
// - 허용된 명령·속성만 통과시키는 마지막 검문소 (S-06, S-07) — 입력 검사를 뚫려도 여기서 한 번 더 막음
// - 한 번에 하나만 실행하는 대기열 (SPEC 8장)

import { execFile } from 'node:child_process';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 시간 제한: up 은 nmcli 에 -w 30 을 주고, execFile 은 그보다 긴 35초 (nmcli 가 먼저 코드 3으로 끝나게)
export const UP_WAIT_SECONDS = 30;
export const UP_TIMEOUT_MS = 35_000;
export const DEFAULT_TIMEOUT_MS = 15_000;

// SPEC 3장의 정식 속성 이름만 허용 (add/modify 에서 쓸 수 있는 것)
export const ALLOWED_PROPS = new Set([
  'connection.id', 'connection.interface-name', 'connection.autoconnect', 'connection.autoconnect-priority',
  'ipv4.method', 'ipv4.addresses', 'ipv4.gateway', 'ipv4.dns', 'ipv4.dns-search', 'ipv4.ignore-auto-dns',
  'ipv6.method', 'ipv6.addresses', 'ipv6.gateway', 'ipv6.dns',
  '802-3-ethernet.mtu', '802-3-ethernet.mac-address', '802-3-ethernet.cloned-mac-address',
]);
// add 에서만 쓰는 공통 옵션(별칭) — TASKS 3단계
const ADD_ONLY = new Set(['type', 'con-name', 'ifname']);

// SPEC 4장의 하위 명령만. networking, radio, reload, device disconnect 같은 것은 아예 없음
const ALLOWED_COMMANDS = {
  general: ['status'],
  device: ['status'],
  connection: ['show', 'add', 'modify', 'up', 'down', 'delete', 'clone'],
};

export class NmcliArgError extends Error {
  constructor(message) { super(`허용되지 않은 nmcli 인자: ${message}`); this.name = 'NmcliArgError'; }
}

// 실행 파일 위치: 맥 개발 때는 NMCLI_BIN=dev/fake-nmcli, Rocky 에서는 진짜 nmcli
export const nmcliBin = () => process.env.NMCLI_BIN || 'nmcli';

// 인자 배열이 허용 목록 모양과 정확히 맞는지 검사. 틀리면 예외 → nmcli 를 아예 실행하지 않음
export function checkArgs(args) {
  if (!Array.isArray(args)) throw new NmcliArgError('배열이 아님');
  for (const a of args) {
    if (typeof a !== 'string') throw new NmcliArgError('문자열이 아닌 인자');
    if (/[\0\r\n]/.test(a)) throw new NmcliArgError('제어문자가 든 인자');
  }

  // ① 전역 옵션: -t, -f <필드>, -g <필드>, -w <초> 만 (-s 비밀값 보기는 없음, S-08)
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    const opt = args[i];
    if (opt === '-t') { i += 1; continue; }
    if (opt === '-f' || opt === '-g') {
      if (!/^[A-Za-z0-9][A-Za-z0-9.,-]*$/.test(args[i + 1] ?? '')) throw new NmcliArgError(`${opt} 값`);
      i += 2; continue;
    }
    if (opt === '-w') {
      if (!/^\d{1,3}$/.test(args[i + 1] ?? '')) throw new NmcliArgError('-w 값');
      i += 2; continue;
    }
    throw new NmcliArgError(`옵션 ${opt}`);
  }

  // ② 오브젝트 + 하위 명령
  const [object, command, ...rest] = args.slice(i);
  if (!ALLOWED_COMMANDS[object]?.includes(command)) throw new NmcliArgError(`${object} ${command}`);
  if (object !== 'connection') {
    if (rest.length) throw new NmcliArgError('남는 인자');
    return;
  }

  // ③ 명령별 모양
  const needUuid = () => {
    if (rest[0] !== 'uuid' || !UUID_RE.test(rest[1] ?? '')) throw new NmcliArgError('uuid <UUID> 형식 아님');
    return rest.slice(2);
  };
  const safeValue = (v) => {
    // 값이 '-' 로 시작하면 옵션으로 오해될 수 있어 거부 (S-07). 빈 값("")은 "지우기"라 허용
    if (v.startsWith('-')) throw new NmcliArgError(`'-' 로 시작하는 값`);
  };
  const pairs = (list, allowed) => {
    if (list.length % 2 !== 0) throw new NmcliArgError('속성/값 짝이 안 맞음');
    for (let k = 0; k < list.length; k += 2) {
      if (!allowed(list[k])) throw new NmcliArgError(`속성 ${list[k]}`);
      safeValue(list[k + 1]);
    }
  };

  switch (command) {
    case 'show':
      if (rest.length === 0) return;
      if (needUuid().length) throw new NmcliArgError('남는 인자');
      return;
    case 'add':
      if (rest[0] !== 'type' || rest[1] !== 'ethernet') throw new NmcliArgError('add 는 type ethernet 으로 시작');
      pairs(rest, (p) => ADD_ONLY.has(p) || ALLOWED_PROPS.has(p));
      return;
    case 'modify': {
      const list = needUuid();
      if (list.length === 0) throw new NmcliArgError('바꿀 속성 없음');
      pairs(list, (p) => ALLOWED_PROPS.has(p));
      return;
    }
    case 'up': {
      const left = needUuid();
      if (left.length === 0) return;
      if (left.length === 2 && left[0] === 'ifname' && /^[A-Za-z0-9._-]{1,15}$/.test(left[1]) && !left[1].startsWith('-')) return;
      throw new NmcliArgError('up 뒤의 인자');
    }
    case 'down':
    case 'delete':
      if (needUuid().length) throw new NmcliArgError('남는 인자');
      return;
    case 'clone': {
      const left = needUuid();
      if (left.length !== 1 || left[0] === '') throw new NmcliArgError('clone 새 이름');
      safeValue(left[0]);
      return;
    }
  }
}

// 실행이 끝날 때마다 알려 줄 곳 (6단계 실행 기록이 여기에 연결됨)
let runListener = null;
export function setRunListener(fn) { runListener = fn; }

// 대기열: 앞의 실행이 끝나야 다음 실행을 시작 (버튼을 여러 번 눌러도 동시에 돌지 않음)
let queueTail = Promise.resolve();
function enqueue(task) {
  const result = queueTail.then(task);
  queueTail = result.catch(() => {}); // 앞의 작업이 실패해도 대기열은 계속 흐르게
  return result;
}

// nmcli 를 실행하고 { exitCode, stdout, stderr, timedOut, notFound, durationMs } 를 돌려줌.
// 실패해도 예외를 던지지 않음(허용 목록 위반만 예외) → 부르는 쪽이 종료 코드로 판단
export function runNmcli(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  checkArgs(args); // 대기열에 넣기 전에 검사 — 위반이면 즉시 예외
  return enqueue(() => new Promise((resolve) => {
    const started = Date.now();
    execFile(nmcliBin(), args, {
      env: { ...process.env, LC_ALL: 'C' }, // 출력 언어를 영어로 고정해야 해석이 안 틀어짐
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const timedOut = Boolean(err?.killed);              // 시간 제한으로 강제 종료됨
      const notFound = err?.code === 'ENOENT' || err?.code === 'EACCES'; // nmcli 파일이 없거나 실행 불가
      const exitCode = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      const result = {
        exitCode, stdout: String(stdout), stderr: String(stderr).trim(),
        timedOut, notFound, durationMs: Date.now() - started,
      };
      try { runListener?.({ args, ...result }); } catch { /* 기록 실패가 실행 결과를 망치지 않게 */ }
      resolve(result);
    });
  }));
}

// -t(terse) 한 줄을 ':' 기준으로 나누되, '\:' 와 '\\' 는 글자로 되돌림 (SPEC 6.1)
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

const lines = (stdout) => stdout.split('\n').filter((l) => l.length > 0);

// 표 모양 출력 (-t -f A,B,C … show) → [{ A, B, C }, …]
export function parseTerseTable(stdout, fields) {
  return lines(stdout).map((line) => {
    const parts = splitTerse(line);
    return Object.fromEntries(fields.map((f, i) => [f, parts[i] ?? '']));
  });
}

// "속성:값" 모양 출력 (-t -f connection,… show uuid X) → { 'connection.id': '…', … }
export function parseTerseFields(stdout) {
  const out = {};
  for (const line of lines(stdout)) {
    const [key, ...rest] = splitTerse(line);
    out[key] = rest.join(':');
  }
  return out;
}

// 여러 값 칸(주소·DNS)은 쉼표로 이어져 나옴 → 배열로
export const splitList = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);

// 큐가 비워질 때까지 기다리기 (테스트용)
export const idle = () => queueTail;
