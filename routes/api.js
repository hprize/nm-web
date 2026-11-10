// SPEC 6장 API
// 모든 요청의 처리 순서: ① 접속 출처 검사(server.js) → ② 입력값 검사 → ③ 인자 배열로 변환
// → ④ LC_ALL=C 로 nmcli 실행 → ⑤ 종료 코드·출력 해석 → ⑥ 기록 남기고 응답

import { Router } from 'express';
import { runNmcli, UP_WAIT_SECONDS, UP_TIMEOUT_MS } from '../lib/nmcli.js';
import {
  validate, uuidSchema, createSchema, patchSchema, cloneSchema, upSchema, toNmcliArgs, toModifyArgs, patchProblems,
} from '../lib/schema.js';
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

  // ---------- 변경 API (F-03 ~ F-08) ----------

  // F-03 생성 (+ "저장 후 바로 적용" 이면 이어서 F-05)
  router.post('/connections', async (req, res) => {
    const v = validate(createSchema, req.body ?? {});
    if (!v.ok) return sendBadInput(res, v.fields);
    const data = v.data;

    const add = await runNmcli(toNmcliArgs(data));
    if (add.exitCode !== 0) return sendNmcliFail(res, add, 'add');
    const uuid = uuidFromAdd(add.stdout);

    // 저장 직후에는 켜지 않음. activate:true 일 때만 이어서 up (SPEC 4.2 F-03)
    if (data.activate && uuid) {
      const up = await runUp(uuid);
      if (up.exitCode !== 0) {
        const { connections } = await readList();
        // docs/DECISIONS.md 6번: 저장은 됐지만 적용은 실패
        return res.status(500).json({
          ok: false,
          error: 'SAVED_BUT_NOT_ACTIVATED',
          hint: `저장은 됐지만 적용은 실패했어요. ${hintFor(up, 'up')}`,
          data: { uuid, connections },
          nmcli: { exitCode: up.exitCode, message: joinMessages(add, up) },
        });
      }
      return sendOk(res, { uuid, activated: true, connections: (await readList()).connections }, up, joinMessages(add, up));
    }
    sendOk(res, { uuid, activated: false, connections: (await readList()).connections }, add);
  });

  // F-04 편집: 바뀐 칸만 modify. 유형 변경은 거부
  router.patch('/connections/:uuid', async (req, res) => {
    const uuid = readUuid(req, res);
    if (!uuid) return;
    const v = validate(patchSchema, req.body ?? {});
    if (!v.ok) return sendBadInput(res, v.fields);
    const patch = v.data;
    const args = toModifyArgs(uuid, patch);
    if (args.length === 4) return sendBadInput(res, [], '바뀐 값이 없어요');

    // 지금 값을 읽어서: 유선인지 확인 + "지금 값 + 바뀐 값" 이 규칙에 맞는지 확인
    const { result: shown, connection: current } = await readDetail(uuid);
    if (shown.exitCode !== 0) return sendNmcliFail(res, shown, 'show');
    if (!current.editable) return sendNotEditable(res, current.typeLabel);
    const problems = patchProblems(current, patch);
    if (problems.length) return sendBadInput(res, problems);

    const mod = await runNmcli(args);
    if (mod.exitCode !== 0) return sendNmcliFail(res, mod, 'modify');

    // modify 는 저장만 함 → 켜져 있는 연결이면 다시 up 해야 반영 (SPEC 2.3, 4.2 F-04)
    const { connections } = await readList();
    const active = Boolean(connections?.find((c) => c.uuid === uuid)?.active);
    res.json({
      ok: true,
      data: { uuid, active, needsReapply: active, connections },
      hint: active ? '저장만 됐어요 — 켜져 있는 연결이라 "지금 적용"을 눌러야 반영돼요.' : '완료했어요',
      nmcli: { exitCode: mod.exitCode, message: nmcliMessage(mod) },
    });
  });

  // F-05 적용 (켜기)
  router.post('/connections/:uuid/up', async (req, res) => {
    const uuid = readUuid(req, res);
    if (!uuid) return;
    const v = validate(upSchema, req.body ?? {});
    if (!v.ok) return sendBadInput(res, v.fields);
    if (!(await guardEditable(res, uuid))) return;
    const up = await runUp(uuid, v.data.ifname);
    await respondChange(res, up, 'up', { uuid });
  });

  // F-06 해제 (끄기)
  router.post('/connections/:uuid/down', async (req, res) => {
    const uuid = readUuid(req, res);
    if (!uuid) return;
    if (!(await guardEditable(res, uuid))) return;
    const down = await runNmcli(['connection', 'down', 'uuid', uuid]);
    await respondChange(res, down, 'down', { uuid });
  });

  // F-07 삭제
  router.delete('/connections/:uuid', async (req, res) => {
    const uuid = readUuid(req, res);
    if (!uuid) return;
    if (!(await guardEditable(res, uuid))) return;
    const del = await runNmcli(['connection', 'delete', 'uuid', uuid]);
    await respondChange(res, del, 'delete', { uuid });
  });

  // F-08 복제: 이름을 안 주면 "<원래이름>-copy" (SPEC 4.2 F-08)
  router.post('/connections/:uuid/clone', async (req, res) => {
    const uuid = readUuid(req, res);
    if (!uuid) return;
    const row = await guardEditable(res, uuid);
    if (!row) return;
    const body = { ...(req.body ?? {}) };
    if (body.name === undefined) {
      if (row === MISSING) { // 없는 프로파일 → nmcli 의 진짜 "없음"(코드 10) 응답을 그대로
        const { result } = await readDetail(uuid);
        if (result.exitCode !== 0) return sendNmcliFail(res, result, 'show');
      } else {
        body.name = `${row.name}-copy`;
      }
    }
    const v = validate(cloneSchema, body);
    if (!v.ok) return sendBadInput(res, v.fields);
    const clone = await runNmcli(['connection', 'clone', 'uuid', uuid, v.data.name]);
    await respondChange(res, clone, 'clone', { uuid: uuidFromClone(clone.stdout), source: uuid });
  });

  return router;
}

// ---------- 변경 API 도우미 ----------

// up 은 nmcli 에 -w 30, execFile 제한은 35초 → nmcli 가 먼저 코드 3 으로 끝나게 (SPEC 4.2 F-05)
function runUp(uuid, ifname) {
  const args = ['-w', String(UP_WAIT_SECONDS), 'connection', 'up', 'uuid', uuid];
  if (ifname) args.push('ifname', ifname);
  return runNmcli(args, UP_TIMEOUT_MS);
}

// 변경 결과 응답 + 목록 다시 읽기 (SPEC 8장 "실행 후 다시 읽기")
async function respondChange(res, result, action, data) {
  if (result.exitCode !== 0) return sendNmcliFail(res, result, action);
  const { connections } = await readList();
  sendOk(res, { ...data, connections }, result);
}

// 목록에 없는 UUID 표시 — nmcli 를 그대로 실행해서 진짜 종료 코드(10)를 받게 함
const MISSING = Symbol('missing');

// 유선이 아니면 바꾸지 못하게 (docs/DECISIONS.md 4번). 통과하면 목록의 그 행(없으면 MISSING), 막히면 null
async function guardEditable(res, uuid) {
  const { result, connections } = await readList();
  if (result.exitCode !== 0) { sendNmcliFail(res, result, 'list'); return null; }
  const row = connections.find((c) => c.uuid === uuid);
  if (!row) return MISSING;
  if (!row.editable) { sendNotEditable(res, row.typeLabel); return null; }
  return row;
}

function sendNotEditable(res, label) {
  res.status(400).json({
    ok: false, error: 'NOT_EDITABLE', nmcli: null,
    hint: `이 앱은 유선 프로파일만 바꿀 수 있어요 (이 프로파일: ${label}). 보기만 할 수 있어요.`,
  });
}

// nmcli 성공 문구에서 UUID 꺼내기. 이름에 가짜 "(UUID)" 를 넣어도 속지 않게 문장 "끝"에서 찾음
const U = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const ADD_RE = new RegExp(`\\(${U}\\) successfully added\\.?\\s*$`);
const CLONE_RE = new RegExp(`\\(${U}\\)\\.?\\s*$`);
export const uuidFromAdd = (stdout) => stdout.match(ADD_RE)?.[1] ?? null;
export const uuidFromClone = (stdout) => stdout.match(CLONE_RE)?.[1] ?? null;

const joinMessages = (...results) => results.map(nmcliMessage).filter(Boolean).join('\n');
