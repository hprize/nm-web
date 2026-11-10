// 2단계 테스트: 서버 보안 검사 (S-01 ~ S-04, S-10)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { useFakeNmcli, request, startTestServer } from './helpers.js';

const fake = useFakeNmcli();
let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); fake.cleanup(); });

test('S-01: 127.0.0.1 에만 연결 대기하고, 코드에 0.0.0.0 이 없음', () => {
  assert.equal(srv.server.address().address, '127.0.0.1');
  const code = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.ok(!code.includes('0.0.0.0'));
  assert.match(code, /const HOST = '127\.0\.0\.1';/);
  assert.ok(!/HOST\s*=\s*process\.env/.test(code), '바인딩 주소를 환경변수로 바꿀 수 없어야 함');
});

test('S-02: 잘못된 Host → 403', async () => {
  for (const host of ['evil.example.com', `evil.example.com:${srv.port}`, '127.0.0.1:1', `0.0.0.0:${srv.port}`]) {
    const r = await request(srv.port, { headers: { host, cookie: srv.auth.cookie } });
    assert.equal(r.status, 403, `Host=${host}`);
    assert.equal(r.json.ok, false);
  }
  // Host 헤더가 아예 없는 요청 (HTTP/1.0) — 소켓으로 직접 보냄
  const raw = await new Promise((resolve) => {
    const sock = net.connect(srv.port, '127.0.0.1', () => sock.write(`GET / HTTP/1.0\r\nCookie: ${srv.auth.cookie}\r\n\r\n`));
    let text = ''; sock.on('data', (c) => { text += c; }); sock.on('end', () => resolve(text));
  });
  assert.match(raw, /^HTTP\/1\.\d 403/, 'Host 없음 → 403');
  const ok = await request(srv.port, { headers: { host: `localhost:${srv.port}`, cookie: srv.auth.cookie } });
  assert.equal(ok.status, 200, 'localhost:<포트> 는 허용');
});

test('S-04: 토큰 없음·틀린 토큰 → 401', async () => {
  assert.equal((await request(srv.port, { path: '/' })).status, 401);
  assert.equal((await request(srv.port, { path: '/api/status' })).status, 401);
  assert.equal((await request(srv.port, { path: '/app.js' })).status, 401, '화면 파일도 토큰 필요');
  assert.equal((await request(srv.port, { path: '/?token=wrong' })).status, 401);
  assert.equal((await request(srv.port, { headers: { cookie: 'nmweb_token=wrong' } })).status, 401);
});

test('S-04: 올바른 /?token= → HttpOnly·SameSite=Strict 쿠키를 주고 / 로 이동', async () => {
  const r = await request(srv.port, { path: `/?token=${srv.token}` });
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/');
  const cookie = r.headers['set-cookie'][0];
  assert.match(cookie, new RegExp(`^nmweb_token=${srv.token};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('S-03: 다른 Origin·Origin 없는 변경 요청 → 403, CORS 허용 헤더 없음', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const evil = await srv.call(method, '/api/connections', {}, { origin: 'http://evil.example.com' });
    assert.equal(evil.status, 403, `${method} 다른 Origin`);
    const none = await request(srv.port, { method, path: '/api/connections', body: {}, headers: { cookie: srv.auth.cookie } });
    assert.equal(none.status, 403, `${method} Origin 없음`);
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
  }
  // 앱 자신의 Origin 이면 보안 검사를 통과 (아직 API 가 없어 403 이 아닌 다른 응답)
  const same = await srv.call('POST', '/api/nothing', {});
  assert.notEqual(same.status, 403);
});

test('정상 요청 → 200 + 보안 응답 헤더', async () => {
  const r = await srv.call('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /<!doctype html>/i);
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['x-powered-by'], undefined);
  // 토큰이 다른 사이트로 새지 않게 하면서, Origin 이 null 로 바뀌지 않는 정책
  assert.equal(r.headers['referrer-policy'], 'same-origin');
  // 403 응답에도 보안 헤더가 붙어야 함
  const bad = await request(srv.port, { headers: { host: 'evil.example.com' } });
  assert.equal(bad.headers['x-frame-options'], 'DENY');
});

test('잘못된 JSON 본문 → 400 공통 형식', async () => {
  const r = await srv.call('POST', '/api/connections', '{not json');
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
});
