// 3단계 테스트: 입력 검사와 nmcli 인자 변환
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSchema, patchSchema, uuidSchema, cloneSchema, upSchema, validate, toNmcliArgs, toModifyArgs, patchProblems,
} from '../lib/schema.js';
import { checkArgs } from '../lib/nmcli.js';
import { isIPv6, isIPv4Cidr, gatewayInSameNetwork } from '../public/rules.js';

const UUID = '1115a96e-50aa-41b6-87c6-21a42abf2774';

// SPEC 6장 생성 요청 예시
const OFFICE_LAN = {
  type: 'ethernet',
  name: 'office-lan',
  ifname: 'eth0',
  autoconnect: false,
  ipv4: { method: 'manual', addresses: ['192.168.10.50/24'], gateway: '192.168.10.1', dns: ['8.8.8.8', '1.1.1.1'] },
  ipv6: { method: 'disabled' },
  activate: false,
};

test('완료 기준: SPEC 6장 office-lan 예시가 TASKS 의 배열로 정확히 변환됨', () => {
  const r = validate(createSchema, OFFICE_LAN);
  assert.equal(r.ok, true, JSON.stringify(r.fields));
  assert.deepEqual(toNmcliArgs(r.data), [
    'connection', 'add', 'type', 'ethernet', 'con-name', 'office-lan', 'ifname', 'eth0',
    'connection.autoconnect', 'no',
    'ipv4.method', 'manual', 'ipv4.addresses', '192.168.10.50/24',
    'ipv4.gateway', '192.168.10.1', 'ipv4.dns', '8.8.8.8 1.1.1.1',
    'ipv6.method', 'disabled',
  ]);
});

test('생성: 올바른 입력들', () => {
  const ok = (body) => {
    const r = validate(createSchema, body);
    assert.equal(r.ok, true, `${JSON.stringify(body)} → ${JSON.stringify(r.fields)}`);
    return toNmcliArgs(r.data);
  };
  // 최소 입력
  assert.deepEqual(ok({ type: 'ethernet', name: 'a' }), ['connection', 'add', 'type', 'ethernet', 'con-name', 'a']);
  // "아무 장치나" → ifname 인자 없음
  assert.ok(!ok({ type: 'ethernet', name: 'a', ifname: '' }).includes('ifname'));
  assert.ok(!ok({ type: 'ethernet', name: 'a', ifname: null }).includes('ifname'));
  // 모든 칸
  const all = ok({
    type: 'ethernet', name: '사무실 유선', ifname: 'ens224', autoconnect: true, autoconnectPriority: 10,
    ipv4: { method: 'manual', addresses: ['10.0.0.5/8', '10.0.0.6/8'], gateway: '10.0.0.1', dns: ['1.1.1.1'], dnsSearch: ['example.com', 'lab.local'], ignoreAutoDns: true },
    ipv6: { method: 'manual', addresses: ['2001:db8::5/64'], gateway: '2001:db8::1', dns: ['2001:4860:4860::8888'] },
    ethernet: { mtu: 1500, macAddress: '52:54:00:12:34:56', clonedMacAddress: 'random' },
    activate: true,
  });
  assert.deepEqual(all, [
    'connection', 'add', 'type', 'ethernet', 'con-name', '사무실 유선', 'ifname', 'ens224',
    'connection.autoconnect', 'yes', 'connection.autoconnect-priority', '10',
    'ipv4.method', 'manual', 'ipv4.addresses', '10.0.0.5/8,10.0.0.6/8', 'ipv4.gateway', '10.0.0.1',
    'ipv4.dns', '1.1.1.1', 'ipv4.dns-search', 'example.com lab.local', 'ipv4.ignore-auto-dns', 'yes',
    'ipv6.method', 'manual', 'ipv6.addresses', '2001:db8::5/64', 'ipv6.gateway', '2001:db8::1',
    'ipv6.dns', '2001:4860:4860::8888',
    '802-3-ethernet.mtu', '1500', '802-3-ethernet.mac-address', '52:54:00:12:34:56',
    '802-3-ethernet.cloned-mac-address', 'random',
  ]);
  // 이름의 특수문자는 그대로 (배열이라 셸이 해석하지 않음)
  assert.equal(ok({ type: 'ethernet', name: 'my:lan; echo HACK' })[5], 'my:lan; echo HACK');
  // 생성할 때 빈 칸은 넣지 않음
  assert.deepEqual(ok({ type: 'ethernet', name: 'a', ipv4: { method: 'auto', gateway: '', dns: [] } }),
    ['connection', 'add', 'type', 'ethernet', 'con-name', 'a', 'ipv4.method', 'auto']);
});

test('생성: 틀린 입력은 칸 위치와 한국어 안내를 돌려줌', () => {
  const bad = (body, path) => {
    const r = validate(createSchema, body);
    assert.equal(r.ok, false, JSON.stringify(body));
    assert.ok(r.fields.some((f) => f.path === path), `${JSON.stringify(body)} → ${JSON.stringify(r.fields)}`);
    assert.ok(r.fields.every((f) => /[가-힣]/.test(f.message)), `한국어 안내: ${JSON.stringify(r.fields)}`);
  };
  const base = { type: 'ethernet', name: 'a' };
  bad({ ...base, type: 'wifi' }, 'type');
  bad({ name: 'a' }, 'type');
  bad({ ...base, name: '' }, 'name');
  bad({ ...base, name: 'x'.repeat(65) }, 'name');
  bad({ ...base, name: 'a\nb' }, 'name');
  bad({ ...base, name: '-a' }, 'name');                     // S-07
  bad({ ...base, name: 5 }, 'name');
  bad({ ...base, ifname: '-eth0' }, 'ifname');
  bad({ ...base, ifname: 'a b' }, 'ifname');
  bad({ ...base, ipv4: { method: 'manual', addresses: ['999.1.1.1/24'] } }, 'ipv4.addresses.0');
  bad({ ...base, ipv4: { method: 'manual', addresses: ['192.168.1.5'] } }, 'ipv4.addresses.0'); // /접두사 필요
  bad({ ...base, ipv4: { method: 'manual', addresses: ['192.168.1.5/33'] } }, 'ipv4.addresses.0');
  bad({ ...base, ipv4: { method: 'manual' } }, 'ipv4.addresses');            // manual 인데 주소 없음
  bad({ ...base, ipv4: { method: 'manual', addresses: [] } }, 'ipv4.addresses');
  bad({ ...base, ipv6: { method: 'manual' } }, 'ipv6.addresses');
  bad({ ...base, ipv4: { method: 'dhcp' } }, 'ipv4.method');
  bad({ ...base, ipv4: { dns: ['8.8.8.8'] } }, 'ipv4.method');               // 생성 땐 방식 필수
  bad({ ...base, ipv4: { method: 'auto', gateway: '1.2.3' } }, 'ipv4.gateway');
  bad({ ...base, ipv4: { method: 'auto', dns: ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4'] } }, 'ipv4.dns'); // 최대 3개
  bad({ ...base, ipv4: { method: 'auto', dns: ['2001:4860:4860::8888'] } }, 'ipv4.dns.0'); // IPv4 칸에 IPv6
  bad({ ...base, ipv4: { method: 'auto', dns: '8.8.8.8' } }, 'ipv4.dns');     // 배열이어야 함
  bad({ ...base, ipv4: { method: 'auto', dnsSearch: ['-bad.com'] } }, 'ipv4.dnsSearch.0');
  bad({ ...base, ipv6: { method: 'auto', dns: ['8.8.8.8'] } }, 'ipv6.dns.0');
  bad({ ...base, ipv6: { method: 'manual', addresses: ['2001:db8::5/129'] } }, 'ipv6.addresses.0');
  bad({ ...base, ethernet: { mtu: 500 } }, 'ethernet.mtu');
  bad({ ...base, ethernet: { mtu: 9001 } }, 'ethernet.mtu');
  bad({ ...base, ethernet: { mtu: 1500.5 } }, 'ethernet.mtu');
  bad({ ...base, ethernet: { macAddress: '52:54:00:12:34' } }, 'ethernet.macAddress');
  bad({ ...base, ethernet: { clonedMacAddress: 'preserve' } }, 'ethernet.clonedMacAddress');
  bad({ ...base, autoconnectPriority: -1 }, 'autoconnectPriority');           // S-07 때문에 음수 금지
  bad({ ...base, autoconnectPriority: 1000 }, 'autoconnectPriority');
  bad({ ...base, autoconnect: 'yes' }, 'autoconnect');
  // 허용 목록에 없는 키 → 거부 (S-06)
  bad({ ...base, foo: 1 }, '');
  bad({ ...base, ipv4: { method: 'auto', routes: '0.0.0.0/0' } }, 'ipv4');
  bad({ ...base, 'connection.type': 'wifi' }, '');
});

test('편집: 바뀐 칸만, 정식 이름만, 빈 값은 지우기', () => {
  const ok = (patch) => {
    const r = validate(patchSchema, patch);
    assert.equal(r.ok, true, JSON.stringify(r.fields));
    return toModifyArgs(UUID, r.data);
  };
  assert.deepEqual(ok({ name: 'new-name', ifname: 'ens224' }),
    ['connection', 'modify', 'uuid', UUID, 'connection.id', 'new-name', 'connection.interface-name', 'ens224']);
  assert.deepEqual(ok({ ifname: '' }), ['connection', 'modify', 'uuid', UUID, 'connection.interface-name', '']);
  assert.deepEqual(ok({ ifname: null }), ['connection', 'modify', 'uuid', UUID, 'connection.interface-name', '']);
  assert.deepEqual(ok({ ipv4: { gateway: '', dns: [] }, ethernet: { mtu: null } }),
    ['connection', 'modify', 'uuid', UUID, 'ipv4.gateway', '', 'ipv4.dns', '', '802-3-ethernet.mtu', '0']);
  assert.deepEqual(ok({ ipv4: { dns: ['8.8.8.8', '1.1.1.1'] }, autoconnect: true }),
    ['connection', 'modify', 'uuid', UUID, 'connection.autoconnect', 'yes', 'ipv4.dns', '8.8.8.8 1.1.1.1']);
  // 별칭(con-name, gw4 …)은 절대 쓰지 않음
  const args = ok({ name: 'x', ifname: 'ens224', ipv4: { method: 'manual', addresses: ['10.0.0.2/24'], gateway: '10.0.0.1' } });
  for (const alias of ['con-name', 'ifname', 'gw4', 'ip4', 'type']) assert.ok(!args.includes(alias), alias);
});

test('편집: 유형 변경·모르는 키 거부', () => {
  const r1 = validate(patchSchema, { type: 'wifi' });
  assert.equal(r1.ok, false);
  assert.match(r1.fields[0].message, /바꿀 수 없어요/);
  assert.equal(validate(patchSchema, { type: 'ethernet' }).ok, false, '같은 값이어도 type 키 자체를 거부');
  assert.equal(validate(patchSchema, { activate: true }).ok, false);
  assert.equal(validate(patchSchema, { ipv4: { routes: 'x' } }).ok, false);
});

test('편집: 지금 값과 합쳐서 manual 주소 규칙 검사', () => {
  const current = { ipv4: { method: 'manual', addresses: ['10.0.0.2/24'] }, ipv6: { method: 'auto', addresses: [] } };
  assert.equal(patchProblems(current, { ipv4: { addresses: [] } }).length, 1, 'manual 인데 주소를 다 지움');
  assert.equal(patchProblems(current, { ipv4: { method: 'auto', addresses: [] } }).length, 0);
  const auto = { ipv4: { method: 'auto', addresses: [] }, ipv6: { method: 'auto', addresses: [] } };
  assert.equal(patchProblems(auto, { ipv4: { method: 'manual' } })[0].path, 'ipv4.addresses');
  assert.equal(patchProblems(auto, { ipv4: { method: 'manual', addresses: ['10.0.0.2/24'] } }).length, 0);
  assert.equal(patchProblems(auto, { ipv6: { method: 'manual' } })[0].path, 'ipv6.addresses');
});

test('UUID·복제·적용 요청 검사', () => {
  assert.equal(validate(uuidSchema, UUID).ok, true);
  for (const bad of [UUID.toUpperCase(), UUID.slice(1), `${UUID} `, `-${UUID.slice(1)}`, 'office-lan', '']) {
    assert.equal(validate(uuidSchema, bad).ok, false, bad);
  }
  assert.equal(validate(cloneSchema, { name: 'office-lan-copy' }).ok, true);
  assert.equal(validate(cloneSchema, { name: '-x' }).ok, false);
  assert.equal(validate(cloneSchema, {}).ok, false);
  assert.equal(validate(upSchema, {}).ok, true);
  assert.equal(validate(upSchema, { ifname: 'ens224' }).ok, true);
  assert.equal(validate(upSchema, { ifname: '--wait' }).ok, false);
});

test('변환 결과는 모두 nmcli 허용 목록(checkArgs)을 통과', () => {
  const created = validate(createSchema, {
    ...OFFICE_LAN, ipv4: { ...OFFICE_LAN.ipv4, dnsSearch: ['example.com'], ignoreAutoDns: true },
    ethernet: { mtu: 1400, macAddress: '52:54:00:12:34:56', clonedMacAddress: 'stable' }, autoconnectPriority: 5,
  });
  assert.doesNotThrow(() => checkArgs(toNmcliArgs(created.data)));
  const patched = validate(patchSchema, { name: 'b', ifname: '', ipv4: { gateway: '', dns: [] }, ethernet: { mtu: null, macAddress: '' } });
  assert.doesNotThrow(() => checkArgs(toModifyArgs(UUID, patched.data)));
});

test('공유 규칙(public/rules.js): IPv6·CIDR·같은 네트워크 경고', () => {
  for (const ok of ['::1', '2001:db8::5', 'fe80::1', '2001:0db8:0000:0000:0000:0000:0000:0001', '::ffff:192.168.1.1']) assert.ok(isIPv6(ok), ok);
  for (const bad of ['', '1.2.3.4', '2001:db8::5::1', 'gggg::1', '2001:db8::5/64', '[::1]', 'fe80::1%eth0']) assert.ok(!isIPv6(bad), bad);
  assert.ok(isIPv4Cidr('0.0.0.0/0'));
  assert.ok(!isIPv4Cidr('01.2.3.4/24'));
  assert.equal(gatewayInSameNetwork(['192.168.10.50/24'], '192.168.10.1'), true);
  assert.equal(gatewayInSameNetwork(['192.168.10.50/24'], '192.168.11.1'), false);
  assert.equal(gatewayInSameNetwork(['10.1.2.3/8'], '10.200.0.1'), true);
  assert.equal(gatewayInSameNetwork([], '10.200.0.1'), true);
});
