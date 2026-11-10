// 생성·편집 폼의 "계산" 부분 (화면 그리기와 분리 → Node 테스트로 확인 가능)
// - 어떤 칸을 보여 줄지 (IPv4 방식에 따라 주소 칸 표시/숨김, SPEC 5장 S-3)
// - 입력 검사 (public/rules.js — 서버와 같은 규칙)
// - 생성 요청 만들기 / 편집에서 "바뀐 칸만" 골라내기 (SPEC 4.2 F-04)

import {
  MSG, DNS_MAX, DNS_SEARCH_MAX, isValidName, isIfname, isIPv4, isIPv4Cidr, isIPv6, isIPv6Cidr,
  isMac, isClonedMac, isDomain, isMtu, isPriority, gatewayInSameNetwork,
} from './rules.js';

// 폼이 다루는 칸 (서버 JSON 위치와 같음)
export const FIELD_PATHS = [
  'name', 'ifname', 'autoconnect', 'autoconnectPriority',
  'ipv4.method', 'ipv4.addresses', 'ipv4.gateway', 'ipv4.dns', 'ipv4.dnsSearch', 'ipv4.ignoreAutoDns',
  'ipv6.method', 'ipv6.addresses', 'ipv6.gateway', 'ipv6.dns',
  'ethernet.mtu', 'ethernet.macAddress', 'ethernet.clonedMacAddress',
];

export const FIELD_LABELS = {
  name: '프로파일 이름', ifname: '연결할 장치', autoconnect: '자동 연결', autoconnectPriority: '자동 연결 우선순위',
  'ipv4.method': 'IPv4 방식', 'ipv4.addresses': 'IPv4 주소', 'ipv4.gateway': 'IPv4 게이트웨이',
  'ipv4.dns': 'IPv4 DNS', 'ipv4.dnsSearch': 'DNS 검색 도메인', 'ipv4.ignoreAutoDns': '자동 DNS 무시',
  'ipv6.method': 'IPv6 방식', 'ipv6.addresses': 'IPv6 주소', 'ipv6.gateway': 'IPv6 게이트웨이', 'ipv6.dns': 'IPv6 DNS',
  'ethernet.mtu': 'MTU', 'ethernet.macAddress': '고정할 MAC', 'ethernet.clonedMacAddress': '바꿔 쓸 MAC',
};

// 새로 만들 때의 처음 값 (nmcli 기본값과 같게)
export function emptyValues() {
  return {
    name: '', ifname: '', autoconnect: true, autoconnectPriority: 0,
    ipv4: { method: 'auto', addresses: [], gateway: '', dns: [], dnsSearch: [], ignoreAutoDns: false },
    ipv6: { method: 'auto', addresses: [], gateway: '', dns: [] },
    ethernet: { mtu: null, macAddress: '', clonedMacAddress: '' },
  };
}

// 상세 조회 결과에서 폼이 쓰는 칸만 꺼내기
export function valuesFromConnection(c) {
  const e = emptyValues();
  const v = {};
  for (const path of FIELD_PATHS) setPath(v, path, getPath(c, path) ?? getPath(e, path));
  return v;
}

export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

// "8.8.8.8, 1.1.1.1" / 줄바꿈 / 공백 → 배열
export const splitInput = (text) => String(text ?? '').split(/[\s,]+/).filter(Boolean);

// 방식에 따라 보여 줄 칸
export function isVisible(path, v) {
  switch (path) {
    case 'ipv4.addresses': case 'ipv4.gateway': return v.ipv4.method === 'manual';
    case 'ipv4.dns': case 'ipv4.dnsSearch': return ['auto', 'manual'].includes(v.ipv4.method);
    case 'ipv4.ignoreAutoDns': return v.ipv4.method === 'auto';
    case 'ipv6.addresses': case 'ipv6.gateway': return v.ipv6.method === 'manual';
    case 'ipv6.dns': return ['auto', 'dhcp', 'manual'].includes(v.ipv6.method);
    default: return true;
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 입력 검사. original(편집 전 값)을 주면, 손대지 않은 칸은 검사하지 않음
// (NetworkManager 가 원래 갖고 있던 값이 이 앱 규칙보다 넓을 수 있어서 — 예: cloned MAC 'preserve')
export function validateForm(v, original = null) {
  const errors = {};
  const warnings = {};
  const err = (path, msg) => {
    if (!isVisible(path, v) || errors[path]) return;
    if (original && same(getPath(v, path), getPath(original, path))
      && (!path.includes('.') || same(getPath(v, path.split('.')[0] + '.method'), getPath(original, path.split('.')[0] + '.method')))) return;
    errors[path] = msg;
  };

  if (!isValidName(v.name)) err('name', MSG.name);
  if (v.ifname !== '' && !isIfname(v.ifname)) err('ifname', MSG.ifname);
  if (!isPriority(v.autoconnectPriority)) err('autoconnectPriority', MSG.priority);

  // IPv4
  if (v.ipv4.method === 'manual' && v.ipv4.addresses.length === 0) err('ipv4.addresses', MSG.manualNeedsAddress);
  if (v.ipv4.addresses.some((a) => !isIPv4Cidr(a))) err('ipv4.addresses', MSG.ipv4Cidr);
  if (v.ipv4.gateway && !isIPv4(v.ipv4.gateway)) err('ipv4.gateway', MSG.ipv4);
  else if (v.ipv4.gateway && isVisible('ipv4.gateway', v) && !gatewayInSameNetwork(v.ipv4.addresses, v.ipv4.gateway)) {
    warnings['ipv4.gateway'] = MSG.gatewayOtherNet; // 경고만 — 저장은 막지 않음
  }
  if (v.ipv4.dns.length > DNS_MAX) err('ipv4.dns', MSG.dnsMax);
  else if (v.ipv4.dns.some((d) => !isIPv4(d))) err('ipv4.dns', MSG.dns4);
  if (v.ipv4.dnsSearch.length > DNS_SEARCH_MAX) err('ipv4.dnsSearch', `검색 도메인은 최대 ${DNS_SEARCH_MAX}개예요`);
  else if (v.ipv4.dnsSearch.some((d) => !isDomain(d))) err('ipv4.dnsSearch', MSG.domain);

  // IPv6
  if (v.ipv6.method === 'manual' && v.ipv6.addresses.length === 0) err('ipv6.addresses', MSG.manualNeedsAddress);
  if (v.ipv6.addresses.some((a) => !isIPv6Cidr(a))) err('ipv6.addresses', MSG.ipv6Cidr);
  if (v.ipv6.gateway && !isIPv6(v.ipv6.gateway)) err('ipv6.gateway', MSG.ipv6);
  if (v.ipv6.dns.length > DNS_MAX) err('ipv6.dns', MSG.dnsMax);
  else if (v.ipv6.dns.some((d) => !isIPv6(d))) err('ipv6.dns', MSG.dns6);

  // 유선
  if (v.ethernet.mtu !== null && !isMtu(v.ethernet.mtu)) err('ethernet.mtu', MSG.mtu);
  if (v.ethernet.macAddress && !isMac(v.ethernet.macAddress)) err('ethernet.macAddress', MSG.mac);
  if (v.ethernet.clonedMacAddress && !isClonedMac(v.ethernet.clonedMacAddress)) err('ethernet.clonedMacAddress', MSG.clonedMac);

  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

const isEmpty = (x) => x === null || x === '' || x === false || (Array.isArray(x) && x.length === 0);

// 생성 요청 (SPEC 6장 예시와 같은 모양). 숨겨진 칸·빈 칸은 보내지 않음
export function toCreateBody(v, activate = false) {
  const body = { type: 'ethernet', name: v.name, autoconnect: v.autoconnect };
  if (v.ifname) body.ifname = v.ifname; // 비우면 "아무 장치나"
  if (v.autoconnectPriority) body.autoconnectPriority = v.autoconnectPriority;
  for (const fam of ['ipv4', 'ipv6', 'ethernet']) {
    const part = {};
    for (const path of FIELD_PATHS.filter((p) => p.startsWith(fam + '.'))) {
      const val = getPath(v, path);
      if (path.endsWith('.method') || (isVisible(path, v) && !isEmpty(val))) part[path.split('.')[1]] = val;
    }
    if (Object.keys(part).length) body[fam] = part;
  }
  if (activate) body.activate = true;
  return body;
}

// 편집: 처음 불러온 값과 비교해 바뀐 칸만 (SPEC 4.2 F-04)
// 숨겨진 칸: 방식을 바꿨으면 비우고(예: manual → auto 면 주소 지우기), 아니면 원래 값 그대로 둠
export function toPatch(original, v) {
  const empty = emptyValues();
  const patch = {};
  for (const path of FIELD_PATHS) {
    let next = getPath(v, path);
    if (!isVisible(path, v)) {
      const fam = path.split('.')[0];
      const methodChanged = getPath(v, `${fam}.method`) !== getPath(original, `${fam}.method`);
      next = methodChanged ? getPath(empty, path) : getPath(original, path);
    }
    if (!same(next, getPath(original, path))) setPath(patch, path, next);
  }
  return patch;
}

// 바뀐 칸 목록 (확인 창에 보여 주기용)
export function changedPaths(patch) {
  return FIELD_PATHS.filter((p) => getPath(patch, p) !== undefined);
}
