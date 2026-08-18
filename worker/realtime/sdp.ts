const MAX_TRANSCEIVER_MID_LENGTH = 32;

export function findAudioTransceiverMid(sdp: string): string | undefined {
  let insideAudioSection = false;

  for (const rawLine of sdp.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith('m=')) {
      insideAudioSection = line.startsWith('m=audio ');
      continue;
    }
    if (!insideAudioSection || !line.startsWith('a=mid:')) continue;

    const mid = line.slice('a=mid:'.length).trim();
    if (mid.length > 0 && mid.length <= MAX_TRANSCEIVER_MID_LENGTH && !/\s/u.test(mid)) {
      return mid;
    }
  }

  return undefined;
}
