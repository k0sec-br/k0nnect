import { describe, expect, it } from 'vitest';

import {
  effectiveMuted,
  INITIAL_VOICE_CONTROL_STATE,
  reduceVoiceControlState,
  type VoiceControlAction,
} from '../../src/features/voice/voice-control-state';

function apply(actions: VoiceControlAction[]) {
  return actions.reduce(reduceVoiceControlState, INITIAL_VOICE_CONTROL_STATE);
}

describe('estado de mute e áudio', () => {
  it('restaura o microfone ativo após desativar e reativar o áudio', () => {
    const deafened = apply([{ type: 'toggle-deafened' }]);
    expect(effectiveMuted(deafened)).toBe(true);
    const restored = reduceVoiceControlState(deafened, { type: 'toggle-deafened' });
    expect(restored).toEqual({ userMuted: false, deafened: false });
    expect(effectiveMuted(restored)).toBe(false);
  });

  it('mantém o microfone desativado quando essa era a intenção anterior', () => {
    const restored = apply([
      { type: 'toggle-user-muted' },
      { type: 'toggle-deafened' },
      { type: 'toggle-deafened' },
    ]);
    expect(restored).toEqual({ userMuted: true, deafened: false });
    expect(effectiveMuted(restored)).toBe(true);
  });

  it('permite alterar a intenção futura do microfone enquanto o áudio está desativado', () => {
    const restored = apply([
      { type: 'toggle-user-muted' },
      { type: 'toggle-deafened' },
      { type: 'toggle-user-muted' },
      { type: 'toggle-deafened' },
    ]);
    expect(restored).toEqual({ userMuted: false, deafened: false });
    expect(effectiveMuted(restored)).toBe(false);
  });

  it('mantém estado consistente após alternâncias rápidas', () => {
    const state = apply(Array.from({ length: 20 }, () => ({ type: 'toggle-deafened' }) as const));
    expect(state).toEqual(INITIAL_VOICE_CONTROL_STATE);
  });
});
