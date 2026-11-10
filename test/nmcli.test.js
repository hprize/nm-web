// 1단계 테스트: nmcli 실행 도구, 해석기, 가짜 nmcli
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  runNmcli, splitTerse, parseTerseTable, parseTerseFields, splitList, checkArgs, NmcliArgError,
} from '../lib/nmcli.js';
import { useFakeNmcli, UUID_TEST, UUID_MISSING } from './helpers.js';

const fake = useFakeNmcli();
beforeEach(() => fake.reset());
after(() => fake.cleanup());

const LIST = ['-t', '-f', 'NAME,UUID,TYPE,DEVICE,ACTIVE', 'connection', 'show'];
const LIST_FIELDS = ['NAME', 'UUID', 'TYPE', 'DEVICE', 'ACTIVE'];
const uuidFromAdd = (stdout) => stdout.match(/\(([0-9a-f-]{36})\) successfully added/)[1];

test('splitTerse: 콜론·역슬래시가 든 값을 되돌림', () => {
  assert.deepEqual(splitTerse('office-lan:1115:802-3-ethernet::no'), ['office-lan', '1115', '802-3-ethernet', '', 'no']);
  assert.deepEqual(splitTerse('my\\:lan:x'), ['my:lan', 'x']);
  assert.deepEqual(splitTerse('a\\\\b:c'), ['a\\b', 'c']);           // a\b
  assert.deepEqual(splitTerse('back\\\\\\:slash'), ['back\\:slash']); // back\:slash
  assert.deepEqual(splitTerse(''), ['']);
});

test('parseTerseFields / splitList: 상세 출력 해석', () => {
  const out = 'connection.id:my\\:lan\nipv4.dns:8.8.8.8,1.1.1.1\nipv6.addresses:2001\\:db8\\:\\:5/64\nipv4.gateway:\n';
  const f = parseTerseFields(out);
  assert.equal(f['connection.id'], 'my:lan');
  assert.deepEqual(splitList(f['ipv4.dns']), ['8.8.8.8', '1.1.1.1']);
  assert.deepEqual(splitList(f['ipv6.addresses']), ['2001:db8::5/64']);
  assert.equal(f['ipv4.gateway'], '');
  assert.deepEqual(splitList(''), []);
});

test('완료 기준: 이름 "my:lan; echo HACK" 이 글자 그대로 저장·조회되고, 명령이 실행되지 않음', async () => {
  const name = 'my:lan; echo HACK';
  const add = await runNmcli(['connection', 'add', 'type', 'ethernet', 'con-name', name, 'ifname', 'ens224',
    'ipv4.method', 'manual', 'ipv4.addresses', '192.168.56.60/24']);
  assert.equal(add.exitCode, 0, add.stderr);
  assert.ok(!add.stdout.includes('\nHACK'), '셸이 echo 를 실행하면 안 됨');
  const uuid = uuidFromAdd(add.stdout);

  const list = parseTerseTable((await runNmcli(LIST)).stdout, LIST_FIELDS);
  const row = list.find((r) => r.UUID === uuid);
  assert.equal(row.NAME, name);
  assert.equal(row.TYPE, '802-3-ethernet');

  const detail = await runNmcli(['-t', '-f', 'connection,ipv4,ipv6,802-3-ethernet', 'connection', 'show', 'uuid', uuid]);
  assert.equal(detail.exitCode, 0);
  const f = parseTerseFields(detail.stdout);
  assert.equal(f['connection.id'], name);
  assert.deepEqual(splitList(f['ipv4.addresses']), ['192.168.56.60/24']);

  const del = await runNmcli(['connection', 'delete', 'uuid', uuid]);
  assert.equal(del.exitCode, 0);
  const after = parseTerseTable((await runNmcli(LIST)).stdout, LIST_FIELDS);
  assert.equal(after.find((r) => r.UUID === uuid), undefined);
});

test('종료 코드를 그대로 전달: 없는 UUID 10, manual 주소 없음 4, 잘못된 IP 2', async () => {
  const missing = await runNmcli(['connection', 'show', 'uuid', UUID_MISSING]);
  assert.equal(missing.exitCode, 10);
  assert.match(missing.stderr, /no such connection profile/);

  const noAddr = await runNmcli(['connection', 'add', 'type', 'ethernet', 'con-name', 'x', 'ipv4.method', 'manual']);
  assert.equal(noAddr.exitCode, 4);

  const badIp = await runNmcli(['connection', 'add', 'type', 'ethernet', 'con-name', 'x',
    'ipv4.method', 'manual', 'ipv4.addresses', '999.1.1.1/24']);
  assert.equal(badIp.exitCode, 2);
});

test('up / down / clone 흐름', async () => {
  const up = await runNmcli(['-w', '30', 'connection', 'up', 'uuid', UUID_TEST]);
  assert.equal(up.exitCode, 0, up.stderr);
  let row = parseTerseTable((await runNmcli(LIST)).stdout, LIST_FIELDS).find((r) => r.UUID === UUID_TEST);
  assert.deepEqual([row.DEVICE, row.ACTIVE], ['ens224', 'yes']);

  assert.equal((await runNmcli(['connection', 'down', 'uuid', UUID_TEST])).exitCode, 0);
  assert.equal((await runNmcli(['connection', 'down', 'uuid', UUID_TEST])).exitCode, 10, '꺼진 연결 down → 10');

  const clone = await runNmcli(['connection', 'clone', 'uuid', UUID_TEST, 'test-lan-copy']);
  assert.equal(clone.exitCode, 0);
  assert.match(clone.stdout, /cloned as test-lan-copy \([0-9a-f-]{36}\)/);
});

test('허용 목록: 위험한 명령·모양이 틀린 인자는 nmcli 를 실행하기 전에 막음 (S-06, S-07, S-08)', async () => {
  const bad = [
    ['networking', 'off'],
    ['radio', 'all', 'off'],
    ['general', 'reload'],
    ['connection', 'reload'],
    ['device', 'disconnect', 'ens160'],
    ['-s', 'connection', 'show', 'uuid', UUID_TEST],
    ['connection', 'show', 'id', 'test-lan'],                       // 이름으로 지정 금지
    ['connection', 'delete', 'uuid', 'not-a-uuid'],
    ['connection', 'modify', 'uuid', UUID_TEST, 'connection.type', 'wifi'], // 유형 변경 금지
    ['connection', 'modify', 'uuid', UUID_TEST, 'ipv4.method', '--help'], // '-' 로 시작하는 값
    ['connection', 'modify', 'uuid', UUID_TEST, 'gw4', '1.1.1.1'],        // modify 에서 별칭 금지
    ['connection', 'add', 'type', 'wifi', 'con-name', 'w'],
    ['connection', 'clone', 'uuid', UUID_TEST, '-x'],
    ['connection', 'add', 'type', 'ethernet', 'con-name', 'a\nb'],
    ['connection', 'show', 123],
  ];
  for (const args of bad) {
    assert.throws(() => checkArgs(args), NmcliArgError, JSON.stringify(args));
    assert.throws(() => runNmcli(args), NmcliArgError);
  }
  assert.doesNotThrow(() => checkArgs(['connection', 'modify', 'uuid', UUID_TEST, 'ipv4.gateway', ''])); // 빈 값 = 지우기
});

test('대기열: 동시에 불러도 하나씩 차례로 실행됨', async () => {
  process.env.FAKE_NMCLI_SLEEP_MS = '150';
  try {
    const start = Date.now();
    const results = await Promise.all([1, 2, 3].map(() => runNmcli(['-t', '-f', 'STATE,CONNECTIVITY', 'general', 'status'])));
    assert.ok(results.every((r) => r.exitCode === 0));
    assert.ok(Date.now() - start >= 450, '3개 × 150ms 이상 걸려야 함 (동시 실행 아님)');
  } finally {
    delete process.env.FAKE_NMCLI_SLEEP_MS;
  }
});

test('시간 제한을 넘기면 강제 종료 → exitCode -1, timedOut', async () => {
  process.env.FAKE_NMCLI_SLEEP_MS = '2000';
  try {
    const r = await runNmcli(['general', 'status'], 200);
    assert.equal(r.exitCode, -1);
    assert.equal(r.timedOut, true);
    assert.equal(r.notFound, false);
  } finally {
    delete process.env.FAKE_NMCLI_SLEEP_MS;
  }
});

test('nmcli 파일이 없으면 notFound 로 구분', async () => {
  const saved = process.env.NMCLI_BIN;
  process.env.NMCLI_BIN = '/nonexistent/nmcli';
  try {
    const r = await runNmcli(['general', 'status']);
    assert.equal(r.exitCode, -1);
    assert.equal(r.notFound, true);
    assert.equal(r.timedOut, false);
  } finally {
    process.env.NMCLI_BIN = saved;
  }
});

test('up 시간 초과는 nmcli 가 코드 3 으로 끝냄 (-w 30)', async () => {
  process.env.FAKE_NMCLI_UP_SECONDS = '40';
  try {
    const r = await runNmcli(['-w', '30', 'connection', 'up', 'uuid', UUID_TEST]);
    assert.equal(r.exitCode, 3);
  } finally {
    delete process.env.FAKE_NMCLI_UP_SECONDS;
  }
});
