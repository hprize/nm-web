// 7단계 테스트: 화면 파일 제공 (S-10) — CSP 때문에 HTML 안에 script·style 을 직접 쓰지 않았는지
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { useFakeNmcli, startTestServer } from './helpers.js';

const fake = useFakeNmcli();
let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); fake.cleanup(); });

const PUBLIC = new URL('../public/', import.meta.url);

test('화면 파일이 알맞은 형식으로 제공됨', async () => {
  for (const [path, type] of [['/', /text\/html/], ['/app.js', /javascript/], ['/rules.js', /javascript/],
    ['/formlogic.js', /javascript/], ['/style.css', /text\/css/], ['/favicon.svg', /image\/svg/]]) {
    const r = await srv.call('GET', path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers['content-type'], type, path);
  }
});

test('HTML 에 인라인 script·style·on… 속성이 없고, 외부 주소(CDN)를 쓰지 않음', () => {
  const html = readFileSync(new URL('index.html', PUBLIC), 'utf8');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), '인라인 <script>');
  assert.ok(!/<style/i.test(html), '<style>');
  assert.ok(!/\sstyle=/i.test(html), 'style= 속성');
  assert.ok(!/\son[a-z]+=/i.test(html), 'onclick= 같은 속성');
  for (const f of readdirSync(PUBLIC)) {
    // 주석(줄 맨 앞이나 공백 뒤의 //, /* */, <!-- -->)은 빼고 검사. "http://" 의 // 는 주석이 아님
    const code = readFileSync(new URL(f, PUBLIC), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    // 허용: SVG 이름표(www.w3.org), IPv6 검사용 new URL(`http://[...]`)
    assert.ok(!/https?:\/\/(?!www\.w3\.org|\[)/.test(code), `${f}: 외부 주소`);
    if (f.endsWith('.js')) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(code), `${f}: 위험한 HTML/코드 삽입`);
  }
});
