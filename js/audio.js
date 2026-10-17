// Procedural ambient music + sound effects. No audio files: everything is
// synthesised live with the Web Audio API, so the game still runs from file://.
//
// Music: a four-chord loop (Am - F - C - G) with a soft detuned pad, a rounded
// bass, a sparse pentatonic pluck line and occasional bells, sent through a
// warm low-pass and a feedback echo. SFX: dice rattle, build tocks, city
// chime, robber drone and a victory arpeggio.
const AUDIO = (() => {
  let ctx = null, master = null, musicBus = null, sfxBus = null, delay = null;
  let timer = null, playing = false, bar = 0;
  let sfxOn = true, volume = 0.7;

  const PROG = [
    { bass: 110.00, tones: [220.00, 261.63, 329.63] },  // A minor
    { bass: 87.31,  tones: [174.61, 220.00, 261.63] },  // F major
    { bass: 130.81, tones: [261.63, 329.63, 392.00] },  // C major
    { bass: 98.00,  tones: [196.00, 246.94, 293.66] },  // G major
  ];
  // A-minor pentatonic over two octaves: every note is safe over all four
  // chords, so the pluck line can wander freely without ever clashing.
  const SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
  const BAR = 4.0; // seconds per chord

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    // Feedback echo for a sense of space.
    delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.33;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
    // Music bus: warm low-pass in front of the echo.
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    musicBus.connect(lp); lp.connect(master); lp.connect(delay);
    // SFX bus feeds the echo too, but stays bright.
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.9 : 0;
    sfxBus.connect(master); sfxBus.connect(delay);
    return true;
  }

  // Ready to make sound right now? AudioContexts need a user gesture to run;
  // until one happens the context stays suspended and calls are simply quiet.
  function live() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    return ctx.state === 'running';
  }

  function tone(dest, type, freq, t0, dur, peak, pan) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.35, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    let node = g;
    if (pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      g.connect(p); node = p;
    }
    node.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // Pad chord: detuned sine pairs with a slow swell and a long release.
  function pad(chord, t0) {
    const dur = BAR + 1.2;
    chord.tones.forEach((f, i) => {
      const pan = (i - 1) * 0.28;
      for (const [freq, level, p] of [[f, 0.05, pan], [f * 1.004, 0.04, -pan]]) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(level, t0 + dur * 0.45);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(musicBus);
        o.start(t0); o.stop(t0 + dur + 0.05);
        void p;
      }
    });
    tone(musicBus, 'sine', chord.bass, t0, dur, 0.09, 0);
  }

  function tick() {
    if (!playing || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.05;
    const chord = PROG[bar % PROG.length];
    pad(chord, t0);
    // Sparse pentatonic wander across eight half-second steps.
    for (let step = 0; step < 8; step++) {
      if (Math.random() < 0.4) {
        const note = SCALE[Math.floor(Math.random() * SCALE.length)];
        tone(musicBus, 'triangle', note, t0 + step * (BAR / 8), 1.1, 0.075,
          Math.random() * 1.2 - 0.6);
      }
    }
    // A high sparkle bell on alternate bars.
    if (bar % 2 === 1) {
      const f = chord.tones[Math.floor(Math.random() * 3)] * 4;
      tone(musicBus, 'sine', f, t0 + BAR * 0.5, 3.0, 0.05, 0.4);
    }
    bar++;
  }

  function start() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
    tick();
    timer = setInterval(tick, BAR * 1000);
    return true;
  }

  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (musicBus && ctx) {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
      musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
    }
  }

  function toggle() {
    if (playing) { stop(); return false; }
    start();
    return playing;
  }

  // ---- sound effects -----------------------------------------------------
  function noiseBurst(t0, dur, freq, peak) {
    const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  function dice() {
    if (!sfxOn || !live()) return;
    const t0 = ctx.currentTime;
    tone(sfxBus, 'triangle', 660, t0, 0.12, 0.22, -0.2);
    tone(sfxBus, 'triangle', 880, t0 + 0.08, 0.15, 0.18, 0.2);
    tone(sfxBus, 'sine', 523.25, t0 + 0.18, 0.22, 0.16, 0);
  }

  function tock(t0, f) { tone(sfxBus, 'sine', f, t0, 0.16, 0.3, 0); }

  // Wooden pieces: a soft double tock; the city adds a two-note chime.
  function build() {
    if (!sfxOn || !live()) return;
    const t0 = ctx.currentTime;
    tock(t0, 300); tock(t0 + 0.07, 210);
  }

  function city() {
    if (!sfxOn || !live()) return;
    const t0 = ctx.currentTime;
    tock(t0, 260); tock(t0 + 0.08, 180);
    tone(sfxBus, 'triangle', 659.26, t0 + 0.16, 0.5, 0.12, 0.2);
    tone(sfxBus, 'triangle', 880.00, t0 + 0.24, 0.6, 0.10, -0.2);
  }

  // Low dissonant drone when the robber strikes.
  function robber() {
    if (!sfxOn || !live()) return;
    const t0 = ctx.currentTime;
    tone(sfxBus, 'sawtooth', 82.41, t0, 0.9, 0.12, 0);
    tone(sfxBus, 'sawtooth', 87.31, t0, 0.9, 0.10, 0);
  }

  function win() {
    if (!sfxOn || !live()) return;
    const t0 = ctx.currentTime;
    [523.25, 659.26, 783.99, 1046.50].forEach((f, i) =>
      tone(sfxBus, 'triangle', f, t0 + i * 0.13, 0.9, 0.14, i % 2 ? 0.3 : -0.3));
  }

  function setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    if (master && ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.15);
    }
    return volume;
  }

  function setSfx(on) {
    sfxOn = !!on;
    if (sfxBus && ctx) {
      sfxBus.gain.cancelScheduledValues(ctx.currentTime);
      sfxBus.gain.setValueAtTime(sfxBus.gain.value, ctx.currentTime);
      sfxBus.gain.linearRampToValueAtTime(sfxOn ? 0.9 : 0, ctx.currentTime + 0.05);
    }
    return sfxOn;
  }

  return {
    start, stop, toggle, isPlaying: () => playing,
    dice, build, city, robber, win,
    setVolume, setSfx, isSfxOn: () => sfxOn,
  };
})();
