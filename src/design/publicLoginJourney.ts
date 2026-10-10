/*
 * Stations for the public-device QR login, derived ONLY from the flow's phase
 * (never from time). Used by both the desktop dialog and the phone approval
 * screen. Presentation only.
 */
import type { DnaStep, DnaStepState } from './DnaKit';

const LABELS = ['إنشاء رمز آمن', 'امسح الرمز', 'وافق بالبصمة', 'تم الدخول'];

function build(states: DnaStepState[], blockedLabel?: string): DnaStep[] {
  return LABELS.map((label, i) => ({
    key: `s${i}`,
    label: states[i] === 'blocked' && blockedLabel ? blockedLabel : label,
    state: states[i],
  }));
}

/** Desktop dialog (publicDeviceLogin). `hasRequest`: the secure code was created before a failure. */
export function publicDeviceLoginSteps(phase: string, hasRequest: boolean): DnaStep[] | null {
  switch (phase) {
    case 'starting':
      return build(['current', 'pending', 'pending', 'pending']);
    case 'waiting':
      return build(['done', 'current', 'pending', 'pending']);
    case 'connecting':
      return build(['done', 'done', 'done', 'current']);
    case 'success':
      return build(['done', 'done', 'done', 'done']);
    case 'expired':
      return build(['done', 'blocked', 'pending', 'pending'], 'انتهى الرمز');
    case 'error':
      return hasRequest
        ? build(['done', 'blocked', 'pending', 'pending'], 'تعذّرت المتابعة')
        : build(['blocked', 'pending', 'pending', 'pending'], 'تعذّر إنشاء الرمز');
    default:
      return null;
  }
}

/** Phone approval screen (publicLoginApproval): the code was scanned, the user is approving. */
export function publicLoginApprovalSteps(phase: string): DnaStep[] | null {
  if (phase === 'ready' || phase === 'verifying') return build(['done', 'done', 'current', 'pending']);
  if (phase === 'success') return build(['done', 'done', 'done', 'done']);
  return null;
}
