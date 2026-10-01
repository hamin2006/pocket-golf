/** Tiny synthesized sound effects — no audio files needed. */
export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuf?: AudioBuffer;
  private lastImpact = 0;
  muted = false;

  /** Must be called from a user gesture before sounds will play (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let k = 0; k < len; k++) data[k] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ready(): AudioContext | undefined {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return undefined;
    return this.ctx;
  }

  private tone(freq: number, end: number, dur: number, type: OscillatorType, gain: number, delay = 0) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(end, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, q: number, gain: number, delay = 0, sweepTo?: number) {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  hit(power: number) {
    const v = 0.25 + power * 0.6;
    this.tone(1400, 500, 0.06, 'triangle', v * 0.7);
    this.noise(0.05, 3000, 1.2, v * 0.6);
  }

  impact(mat: string, speed: number) {
    const now = performance.now();
    if (now - this.lastImpact < 45) return;
    this.lastImpact = now;
    const v = Math.min(1, speed / 8);
    if (mat === 'bumper') {
      this.tone(260, 620, 0.18, 'sine', 0.35 + v * 0.3);
    } else if (mat === 'wall' || mat === 'obstacle') {
      this.tone(320 + v * 120, 180, 0.08, 'sine', 0.15 + v * 0.45);
      this.noise(0.04, 1400, 2, 0.1 + v * 0.3);
    } else {
      this.noise(0.05, 500, 1, 0.08 + v * 0.2);
    }
  }

  lip() {
    this.noise(0.04, 2200, 4, 0.3);
    this.noise(0.04, 1900, 4, 0.25, 0.07);
  }

  cup() {
    [0, 0.07, 0.12].forEach((d, k) => this.noise(0.05, 2400 - k * 300, 5, 0.35, d));
    this.tone(160, 90, 0.18, 'sine', 0.5, 0.16);
  }

  cheer(level: number) {
    const notes = level >= 2 ? [523, 659, 784, 1047, 1319] : level === 1 ? [523, 659, 784, 1047] : [523, 659];
    notes.forEach((n, k) => this.tone(n, n, 0.22, 'triangle', 0.22, 0.3 + k * 0.09));
  }

  fall() {
    this.tone(700, 140, 0.6, 'sine', 0.25);
    this.noise(0.5, 900, 0.8, 0.1, 0.1, 300);
  }

  boost() {
    this.noise(0.35, 400, 1.5, 0.35, 0, 2600);
  }

  click() {
    this.tone(900, 700, 0.04, 'triangle', 0.15);
  }
}
