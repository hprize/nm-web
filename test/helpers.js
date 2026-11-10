// 테스트 공용 도우미: 테스트 파일마다 따로 쓰는 가짜 nmcli 상태 파일을 준비
// (node --test 는 파일들을 동시에 돌리므로, 상태 파일을 같이 쓰면 서로 엉킴)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_BIN = fileURLToPath(new URL('../dev/fake-nmcli', import.meta.url));

export function useFakeNmcli() {
  const dir = mkdtempSync(join(tmpdir(), 'nmweb-test-'));
  const stateFile = join(dir, 'state.json');
  process.env.NMCLI_BIN = FAKE_BIN;
  process.env.FAKE_NMCLI_STATE = stateFile;
  process.env.LOG_DIR = join(dir, 'logs');
  return {
    dir,
    // 가짜 상태를 처음(ens160, lo, test-lan)으로 되돌림
    reset: () => rmSync(stateFile, { force: true }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// 가짜 데이터의 고정 UUID
export const UUID_MAIN = '5fb06bd0-0bb0-7ffb-45f1-d6edd65f3e03';
export const UUID_LO = 'b1a41c0e-36a5-4d1c-9a4c-2c9a7b1f0e11';
export const UUID_TEST = '3c2f6a8e-1d4b-4e5f-9a7b-8c6d5e4f3a21';
export const UUID_MISSING = '00000000-0000-4000-8000-000000000000';
