/**
 * SFX: WebAudioシンセ効果音（音声アセット不要）
 * 使い方: SFX.play('pop')。初回はユーザー操作内で SFX.unlock() を呼ぶ（autoplay制限対策）。
 * stage3d.js からは window.SFX 経由の疎結合で呼ぶ。
 */
const SFX = (() => {
  'use strict';
  let ctx = null, master = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /* 単音: 周波数f→f2へスライド */
  function tone(o) {
    const t0 = ctx.currentTime + (o.at || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f2, 1), t0 + o.d);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.v || 0.5, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + o.d);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + o.d + 0.05);
  }

  /* ノイズバースト（filter: lowpass/bandpassの中心周波数スライド） */
  function noise(o) {
    const t0 = ctx.currentTime + (o.at || 0);
    const len = Math.ceil(ctx.sampleRate * o.d);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const fl = ctx.createBiquadFilter();
    fl.type = o.ftype || 'lowpass';
    fl.frequency.setValueAtTime(o.f || 800, t0);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(Math.max(o.f2, 1), t0 + o.d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.v || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + o.d);
    src.connect(fl); fl.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + o.d + 0.05);
  }

  const defs = {
    click:   () => tone({ f: 900, f2: 1400, d: 0.05, type: 'sine', v: 0.25 }),
    pop:     () => tone({ f: 420, f2: 920, d: 0.1, type: 'sine', v: 0.5 }),
    munch:   () => { noise({ f: 900, f2: 250, d: 0.09, v: 0.5 }); tone({ f: 160, f2: 90, d: 0.09, type: 'square', v: 0.18 }); },
    gulp:    () => tone({ f: 300, f2: 90, d: 0.22, type: 'sine', v: 0.45 }),
    hop:     () => tone({ f: 280, f2: 640, d: 0.13, type: 'triangle', v: 0.4 }),
    sweat:   () => tone({ f: 1200, f2: 700, d: 0.08, type: 'sine', v: 0.2 }),
    sweep:   () => noise({ ftype: 'bandpass', f: 400, f2: 2600, d: 0.35, v: 0.4 }),
    sparkle: () => { [1320, 1760, 2200].forEach((f, i) => tone({ f, f2: f * 1.3, d: 0.1, at: i * 0.05, type: 'sine', v: 0.16 })); },
    plop:    () => tone({ f: 260, f2: 70, d: 0.16, type: 'sine', v: 0.45 }),
    buzz:    () => tone({ f: 130, f2: 100, d: 0.18, type: 'square', v: 0.22 }),
    heal:    () => { [660, 880].forEach((f, i) => tone({ f, d: 0.14, at: i * 0.1, type: 'triangle', v: 0.3 })); },
    alert:   () => { [1100, 1100].forEach((f, i) => tone({ f, f2: 900, d: 0.11, at: i * 0.16, type: 'square', v: 0.15 })); },
    night:   () => { [520, 390].forEach((f, i) => tone({ f, d: 0.28, at: i * 0.18, type: 'sine', v: 0.25 })); },
    impact:  () => { noise({ f: 2200, f2: 200, d: 0.16, v: 0.55 }); tone({ f: 190, f2: 55, d: 0.17, type: 'sine', v: 0.5 }); },
    dash:    () => noise({ ftype: 'bandpass', f: 600, f2: 1800, d: 0.14, v: 0.25 }),
    fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: i === 3 ? 0.4 : 0.13, at: i * 0.12, type: 'square', v: 0.16 })); },
    sad:     () => { [392, 330, 262].forEach((f, i) => tone({ f, d: 0.25, at: i * 0.2, type: 'triangle', v: 0.25 })); },
    evolve:  () => {
      [440, 554, 659, 880, 1109, 1319].forEach((f, i) => tone({ f, d: 0.12, at: i * 0.07, type: 'triangle', v: 0.2 }));
      noise({ ftype: 'bandpass', f: 1500, f2: 4000, d: 0.5, at: 0.1, v: 0.12 });
    },
    born:    () => { [523, 659, 784].forEach((f, i) => tone({ f, f2: f * 1.05, d: 0.16, at: i * 0.1, type: 'sine', v: 0.25 })); },
  };

  return {
    unlock() { ensure(); },
    play(name) {
      try {
        if (!ensure()) return;
        const fn = defs[name];
        if (fn) fn();
      } catch (e) { /* 音は失敗してもゲームを止めない */ }
    },
  };
})();
window.SFX = SFX;
