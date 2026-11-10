// 6단계 테스트: 실행 기록 (F-11, S-08, S-09)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useFakeNmcli, startTestServer, UUID_TEST } from './helpers.js';
import { maskArgs, commandLine, record, getLogs, resetLogs, logFilePath, MAX_ENTRIES } from '../lib/log.js';

const fake = useFakeNmcli();
let srv;
before(async () => { srv = await startTestServer(); });
beforeEach(() => { fake.reset(); resetLogs(); });
after(async () => { await srv.close(); fake.cleanup(); });

// 파일 쓰기는 비동기라 잠깐 기다렸다 읽기
const readLogFile = async () => {
  await new Promise((r) => setTimeout(r, 100));
  return readFileSync(logFilePath(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
};

test('비밀이 될 수 있는 값은 *** 로 가림', () => {
  assert.deepEqual(
    maskArgs(['connection', 'modify', 'uuid', UUID_TEST, '802-1x.password', 'hunter2', 'wifi-sec.psk', 'abc', 'ipv4.dns', '8.8.8.8']),
    ['connection', 'modify', 'uuid', UUID_TEST, '802-1x.password', '***', 'wifi-sec.psk', '***', 'ipv4.dns', '8.8.8.8'],
  );
  const e = record({
    args: ['connection', 'modify', 'uuid', UUID_TEST, 'vpn.secrets', 'topsecret'],
    exitCode: 2, stdout: '', stderr: "Error: invalid value 'topsecret'",
  });
  assert.ok(!JSON.stringify(e).includes('topsecret'), '명령·문구 어디에도 비밀값이 없어야 함');
  assert.match(e.message, /\*\*\*/);
});

test('기록 형식: 시간·명령(배열)·종료 코드·결과 문구', async () => {
  const r = await srv.call('POST', `/api/connections/${UUID_TEST}/up`);
  assert.equal(r.status, 200);
  const [entry] = getLogs();
  assert.equal(entry.kind, 'change');
  assert.deepEqual(entry.args, ['-w', '30', 'connection', 'up', 'uuid', UUID_TEST]);
  assert.equal(entry.command, `nmcli -w 30 connection up uuid ${UUID_TEST}`);
  assert.equal(entry.exitCode, 0);
  assert.equal(entry.ok, true);
  assert.match(entry.message, /successfully activated/);
  assert.ok(!Number.isNaN(Date.parse(entry.time)));
  assert.equal(typeof entry.durationMs, 'number');
});

test('파일에도 한 줄에 JSON 하나씩 기록 (실패도 기록)', async () => {
  await srv.call('POST', `/api/connections/${UUID_TEST}/down`); // 꺼진 연결 → 실패(10)
  const lines = await readLogFile();
  const last = lines.at(-1);
  assert.deepEqual(last.args, ['connection', 'down', 'uuid', UUID_TEST]);
  assert.equal(last.exitCode, 10);
  assert.equal(last.ok, false);
  assert.match(last.message, /not an active connection/);
});

test('GET /api/logs: 기본은 변경만, ?all=1 이면 조회도, 새것부터', async () => {
  await srv.call('POST', '/api/connections', { type: 'ethernet', name: 'log; echo X' });
  const changes = (await srv.call('GET', '/api/logs')).json;
  assert.equal(changes.ok, true);
  assert.equal(changes.nmcli, null);
  assert.ok(changes.data.logs.every((l) => l.kind === 'change'));
  assert.equal(changes.data.logs[0].args[1], 'add');
  assert.match(changes.data.logs[0].command, /con-name 'log; echo X'/, '특수문자가 든 인자는 따옴표로 보여 줌');

  const all = (await srv.call('GET', '/api/logs?all=1')).json.data.logs;
  assert.ok(all.some((l) => l.kind === 'read'), '생성 뒤 목록 다시 읽기(조회)도 보임');
  assert.match(all.find((l) => l.kind === 'read').message, /^\(출력 \d+줄\)$/);
  assert.ok(all[0].id > all.at(-1).id, '새것부터');
});

test(`최근 ${MAX_ENTRIES}개까지만, 조회가 많아도 변경 기록은 밀려나지 않음`, async () => {
  record({ args: ['connection', 'delete', 'uuid', UUID_TEST], exitCode: 0, stdout: 'ok', stderr: '' });
  for (let i = 0; i < 150; i++) record({ args: ['general', 'status'], exitCode: 0, stdout: 'connected:full', stderr: '' });
  assert.equal(getLogs({ includeReads: true }).length, MAX_ENTRIES);
  assert.equal(getLogs().length, 1);
});

test('commandLine: 보여 주기용 따옴표', () => {
  assert.equal(commandLine(['connection', 'modify', 'uuid', UUID_TEST, 'ipv4.gateway', '']), `nmcli connection modify uuid ${UUID_TEST} ipv4.gateway ''`);
  assert.equal(commandLine(['x', "it's"]), "nmcli x 'it'\\''s'");
});
