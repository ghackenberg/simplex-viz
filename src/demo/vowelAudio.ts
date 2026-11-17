import type { VoiceSampleItem } from './data/multimodalCatalog';

/**
 * Canonical F1 / F2 / F3 vocal-tract formant center frequencies (Hz)
 * for Deterding's 11 British English IPA vowels, modulated per speaker
 * by the sample's 10D LPC vector and fundamental pitch F0.
 */
const IPA_FORMANTS_HZ: Readonly<Record<string, readonly [number, number, number]>> = {
  '/iː/': [280, 2280, 2960], // hid / heed
  '/ɪ/': [390, 1980, 2560], // hId
  '/ɛ/': [530, 1840, 2480], // hEd
  '/æ/': [680, 1720, 2420], // hAd
  '/ɑː/': [740, 1090, 2440], // hArd
  '/ɒ/': [590, 890, 2410], // hOd
  '/ɔː/': [450, 760, 2420], // hAwed
  '/ʊ/': [430, 1030, 2280], // hOOd
  '/uː/': [310, 870, 2240], // whO'd
  '/ʌ/': [640, 1220, 2400], // hUd
  '/ɜː/': [500, 1380, 1720], // hEArd
};

let sharedAudioCtx: AudioContext | null = null;
let activeStopFn: (() => void) | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    sharedAudioCtx = new Ctor();
  }
  return sharedAudioCtx;
}

export function stopActiveVowelPlayback(): void {
  if (activeStopFn) {
    const fn = activeStopFn;
    activeStopFn = null;
    fn();
  }
}

/**
 * Synthesizes a 0.6s spoken vowel timbre using a glottal pulse oscillator bank
 * shaped through three parallel bandpass formant resonators (F1, F2, F3)
 * modulated by the speaker's LPC profile and sex/pitch.
 */
export function playSynthesizedVowel(
  voice: VoiceSampleItem,
  onEnded?: () => void,
): () => void {
  stopActiveVowelPlayback();

  const ctx = getAudioContext();
  if (!ctx) {
    onEnded?.();
    return () => {};
  }

  if (ctx.state === 'suspended') {
    void ctx.resume();
  }

  const now = ctx.currentTime;
  const duration = 0.62;
  const baseFormants = IPA_FORMANTS_HZ[voice.language] ?? [500, 1500, 2450];
  const femaleShift = voice.speakerSex === 'Female' ? 1.13 : 1.0;
  const lpcShift1 = 0.94 + (voice.voiceEmbedding[1] ?? 0.5) * 0.12;
  const lpcShift2 = 0.94 + (voice.voiceEmbedding[3] ?? 0.5) * 0.12;

  const f1 = baseFormants[0] * femaleShift * lpcShift1;
  const f2 = baseFormants[1] * femaleShift * lpcShift2;
  const f3 = baseFormants[2] * femaleShift;

  // Glottal source: sawtooth harmonic series + soft fundamental triangle
  const sawOsc = ctx.createOscillator();
  sawOsc.type = 'sawtooth';
  sawOsc.frequency.setValueAtTime(voice.pitchHz, now);
  sawOsc.frequency.linearRampToValueAtTime(voice.pitchHz * 0.96, now + duration);

  const subOsc = ctx.createOscillator();
  subOsc.type = 'triangle';
  subOsc.frequency.setValueAtTime(voice.pitchHz, now);

  // Subtle natural vocal vibrato (5.3 Hz)
  const vibratoOsc = ctx.createOscillator();
  vibratoOsc.type = 'sine';
  vibratoOsc.frequency.setValueAtTime(5.3, now);
  const vibratoGain = ctx.createGain();
  vibratoGain.gain.setValueAtTime(2.4, now);
  vibratoOsc.connect(vibratoGain);
  vibratoGain.connect(sawOsc.frequency);
  vibratoGain.connect(subOsc.frequency);

  // Spectral tilt lowpass (mimics -12 dB/oct glottal rolloff)
  const glottalTilt = ctx.createBiquadFilter();
  glottalTilt.type = 'lowpass';
  glottalTilt.frequency.setValueAtTime(3400, now);
  glottalTilt.Q.setValueAtTime(0.6, now);

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.35, now);

  sawOsc.connect(glottalTilt);
  subOsc.connect(subGain);
  subGain.connect(glottalTilt);

  const masterEnv = ctx.createGain();
  masterEnv.gain.setValueAtTime(0.0001, now);
  masterEnv.gain.linearRampToValueAtTime(0.28, now + 0.055);
  masterEnv.gain.setValueAtTime(0.26, now + duration - 0.18);
  masterEnv.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  masterEnv.connect(ctx.destination);

  const formantSpecs: ReadonlyArray<{ freq: number; q: number; gain: number }> = [
    { freq: f1, q: 7.5, gain: 1.0 },
    { freq: f2, q: 10.5, gain: 0.68 },
    { freq: f3, q: 12.0, gain: 0.34 },
  ];

  for (const spec of formantSpecs) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(spec.freq, now);
    bp.Q.setValueAtTime(spec.q, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(spec.gain, now);

    glottalTilt.connect(bp);
    bp.connect(g);
    g.connect(masterEnv);
  }

  let finished = false;
  const timer = window.setTimeout(() => {
    cleanup();
  }, Math.ceil(duration * 1000) + 40);

  const cleanup = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    try {
      sawOsc.stop();
      subOsc.stop();
      vibratoOsc.stop();
      masterEnv.disconnect();
    } catch {
      // Oscillator may already have stopped
    }
    if (activeStopFn === cleanup) {
      activeStopFn = null;
    }
    onEnded?.();
  };

  activeStopFn = cleanup;
  sawOsc.start(now);
  subOsc.start(now);
  vibratoOsc.start(now);
  sawOsc.stop(now + duration + 0.02);
  subOsc.stop(now + duration + 0.02);
  vibratoOsc.stop(now + duration + 0.02);

  return cleanup;
}
