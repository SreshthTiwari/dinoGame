// Sound, all synthesized with the Web Audio API (no audio files).
//   - sound effects, triggered by game events (see game.on in game.js)
//   - a procedural music loop: bass, drums, arpeggio and a lead that come in as the level rises, a
//     key and feel per colour theme, faster with the level and slowed during the breather
// Browsers only allow sound after a click or key press, so the audio context is created on the
// first unlock() call (main.js calls it on the first key press / pointer down).

const MODES = ['on', 'sfx', 'off'];            // M cycles: sound + music, sound effects only, silent

// Music per theme: root note (MIDI), scale (semitones), tempo, and the waveforms used.
const MUSIC = {
  neon:   { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 112, bass: 'sawtooth', arp: 'square' },
  sunset: { root: 41, scale: [0, 2, 4, 7, 9], bpm: 104, bass: 'sawtooth', arp: 'triangle' },
  day:    { root: 48, scale: [0, 2, 4, 5, 7, 9, 11], bpm: 118, bass: 'triangle', arp: 'square' },
  desert: { root: 50, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 100, bass: 'square', arp: 'triangle' },
  arctic: { root: 52, scale: [0, 3, 5, 7, 10], bpm: 96, bass: 'sine', arp: 'sine' },
  candy:  { root: 43, scale: [0, 2, 4, 7, 9], bpm: 126, bass: 'triangle', arp: 'square' },
  matrix: { root: 36, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 128, bass: 'sawtooth', arp: 'sawtooth' },
};
const PROGRESSION = [0, 5, 3, 4];             // scale degree each bar is built on
const BASS_PATTERN = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const SFX_GAIN = 1.5, MUSIC_GAIN = 0.5;       // effects sit above the music so they cut through it

const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const degree = (scale, i) => scale[i % scale.length] + 12 * Math.floor(i / scale.length);

export function createAudio({ ctx: given = null } = {}) {
  let ctx = given, master, sfxBus, musicBus, noiseBuf, testOffset = 0;   // testOffset: tests start sounds a little in
  let mode = 'on';
  try { const m = localStorage.getItem('blip-sound'); if (MODES.includes(m)) mode = m; } catch {}

  // ---- setup ----
  function build() {
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();         // keeps busy moments from clipping
    comp.threshold.value = -14; comp.ratio.value = 6;
    sfxBus = ctx.createGain(); musicBus = ctx.createGain();
    sfxBus.connect(master); musicBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyMode();
  }
  function ensure() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (!master) build();
    if (ctx.state === 'suspended') { try { ctx.resume()?.catch?.(() => {}); } catch {} }
    return ctx;
  }
  function applyMode() {
    if (!master) return;
    sfxBus.gain.value = mode === 'off' ? 0 : SFX_GAIN;
    musicBus.gain.value = mode === 'on' ? MUSIC_GAIN : 0;
  }

  // ---- building blocks ----
  // a pitched note: sweeps from f to f2, with a quick attack and an exponential fade
  function tone({ f, f2, dur, type = 'sine', gain = 0.2, at = 0, attack = 0.004, pan = 0, lp = 0, bus = sfxBus, t0 }) {
    t0 ??= ctx.currentTime + testOffset + at;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + attack + dur * 0.3);              // a short hold, so notes have body
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (lp) { const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lp; node.connect(flt); node = flt; }
    node.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(bus);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  // filtered noise: whooshes, hats, snares, crashes
  function noise({ dur, f, f2, q = 1, type = 'bandpass', gain = 0.2, at = 0, attack = 0.005, pan = 0, bus = sfxBus, t0 }) {
    t0 ??= ctx.currentTime + testOffset + at;
    if (type === 'bandpass') gain *= 2 + q * 2;                          // a narrow band passes little noise: make up for it
    const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t0);
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + attack + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(bus);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }
  const arpeggio = (notes, o) => notes.forEach((n, i) => tone({ ...o, f: midi(n), at: (o.at ?? 0) + i * (o.step ?? 0.07) }));

  // ---- sound effects ----
  const SFX = {
    start: () => arpeggio([67, 72, 79], { type: 'square', dur: 0.14, gain: 0.07, step: 0.08 }),
    laneChange: d => noise({ dur: 0.15, f: 700, f2: 2800, q: 1.4, gain: 0.13, pan: (d?.dir ?? 0) * 0.6 }),
    jump: () => tone({ f: 260, f2: 680, dur: 0.17, type: 'square', gain: 0.07 }),
    duck: () => { tone({ f: 320, f2: 100, dur: 0.15, type: 'triangle', gain: 0.13 }); noise({ dur: 0.12, f: 1200, f2: 300, gain: 0.06 }); },
    pickupShield: () => arpeggio([76, 81, 88, 93], { dur: 0.22, gain: 0.11, step: 0.06 }),
    pickupGhost: () => {
      tone({ f: 300, f2: 960, dur: 0.5, gain: 0.12 });
      tone({ f: 310, f2: 985, dur: 0.5, gain: 0.09 });
      arpeggio([84, 79, 75, 72], { type: 'triangle', dur: 0.2, gain: 0.05, step: 0.07, at: 0.12 });
    },
    shieldBreak: () => {
      noise({ dur: 0.35, f: 5000, f2: 800, type: 'highpass', gain: 0.3 });
      tone({ f: 1500, f2: 160, dur: 0.28, type: 'sawtooth', gain: 0.12 });
      arpeggio([96, 91, 84], { dur: 0.1, gain: 0.05, step: 0.03 });
    },
    ghostEnd: () => tone({ f: 640, f2: 260, dur: 0.25, gain: 0.1 }),
    breatherStart: () => arpeggio([60, 64, 67, 72], { dur: 1.8, gain: 0.05, step: 0.12, attack: 0.35 }),
    breatherEnd: () => arpeggio([67, 72, 76], { type: 'triangle', dur: 0.3, gain: 0.08, step: 0.09 }),
    level: () => arpeggio([72, 79], { type: 'triangle', dur: 0.2, gain: 0.1, step: 0.09 }),
    die: () => {
      tone({ f: 540, f2: 45, dur: 0.75, type: 'sawtooth', gain: 0.16, lp: 2200 });
      noise({ dur: 0.7, f: 3000, f2: 120, type: 'lowpass', gain: 0.25 });
      tone({ f: 90, f2: 35, dur: 0.6, gain: 0.25 });
    },
    themeChange: () => noise({ dur: 0.9, f: 300, f2: 1500, q: 0.6, gain: 0.09, attack: 0.3 }),
  };
  // game events -> effect names
  const EVENT_SFX = {
    start: 'start', laneChange: 'laneChange', jump: 'jump', duck: 'duck', shieldBreak: 'shieldBreak',
    ghostEnd: 'ghostEnd', breatherStart: 'breatherStart', breatherEnd: 'breatherEnd', level: 'level', die: 'die',
    themeChange: 'themeChange',
  };
  function play(event, data) {
    if (mode === 'off' || !ensure()) return;
    const name = event === 'pickup' ? (data?.type === 'ghost' ? 'pickupGhost' : 'pickupShield') : EVENT_SFX[event];
    SFX[name]?.(data);
  }

  // ---- music ----
  let themeId = 'neon', pendingTheme = null, level = 1, tempoScale = 1;
  let playing = false, timer = null, step = 0, nextTime = 0;
  const stepLen = () => 60 / (MUSIC[themeId].bpm * (1 + (level - 1) * 0.05) * tempoScale) / 4;   // a sixteenth note

  function scheduleStep(n, t) {
    const cfg = MUSIC[themeId], bar = Math.floor(n / 16) % PROGRESSION.length, s = n % 16, L = stepLen();
    const deg = PROGRESSION[bar], rootSemi = degree(cfg.scale, deg);
    const m = { bus: musicBus, t0: t };
    if (BASS_PATTERN[s]) tone({ ...m, f: midi(cfg.root + rootSemi), dur: L * 1.7, type: cfg.bass, gain: 0.13, lp: 700 });
    if (s % 4 === 0) tone({ ...m, f: 150, f2: 42, dur: 0.14, gain: 0.4 });                                    // kick
    if (level >= 2 && s % 2 === 0) noise({ ...m, dur: 0.04, f: 7500, type: 'highpass', gain: 0.05 });          // hats
    if (level >= 6 && s % 2 === 1) noise({ ...m, dur: 0.03, f: 8500, type: 'highpass', gain: 0.03 });
    if (level >= 3 && (s === 4 || s === 12)) noise({ ...m, dur: 0.13, f: 1900, q: 0.8, gain: 0.13 });         // snare
    if (level >= 4 && (level >= 7 || s % 2 === 0)) {                                                         // arpeggio
      const chord = [0, 2, 4, 7].map(k => degree(cfg.scale, deg + k));
      tone({ ...m, f: midi(cfg.root + 12 + chord[s % 4]), dur: L * 0.9, type: cfg.arp, gain: 0.045, lp: 3500 });
    }
    if (level >= 8 && (s === 0 || s === 6 || s === 10)) {                                                    // lead
      tone({ ...m, f: midi(cfg.root + 24 + degree(cfg.scale, deg + (s % 5))), dur: L * 2.4, type: 'triangle', gain: 0.06 });
    }
    if (s === 0) {                                                                                           // pad
      for (const k of [0, 2, 4]) tone({ ...m, f: midi(cfg.root + 12 + degree(cfg.scale, deg + k)), dur: L * 15, type: 'sine', gain: 0.03, attack: 0.3 });
    }
  }
  // schedule every step that falls before `until` (called every 25 ms, a little ahead of the clock)
  function scheduleUntil(until) {
    while (nextTime < until) {
      if (step % 16 === 0 && pendingTheme) { themeId = pendingTheme; pendingTheme = null; }   // change key on a bar line
      scheduleStep(step, nextTime);
      nextTime += stepLen(); step++;
    }
  }
  function startMusic() {
    if (timer || mode !== 'on' || !ensure()) return;
    step = 0; nextTime = ctx.currentTime + 0.08;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + 0.6);
    timer = setInterval(() => scheduleUntil(ctx.currentTime + 0.15), 25);
  }
  function stopMusic(fade = 0.5) {
    if (!timer) return;
    clearInterval(timer); timer = null;
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(0.0001, t + fade);
  }

  return {
    unlock: ensure,
    play,
    // is a run in progress? music plays only then
    setPlaying(on) { playing = on; if (on) startMusic(); else stopMusic(); },
    setLevel(n) { level = Math.max(1, Math.min(10, n)); },
    setTempoScale(k) { tempoScale = k; },
    setTheme(id) {
      if (!MUSIC[id] || id === themeId || id === pendingTheme) return;
      if (timer) { pendingTheme = id; play('themeChange'); } else themeId = id;
    },
    get mode() { return mode; },
    cycleMode() {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem('blip-sound', mode); } catch {}
      if (ctx) { applyMode(); if (mode === 'on' && playing) startMusic(); else if (mode !== 'on') stopMusic(0.2); }
      return mode;
    },
    // for tests: render music without the timer
    _renderMusic(seconds) { ensure(); step = 0; nextTime = ctx.currentTime; musicBus.gain.value = MUSIC_GAIN; scheduleUntil(ctx.currentTime + seconds); },
    _ensure: ensure,
    _setOffset(s) { testOffset = s; },
  };
}
