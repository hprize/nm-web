// nmcli 출력 → 화면용 JSON
// 조회 결과는 생성/편집 요청(lib/schema.js)과 "같은 모양"으로 돌려줍니다.
// 그래야 화면이 처음 값과 바뀐 값을 비교해서 "바뀐 칸만" 보낼 수 있습니다 (SPEC 4.2 F-04).

import { parseTerseTable, parseTerseFields, splitList } from './nmcli.js';

export const ETHERNET = '802-3-ethernet';

// 목록의 TYPE 은 긴 이름(802-3-ethernet)으로 나옴 → 화면에는 쉬운 말로 (SPEC 2.3)
const TYPE_LABELS = {
  '802-3-ethernet': '유선', loopback: '루프백', '802-11-wireless': '와이파이', bridge: '브리지',
  bond: '본딩', vlan: 'VLAN', vpn: 'VPN', wireguard: 'WireGuard', 'ip-tunnel': '터널',
};
export const typeLabel = (t) => TYPE_LABELS[t] || t;

// 이 앱이 바꿀 수 있는 것은 유선뿐 — 나머지는 읽기 전용 (docs/DECISIONS.md 4번)
export const isEditableType = (t) => t === ETHERNET;

// 실행할 명령과 그 결과 칸 이름을 한곳에 (SPEC 4.1)
export const LIST_ARGS = ['-t', '-f', 'NAME,UUID,TYPE,DEVICE,ACTIVE', 'connection', 'show'];
const LIST_FIELDS = ['NAME', 'UUID', 'TYPE', 'DEVICE', 'ACTIVE'];
export const DEVICE_ARGS = ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status'];
const DEVICE_FIELDS = ['DEVICE', 'TYPE', 'STATE', 'CONNECTION'];
export const STATUS_ARGS = ['-t', '-f', 'STATE,CONNECTIVITY', 'general', 'status'];
export const DETAIL_FIELDS = 'connection,ipv4,ipv6,802-3-ethernet';
export const detailArgs = (uuid, fields = DETAIL_FIELDS) => ['-t', '-f', fields, 'connection', 'show', 'uuid', uuid];

// 예쁜 출력의 '--'(값 없음)이 섞여 와도 빈 값으로
const clean = (v) => (v === undefined || v === '--' ? '' : v);

export function parseList(stdout) {
  return parseTerseTable(stdout, LIST_FIELDS).map((r) => ({
    name: r.NAME,
    uuid: r.UUID,
    type: r.TYPE,
    typeLabel: typeLabel(r.TYPE),
    device: clean(r.DEVICE),
    active: r.ACTIVE === 'yes',
    editable: isEditableType(r.TYPE),
  }));
}

export function parseDevices(stdout) {
  return parseTerseTable(stdout, DEVICE_FIELDS).map((r) => ({
    device: r.DEVICE, type: r.TYPE, state: r.STATE, connection: clean(r.CONNECTION),
  }));
}

export function parseStatus(stdout) {
  const [row] = parseTerseTable(stdout, ['STATE', 'CONNECTIVITY']);
  return { running: true, state: row?.STATE ?? '', connectivity: row?.CONNECTIVITY ?? '' };
}

const yes = (v) => clean(v) === 'yes';
const toInt = (v, fallback) => (/^\d+$/.test(clean(v)) ? Number(v) : fallback);

// 상세 출력 → SPEC 3장 속성만 골라서 화면용 JSON (그 밖의 속성은 버림)
export function parseDetail(stdout) {
  const f = parseTerseFields(stdout);
  const nmType = clean(f['connection.type']);
  const ethernet = nmType === ETHERNET;
  const mtu = clean(f['802-3-ethernet.mtu']);
  return {
    uuid: clean(f['connection.uuid']),
    name: clean(f['connection.id']),
    type: ethernet ? 'ethernet' : nmType,
    nmType,
    typeLabel: typeLabel(nmType),
    editable: isEditableType(nmType),
    ifname: clean(f['connection.interface-name']),
    autoconnect: yes(f['connection.autoconnect']),
    autoconnectPriority: toInt(f['connection.autoconnect-priority'], 0),
    ipv4: {
      method: clean(f['ipv4.method']),
      addresses: splitList(clean(f['ipv4.addresses'])),
      gateway: clean(f['ipv4.gateway']),
      dns: splitList(clean(f['ipv4.dns'])),
      dnsSearch: splitList(clean(f['ipv4.dns-search'])),
      ignoreAutoDns: yes(f['ipv4.ignore-auto-dns']),
    },
    ipv6: {
      method: clean(f['ipv6.method']),
      addresses: splitList(clean(f['ipv6.addresses'])),
      gateway: clean(f['ipv6.gateway']),
      dns: splitList(clean(f['ipv6.dns'])),
    },
    ethernet: ethernet
      ? {
        mtu: mtu === '' || mtu === 'auto' || mtu === '0' ? null : toInt(mtu, null), // null = 자동
        macAddress: clean(f['802-3-ethernet.mac-address']),
        clonedMacAddress: clean(f['802-3-ethernet.cloned-mac-address']),
      }
      : null,
  };
}
