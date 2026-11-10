// nm-web 화면 (SPEC 5장 S-1 ~ S-5)
// 주소(#) 로 화면을 바꿉니다:  #/ 목록 · #/c/<UUID> 상세 · #/new 새로 만들기 · #/edit/<UUID> 편집
// 화면 검사는 편의용이고, 진짜 검사는 서버가 합니다 (SPEC 5장).

import { api } from './api.js';
import { h, clear, append } from './dom.js';
import {
  emptyValues, valuesFromConnection, validateForm, toCreateBody, toPatch, changedPaths,
  isVisible, splitInput, FIELD_PATHS, FIELD_LABELS,
} from './formlogic.js';
import { IPV4_METHODS, IPV6_METHODS, NAME_MAX, MTU_MIN, MTU_MAX, PRIORITY_MAX, MSG, isValidName } from './rules.js';

const $ = (sel) => document.querySelector(sel);

const METHOD_LABELS = {
  ipv4: { auto: '자동 (DHCP)', manual: '수동 (고정 IP)', 'link-local': '링크 로컬 (169.254.x.x)', disabled: '사용 안 함' },
  ipv6: { auto: '자동 (SLAAC)', dhcp: 'DHCPv6 만', manual: '수동 (고정 IP)', 'link-local': '링크 로컬만', ignore: '무시', disabled: '사용 안 함' },
};
const STATE_LABELS = {
  connected: '연결됨', connecting: '연결 중', disconnected: '연결 안 됨', asleep: '쉬는 중', disconnecting: '끊는 중',
  'connected (local only)': '연결됨 (내부망만)', 'connected (site only)': '연결됨 (사이트만)',
};
const CONNECTIVITY_LABELS = { full: '인터넷 됨', limited: '제한됨', portal: '로그인 필요', none: '없음', unknown: '알 수 없음' };
const methodLabel = (fam, m) => METHOD_LABELS[fam][m] || m || '—';

let connections = []; // 마지막으로 읽은 프로파일 목록
let renderSeq = 0;    // 화면을 빨리 바꿀 때 늦게 도착한 옛 결과가 덮어쓰지 않게

// ---------- 공통: 알림 · 실행 중 표시 · 이동 ----------

function notify(kind, title, detail = '') {
  const box = $('#notice');
  clear(box);
  box.className = `notice ${kind}`;
  append(box, [
    h('button', { type: 'button', class: 'close', 'aria-label': '닫기', onclick: () => { box.hidden = true; } }, '×'),
    h('strong', {}, title),
    detail ? h('pre', {}, detail) : null,
  ]);
  box.hidden = false;
}

// API 결과를 알림으로: 성공이면 초록, 실패면 빨강 + 종료 코드 + nmcli 원래 문구 (SPEC 8장)
function showResult(res, okText) {
  if (res.ok) {
    notify('ok', okText || res.hint || '완료했어요', res.nmcli?.message || '');
    return;
  }
  const lines = [];
  if (res.nmcli) lines.push(`nmcli 종료 코드: ${res.nmcli.exitCode}`, res.nmcli.message);
  for (const f of res.fields ?? []) lines.push(`${FIELD_LABELS[fieldKey(f.path)] || f.path || '요청'}: ${f.message}`);
  notify('fail', res.hint || '실패했어요', lines.filter(Boolean).join('\n'));
}

let busyCount = 0;
async function withBusy(text, task) {
  busyCount += 1;
  $('#busy-text').textContent = text;
  $('#busy').hidden = false;
  try {
    return await task();
  } finally {
    busyCount -= 1;
    if (busyCount === 0) $('#busy').hidden = true;
  }
}

// 바꾸는 요청 공통: 실행 중 표시 → 결과 알림 → 상태·기록 새로고침
async function change(busyText, method, path, body, okText) {
  const res = await withBusy(busyText, () => api(method, path, body));
  showResult(res, okText);
  if (res.data?.connections) connections = res.data.connections;
  refreshStatus();
  refreshLogs();
  return res;
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

const setView = (...nodes) => clear($('#view')).append(...nodes);
const loading = () => setView(h('section', {}, h('p', { class: 'muted' }, '불러오는 중…')));
const backLink = (hash = '#/', text = '← 목록으로') => h('a', { href: hash }, text);
const activeBadge = (on) => h('span', { class: `badge ${on ? 'on' : 'off'}` }, on ? '켜짐' : '꺼짐');

// ---------- F-10 상태 표시줄 ----------

async function refreshStatus() {
  const res = await api('GET', '/status');
  const el = $('#status');
  if (res.ok) {
    const { state, connectivity } = res.data;
    el.className = `status ${state.startsWith('connected') ? 'good' : 'warn'}`;
    el.textContent = `NetworkManager 켜짐 · ${STATE_LABELS[state] || state} · 인터넷: ${CONNECTIVITY_LABELS[connectivity] || connectivity}`;
  } else {
    el.className = 'status bad';
    el.textContent = `NetworkManager: ${res.hint}`;
  }
}

// ---------- S-4 확인 창 ----------
// 결과: 확인 → true, 취소/Esc → false. canConfirm() 이 false 면 확인 버튼이 눌리지 않음

function confirmDialog({ title, body = [], confirmText = '확인', danger = false, canConfirm = () => true, focus }) {
  const dlg = $('#dialog');
  clear(dlg);
  const okBtn = h('button', { type: 'submit', value: 'ok', class: danger ? 'danger' : 'primary' }, confirmText);
  const cancelBtn = h('button', { type: 'button' }, '취소');
  const update = () => { okBtn.disabled = !canConfirm(); };
  const form = h('form', { method: 'dialog', oninput: update, onchange: update },
    h('h3', {}, title), body, h('div', { class: 'dialog-buttons' }, cancelBtn, okBtn));
  dlg.append(form);
  update();
  return new Promise((resolve) => {
    cancelBtn.addEventListener('click', () => dlg.close('cancel'));
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    (focus || cancelBtn).focus();
  });
}

// ---------- 동작: 켜기 · 끄기 · 삭제 · 복제 ----------

async function doUp(c, { reapplyDevice } = {}) {
  const body = {};
  if (reapplyDevice) {
    body.ifname = reapplyDevice; // 이미 켜진 연결을 다시 적용: 지금 쓰는 장치 그대로
  } else {
    const d = await api('GET', `/connections/${c.uuid}`);
    if (!d.ok) return showResult(d);
    if (!d.data.connection.ifname) {
      // "아무 장치나" 프로파일 → 1번 카드에 붙을 수 있어 경고 (docs/DECISIONS.md 5번)
      const devs = await api('GET', '/devices');
      const eth = devs.ok ? devs.data.devices.filter((x) => x.type === 'ethernet') : [];
      const select = h('select', {},
        h('option', { value: '' }, 'NetworkManager가 고르게 두기'),
        eth.map((x) => h('option', { value: x.device }, `${x.device} (${x.state}${x.connection ? ` · ${x.connection}` : ''})`)));
      const ok = await confirmDialog({
        title: '장치를 정하지 않은 프로파일이에요',
        body: [
          h('p', { class: 'warn-text' }, '이 프로파일은 "아무 장치나"로 되어 있어요. 그대로 켜면 NetworkManager가 1번 카드(평소 쓰는 연결)에 붙일 수도 있고, 그러면 인터넷이 끊길 수 있어요. 테스트용 카드를 골라 주세요.'),
          h('label', {}, '켤 장치: ', select),
        ],
        confirmText: '켜기',
        focus: select,
      });
      if (!ok) return;
      if (select.value) body.ifname = select.value;
    }
  }
  const res = await change('켜는 중… (최대 30초 걸릴 수 있어요)', 'POST', `/connections/${c.uuid}/up`, body, `"${c.name}" 연결을 켰어요`);
  route();
  return res;
}

async function doDown(c) {
  const ok = await confirmDialog({
    title: `"${c.name}" 연결을 끌까요?`,
    body: [h('p', { class: 'warn-text' }, '지금 켜져 있는 연결이에요. 끄면 인터넷이 끊길 수 있어요. (이 화면은 같은 컴퓨터 안에서 돌아서 계속 쓸 수 있어요)')],
    confirmText: '끄기',
    danger: true,
  });
  if (!ok) return;
  await change('끄는 중…', 'POST', `/connections/${c.uuid}/down`, undefined, `"${c.name}" 연결을 껐어요`);
  route();
}

async function doDelete(c, active) {
  const input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': '프로파일 이름 다시 입력' });
  const ok = await confirmDialog({
    title: '프로파일 삭제',
    body: [
      h('p', {}, '지우면 되돌릴 수 없어요. 확인을 위해 프로파일 이름을 똑같이 입력하세요:'),
      h('p', {}, h('code', {}, c.name)),
      input,
      active ? h('p', { class: 'warn-text' }, '⚠️ 지금 사용 중인 연결이에요! 지우면 인터넷이 끊길 수 있어요.') : null,
    ],
    confirmText: '삭제',
    danger: true,
    canConfirm: () => input.value === c.name,
    focus: input,
  });
  if (!ok) return;
  const res = await change('지우는 중…', 'DELETE', `/connections/${c.uuid}`, undefined, `"${c.name}" 프로파일을 지웠어요`);
  if (res.ok) go('#/');
}

async function doClone(c) {
  const input = h('input', { type: 'text', value: `${c.name}-copy`, maxlength: String(NAME_MAX), 'aria-label': '새 이름' });
  const msg = h('p', { class: 'dialog-error' });
  const ok = await confirmDialog({
    title: '프로파일 복제',
    body: [h('p', {}, '같은 설정으로 새 프로파일을 만들어요 (새 UUID를 받아요). 새 이름:'), input, msg],
    confirmText: '복제',
    canConfirm: () => {
      const valid = isValidName(input.value);
      msg.textContent = valid ? '' : MSG.name;
      return valid;
    },
    focus: input,
  });
  if (!ok) return;
  const res = await change('복제하는 중…', 'POST', `/connections/${c.uuid}/clone`, { name: input.value }, `"${input.value}" 으로 복제했어요`);
  if (res.ok && res.data.uuid) go(`#/c/${res.data.uuid}`);
}

// ---------- S-1 목록 ----------

async function renderList() {
  const seq = ++renderSeq;
  loading();
  const res = await api('GET', '/connections');
  if (seq !== renderSeq) return;
  const toolbar = h('div', { class: 'toolbar' },
    h('h2', {}, '연결 프로파일'), h('div', { class: 'spacer' }),
    h('button', { type: 'button', class: 'primary', onclick: () => go('#/new') }, '+ 새로 만들기'),
    h('button', { type: 'button', onclick: () => { renderList(); refreshStatus(); } }, '새로고침'));
  if (!res.ok) {
    showResult(res);
    setView(h('section', {}, toolbar, h('p', { class: 'fail-text' }, res.hint)));
    return;
  }
  connections = res.data.connections;

  const rows = connections.map((c) => {
    const open = () => go(`#/c/${c.uuid}`);
    let action;
    if (!c.editable) action = h('span', { class: 'badge', title: '이 앱은 유선만 바꿀 수 있어요' }, '보기 전용');
    else {
      action = h('button', {
        type: 'button', class: 'small',
        onclick: (e) => { e.stopPropagation(); (c.active ? doDown : doUp)(c); },
      }, c.active ? '끄기' : '켜기');
    }
    return h('tr', { class: 'row', tabindex: '0', onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
      h('td', {}, c.name), h('td', {}, c.typeLabel), h('td', {}, c.device || '—'),
      h('td', {}, activeBadge(c.active)), h('td', { class: 'actions' }, action));
  });

  setView(h('section', {},
    toolbar,
    h('table', {},
      h('thead', {}, h('tr', {}, ['이름', '유형', '장치', '켜짐', '동작'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '5', class: 'muted' }, '프로파일이 없어요')))),
    h('p', { class: 'hint' }, '행을 누르면 자세한 설정을 볼 수 있어요. 유선이 아닌 프로파일은 보기만 할 수 있어요. 실험은 테스트용 2번 카드로만 하세요.')));
}

// ---------- S-2 상세 ----------

const listOrDash = (arr) => (arr?.length ? arr.map((x) => h('div', { class: 'mono' }, x)) : '—');
const kv = (label, value) => [h('dt', {}, label), h('dd', {}, value === '' || value == null ? '—' : value)];
const yesNo = (b) => (b ? '예' : '아니오');

async function renderDetail(uuid) {
  const seq = ++renderSeq;
  loading();
  const [d, list] = await Promise.all([api('GET', `/connections/${uuid}`), api('GET', '/connections')]);
  if (seq !== renderSeq) return;
  if (!d.ok) {
    showResult(d);
    setView(h('section', {}, backLink(), h('p', { class: 'fail-text' }, d.hint)));
    return;
  }
  if (list.ok) connections = list.data.connections;
  const c = d.data.connection;
  const row = connections.find((x) => x.uuid === uuid) ?? { active: false, device: '' };
  const conn = { ...c, active: row.active, device: row.device };

  const buttons = c.editable
    ? h('div', { class: 'form-buttons' },
      h('button', { type: 'button', class: 'primary', onclick: () => go(`#/edit/${uuid}`) }, '편집'),
      conn.active
        ? [h('button', { type: 'button', onclick: () => doUp(conn, { reapplyDevice: conn.device }), title: '저장된 설정을 지금 다시 적용해요' }, '지금 적용'),
          h('button', { type: 'button', onclick: () => doDown(conn) }, '끄기')]
        : h('button', { type: 'button', onclick: () => doUp(conn) }, '켜기'),
      h('button', { type: 'button', onclick: () => doClone(conn) }, '복제'),
      h('button', { type: 'button', class: 'danger', onclick: () => doDelete(conn, conn.active) }, '삭제'))
    : h('p', { class: 'warn-text' }, `"${c.typeLabel}" 프로파일이에요. 이 앱은 유선 프로파일만 바꿀 수 있어서 보기만 할 수 있어요.`);

  const cards = [
    h('div', { class: 'card' }, h('h3', {}, '공통'), h('dl', {},
      kv('이름', c.name), kv('UUID', h('code', {}, c.uuid)), kv('유형', `${c.typeLabel} (${c.nmType})`),
      kv('연결할 장치', c.ifname || '아무 장치나'), kv('지금 연결된 장치', conn.device),
      kv('켜짐', activeBadge(conn.active)), kv('자동 연결', yesNo(c.autoconnect)), kv('자동 연결 우선순위', String(c.autoconnectPriority)))),
    h('div', { class: 'card' }, h('h3', {}, 'IPv4'), h('dl', {},
      kv('방식', methodLabel('ipv4', c.ipv4.method)), kv('주소', listOrDash(c.ipv4.addresses)), kv('게이트웨이', c.ipv4.gateway),
      kv('DNS', listOrDash(c.ipv4.dns)), kv('DNS 검색 도메인', listOrDash(c.ipv4.dnsSearch)), kv('자동 DNS 무시', yesNo(c.ipv4.ignoreAutoDns)))),
    h('div', { class: 'card' }, h('h3', {}, 'IPv6'), h('dl', {},
      kv('방식', methodLabel('ipv6', c.ipv6.method)), kv('주소', listOrDash(c.ipv6.addresses)),
      kv('게이트웨이', c.ipv6.gateway), kv('DNS', listOrDash(c.ipv6.dns)))),
  ];
  if (c.ethernet) {
    cards.push(h('div', { class: 'card' }, h('h3', {}, '유선'), h('dl', {},
      kv('MTU', c.ethernet.mtu === null ? '자동' : String(c.ethernet.mtu)),
      kv('고정할 MAC', c.ethernet.macAddress), kv('바꿔 쓸 MAC', c.ethernet.clonedMacAddress))));
  }

  setView(h('section', {},
    h('div', { class: 'toolbar' }, backLink(), h('div', { class: 'spacer' })),
    h('div', { class: 'toolbar' }, h('h2', {}, c.name), activeBadge(conn.active), h('div', { class: 'spacer' }), buttons),
    h('div', { class: 'detail-grid' }, cards),
    conn.active && c.editable ? h('p', { class: 'hint' }, '설정을 바꾼 뒤에는 "지금 적용"을 눌러야 실제 연결에 반영돼요.') : null));
}

// ---------- S-3 생성·편집 폼 ----------

// 서버가 돌려준 칸 위치(예: ipv4.addresses.0)를 폼 칸 이름(ipv4.addresses)으로
const fieldKey = (path) => String(path ?? '').replace(/\.\d+$/, '');

async function renderForm(uuid) {
  const seq = ++renderSeq;
  loading();
  const isEdit = Boolean(uuid);
  let original = null;
  let current = null; // 목록의 그 행 (켜짐 여부·장치)

  const devReq = api('GET', '/devices');
  if (isEdit) {
    const [d, list] = await Promise.all([api('GET', `/connections/${uuid}`), api('GET', '/connections')]);
    if (seq !== renderSeq) return;
    if (!d.ok) {
      showResult(d);
      setView(h('section', {}, backLink(), h('p', { class: 'fail-text' }, d.hint)));
      return;
    }
    if (!d.data.connection.editable) {
      notify('fail', '유선 프로파일만 편집할 수 있어요');
      go(`#/c/${uuid}`);
      return;
    }
    original = valuesFromConnection(d.data.connection);
    if (list.ok) connections = list.data.connections;
    current = connections.find((x) => x.uuid === uuid) ?? null;
  }
  const devs = await devReq;
  if (seq !== renderSeq) return;

  const start = original ? structuredClone(original) : emptyValues();
  const inputs = {}; // 칸 이름 → { input, row, error, warn }
  const touched = new Set();
  let submitted = false;

  // 칸 하나 만들기
  function field(path, input, help = '') {
    const id = `f-${path.replace(/\./g, '-')}`;
    input.id = id;
    const error = h('div', { class: 'error', 'aria-live': 'polite' });
    const warn = h('div', { class: 'warn' });
    const isCheck = input.type === 'checkbox';
    const row = h('div', { class: 'field' },
      h('label', { for: id }, FIELD_LABELS[path]),
      isCheck ? h('div', { class: 'checkbox' }, input, help ? h('span', { class: 'muted' }, help) : null) : input,
      !isCheck && help ? h('div', { class: 'help' }, help) : null,
      error, warn);
    inputs[path] = { input, row, error, warn };
    input.addEventListener('input', () => { touched.add(path); refresh(); });
    input.addEventListener('change', () => { touched.add(path); refresh(); });
    return row;
  }
  const text = (value, placeholder = '') => h('input', { type: 'text', value, placeholder, autocomplete: 'off', spellcheck: 'false' });
  const area = (value, placeholder) => h('textarea', { placeholder, spellcheck: 'false' }, value);
  const check = (checked) => h('input', { type: 'checkbox', checked });
  const select = (options, value) => {
    const el = h('select', {}, options.map(([v, label]) => h('option', { value: v }, label)));
    el.value = value; // 처음 값 고르기
    return el;
  };

  // 장치 선택지: 유선 장치 + "아무 장치나" (+ 목록에 없는 원래 값)
  const ethDevices = devs.ok ? devs.data.devices.filter((x) => x.type === 'ethernet') : [];
  const deviceOptions = [['', '아무 장치나 (NetworkManager가 고름 — 주의)'],
    ...ethDevices.map((x) => [x.device, `${x.device} (${x.state}${x.connection ? ` · ${x.connection}` : ''})`])];
  if (start.ifname && !ethDevices.some((x) => x.device === start.ifname)) deviceOptions.push([start.ifname, `${start.ifname} (지금 없는 장치)`]);

  const typeSelect = h('select', { id: 'f-type', disabled: isEdit }, h('option', { value: 'ethernet' }, isEdit ? '유선 (만든 뒤에는 바꿀 수 없어요)' : '유선 (ethernet)'));
  const activate = check(false);

  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
    h('fieldset', {}, h('legend', {}, '공통'),
      h('div', { class: 'field' }, h('label', { for: 'f-type' }, '유형'), typeSelect,
        h('div', { class: 'help' }, '이번 버전은 유선만 지원해요')),
      field('name', text(start.name, '예: office-lan'), `1~${NAME_MAX}자`),
      field('ifname', select(deviceOptions, start.ifname), '테스트할 때는 2번 카드(예: ens224)를 고르세요'),
      field('autoconnect', check(start.autoconnect), '장치가 준비되면 자동으로 켜기'),
      field('autoconnectPriority', h('input', { type: 'number', min: '0', max: String(PRIORITY_MAX), step: '1', value: String(start.autoconnectPriority) }), `0~${PRIORITY_MAX}, 클수록 먼저`)),
    h('fieldset', {}, h('legend', {}, 'IPv4'),
      field('ipv4.method', select(IPV4_METHODS.map((m) => [m, methodLabel('ipv4', m)]), start.ipv4.method)),
      field('ipv4.addresses', area(start.ipv4.addresses.join('\n'), '192.168.10.50/24'), '한 줄에 하나씩, 주소/접두사 (예: 192.168.10.50/24)'),
      field('ipv4.gateway', text(start.ipv4.gateway, '192.168.10.1'), '비워 두면 게이트웨이 없음'),
      field('ipv4.dns', text(start.ipv4.dns.join(' '), '8.8.8.8 1.1.1.1'), '공백이나 쉼표로 구분, 최대 3개'),
      field('ipv4.dnsSearch', text(start.ipv4.dnsSearch.join(' '), 'example.com'), '선택'),
      field('ipv4.ignoreAutoDns', check(start.ipv4.ignoreAutoDns), 'DHCP가 주는 DNS는 무시하고 위의 DNS만 쓰기')),
    h('fieldset', {}, h('legend', {}, 'IPv6'),
      field('ipv6.method', select(IPV6_METHODS.map((m) => [m, methodLabel('ipv6', m)]), start.ipv6.method)),
      field('ipv6.addresses', area(start.ipv6.addresses.join('\n'), '2001:db8::5/64'), '한 줄에 하나씩, 주소/접두사'),
      field('ipv6.gateway', text(start.ipv6.gateway, '2001:db8::1')),
      field('ipv6.dns', text(start.ipv6.dns.join(' '), '2001:4860:4860::8888'), '공백이나 쉼표로 구분, 최대 3개')),
    h('fieldset', {}, h('legend', {}, '유선'),
      field('ethernet.mtu', h('input', { type: 'number', min: String(MTU_MIN), max: String(MTU_MAX), step: '1', value: start.ethernet.mtu ?? '', placeholder: '자동' }), `비우면 자동, 보통 1500 (${MTU_MIN}~${MTU_MAX})`),
      field('ethernet.macAddress', text(start.ethernet.macAddress, '52:54:00:12:34:56'), '이 MAC 을 가진 카드에서만 쓰기 (선택)'),
      field('ethernet.clonedMacAddress', text(start.ethernet.clonedMacAddress, 'random / stable / MAC'), '카드의 MAC 을 바꿔서 쓰기 (선택)')),
    h('div', { class: 'form-buttons' },
      h('button', { type: 'submit', class: 'primary' }, isEdit ? '저장' : '만들기'),
      isEdit ? null : h('label', { class: 'checkbox' }, activate, '저장 후 바로 적용'),
      h('button', { type: 'button', onclick: () => go(isEdit ? `#/c/${uuid}` : '#/') }, '취소')));

  // 폼 → 값
  function readValues() {
    const val = (p) => inputs[p].input.value;
    const num = (p, empty) => (val(p).trim() === '' ? empty : Number(val(p)));
    return {
      name: val('name'),
      ifname: val('ifname'),
      autoconnect: inputs.autoconnect.input.checked,
      autoconnectPriority: num('autoconnectPriority', 0),
      ipv4: {
        method: val('ipv4.method'), addresses: splitInput(val('ipv4.addresses')), gateway: val('ipv4.gateway').trim(),
        dns: splitInput(val('ipv4.dns')), dnsSearch: splitInput(val('ipv4.dnsSearch')),
        ignoreAutoDns: inputs['ipv4.ignoreAutoDns'].input.checked,
      },
      ipv6: {
        method: val('ipv6.method'), addresses: splitInput(val('ipv6.addresses')), gateway: val('ipv6.gateway').trim(),
        dns: splitInput(val('ipv6.dns')),
      },
      ethernet: {
        mtu: num('ethernet.mtu', null), macAddress: val('ethernet.macAddress').trim(),
        clonedMacAddress: val('ethernet.clonedMacAddress').trim(),
      },
    };
  }

  // 칸 보이기/숨기기 + 빨간 안내 다시 그리기
  function refresh(serverErrors = {}) {
    const v = readValues();
    const { errors, warnings } = validateForm(v, original);
    for (const path of FIELD_PATHS) {
      const f = inputs[path];
      f.row.hidden = !isVisible(path, v);
      const msg = serverErrors[path] || ((submitted || touched.has(path)) ? errors[path] : '');
      f.error.textContent = msg || '';
      f.row.classList.toggle('has-error', Boolean(msg));
      f.warn.textContent = warnings[path] && !msg ? `⚠️ ${warnings[path]} (경고만, 저장은 돼요)` : '';
    }
    return { v, errors };
  }

  function showServerErrors(fields = []) {
    const map = {};
    for (const f of fields) if (inputs[fieldKey(f.path)]) map[fieldKey(f.path)] ??= f.message;
    refresh(map);
  }

  async function submit() {
    submitted = true;
    const { v, errors } = refresh();
    const firstBad = FIELD_PATHS.find((p) => errors[p]);
    if (firstBad) {
      notify('fail', '빨간 안내가 있는 칸을 고쳐 주세요');
      inputs[firstBad].input.focus();
      return;
    }

    if (!isEdit) {
      const wantUp = activate.checked;
      if (wantUp && !v.ifname) {
        const ok = await confirmDialog({
          title: '장치를 정하지 않았어요',
          body: [h('p', { class: 'warn-text' }, '"아무 장치나"로 저장하고 바로 적용하면 NetworkManager가 1번 카드(평소 쓰는 연결)에 붙일 수도 있어요. 그래도 할까요?')],
          confirmText: '그래도 저장하고 적용',
          danger: true,
        });
        if (!ok) return;
      }
      const res = await change(wantUp ? '저장하고 적용하는 중… (최대 30초)' : '저장하는 중…', 'POST', '/connections',
        toCreateBody(v, wantUp), wantUp ? '저장하고 적용했어요' : '저장했어요 (아직 켜지 않았어요)');
      if (res.ok || res.error === 'SAVED_BUT_NOT_ACTIVATED') {
        if (res.data?.uuid) go(`#/c/${res.data.uuid}`);
        else go('#/');
      } else {
        showServerErrors(res.fields);
      }
      return;
    }

    const patch = toPatch(original, v);
    const changed = changedPaths(patch);
    if (changed.length === 0) {
      notify('ok', '바뀐 값이 없어요');
      return;
    }
    if (current?.active) {
      // 지금 쓰는 연결 보호 (SPEC 8장 안전장치)
      const ok = await confirmDialog({
        title: '사용 중인 연결의 설정을 바꿔요',
        body: [
          h('p', {}, '바뀌는 칸: ', changed.map((p) => FIELD_LABELS[p]).join(', ')),
          h('p', { class: 'warn-text' }, '저장만 먼저 해요. 실제 반영은 "지금 적용"을 눌러야 되고, 그때 인터넷이 잠깐(또는 설정에 따라 계속) 끊길 수 있어요.'),
        ],
        confirmText: '저장',
      });
      if (!ok) return;
    }
    const res = await change('저장하는 중…', 'PATCH', `/connections/${uuid}`, patch, '저장했어요');
    if (!res.ok) {
      showServerErrors(res.fields);
      return;
    }
    if (res.data.needsReapply) {
      const again = await confirmDialog({
        title: '저장만 됐어요 — 지금 적용할까요?',
        body: [
          h('p', {}, '켜져 있는 연결은 다시 적용(up)해야 바뀐 설정이 실제로 반영돼요.'),
          h('p', { class: 'warn-text' }, '적용하는 동안 인터넷이 잠깐 끊길 수 있어요.'),
        ],
        confirmText: '지금 적용',
      });
      if (again) {
        const device = res.data.connections?.find((x) => x.uuid === uuid)?.device || current?.device;
        await change('적용하는 중… (최대 30초)', 'POST', `/connections/${uuid}/up`, device ? { ifname: device } : {}, '지금 적용했어요');
      }
    }
    go(`#/c/${uuid}`);
  }

  setView(h('section', {},
    h('div', { class: 'toolbar' }, backLink(isEdit ? `#/c/${uuid}` : '#/', isEdit ? '← 상세로' : '← 목록으로')),
    h('h2', {}, isEdit ? `편집: ${original.name}` : '새 유선 프로파일'),
    isEdit ? h('p', { class: 'hint' }, '바꾼 칸만 저장돼요.') : null,
    form));
  refresh();
  inputs.name.input.focus();
}

// ---------- S-5 실행 기록 ----------

let logsClearedAfter = 0; // "지우기" 를 누른 시점까지의 기록은 화면에서만 숨김
let lastLogId = 0;

async function refreshLogs() {
  const panel = $('#log-panel');
  if (!panel.open) return;
  const all = $('#log-all').checked;
  const res = await api('GET', `/logs${all ? '?all=1' : ''}`);
  const body = clear($('#log-body'));
  if (!res.ok) {
    body.append(h('p', { class: 'fail-text' }, res.hint));
    return;
  }
  lastLogId = Math.max(lastLogId, ...res.data.logs.map((l) => l.id), 0);
  const logs = res.data.logs.filter((l) => l.id > logsClearedAfter);
  if (!logs.length) {
    body.append(h('p', { class: 'muted' }, '아직 기록이 없어요.'));
  } else {
    body.append(h('table', { class: 'log-table' },
      h('thead', {}, h('tr', {}, ['시간', '실행한 명령', '결과'].map((t) => h('th', {}, t)))),
      h('tbody', {}, logs.map((l) => h('tr', {},
        h('td', { class: 'mono' }, new Date(l.time).toLocaleTimeString('ko-KR')),
        h('td', { class: 'mono cmd' }, l.command),
        h('td', {},
          h('div', { class: l.ok ? 'log-ok' : 'log-fail' },
            l.ok ? '성공' : `실패 (코드 ${l.exitCode}${l.timedOut ? ', 시간 초과' : ''}${l.notFound ? ', nmcli 없음' : ''})`),
          l.message ? h('div', { class: 'mono' }, l.message) : null))))));
  }
  if (res.data.file) body.append(h('p', { class: 'hint' }, `파일 기록: ${res.data.file} (최근 ${res.data.max}개만 화면에 보여요)`));
}

// ---------- 시작 ----------

function route() {
  const hash = location.hash || '#/';
  let m;
  if (hash === '#/new') return renderForm(null);
  if ((m = hash.match(/^#\/edit\/([0-9a-f-]{36})$/))) return renderForm(m[1]);
  if ((m = hash.match(/^#\/c\/([0-9a-f-]{36})$/))) return renderDetail(m[1]);
  return renderList();
}

window.addEventListener('hashchange', route);
$('#status-refresh').addEventListener('click', refreshStatus);
$('#log-panel').addEventListener('toggle', refreshLogs);
$('#log-all').addEventListener('change', refreshLogs);
$('#log-refresh').addEventListener('click', refreshLogs);
$('#log-clear').addEventListener('click', () => { logsClearedAfter = lastLogId; refreshLogs(); });

refreshStatus();
route();
