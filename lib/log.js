// 실행 기록 (F-11, S-08, S-09)
// nmcli 를 실행할 때마다 시간·명령·종료 코드·결과 문구를 메모리(화면용)와 파일(추적용)에 남깁니다.
// 비밀이 될 수 있는 값은 기록하기 "전에" *** 로 바꿔서, 파일·화면 어디에도 남지 않게 합니다.

import { appendFile, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRun } from './nmcli.js';

export const MAX_ENTRIES = 100;
const MESSAGE_MAX = 1000;
const SECRET_PROP = /psk|password|secret|802-1x/i;
const CHANGE_COMMANDS = new Set(['add', 'modify', 'up', 'down', 'delete', 'clone']);

// 비밀 속성 이름 바로 뒤의 값을 *** 로
export function maskArgs(args) {
  return args.map((a, i) => (i > 0 && SECRET_PROP.test(args[i - 1]) ? '***' : a));
}

// 가린 값이 nmcli 문구 안에 다시 나오면 그것도 ***
function maskMessage(message, args) {
  let out = message;
  args.forEach((a, i) => {
    if (i > 0 && SECRET_PROP.test(args[i - 1]) && a) out = out.split(a).join('***');
  });
  return out;
}

// 화면에 보여 줄 명령 한 줄 (공백·특수문자가 든 인자는 따옴표로 감싸 보여 주기만 함 — 실행과는 무관)
export function commandLine(args) {
  const quote = (a) => (a === '' || /[\s'"\\;|&$<>()`]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a);
  return ['nmcli', ...args.map(quote)].join(' ');
}

function kindOf(args) {
  const i = args.indexOf('connection');
  return i >= 0 && CHANGE_COMMANDS.has(args[i + 1]) ? 'change' : 'read';
}

// ---------- 저장소 ----------
let nextId = 1;
let allEntries = [];    // 조회 포함 최근 100개
let changeEntries = []; // 변경만 최근 100개 (조회가 많아도 밀려나지 않게 따로 보관)
let logFile = null;
let stopListening = null;
let warnedWriteError = false;

const defaultDir = () => process.env.LOG_DIR
  || process.env.LOGS_DIRECTORY // systemd 의 LogsDirectory= 가 알려 주는 폴더
  || fileURLToPath(new URL('../logs/', import.meta.url));

export function record(run) {
  const args = maskArgs(run.args);
  const kind = kindOf(run.args);
  const raw = run.exitCode === 0 ? run.stdout : (run.stderr || run.stdout);
  let message = maskMessage(String(raw ?? '').trim(), run.args);
  // 조회 결과(목록·상세)는 길고 화면 데이터라 줄 수만 적음
  if (kind === 'read' && run.exitCode === 0) message = `(출력 ${message ? message.split('\n').length : 0}줄)`;
  if (message.length > MESSAGE_MAX) message = message.slice(0, MESSAGE_MAX) + '…';

  const entry = {
    id: nextId++,
    time: new Date().toISOString(),
    kind,
    args,
    command: commandLine(args),
    ok: run.exitCode === 0,
    exitCode: run.exitCode,
    timedOut: Boolean(run.timedOut),
    notFound: Boolean(run.notFound),
    durationMs: run.durationMs ?? null,
    message,
  };
  allEntries = [...allEntries, entry].slice(-MAX_ENTRIES);
  if (kind === 'change') changeEntries = [...changeEntries, entry].slice(-MAX_ENTRIES);
  writeToFile(entry);
  return entry;
}

function writeToFile(entry) {
  if (!logFile) return;
  appendFile(logFile, JSON.stringify(entry) + '\n', { mode: 0o640 }, (err) => {
    if (err && !warnedWriteError) {
      warnedWriteError = true;
      console.error(`[nm-web] 기록 파일에 쓰지 못했어요 (${logFile}): ${err.message}`);
    }
  });
}

// 서버가 켜질 때 한 번 부름: 기록 폴더를 만들고 nmcli 실행을 엿듣기 시작
export function startLogging({ dir = defaultDir() } = {}) {
  if (stopListening) return logFile;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    logFile = path.join(dir, 'nm-web.log');
  } catch (e) {
    console.error(`[nm-web] 기록 폴더를 만들지 못했어요 (${dir}): ${e.message} — 화면 기록만 남깁니다`);
    logFile = null;
  }
  stopListening = onRun(record);
  return logFile;
}

export const logFilePath = () => logFile;

// 최근 기록, 새것부터. includeReads 면 조회 명령도 포함
export function getLogs({ includeReads = false } = {}) {
  return [...(includeReads ? allEntries : changeEntries)].reverse();
}

// 테스트용: 기록 비우기
export function resetLogs() {
  allEntries = []; changeEntries = []; nextId = 1;
}
