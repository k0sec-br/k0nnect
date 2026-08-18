export interface VoiceControlState {
  userMuted: boolean;
  deafened: boolean;
}

export type VoiceControlAction =
  { type: 'toggle-user-muted' } | { type: 'toggle-deafened' } | { type: 'reset' };

export const INITIAL_VOICE_CONTROL_STATE: VoiceControlState = {
  userMuted: false,
  deafened: false,
};

export function effectiveMuted(state: VoiceControlState): boolean {
  return state.userMuted || state.deafened;
}

export function reduceVoiceControlState(
  state: VoiceControlState,
  action: VoiceControlAction,
): VoiceControlState {
  if (action.type === 'toggle-user-muted') {
    return { ...state, userMuted: !state.userMuted };
  }
  if (action.type === 'toggle-deafened') {
    return { ...state, deafened: !state.deafened };
  }
  return INITIAL_VOICE_CONTROL_STATE;
}
