// The phone's opt-in turn tone (house decision #112): one short note from a Web Audio oscillator (no audio file), only
// while this device's sound switch is on. A browser keeps audio locked until a tap, so the first tap after load
// unlocks it; a turn that starts before that tap is silent.

export const SOUND_KEY = "it-turn-sound";
/** The root class the sound switch sets; the tone plays only under it (off by default). */
export const SOUND_CLASS = "turn-sound";
/** The tone: a soft two-step rise, in Hz and seconds. */
export const TONE = { from: 660, to: 880, step: 0.09, length: 0.28, gain: 0.12 } as const;

let context: AudioContext | null = null;

/** Whether this device asked for the tone. */
export const turnSoundOn = (): boolean => document.documentElement.classList.contains(SOUND_CLASS);

/** Opens the audio context, called from a tap (the only place a browser lets it start). */
export function unlockTone() {
  if (typeof AudioContext === "undefined") return;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
}

/** One short tone for a new turn. Nothing plays with the switch off or before the first tap. */
export function playTurnTone() {
  if (!turnSoundOn() || !context || context.state !== "running") return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(TONE.from, now);
  osc.frequency.setValueAtTime(TONE.to, now + TONE.step);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(TONE.gain, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + TONE.length);
  osc.connect(gain).connect(context.destination);
  osc.start(now);
  osc.stop(now + TONE.length);
}
