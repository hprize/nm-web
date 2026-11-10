// nm-web 서버 시작점
// "같은 컴퓨터 안에서, 허락된 화면만, 정해진 명령만" (SPEC 7장)
//   S-01 127.0.0.1 에만 연결 대기 — 주소를 상수로 고정, 설정으로 바꿀 수 없음
//   S-02 Host 헤더 검사 → 403    S-04 접속 토큰(쿠키) 검사 → 401
//   S-03 변경 요청의 Origin 검사 → 403 (CORS 허용 헤더는 절대 보내지 않음)
//   S-10 화면 파일은 public/ 에서 직접 제공, 외부 CDN 없음

import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import express from 'express';
import { createApiRouter } from './routes/api.js';

// S-01: 바인딩 주소는 코드에 고정. 환경변수·설정 파일로 바꾸는 길을 만들지 않음
const HOST = '127.0.0.1';
const COOKIE_NAME = 'nmweb_token';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const CHANGE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// 공통 응답 형식의 실패 응답 (SPEC 6장)
export function sendFail(res, status, hint, extra = {}) {
  res.status(status).json({ ok: false, error: null, hint, nmcli: null, ...extra }); // nmcli 는 실행하지 않음
}

// 토큰 비교: 길이·내용에 따라 걸리는 시간이 달라지지 않게 해시 후 timingSafeEqual
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// 쿠키 헤더에서 이름=값 꺼내기 (cookie-parser 패키지를 쓰지 않으려고 직접 작성)
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function createApp({ token }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('토큰이 너무 짧습니다');
  const app = express();
  app.disable('x-powered-by'); // 서버 종류를 알려 줄 필요 없음

  // ① 보안 응답 헤더 — 모든 응답(403·401 포함)에 붙임
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer', // 주소창의 ?token= 이 다른 곳으로 새지 않게
      'Cache-Control': 'no-store',
    });
    next();
  });

  // ② S-02 Host 검사: 실제로 접속한 포트 번호와 함께 정확히 맞아야 함 (DNS 리바인딩 차단)
  app.use((req, res, next) => {
    const port = req.socket.localPort;
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return sendFail(res, 403, '허용되지 않은 주소(Host)로 접속했어요. http://127.0.0.1:<포트>/ 로 접속하세요.', { error: 'BAD_HOST' });
    }
    req.appOrigin = `http://${host}`; // Origin 검사에 쓸 "앱 자신"의 주소
    next();
  });

  // ③ S-04 토큰 검사. 터미널에 찍힌 /?token=… 으로 들어오면 쿠키를 주고 주소에서 토큰을 지움
  app.use((req, res, next) => {
    const fromQuery = typeof req.query.token === 'string' ? req.query.token : null;
    if (req.method === 'GET' && req.path === '/' && fromQuery !== null) {
      if (!sameToken(fromQuery, token)) {
        return sendFail(res, 401, '접속 토큰이 틀렸어요. 서버 터미널에 찍힌 주소를 그대로 여세요.', { error: 'BAD_TOKEN' });
      }
      res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'strict', path: '/' });
      return res.redirect(303, '/');
    }
    if (!sameToken(readCookie(req, COOKIE_NAME), token)) {
      return sendFail(res, 401, '접속 토큰이 없어요. 서버 터미널에 찍힌 http://127.0.0.1:<포트>/?token=… 주소로 여세요.', { error: 'NO_TOKEN' });
    }
    next();
  });

  // ④ S-03 Origin 검사: 바꾸는 요청은 이 앱 화면에서 온 것만. Origin 이 없어도 거부
  app.use((req, res, next) => {
    if (CHANGE_METHODS.has(req.method) && req.headers.origin !== req.appOrigin) {
      return sendFail(res, 403, '다른 곳에서 보낸 변경 요청이라 막았어요.', { error: 'BAD_ORIGIN' });
    }
    next();
  });

  // API (JSON 본문은 작게 제한)
  app.use('/api', express.json({ limit: '16kb' }), createApiRouter());
  app.use('/api', (req, res) => sendFail(res, 404, '없는 API 주소예요.', { error: 'NOT_FOUND' }));

  // 화면 파일
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', dotfiles: 'ignore' }));
  app.use((req, res) => sendFail(res, 404, '없는 주소예요.', { error: 'NOT_FOUND' }));

  // 오류 처리: JSON 형식이 틀린 본문 등 → 400, 나머지 → 500 (속 내용은 숨김)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return sendFail(res, 400, '요청 본문(JSON)을 읽을 수 없어요.', { error: 'BAD_JSON' });
    }
    console.error('[nm-web] 처리 중 오류:', err);
    sendFail(res, 500, '서버 안에서 오류가 났어요. 서버 터미널의 기록을 확인하세요.', { error: 'INTERNAL' });
  });

  return app;
}

function readPort() {
  const raw = process.env.PORT ?? '8080';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT 값이 이상해요: ${raw}`);
  return port;
}

// 서버 시작. port 0 이면 빈 포트를 아무거나 씀(테스트용)
export function startServer({ port = readPort(), token = randomBytes(32).toString('base64url') } = {}) {
  const server = http.createServer(createApp({ token }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      resolve({ server, port: actual, token, url: `http://${HOST}:${actual}/?token=${token}` });
    });
  });
}

// `node server.js` 로 직접 실행했을 때만 서버를 켬 (테스트에서 import 할 때는 켜지 않음)
const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const { url } = await startServer();
    console.log('nm-web 서버가 켜졌어요. 이 컴퓨터의 브라우저에서 아래 주소를 여세요:');
    console.log(`  ${url}`);
    console.log(`(nmcli 실행 파일: ${process.env.NMCLI_BIN || 'nmcli'})`);
  } catch (e) {
    console.error('[nm-web] 서버를 켜지 못했어요:', e.message);
    process.exit(1);
  }
}
