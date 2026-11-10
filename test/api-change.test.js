// 5단계 테스트: 변경 API (F-03 ~ F-08)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useFakeNmcli, startTestServer, UUID_MAIN, UUID_TEST, UUID_LO, UUID_MISSING } from './helpers.js';
import { onRun } from '../lib/nmcli.js';
import { uuidFromAdd, uuidFromClone } from '../routes/api.js';

const fake = useFakeNmcli();
let srv;
// 이 파일에서 실제로 실행된 nmcli 인자를 모두 모아 둠 (uuid 형식 검사용)
const executed = [];
const stopSpy = onRun(({ args }) => executed.push(args));
before(async () => { srv = await startTestServer(); });
beforeEach(() => fake.reset());
after(async () => { stopSpy(); await srv.close(); fake.cleanup(); });

const LAB = {
  type: 'ethernet', name: 'lab-lan', ifname: 'ens224', autoconnect: false,
  ipv4: { method: 'manual', addresses: ['192.168.56.60/24'], gateway: '192.168.56.1', dns: ['8.8.8.8'] },
  ipv6: { method: 'disabled' },
};
const detail = async (uuid) => (await srv.call('GET', `/api/connections/${uuid}`)).json.data.connection;
const rowOf = (json, uuid) => json.data.connections.find((c) => c.uuid === uuid);

test('전체 흐름: 생성 → 수정 → 적용 → 해제 → 복제 → 삭제', async () => {
  // 생성
  const created = await srv.call('POST', '/api/connections', LAB);
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(created.json.ok, true);
  const uuid = created.json.data.uuid;
  assert.match(uuid, /^[0-9a-f-]{36}$/);
  assert.equal(created.json.data.activated, false, '저장 직후에는 켜지 않음');
  assert.match(created.json.nmcli.message, /successfully added/);
  assert.equal(rowOf(created.json, uuid).active, false, '응답에 다시 읽은 목록이 들어 있음');

  // 수정 (바뀐 칸만)
  const patched = await srv.call('PATCH', `/api/connections/${uuid}`, { name: 'lab-lan-2', ipv4: { dns: ['1.1.1.1', '8.8.4.4'], gateway: '' } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.data.needsReapply, false);
  let d = await detail(uuid);
  assert.equal(d.name, 'lab-lan-2');
  assert.deepEqual(d.ipv4.dns, ['1.1.1.1', '8.8.4.4']);
  assert.equal(d.ipv4.gateway, '', '빈 값 = 지우기');
  assert.deepEqual(d.ipv4.addresses, ['192.168.56.60/24'], '보내지 않은 칸은 그대로');

  // 적용
  const up = await srv.call('POST', `/api/connections/${uuid}/up`);
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.deepEqual([rowOf(up.json, uuid).active, rowOf(up.json, uuid).device], [true, 'ens224']);

  // 켜진 연결을 수정하면 "저장만 됨 — 지금 적용" 안내
  const patchedActive = await srv.call('PATCH', `/api/connections/${uuid}`, { autoconnect: true });
  assert.equal(patchedActive.json.data.needsReapply, true);
  assert.match(patchedActive.json.hint, /저장만 됐어요/);

  // 해제
  const down = await srv.call('POST', `/api/connections/${uuid}/down`);
  assert.equal(down.status, 200);
  assert.equal(rowOf(down.json, uuid).active, false);

  // 복제 (이름을 안 주면 <원래이름>-copy)
  const cloned = await srv.call('POST', `/api/connections/${uuid}/clone`, {});
  assert.equal(cloned.status, 200, JSON.stringify(cloned.json));
  const copyUuid = cloned.json.data.uuid;
  assert.notEqual(copyUuid, uuid, '복사본은 새 UUID');
  const copy = await detail(copyUuid);
  assert.equal(copy.name, 'lab-lan-2-copy');
  assert.deepEqual(copy.ipv4, d.ipv4, '같은 설정');

  // 이름을 정해서 복제
  const named = await srv.call('POST', `/api/connections/${uuid}/clone`, { name: 'my copy' });
  assert.equal((await detail(named.json.data.uuid)).name, 'my copy');

  // 삭제
  for (const u of [uuid, copyUuid, named.json.data.uuid]) {
    const del = await srv.call('DELETE', `/api/connections/${u}`);
    assert.equal(del.status, 200);
    assert.equal(rowOf(del.json, u), undefined);
  }
  const list = await srv.call('GET', '/api/connections');
  assert.equal(list.json.data.connections.length, 3, '처음 3개만 남음');
});

test('생성 + 저장 후 바로 적용(activate:true)', async () => {
  const r = await srv.call('POST', '/api/connections', { ...LAB, activate: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.activated, true);
  assert.equal(rowOf(r.json, r.json.data.uuid).active, true);
});

test('생성은 됐는데 적용만 실패 → ok:false + data.uuid + "저장은 됐지만"', async () => {
  const r = await srv.call('POST', '/api/connections', { ...LAB, ifname: 'ens999', activate: true });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, 'SAVED_BUT_NOT_ACTIVATED');
  assert.equal(r.json.nmcli.exitCode, 4);
  assert.match(r.json.hint, /^저장은 됐지만 적용은 실패했어요/);
  assert.ok(rowOf(r.json, r.json.data.uuid), '프로파일은 저장되어 있음');
});

test('생성 실패: 입력 검사에서 막히면 nmcli 를 실행하지 않음', async () => {
  const before = executed.length;
  for (const body of [
    { ...LAB, type: 'wifi' },
    { ...LAB, ipv4: { method: 'manual' } },
    { ...LAB, name: '-rf' },
    { ...LAB, extra: 'x' },
    'not an object',
  ]) {
    const r = await srv.call('POST', '/api/connections', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(['VALIDATION', 'BAD_JSON'].includes(r.json.error), r.json.error); // 문자열 본문은 JSON 읽기 단계에서 막힘
  }
  assert.equal(executed.length, before, 'nmcli 실행 0번');
});

test('생성 실패: nmcli 가 거부하면 코드와 원래 문구를 그대로', async () => {
  // 서버 검사는 통과했지만 nmcli 쪽에서 실패하는 경우를 흉내: NetworkManager 꺼짐
  process.env.FAKE_NMCLI_NM_DOWN = '1';
  try {
    const r = await srv.call('POST', '/api/connections', LAB);
    assert.equal(r.status, 500);
    assert.equal(r.json.nmcli.exitCode, 8);
    assert.match(r.json.nmcli.message, /not running/);
  } finally {
    delete process.env.FAKE_NMCLI_NM_DOWN;
  }
});

test('편집 실패들', async () => {
  const p = (uuid, body) => srv.call('PATCH', `/api/connections/${uuid}`, body);
  // 유형 변경 거부
  let r = await p(UUID_TEST, { type: 'wifi' });
  assert.equal(r.status, 400);
  assert.match(r.json.fields[0].message, /바꿀 수 없어요/);
  // 바뀐 값 없음
  r = await p(UUID_TEST, {});
  assert.equal(r.status, 400);
  assert.equal(r.json.hint, '바뀐 값이 없어요');
  // manual 인데 주소를 다 지움 (지금 값과 합쳐서 검사)
  r = await p(UUID_TEST, { ipv4: { addresses: [] } });
  assert.equal(r.status, 400);
  assert.equal(r.json.fields[0].path, 'ipv4.addresses');
  // 유선이 아닌 프로파일
  r = await p(UUID_LO, { name: 'x' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'NOT_EDITABLE');
  // 없는 UUID → 404 + 코드 10
  r = await p(UUID_MISSING, { name: 'x' });
  assert.equal(r.status, 404);
  assert.equal(r.json.nmcli.exitCode, 10);
  // 잘못된 UUID
  r = await p('not-a-uuid', { name: 'x' });
  assert.equal(r.status, 400);
});

test('적용·해제·삭제·복제 실패들', async () => {
  // 시간 초과 → 코드 3
  process.env.FAKE_NMCLI_UP_SECONDS = '40';
  try {
    const r = await srv.call('POST', `/api/connections/${UUID_TEST}/up`);
    assert.equal(r.status, 500);
    assert.equal(r.json.nmcli.exitCode, 3);
    assert.equal(r.json.hint, '30초 안에 연결되지 않았어요. 장치·케이블·DHCP 서버를 확인하세요.');
  } finally {
    delete process.env.FAKE_NMCLI_UP_SECONDS;
  }
  // 다른 장치를 지정 → 코드 4
  let r = await srv.call('POST', `/api/connections/${UUID_TEST}/up`, { ifname: 'ens160' });
  assert.equal(r.json.nmcli.exitCode, 4);
  assert.match(r.json.hint, /^적용\(또는 저장\)에 실패했어요/);
  // 잘못된 ifname
  r = await srv.call('POST', `/api/connections/${UUID_TEST}/up`, { ifname: '-w' });
  assert.equal(r.status, 400);
  // 꺼진 연결 down → 404 + 코드 10
  r = await srv.call('POST', `/api/connections/${UUID_TEST}/down`);
  assert.equal(r.status, 404);
  assert.equal(r.json.nmcli.exitCode, 10);
  assert.equal(r.json.hint, '이미 없거나 꺼져 있는 연결이에요');
  // 없는 프로파일
  assert.equal((await srv.call('DELETE', `/api/connections/${UUID_MISSING}`)).json.nmcli.exitCode, 10);
  assert.equal((await srv.call('POST', `/api/connections/${UUID_MISSING}/up`)).json.nmcli.exitCode, 10);
  assert.equal((await srv.call('POST', `/api/connections/${UUID_MISSING}/clone`, {})).status, 404);
  // 유선이 아니면 켜기·끄기·삭제·복제 거부
  for (const [m, path] of [['POST', 'up'], ['POST', 'down'], ['DELETE', ''], ['POST', 'clone']]) {
    const res = await srv.call(m, `/api/connections/${UUID_LO}${path ? '/' + path : ''}`, m === 'DELETE' ? undefined : {});
    assert.equal(res.json.error, 'NOT_EDITABLE', `${m} ${path}`);
  }
  // 복제 이름 검사
  r = await srv.call('POST', `/api/connections/${UUID_TEST}/clone`, { name: '-x' });
  assert.equal(r.status, 400);
  r = await srv.call('POST', `/api/connections/${UUID_TEST}/clone`, { name: 'x'.repeat(65) });
  assert.equal(r.status, 400);
});

test('켜진 연결(1번 카드) 삭제는 서버가 막지 않음 — 경고는 화면 몫', async () => {
  const r = await srv.call('DELETE', `/api/connections/${UUID_MAIN}`);
  assert.equal(r.status, 200);
});

test('UUID 꺼내기: 이름에 가짜 "(UUID) successfully added" 를 넣어도 속지 않음', () => {
  const real = '11111111-2222-4333-8444-555555555555';
  const fakeU = '99999999-9999-4999-8999-999999999999';
  assert.equal(uuidFromAdd(`Connection 'x (${fakeU}) successfully added' (${real}) successfully added.\n`), real);
  assert.equal(uuidFromClone(`a (${fakeU}) cloned as b (${fakeU}) (${real}).\n`), real);
  assert.equal(uuidFromAdd('weird output'), null);
});

test('완료 기준: 실행된 모든 nmcli connection 명령이 "uuid <UUID>" 형식 (목록·생성 제외)', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let checked = 0;
  for (const args of executed) {
    const i = args.indexOf('connection');
    if (i < 0) continue;
    const cmd = args[i + 1];
    if (cmd === 'add' || (cmd === 'show' && args.length === i + 2)) continue;
    assert.equal(args[i + 2], 'uuid', JSON.stringify(args));
    assert.match(args[i + 3], UUID_RE);
    checked++;
  }
  assert.ok(checked > 20, `검사한 명령 수: ${checked}`);
  // up 은 모두 -w 30
  for (const args of executed.filter((a) => a.includes('up'))) assert.deepEqual(args.slice(0, 2), ['-w', '30']);
});
