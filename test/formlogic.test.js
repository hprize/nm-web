// 7단계 테스트: 화면 폼 계산 (public/formlogic.js) — 브라우저 없이 Node 로 확인
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyValues, valuesFromConnection, validateForm, toCreateBody, toPatch, changedPaths, isVisible, splitInput,
} from '../public/formlogic.js';
import { createSchema, patchSchema, validate } from '../lib/schema.js';

const officeValues = () => {
  const v = emptyValues();
  v.name = 'office-lan'; v.ifname = 'eth0'; v.autoconnect = false;
  v.ipv4 = { ...v.ipv4, method: 'manual', addresses: ['192.168.10.50/24'], gateway: '192.168.10.1', dns: ['8.8.8.8', '1.1.1.1'] };
  v.ipv6 = { ...v.ipv6, method: 'disabled' };
  return v;
};

// 상세 API 가 돌려주는 모양 (lib/profile.js parseDetail)
const detail = () => ({
  uuid: 'x', name: 'lab', type: 'ethernet', nmType: '802-3-ethernet', typeLabel: '유선', editable: true,
  ifname: 'ens224', autoconnect: true, autoconnectPriority: 0,
  ipv4: { method: 'manual', addresses: ['10.0.0.5/24'], gateway: '10.0.0.1', dns: ['1.1.1.1'], dnsSearch: [], ignoreAutoDns: false },
  ipv6: { method: 'auto', addresses: [], gateway: '', dns: [] },
  ethernet: { mtu: null, macAddress: '', clonedMacAddress: '' },
});

test('splitInput: 쉼표·공백·줄바꿈으로 나눔', () => {
  assert.deepEqual(splitInput('8.8.8.8, 1.1.1.1\n9.9.9.9  '), ['8.8.8.8', '1.1.1.1', '9.9.9.9']);
  assert.deepEqual(splitInput(''), []);
});

test('폼 → 생성 요청: SPEC 6장 예시와 같은 모양, 서버 검사 통과', () => {
  const body = toCreateBody(officeValues(), false);
  assert.deepEqual(body, {
    type: 'ethernet', name: 'office-lan', ifname: 'eth0', autoconnect: false,
    ipv4: { method: 'manual', addresses: ['192.168.10.50/24'], gateway: '192.168.10.1', dns: ['8.8.8.8', '1.1.1.1'] },
    ipv6: { method: 'disabled' },
  });
  assert.equal(validate(createSchema, body).ok, true);
  assert.equal(toCreateBody(officeValues(), true).activate, true);
});

test('숨겨진 칸은 생성 요청에 넣지 않음 (auto 로 바꾸면 주소 칸 무시)', () => {
  const v = officeValues();
  v.ipv4.method = 'auto';
  const body = toCreateBody(v);
  assert.deepEqual(body.ipv4, { method: 'auto', dns: ['8.8.8.8', '1.1.1.1'] });
  assert.equal(isVisible('ipv4.addresses', v), false);
  assert.equal(isVisible('ipv4.dns', v), true);
  v.ipv4.method = 'disabled';
  assert.deepEqual(toCreateBody(v).ipv4, { method: 'disabled' });
});

test('편집: 바뀐 칸만 patch 로, 서버 검사 통과', () => {
  const original = valuesFromConnection(detail());
  assert.deepEqual(toPatch(original, structuredClone(original)), {}, '안 바꾸면 빈 patch');

  const v = structuredClone(original);
  v.name = 'lab-2';
  v.ipv4.dns = ['8.8.8.8', '1.1.1.1'];
  v.ethernet.mtu = 1400;
  const patch = toPatch(original, v);
  assert.deepEqual(patch, { name: 'lab-2', ipv4: { dns: ['8.8.8.8', '1.1.1.1'] }, ethernet: { mtu: 1400 } });
  assert.deepEqual(changedPaths(patch), ['name', 'ipv4.dns', 'ethernet.mtu']);
  assert.equal(validate(patchSchema, patch).ok, true);
});

test('편집: manual → auto 로 바꾸면 숨겨진 주소·게이트웨이를 지움', () => {
  const original = valuesFromConnection(detail());
  const v = structuredClone(original);
  v.ipv4.method = 'auto';
  assert.deepEqual(toPatch(original, v), { ipv4: { method: 'auto', addresses: [], gateway: '' } });
});

test('편집: 방식을 안 바꿨으면 숨겨진 칸은 원래 값 그대로 (손대지 않은 값을 지우지 않음)', () => {
  const c = detail();
  c.ipv4 = { ...c.ipv4, method: 'auto', addresses: ['10.0.0.9/24'] }; // 밖에서 만든 특이한 설정
  const original = valuesFromConnection(c);
  const v = structuredClone(original);
  v.ipv4.addresses = []; // 숨겨진 칸 (auto) — 무시돼야 함
  v.autoconnect = false;
  assert.deepEqual(toPatch(original, v), { autoconnect: false });
});

test('입력 검사: 틀린 칸마다 안내, 게이트웨이 다른 네트워크는 경고만', () => {
  const v = officeValues();
  v.name = '';
  v.ipv4.addresses = ['192.168.10.50'];
  v.ipv4.dns = ['8.8.8.8', '1.1.1.1', '9.9.9.9', '8.8.4.4'];
  v.ethernet.mtu = 100;
  v.ethernet.macAddress = 'zz';
  const r = validateForm(v);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['ethernet.macAddress', 'ethernet.mtu', 'ipv4.addresses', 'ipv4.dns', 'name']);

  const w = officeValues();
  w.ipv4.gateway = '192.168.99.1';
  const r2 = validateForm(w);
  assert.equal(r2.ok, true, '경고는 저장을 막지 않음');
  assert.match(r2.warnings['ipv4.gateway'], /다른 네트워크/);

  const m = emptyValues();
  m.name = 'a'; m.ipv4.method = 'manual';
  assert.match(validateForm(m).errors['ipv4.addresses'], /manual/);
});

test('입력 검사: 편집에서 손대지 않은 칸(NetworkManager 원래 값)은 검사하지 않음', () => {
  const c = detail();
  c.ethernet.clonedMacAddress = 'preserve'; // 이 앱 규칙에는 없지만 NM 에는 있는 값
  const original = valuesFromConnection(c);
  const v = structuredClone(original);
  v.name = 'renamed';
  assert.equal(validateForm(v, original).ok, true);
  v.ethernet.clonedMacAddress = 'preserve2';
  assert.equal(validateForm(v, original).ok, false, '바꾼 칸은 검사');
});
