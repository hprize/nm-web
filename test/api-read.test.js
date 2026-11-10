// 4단계 테스트: 조회 API (F-01, F-02, F-09, F-10)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useFakeNmcli, startTestServer, UUID_TEST, UUID_LO, UUID_MISSING } from './helpers.js';
import { runNmcli } from '../lib/nmcli.js';

const fake = useFakeNmcli();
let srv;
before(async () => { srv = await startTestServer(); });
beforeEach(() => fake.reset());
after(async () => { await srv.close(); fake.cleanup(); });

// 공통 응답 형식인지 확인
function assertCommon(body) {
  assert.equal(typeof body.ok, 'boolean');
  assert.equal(typeof body.nmcli.exitCode, 'number');
  assert.equal(typeof body.nmcli.message, 'string');
}

test('GET /api/status: NetworkManager 상태', async () => {
  const r = await srv.call('GET', '/api/status');
  assert.equal(r.status, 200);
  assertCommon(r.json);
  assert.deepEqual(r.json.data, { running: true, state: 'connected', connectivity: 'full' });
});

test('GET /api/devices: 장치 목록', async () => {
  const r = await srv.call('GET', '/api/devices');
  assert.equal(r.status, 200);
  assertCommon(r.json);
  assert.deepEqual(r.json.data.devices.map((d) => d.device), ['ens160', 'ens224', 'lo']);
  assert.deepEqual(r.json.data.devices[1], { device: 'ens224', type: 'ethernet', state: 'disconnected', connection: '' });
});

test('GET /api/connections: 목록 + 유선 표시값 + 유선 아닌 것은 읽기 전용', async () => {
  const r = await srv.call('GET', '/api/connections');
  assert.equal(r.status, 200);
  assertCommon(r.json);
  const list = r.json.data.connections;
  assert.equal(list.length, 3);
  const test = list.find((c) => c.uuid === UUID_TEST);
  assert.deepEqual(test, {
    name: 'test-lan', uuid: UUID_TEST, type: '802-3-ethernet', typeLabel: '유선',
    device: '', active: false, editable: true,
  });
  const lo = list.find((c) => c.uuid === UUID_LO);
  assert.equal(lo.typeLabel, '루프백');
  assert.equal(lo.editable, false);
  assert.equal(lo.active, true);
});

test('GET /api/connections: 이름의 ":" "\\" 도 그대로', async () => {
  await runNmcli(['connection', 'add', 'type', 'ethernet', 'con-name', 'a:b\\c']);
  const r = await srv.call('GET', '/api/connections');
  assert.ok(r.json.data.connections.some((c) => c.name === 'a:b\\c'));
});

test('GET /api/connections/:uuid: 상세 — SPEC 3장 칸만, 생성 요청과 같은 모양', async () => {
  const r = await srv.call('GET', `/api/connections/${UUID_TEST}`);
  assert.equal(r.status, 200);
  assertCommon(r.json);
  assert.deepEqual(r.json.data.connection, {
    uuid: UUID_TEST, name: 'test-lan', type: 'ethernet', nmType: '802-3-ethernet', typeLabel: '유선', editable: true,
    ifname: 'ens224', autoconnect: false, autoconnectPriority: 0,
    ipv4: { method: 'manual', addresses: ['192.168.56.50/24'], gateway: '192.168.56.1', dns: [], dnsSearch: [], ignoreAutoDns: false },
    ipv6: { method: 'disabled', addresses: [], gateway: '', dns: [] },
    ethernet: { mtu: null, macAddress: '', clonedMacAddress: '' },
  });
});

test('GET /api/connections/:uuid: 유선이 아닌 프로파일도 읽을 수 있음 (ethernet 칸은 null)', async () => {
  const r = await srv.call('GET', `/api/connections/${UUID_LO}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.data.connection.ethernet, null);
  assert.deepEqual(r.json.data.connection.ipv6.addresses, ['::1/128']);
});

test('없는 UUID → 404, ok:false, 코드 10, 쉬운 안내', async () => {
  const r = await srv.call('GET', `/api/connections/${UUID_MISSING}`);
  assert.equal(r.status, 404);
  assertCommon(r.json);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.nmcli.exitCode, 10);
  assert.equal(r.json.hint, '이미 없거나 꺼져 있는 연결이에요');
  assert.match(r.json.nmcli.message, /no such connection profile/);
});

test('UUID 형식이 틀리면 nmcli 를 실행하지 않고 400', async () => {
  for (const bad of ['test-lan', UUID_TEST.toUpperCase(), '--help', `${UUID_TEST}x`]) {
    const r = await srv.call('GET', `/api/connections/${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, bad);
    assert.equal(r.json.error, 'VALIDATION');
  }
});

test('NetworkManager 꺼짐: 코드 8, D-Bus 까지 꺼짐: 코드 1 → 둘 다 "꺼져 있어요" 안내', async () => {
  for (const [mode, code] of [['1', 8], ['dbus', 1]]) {
    process.env.FAKE_NMCLI_NM_DOWN = mode;
    try {
      const r = await srv.call('GET', '/api/status');
      assert.equal(r.status, 500);
      assert.equal(r.json.ok, false);
      assert.equal(r.json.nmcli.exitCode, code);
      assert.match(r.json.hint, /NetworkManager가 꺼져 있어요/);
    } finally {
      delete process.env.FAKE_NMCLI_NM_DOWN;
    }
  }
});

test('nmcli 실행 파일이 없음 → 500 + 설치 확인 안내', async () => {
  const saved = process.env.NMCLI_BIN;
  process.env.NMCLI_BIN = '/nonexistent/nmcli';
  try {
    const r = await srv.call('GET', '/api/connections');
    assert.equal(r.status, 500);
    assert.equal(r.json.nmcli.exitCode, -1);
    assert.match(r.json.hint, /nmcli 프로그램을 찾을 수 없어요/);
  } finally {
    process.env.NMCLI_BIN = saved;
  }
});

test('nmcli 를 실행하지 않은 실패(입력 오류·보안 거부)도 공통 형식 (nmcli: null)', async () => {
  const bad = await srv.call('GET', '/api/connections/nope');
  assert.deepEqual(Object.keys(bad.json).sort(), ['error', 'fields', 'hint', 'nmcli', 'ok']);
  assert.equal(bad.json.nmcli, null);
  const denied = await srv.call('POST', '/api/connections', {}, { origin: 'http://evil.example.com' });
  assert.equal(denied.json.nmcli, null);
  assert.equal(denied.json.error, 'BAD_ORIGIN');
});
