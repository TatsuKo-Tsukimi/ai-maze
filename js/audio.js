// ═══════════════════════════════════════════════════════════════
// AUDIO SYSTEM — Web Audio API synthesizer, zero audio files
// ═══════════════════════════════════════════════════════════════
const audio = (() => {
  let ctx = null;
  let masterGain = null;
  let ambientOsc = null;
  let ambientLfo = null;
  let ambientGain = null;
  let heartbeatTimer = null;
  let _muted = false;
  let _initialized = false;

  function init() {
    if (_initialized) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.7;
      masterGain.connect(ctx.destination);
      _initialized = true;
      _startAmbient();
    } catch (e) {
      console.warn('[audio] Web Audio not available:', e.message);
    }
  }

  function _ok() { return _initialized && ctx && !_muted; }

  function _now() { return ctx.currentTime; }

  // ── Ambient drone ──────────────────────────────────────────
  function _startAmbient() {
    if (!_ok()) return;
    ambientOsc = ctx.createOscillator();
    ambientOsc.type = 'sine';
    ambientOsc.frequency.value = 48;

    ambientLfo = ctx.createOscillator();
    ambientLfo.type = 'sine';
    ambientLfo.frequency.value = 0.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    ambientLfo.connect(lfoGain);
    lfoGain.connect(ambientOsc.frequency);
    ambientLfo.start();

    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0.06;
    ambientOsc.connect(ambientGain);
    ambientGain.connect(masterGain);
    ambientOsc.start();
  }

  function updateAmbientDepth(depth) {
    if (!ambientGain) return;
    // Volume increases subtly with depth: 0.06 at depth 0, up to 0.14 at depth 20+
    const vol = 0.06 + Math.min(depth, 20) * 0.004;
    ambientGain.gain.setTargetAtTime(vol, _now(), 0.5);
    // Pitch drops slightly with depth
    if (ambientOsc) {
      ambientOsc.frequency.setTargetAtTime(48 - Math.min(depth, 15) * 0.5, _now(), 0.5);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function _noise(duration) {
    const len = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function _envelope(param, attack, hold, decay, peak = 1) {
    const t = _now();
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(0.001, t + attack + hold + decay);
  }

  // ── Per-mechanic sounds ────────────────────────────────────

  function playMove() {
    if (!_ok()) return;
    // Soft footstep — short noise burst with bandpass
    const noise = _noise(0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 200 + Math.random() * 300;
    bp.Q.value = 1.5;
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.005, 0.02, 0.06, 0.15);
    noise.connect(bp);
    bp.connect(gain);
    gain.connect(masterGain);
    noise.start();
    noise.stop(_now() + 0.1);
  }

  function playTemptation() {
    if (!_ok()) return;
    // Eerie whisper tone — high-frequency sine with reverb feel, slow fade
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1800 + Math.random() * 400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, _now());
    gain.gain.linearRampToValueAtTime(0.06, _now() + 1.0);
    gain.gain.linearRampToValueAtTime(0, _now() + 3.0);
    // Slight detune for eeriness
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = osc.frequency.value + 3;
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0, _now());
    gain2.gain.linearRampToValueAtTime(0.04, _now() + 1.0);
    gain2.gain.linearRampToValueAtTime(0, _now() + 3.0);
    osc.connect(gain); gain.connect(masterGain);
    osc2.connect(gain2); gain2.connect(masterGain);
    osc.start(); osc2.start();
    osc.stop(_now() + 3.2); osc2.stop(_now() + 3.2);
  }

  function playJumpscare() {
    if (!_ok()) return;
    // Loud stinger — sawtooth burst at 200Hz with distortion
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 200;
    const dist = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = (Math.PI + 3) * x / (Math.PI + 3 * Math.abs(x));
    }
    dist.curve = curve;
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.01, 0.05, 0.25, 0.45);
    osc.connect(dist);
    dist.connect(gain);
    gain.connect(masterGain);
    osc.start();
    osc.stop(_now() + 0.35);
    // Screen shake
    document.body.classList.add('screen-shake');
    setTimeout(() => document.body.classList.remove('screen-shake'), 400);
  }

  function playEchoLoop() {
    if (!_ok()) return;
    // Repeat last footstep 3x with increasing delay and decreasing volume
    [0, 0.15, 0.35].forEach((delay, i) => {
      setTimeout(() => {
        const noise = _noise(0.06);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 250 + Math.random() * 200;
        bp.Q.value = 1.2;
        const gain = ctx.createGain();
        const vol = 0.12 * (1 - i * 0.3);
        _envelope(gain.gain, 0.005, 0.015, 0.04, vol);
        noise.connect(bp); bp.connect(gain); gain.connect(masterGain);
        noise.start(); noise.stop(ctx.currentTime + 0.08);
      }, delay * 1000);
    });
  }

  function playMemoryScramble() {
    if (!_ok()) return;
    // Static/noise — white noise through bandpass, warbling
    const noise = _noise(1.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1000;
    bp.Q.value = 2;
    // Warble the filter
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain);
    lfoGain.connect(bp.frequency);
    lfo.start();
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.05, 0.4, 0.7, 0.18);
    noise.connect(bp); bp.connect(gain); gain.connect(masterGain);
    noise.start(); noise.stop(_now() + 1.3);
    lfo.stop(_now() + 1.3);
    // Full-screen glitch flash
    _triggerGlitchFlash();
  }

  function _triggerGlitchFlash() {
    let flash = document.getElementById('fullscreen-glitch');
    if (!flash) {
      flash = document.createElement('div');
      flash.id = 'fullscreen-glitch';
      document.body.appendChild(flash);
    }
    flash.classList.remove('active');
    void flash.offsetWidth;
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 300);
  }

  function playTrialAppear() {
    if (!_ok()) return;
    // Metallic scrape — noise + resonant bandpass sweep 2kHz→200Hz over 1s
    const noise = _noise(1.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2000, _now());
    bp.frequency.exponentialRampToValueAtTime(200, _now() + 1.0);
    bp.Q.value = 8;
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.02, 0.5, 0.5, 0.2);
    noise.connect(bp); bp.connect(gain); gain.connect(masterGain);
    noise.start(); noise.stop(_now() + 1.3);
  }

  function playTrialPass() {
    if (!_ok()) return;
    // Resolution tone — major chord (C-E-G), gentle sine, 0.5s
    [261.63, 329.63, 392.00].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = _now() + i * 0.05;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain); gain.connect(masterGain);
      osc.start(t); osc.stop(t + 0.55);
    });
  }

  function playTrialFail() {
    if (!_ok()) return;
    // Dissonant buzz — minor second (E-F), sawtooth, 0.3s (lowered volume)
    [329.63, 349.23].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      _envelope(gain.gain, 0.01, 0.1, 0.2, 0.05);
      osc.connect(gain); gain.connect(masterGain);
      osc.start(); osc.stop(_now() + 0.35);
    });
  }

  function playGodHand() {
    if (!_ok()) return;
    // Deep bass hit + reverb tail — sine at 50Hz, fast decay
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 50;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, _now());
    gain.gain.exponentialRampToValueAtTime(0.001, _now() + 1.2);
    // Sub-harmonic for reverb feel
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 25;
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.2, _now());
    gain2.gain.exponentialRampToValueAtTime(0.001, _now() + 1.8);
    osc.connect(gain); gain.connect(masterGain);
    osc2.connect(gain2); gain2.connect(masterGain);
    osc.start(); osc.stop(_now() + 1.3);
    osc2.start(); osc2.stop(_now() + 2.0);
  }

  function playHpLoss() {
    if (!_ok()) return;
    // Glass shatter — noise burst with high-pass filter, fast decay, pitch down
    const noise = _noise(0.3);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(3000, _now());
    hp.frequency.exponentialRampToValueAtTime(800, _now() + 0.25);
    hp.Q.value = 1;
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.005, 0.03, 0.25, 0.25);
    noise.connect(hp); hp.connect(gain); gain.connect(masterGain);
    noise.start(); noise.stop(_now() + 0.35);
    // Screen shake + red flash on HP loss — visceral feedback
    document.body.classList.remove('screen-shake');
    void document.body.offsetWidth;
    document.body.classList.add('screen-shake');
    setTimeout(() => document.body.classList.remove('screen-shake'), 400);
    // Red damage vignette flash
    const flash = document.createElement('div');
    flash.className = 'dmg-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 600);
  }

  function playHpGain() {
    if (!_ok()) return;
    // Soft chime — triangle wave, ascending arpeggio C5-E5-G5
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = _now() + i * 0.3;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain); gain.connect(masterGain);
      osc.start(t); osc.stop(t + 0.4);
    });
  }

  function playTruthReveal() {
    if (!_ok()) return;
    // Bell tone — sine with slow attack, long sustain, vibrato
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    // Vibrato
    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 3;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vib.start();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, _now());
    gain.gain.linearRampToValueAtTime(0.15, _now() + 0.8);
    gain.gain.setValueAtTime(0.15, _now() + 2.5);
    gain.gain.exponentialRampToValueAtTime(0.001, _now() + 4.0);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(); osc.stop(_now() + 4.2);
    vib.stop(_now() + 4.2);
  }

  // ── Card-specific temptation sounds ──

  function playBeautyTrap() {
    if (!_ok()) return;
    // Warm, dreamy chime — layered sine harmonics with slow swell
    const freqs = [440, 554, 659]; // A4, C#5, E5 — A major chord
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      const delay = i * 0.3;
      gain.gain.setValueAtTime(0, _now() + delay);
      gain.gain.linearRampToValueAtTime(0.06, _now() + delay + 0.8);
      gain.gain.linearRampToValueAtTime(0, _now() + delay + 3.0);
      osc.connect(gain); gain.connect(masterGain);
      osc.start(_now() + delay); osc.stop(_now() + delay + 3.2);
    });
  }

  function playBreadcrumb() {
    if (!_ok()) return;
    // Dripping water echoes — short noise bursts with decay, spaced out
    [0, 0.25, 0.55, 0.9].forEach(delay => {
      setTimeout(() => {
        if (!_ok()) return;
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.2));
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        // Band-pass for water-like tone
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2000 + Math.random() * 1000;
        filter.Q.value = 8;
        const gain = ctx.createGain();
        gain.gain.value = 0.08;
        src.connect(filter); filter.connect(gain); gain.connect(masterGain);
        src.start();
      }, delay * 1000);
    });
  }

  function playRewardMirage() {
    if (!_ok()) return;
    // Shimmering mirage — two detuned oscillators with vibrato, phase shifting
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc2.type = 'triangle';
    osc1.frequency.value = 600;
    osc2.frequency.value = 603; // slight detune for shimmer
    // Vibrato via LFO
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4; // 4Hz wobble
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 15; // ±15Hz pitch wobble
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfoGain.connect(osc2.frequency);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, _now());
    gain.gain.linearRampToValueAtTime(0.05, _now() + 0.5);
    gain.gain.linearRampToValueAtTime(0.07, _now() + 1.5);
    gain.gain.linearRampToValueAtTime(0, _now() + 3.0);
    osc1.connect(gain); osc2.connect(gain); gain.connect(masterGain);
    lfo.start(); osc1.start(); osc2.start();
    lfo.stop(_now() + 3.2); osc1.stop(_now() + 3.2); osc2.stop(_now() + 3.2);
  }

  function playFakeExit() {
    if (!_ok()) return;
    // Rising tone then cut — sine sweep 200→800Hz over 1.5s, then silence
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, _now());
    osc.frequency.exponentialRampToValueAtTime(800, _now() + 1.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, _now());
    gain.gain.setValueAtTime(0.15, _now() + 1.48);
    gain.gain.setValueAtTime(0, _now() + 1.5); // abrupt cut
    osc.connect(gain); gain.connect(masterGain);
    osc.start(); osc.stop(_now() + 1.55);
  }

  function startHeartbeat(stepsRemaining) {
    if (!_ok()) return;
    stopHeartbeat();
    // Rate increases as steps decrease: ~1Hz at 10 remaining, ~2.5Hz at 2 remaining
    const rate = 1.0 + (10 - Math.min(stepsRemaining, 10)) * 0.15;
    const interval = 1000 / rate;
    heartbeatTimer = setInterval(() => {
      if (!_ok()) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain); gain.connect(masterGain);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
      // Second beat (lub-dub)
      setTimeout(() => {
        if (!_ok()) return;
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 45;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.12, ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc2.connect(g2); g2.connect(masterGain);
        osc2.start(); osc2.stop(ctx.currentTime + 0.12);
      }, 120);
    }, interval);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function playGameOver() {
    if (!_ok()) return;
    stopHeartbeat();
    // Drone pitch drops slowly, volume fades, ends in silence
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, _now());
    osc.frequency.exponentialRampToValueAtTime(25, _now() + 4.0);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, _now());
    gain.gain.linearRampToValueAtTime(0, _now() + 4.0);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(); osc.stop(_now() + 4.2);
    // Stop ambient
    if (ambientGain) ambientGain.gain.setTargetAtTime(0, _now(), 1.0);
  }

  function playWin() {
    if (!_ok()) return;
    stopHeartbeat();
    // Ascending major scale, each note louder, ending in sustained chord
    const scale = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];
    scale.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = _now() + i * 0.2;
      const vol = 0.06 + i * 0.015;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.03);
      if (i < scale.length - 1) {
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      } else {
        // Sustained final note
        gain.gain.setValueAtTime(vol, t + 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
      }
      osc.connect(gain); gain.connect(masterGain);
      osc.start(t); osc.stop(t + (i < scale.length - 1 ? 0.25 : 2.2));
    });
    // Final sustained chord (C-E-G)
    const chordT = _now() + scale.length * 0.2 + 0.1;
    [523.25, 659.25, 783.99].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, chordT);
      gain.gain.linearRampToValueAtTime(0.12, chordT + 0.1);
      gain.gain.setValueAtTime(0.12, chordT + 1.5);
      gain.gain.exponentialRampToValueAtTime(0.001, chordT + 3.0);
      osc.connect(gain); gain.connect(masterGain);
      osc.start(chordT); osc.stop(chordT + 3.2);
    });
  }

  function playWallClose() {
    if (!_ok()) return;
    // Stone grinding — filtered noise
    const noise = _noise(0.8);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 400;
    bp.Q.value = 2;
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.05, 0.3, 0.4, 0.15);
    noise.connect(bp); bp.connect(gain); gain.connect(masterGain);
    noise.start(); noise.stop(_now() + 0.9);
  }

  function playCountdown() {
    if (!_ok()) return;
    // Ticking clock sound
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1000;
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.001, 0.01, 0.05, 0.08);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(); osc.stop(_now() + 0.08);
  }

  function playShadowChase() {
    if (!_ok()) return;
    // Low rumble
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.1, 0.5, 1.0, 0.15);
    osc.connect(lp); lp.connect(gain); gain.connect(masterGain);
    osc.start(); osc.stop(_now() + 1.8);
  }

  function playRetreat() {
    if (!_ok()) return;
    // Quick descending tone
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, _now());
    osc.frequency.exponentialRampToValueAtTime(150, _now() + 0.2);
    const gain = ctx.createGain();
    _envelope(gain.gain, 0.01, 0.05, 0.15, 0.1);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(); osc.stop(_now() + 0.25);
  }

  // ── Reset (for restartGame) ────────────────────────────────
  function reset() {
    stopHeartbeat();
    if (ambientGain && ctx) {
      ambientGain.gain.setTargetAtTime(0.06, _now(), 0.3);
    }
    // Reset HP color grading
    _updateHpVisuals(3);
  }

  // ── HP-based color grading (called from updateHearts) ──────
  function _updateHpVisuals(hp) {
    document.body.classList.remove('hp-2', 'hp-1', 'hp-0');
    if (hp === 2) document.body.classList.add('hp-2');
    else if (hp === 1) document.body.classList.add('hp-1');
    else if (hp <= 0) document.body.classList.add('hp-0');
  }

  function onHpChange(hp) {
    _updateHpVisuals(hp);
    if (!ctx || !ambientGain || !ambientOsc) return;
    const t = _now();
    // HP-reactive ambient: lower HP = lower pitch, louder, more oppressive
    if (hp <= 1) {
      ambientOsc.frequency.setTargetAtTime(35, t, 1.2);   // deep rumble
      ambientGain.gain.setTargetAtTime(0.18, t, 0.8);     // louder
    } else if (hp <= 2) {
      ambientOsc.frequency.setTargetAtTime(42, t, 0.8);   // slightly lower
      ambientGain.gain.setTargetAtTime(0.12, t, 0.5);     // slightly louder
    } else {
      // HP=3: restore normal ambient based on depth
      ambientOsc.frequency.setTargetAtTime(48, t, 0.5);
      ambientGain.gain.setTargetAtTime(0.08, t, 0.5);
    }
  }

  return {
    init,
    playMove,
    playTemptation,
    playJumpscare,
    playEchoLoop,
    playMemoryScramble,
    playTrialAppear,
    playTrialPass,
    playTrialFail,
    playGodHand,
    playHpLoss,
    playHpGain,
    playTruthReveal,
    playBeautyTrap,
    playBreadcrumb,
    playRewardMirage,
    playFakeExit,
    startHeartbeat,
    stopHeartbeat,
    playGameOver,
    playWin,
    playWallClose,
    playCountdown,
    playShadowChase,
    playRetreat,
    updateAmbientDepth,
    onHpChange,
    reset,
  };
})();
