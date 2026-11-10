// 8단계 테스트: 배포 파일 (deploy/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('polkit 규칙: SPEC 7.1 과 똑같음', () => {
  const spec = read('docs/SPEC.md');
  const block = spec.slice(spec.indexOf('// nmweb 그룹에게'), spec.indexOf('});', spec.indexOf('// nmweb 그룹에게')) + 3);
  assert.equal(read('deploy/50-nmweb.rules').trim(), block.trim());
});

test('polkit 규칙: nmweb 그룹에게 딱 2개 권한만 YES', () => {
  // 진짜 polkit 대신 같은 모양의 가짜 객체로 규칙을 실행해 봄
  let rule;
  const polkit = { Result: { YES: 'yes' }, addRule: (fn) => { rule = fn; } };
  new Function('polkit', read('deploy/50-nmweb.rules'))(polkit);
  const member = { isInGroup: (g) => g === 'nmweb' };
  const stranger = { isInGroup: () => false };
  const NM = 'org.freedesktop.NetworkManager.';
  assert.equal(rule({ id: NM + 'settings.modify.system' }, member), 'yes');
  assert.equal(rule({ id: NM + 'network-control' }, member), 'yes');
  for (const id of ['enable-disable-network', 'reload', 'settings.modify.hostname', 'enable-disable-wifi', 'settings.modify.global-dns']) {
    assert.equal(rule({ id: NM + id }, member), undefined, id); // 정하지 않음 → polkit 기본(거부)
  }
  assert.equal(rule({ id: NM + 'network-control' }, stranger), undefined);
});

test('systemd 서비스: nmweb 사용자, PORT=8080, 기록 폴더, 바인딩 주소 설정 없음', () => {
  const unit = read('deploy/nm-web.service');
  for (const line of ['User=nmweb', 'Group=nmweb', 'Environment=PORT=8080', 'LogsDirectory=nm-web', 'NoNewPrivileges=yes', 'WorkingDirectory=/opt/nm-web']) {
    assert.match(unit, new RegExp(`^${line}$`, 'm'), line);
  }
  assert.ok(!/0\.0\.0\.0|HOST=/.test(unit));
  assert.ok(!/^User=root/m.test(unit));
});
