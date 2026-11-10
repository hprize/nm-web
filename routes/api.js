// SPEC 6장 API
// 모든 요청의 처리 순서: ① 접속 출처 검사(server.js) → ② 입력값 검사 → ③ 인자 배열로 변환
// → ④ LC_ALL=C 로 nmcli 실행 → ⑤ 종료 코드·출력 해석 → ⑥ 기록 남기고 응답

import { Router } from 'express';
import { runNmcli } from '../lib/nmcli.js';
import { validate, uuidSchema } from '../lib/schema.js';
import { hintFor, nmcliMessage, httpStatusFor } from '../lib/hints.js';
import {
  LIST_ARGS, DEVICE_ARGS, STATUS_ARGS, detailArgs, parseList, parseDevices, parseStatus, parseDetail,
} from '../lib/profile.js';

// ---------- 공통 응답 형식 (SPEC 6장) ----------
function sendOk(res, data, result, message) {
  res.json({ ok: true, data, nmcli: { exitCode: result.exitCode, message: message ?? nmcliMessage(result) } });
}
function sendNmcliFail(res, result, action, extra = {}) {
  res.status(httpStatusFor(result)).json({
    ok: false,
    error: 'NMCLI_FAILED',
    hint: hintFor(result, action),
    nmcli: { exitCode: result.exitCode, message: nmcliMessage(result) },
    ...extra,
  });
}
export function sendBadInput(res, fields, hint = '입력값을 확인하세요') {
  res.status(400).json({ ok: false, error: 'VALIDATION', hint, fields, nmcli: null }); // nmcli 는 실행하지 않음
}

// 주소의 :uuid 를 검사 (S-07). 틀리면 400 을 보내고 null
function readUuid(req, res) {
  const r = validate(uuidSchema, req.params.uuid);
  if (!r.ok) { sendBadInput(res, [{ path: 'uuid', message: r.fields[0].message }], 'UUID 형식이 올바르지 않아요'); return null; }
  return r.data;
}

// 상세 읽기. 유선이 아닌 프로파일에 802-3-ethernet 칸을 물으면 nmcli 가 거부할 수 있어 한 번 더 시도
export async function readDetail(uuid) {
  let result = await runNmcli(detailArgs(uuid));
  if (result.exitCode === 2 && /invalid field/i.test(result.stderr)) {
    result = await runNmcli(detailArgs(uuid, 'connection,ipv4,ipv6'));
  }
  return { result, connection: result.exitCode === 0 ? parseDetail(result.stdout) : null };
}

export async function readList() {
  const result = await runNmcli(LIST_ARGS);
  return { result, connections: result.exitCode === 0 ? parseList(result.stdout) : null };
}

export function createApiRouter() {
  const router = Router();

  // F-10 상태 표시
  router.get('/status', async (req, res) => {
    const result = await runNmcli(STATUS_ARGS);
    if (result.exitCode !== 0) return sendNmcliFail(res, result, 'status');
    sendOk(res, parseStatus(result.stdout), result, '');
  });

  // F-09 장치 목록
  router.get('/devices', async (req, res) => {
    const result = await runNmcli(DEVICE_ARGS);
    if (result.exitCode !== 0) return sendNmcliFail(res, result, 'devices');
    sendOk(res, { devices: parseDevices(result.stdout) }, result, '');
  });

  // F-01 프로파일 목록
  router.get('/connections', async (req, res) => {
    const { result, connections } = await readList();
    if (result.exitCode !== 0) return sendNmcliFail(res, result, 'list');
    sendOk(res, { connections }, result, '');
  });

  // F-02 프로파일 상세
  router.get('/connections/:uuid', async (req, res) => {
    const uuid = readUuid(req, res);
    if (!uuid) return;
    const { result, connection } = await readDetail(uuid);
    if (result.exitCode !== 0) return sendNmcliFail(res, result, 'show');
    sendOk(res, { connection }, result, '');
  });

  return router;
}
