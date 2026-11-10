// 입력 검사(zod)와 nmcli 인자 변환
// - 규칙 자체는 public/rules.js 에 있고(화면과 공유), 여기서는 그것을 zod 모양으로 엮음
// - 허용 목록 방식: 정해진 키만 통과, 모르는 키가 오면 400 (S-06)
// - 검사를 통과한 JSON 만 nmcli 인자 "배열"로 바꿈 (S-05)

import { z } from 'zod';
import { isIPv6 as nodeIsIPv6 } from 'node:net';
import { UUID_RE } from './nmcli.js';
import {
  MSG, IPV4_METHODS, IPV6_METHODS, DNS_MAX, DNS_SEARCH_MAX,
  isValidName, isIfname, isIPv4, isIPv4Cidr, isIPv6, isIPv6Cidr, isMac, isClonedMac, isDomain, isMtu, isPriority,
} from '../public/rules.js';

const ADDR_MAX = 16;

// ---------- 작은 부품 ----------
// 문자열 + 검사 함수 → 틀리면 같은 한국어 안내
const str = (msg, check) => z.string({ error: msg }).refine(check, { error: msg });
// 빈 값("")도 허용하는 문자열 — 편집에서 "지우기", 생성에서 "안 넣기"
const strOrEmpty = (msg, check) => z.string({ error: msg }).refine((s) => s === '' || check(s), { error: msg });
const list = (item, max, maxMsg) => z.array(item, { error: '목록(배열) 형식으로 보내 주세요' }).max(max, { error: maxMsg });
const bool = z.boolean({ error: '예/아니오(true/false)로 보내 주세요' });

// 모르는 키가 있으면 "허용되지 않은 항목" 이라고 알려 주는 객체
const strict = (shape) => z.strictObject(shape, {
  error: (iss) => (iss.code === 'unrecognized_keys'
    ? `허용되지 않은 항목이에요: ${iss.keys.join(', ')}`
    : '형식이 올바르지 않아요 (객체로 보내 주세요)'),
});

// IPv6 는 화면 규칙 + Node 내장 검사를 둘 다 통과해야 함 (서버 쪽은 한 번 더 엄격하게)
const ipv6Ok = (s) => isIPv6(s) && nodeIsIPv6(s);
const ipv6CidrOk = (s) => isIPv6Cidr(s) && nodeIsIPv6(s.split('/')[0]);

const fields = {
  name: str(MSG.name, isValidName),
  ifname: strOrEmpty(MSG.ifname, isIfname).nullable(), // '' 또는 null = 아무 장치나
  autoconnectPriority: z.number({ error: MSG.priority }).refine(isPriority, { error: MSG.priority }),
  ipv4: {
    method: z.enum(IPV4_METHODS, { error: `IPv4 방식은 ${IPV4_METHODS.join(' / ')} 중 하나예요` }),
    addresses: list(str(MSG.ipv4Cidr, isIPv4Cidr), ADDR_MAX, `주소는 최대 ${ADDR_MAX}개예요`),
    gateway: strOrEmpty(MSG.ipv4, isIPv4),
    dns: list(str(MSG.dns4, isIPv4), DNS_MAX, MSG.dnsMax),
    dnsSearch: list(str(MSG.domain, isDomain), DNS_SEARCH_MAX, `검색 도메인은 최대 ${DNS_SEARCH_MAX}개예요`),
    ignoreAutoDns: bool,
  },
  ipv6: {
    method: z.enum(IPV6_METHODS, { error: `IPv6 방식은 ${IPV6_METHODS.join(' / ')} 중 하나예요` }),
    addresses: list(str(MSG.ipv6Cidr, ipv6CidrOk), ADDR_MAX, `주소는 최대 ${ADDR_MAX}개예요`),
    gateway: strOrEmpty(MSG.ipv6, ipv6Ok),
    dns: list(str(MSG.dns6, ipv6Ok), DNS_MAX, MSG.dnsMax),
  },
  ethernet: {
    mtu: z.number({ error: MSG.mtu }).refine(isMtu, { error: MSG.mtu }).nullable(), // null = 자동
    macAddress: strOrEmpty(MSG.mac, isMac),
    clonedMacAddress: strOrEmpty(MSG.clonedMac, isClonedMac),
  },
};

// 모든 칸을 "넣어도 되고 안 넣어도 되게"
const optionalAll = (shape) => Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.optional()]));

// manual 이면 주소 필수 (SPEC 4.2 F-03 — nmcli 도 코드 4로 거부)
function requireAddressForManual(data, ctx) {
  for (const fam of ['ipv4', 'ipv6']) {
    if (data[fam]?.method === 'manual' && !(data[fam].addresses?.length > 0)) {
      ctx.addIssue({ code: 'custom', path: [fam, 'addresses'], message: MSG.manualNeedsAddress });
    }
  }
}

// ---------- 생성 (POST /api/connections) — SPEC 6장 예시와 같은 모양 ----------
export const createSchema = strict({
  type: z.literal('ethernet', { error: '유형은 유선(ethernet)만 지원해요' }),
  name: fields.name,
  ifname: fields.ifname.optional(),
  autoconnect: bool.optional(),
  autoconnectPriority: fields.autoconnectPriority.optional(),
  ipv4: strict({ ...optionalAll(fields.ipv4), method: fields.ipv4.method }).optional(),
  ipv6: strict({ ...optionalAll(fields.ipv6), method: fields.ipv6.method }).optional(),
  ethernet: strict(optionalAll(fields.ethernet)).optional(),
  activate: bool.optional(),
}).superRefine(requireAddressForManual);

// ---------- 편집 (PATCH /api/connections/:uuid) — 바뀐 칸만 ----------
export const patchSchema = strict({
  // 유형은 만든 뒤 바꿀 수 없음 (nmcli 도 거부) — 키가 있기만 해도 거부
  type: z.never({ error: '유형(connection.type)은 만든 뒤에 바꿀 수 없어요' }).optional(),
  name: fields.name.optional(),
  ifname: fields.ifname.optional(),
  autoconnect: bool.optional(),
  autoconnectPriority: fields.autoconnectPriority.optional(),
  ipv4: strict(optionalAll(fields.ipv4)).optional(),
  ipv6: strict(optionalAll(fields.ipv6)).optional(),
  ethernet: strict(optionalAll(fields.ethernet)).optional(),
});

// ---------- 그 밖의 요청 ----------
export const uuidSchema = z.string().regex(UUID_RE, { error: 'UUID 형식이 올바르지 않아요' });
export const cloneSchema = strict({ name: fields.name });
export const upSchema = strict({ ifname: str(MSG.ifname, isIfname).optional() });

// 검사 결과를 { ok, data } 또는 { ok:false, fields:[{ path, message }] } 로
export function validate(schema, input) {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

// ---------- JSON → nmcli 인자 배열 ----------
const yesNo = (b) => (b ? 'yes' : 'no');
const join = (sep) => (arr) => arr.join(sep);

// [JSON 위치, 정식 속성 이름(SPEC 3장), 값 바꾸기, 빈 값일 때 modify 에 넣을 값]
// 이 표에 없는 키는 절대 nmcli 로 가지 않음 (허용 목록)
const PROPS = [
  [['autoconnect'], 'connection.autoconnect', yesNo],
  [['autoconnectPriority'], 'connection.autoconnect-priority', String],
  [['ipv4', 'method'], 'ipv4.method', String],
  [['ipv4', 'addresses'], 'ipv4.addresses', join(',')],
  [['ipv4', 'gateway'], 'ipv4.gateway', String],
  [['ipv4', 'dns'], 'ipv4.dns', join(' ')],          // 여러 DNS 는 공백으로 이은 "한 개의 인자"
  [['ipv4', 'dnsSearch'], 'ipv4.dns-search', join(' ')],
  [['ipv4', 'ignoreAutoDns'], 'ipv4.ignore-auto-dns', yesNo],
  [['ipv6', 'method'], 'ipv6.method', String],
  [['ipv6', 'addresses'], 'ipv6.addresses', join(',')],
  [['ipv6', 'gateway'], 'ipv6.gateway', String],
  [['ipv6', 'dns'], 'ipv6.dns', join(' ')],
  [['ethernet', 'mtu'], '802-3-ethernet.mtu', String, '0'], // 0 = 자동
  [['ethernet', 'macAddress'], '802-3-ethernet.mac-address', String],
  [['ethernet', 'clonedMacAddress'], '802-3-ethernet.cloned-mac-address', String],
];

const getPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isEmpty = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0);

function pushProps(args, data, mode) {
  for (const [path, prop, convert, emptyValue = ''] of PROPS) {
    const v = getPath(data, path);
    if (v === undefined) continue;
    if (isEmpty(v)) {
      if (mode === 'modify') args.push(prop, emptyValue); // 편집: 빈 값 = 지우기
      continue;                                           // 생성: 빈 칸은 그냥 안 넣음 (기본값)
    }
    args.push(prop, convert(v));
  }
  return args;
}

// 생성: 공통 옵션 type / con-name / ifname 은 add 문법 그대로, 나머지는 정식 이름 (TASKS 3단계)
export function toNmcliArgs(data) {
  const args = ['connection', 'add', 'type', 'ethernet', 'con-name', data.name];
  if (data.ifname) args.push('ifname', data.ifname); // "아무 장치나"면 ifname 을 아예 넣지 않음
  return pushProps(args, data, 'add');
}

// 편집: 별칭 없이 정식 이름만 (connection.id, connection.interface-name …)
export function toModifyArgs(uuid, patch) {
  const args = ['connection', 'modify', 'uuid', uuid];
  if (patch.name !== undefined) args.push('connection.id', patch.name);
  if (patch.ifname !== undefined) args.push('connection.interface-name', patch.ifname ?? '');
  pushProps(args, patch, 'modify');
  return args;
}

// 편집 결과(지금 값 + 바뀐 값)가 규칙에 맞는지 — 예: 주소를 다 지웠는데 방식이 manual 로 남는 경우
export function patchProblems(current, patch) {
  const merged = {};
  for (const fam of ['ipv4', 'ipv6']) {
    merged[fam] = { ...current[fam], ...patch[fam] };
  }
  const problems = [];
  requireAddressForManual(merged, { addIssue: (i) => problems.push({ path: i.path.join('.'), message: i.message }) });
  return problems;
}
