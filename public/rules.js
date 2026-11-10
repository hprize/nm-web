// 입력 검사 규칙 — 화면(브라우저)과 서버가 "같은 파일"을 함께 씁니다 (SPEC 5장 표)
// 화면은 이 파일로 빨간 안내를 미리 보여 주고, 서버(lib/schema.js)는 이 규칙으로 진짜 검사를 합니다.
// 브라우저에서도 돌아야 해서 Node 전용 기능이나 외부 라이브러리를 쓰지 않습니다.

export const NAME_MAX = 64;
export const DNS_MAX = 3;
export const DNS_SEARCH_MAX = 6;
export const MTU_MIN = 576;
export const MTU_MAX = 9000;
export const PRIORITY_MIN = 0;   // S-07: '-' 로 시작하는 값은 거부하므로 음수는 받지 않음
export const PRIORITY_MAX = 999;

export const IPV4_METHODS = ['auto', 'manual', 'link-local', 'disabled'];
export const IPV6_METHODS = ['auto', 'manual', 'dhcp', 'link-local', 'ignore', 'disabled'];
export const CLONED_MAC_WORDS = ['random', 'stable'];

// 화면에 보여 줄 안내 문구 (SPEC 5장 예시)
export const MSG = {
  name: '이름은 1~64자로 입력하세요 (줄바꿈·제어문자, 맨 앞 "-" 는 안 돼요)',
  ifname: '장치 이름이 올바르지 않아요 (예: ens224)',
  ipv4Cidr: '예: 192.168.10.50/24',
  ipv4: '예: 192.168.10.1',
  ipv6Cidr: '예: 2001:db8::5/64',
  ipv6: '예: 2001:db8::1',
  dns4: '예: 8.8.8.8',
  dns6: '예: 2001:4860:4860::8888',
  dnsMax: `DNS는 최대 ${DNS_MAX}개까지 넣을 수 있어요`,
  domain: '예: example.com',
  mtu: `보통 1500을 써요 (${MTU_MIN}~${MTU_MAX})`,
  mac: '예: 52:54:00:12:34:56',
  clonedMac: '예: 52:54:00:12:34:56 또는 random / stable',
  priority: `0~${PRIORITY_MAX} 사이의 정수를 넣어 주세요 (클수록 먼저 연결)`,
  manualNeedsAddress: '방식이 "수동(manual)"이면 주소를 하나 이상 넣어야 해요',
  gatewayOtherNet: '게이트웨이가 다른 네트워크에 있어요',
};

// 제어문자(줄바꿈 포함) 검사
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function isValidName(s) {
  return typeof s === 'string' && [...s].length >= 1 && [...s].length <= NAME_MAX
    && !CONTROL_RE.test(s) && !s.startsWith('-');
}

// 리눅스 장치 이름: 1~15자, 영문·숫자·. _ -  (맨 앞 '-' 금지)
export const isIfname = (s) => typeof s === 'string' && /^[A-Za-z0-9._][A-Za-z0-9._-]{0,14}$/.test(s);

// 0~255 네 덩어리. 앞자리 0(예: 010)은 헷갈리므로 거부
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_RE = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
export const isIPv4 = (s) => typeof s === 'string' && IPV4_RE.test(s);

export function isIPv4Cidr(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(/^([^/]+)\/(\d{1,2})$/);
  return Boolean(m) && isIPv4(m[1]) && Number(m[2]) <= 32;
}

// IPv6 검사: 브라우저·Node 모두 있는 URL 해석기에 [주소] 로 넣어 보면 올바른지 알 수 있음
export function isIPv6(s) {
  if (typeof s !== 'string' || !s.includes(':') || !/^[0-9A-Fa-f:.]+$/.test(s)) return false;
  try { new URL(`http://[${s}]/`); return true; } catch { return false; }
}

export function isIPv6Cidr(s) {
  if (typeof s !== 'string') return false;
  const m = s.match(/^([^/]+)\/(\d{1,3})$/);
  return Boolean(m) && isIPv6(m[1]) && Number(m[2]) <= 128;
}

export const isMac = (s) => typeof s === 'string' && /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(s);
export const isClonedMac = (s) => isMac(s) || CLONED_MAC_WORDS.includes(s);

// DNS 검색 도메인: 글자·숫자·하이픈 덩어리를 점으로 이은 것
export const isDomain = (s) => typeof s === 'string' && s.length <= 253
  && /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(s);

export const isMtu = (n) => Number.isInteger(n) && n >= MTU_MIN && n <= MTU_MAX;
export const isPriority = (n) => Number.isInteger(n) && n >= PRIORITY_MIN && n <= PRIORITY_MAX;

// 게이트웨이가 주소들 중 하나와 같은 네트워크인지 (경고용 — 막지는 않음)
export function gatewayInSameNetwork(addresses, gateway) {
  if (!isIPv4(gateway) || !Array.isArray(addresses) || addresses.length === 0) return true;
  const toNum = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
  return addresses.filter(isIPv4Cidr).some((cidr) => {
    const [ip, p] = cidr.split('/');
    const prefix = Number(p);
    if (prefix === 0) return true;
    const size = 2 ** (32 - prefix);
    return Math.floor(toNum(ip) / size) === Math.floor(toNum(gateway) / size);
  });
}
