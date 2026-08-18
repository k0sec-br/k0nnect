export function startSpeakingDetector(
  track: MediaStreamTrack,
  onSpeakingChange: (speaking: boolean) => void,
): () => void {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;
  const source = audioContext.createMediaStreamSource(new MediaStream([track]));
  source.connect(analyser);
  const levels = new Uint8Array(analyser.frequencyBinCount);
  let frame = 0;
  let previousSpeaking = false;
  let activeFrames = 0;
  let quietFrames = 0;

  const sample = () => {
    analyser.getByteFrequencyData(levels);
    const average = levels.reduce((sum, level) => sum + level, 0) / levels.length;
    if (average > 18) {
      activeFrames += 1;
      quietFrames = 0;
    } else {
      quietFrames += 1;
      activeFrames = 0;
    }
    const speaking = previousSpeaking ? quietFrames < 8 : activeFrames >= 3;
    if (speaking !== previousSpeaking) {
      previousSpeaking = speaking;
      onSpeakingChange(speaking);
    }
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  return () => {
    cancelAnimationFrame(frame);
    source.disconnect();
    void audioContext.close();
    if (previousSpeaking) onSpeakingChange(false);
  };
}
