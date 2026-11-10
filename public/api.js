// 서버 API 부르기
// 같은 출처(127.0.0.1:<포트>)로만 보냄 → 브라우저가 Origin 을 붙여 서버의 S-03 검사를 통과
// 접속 토큰은 HttpOnly 쿠키라 JS 가 읽지 못하고, 브라우저가 알아서 붙여 보냄

export async function api(method, path, body) {
  const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch {
    return { ok: false, status: 0, hint: '서버에 연결할 수 없어요. 서버가 켜져 있는지 확인하세요.', nmcli: null };
  }
  let json;
  try {
    json = await res.json();
  } catch {
    json = { ok: false, hint: `서버 응답을 읽을 수 없어요 (HTTP ${res.status})`, nmcli: null };
  }
  if (res.status === 401) {
    json.hint = '접속 토큰이 없거나 바뀌었어요 (서버를 다시 켰나요?). 서버 터미널에 새로 찍힌 주소를 여세요.';
  }
  json.status = res.status;
  return json;
}
