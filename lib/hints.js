// nmcli 종료 코드 → 쉬운 한국어 안내 (SPEC 8장 표)
// 숫자만 믿지 않고 nmcli 오류 문구도 함께 봅니다.
// (예: NetworkManager와 D-Bus가 모두 꺼지면 공식 문서의 8이 아니라 1이 나온 적이 있음)

const MESSAGE_RULES = [
  [/Could not create NMClient object|NetworkManager is not running/i,
    'NetworkManager가 꺼져 있어요. Rocky 에서 `systemctl status NetworkManager` 로 확인하세요.'],
  [/Insufficient privileges|Not authorized|access denied/i,
    '권한이 없어요. polkit 규칙(nmweb 그룹)이 적용됐는지 `sudo -u nmweb nmcli general permissions` 로 확인하세요.'],
];

// action: 'add' | 'modify' | 'up' | 'down' | 'delete' | 'clone' | 'show' | 'status' | 'devices' | 'list'
export function hintFor(result, action = '') {
  if (result.notFound) return 'nmcli 프로그램을 찾을 수 없어요. NetworkManager가 설치되어 있는지(또는 NMCLI_BIN 설정)를 확인하세요.';
  if (result.timedOut) {
    return action === 'up'
      ? '35초 안에 끝나지 않아 멈췄어요. 장치와 케이블 상태를 확인하세요.'
      : '15초 안에 끝나지 않아 멈췄어요. NetworkManager가 바쁜지 확인하세요.';
  }
  const msg = nmcliMessage(result);
  if (result.exitCode !== 0) {
    for (const [re, hint] of MESSAGE_RULES) if (re.test(msg)) return hint;
  }

  switch (result.exitCode) {
    case 0: return '완료했어요';
    case 1: return `알 수 없는 오류가 났어요: ${msg} (NetworkManager가 실행 중인지도 확인하세요)`;
    case 2: return `입력값을 확인하세요: ${msg}`;
    case 3: return '30초 안에 연결되지 않았어요. 장치·케이블·DHCP 서버를 확인하세요.';
    case 4: return action === 'add'
      ? `저장에 실패했어요: ${msg}`
      : `적용(또는 저장)에 실패했어요: ${msg}`;
    case 5: return '연결을 끊지 못했어요';
    case 7: return '삭제하지 못했어요';
    case 8: return 'NetworkManager가 꺼져 있어요';
    case 10: return '이미 없거나 꺼져 있는 연결이에요';
    default: return `nmcli 오류가 났어요 (코드 ${result.exitCode}): ${msg}`;
  }
}

// 화면에 보여 줄 nmcli 원래 문구: 실패면 오류 출력, 성공이면 안내 출력
export function nmcliMessage(result) {
  if (result.exitCode !== 0) return (result.stderr || result.stdout || '').trim();
  return (result.stdout || '').trim();
}

// HTTP 상태: 코드 10(없음) → 404, 그 밖의 nmcli 실패 → 500 (docs/DECISIONS.md 7번)
export const httpStatusFor = (result) => (result.exitCode === 10 ? 404 : 500);
