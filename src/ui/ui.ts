import './ui.css';

export interface MenuInfo {
  bestQuick: number | null;
  dailyLabel: string;
  dailyResult: number | null;
  holesInOne: number;
  runs: number;
}

export interface HudInfo {
  hole: number;
  holes: number;
  par: number;
  strokes: number;
  total: number | null;
}

export interface ScorecardInfo {
  title: string;
  pars: number[];
  scores: number[];
  newBest: boolean;
  best: number | null;
}

type Handler = () => void;

export const fmtRel = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UI {
  onQuick: Handler = () => {};
  onDaily: Handler = () => {};
  onRestartHole: Handler = () => {};
  onPause: Handler = () => {};
  onResume: Handler = () => {};
  onQuit: Handler = () => {};
  onMute: Handler = () => {};
  onPlayAgain: Handler = () => {};
  onContinue: Handler = () => {};

  private hud = el('div', 'hud hidden');
  private hudInfo = el('div', 'hud-info');
  private muteBtn = el('button', 'icon-btn', '');
  private bannerEl = el('div', 'banner');
  private hintEl = el('div', 'hint');
  private menu = el('div', 'screen menu hidden');
  private pause = el('div', 'screen pause hidden');
  private card = el('div', 'screen card hidden');
  private bannerTimer = 0;

  constructor(root: HTMLElement) {
    const buttons = el('div', 'hud-buttons');
    const restart = el('button', 'icon-btn', icon('restart'));
    restart.title = 'Restart hole (R)';
    restart.onclick = () => this.onRestartHole();
    this.muteBtn.title = 'Sound (M)';
    this.muteBtn.onclick = () => this.onMute();
    const pause = el('button', 'icon-btn', icon('pause'));
    pause.title = 'Menu (Esc)';
    pause.onclick = () => this.onPause();
    buttons.append(restart, this.muteBtn, pause);
    this.hud.append(this.hudInfo, buttons);

    // Banner taps advance to the next hole on touch screens.
    this.bannerEl.onclick = () => this.onContinue();

    root.append(this.hud, this.bannerEl, this.hintEl, this.menu, this.pause, this.card);
    for (const b of [restart, this.muteBtn, pause]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  showMenu(info: MenuInfo) {
    this.hideScreens();
    this.hud.classList.add('hidden');
    this.hint(null);
    const best = info.bestQuick === null ? '—' : fmtRel(info.bestQuick);
    const daily = info.dailyResult === null ? 'Not played yet' : `Your score: ${fmtRel(info.dailyResult)}`;
    this.menu.innerHTML = `
      <div class="panel">
        <div class="logo"><span class="logo-flag">⛳</span><h1>Pocket Golf</h1></div>
        <p class="tagline">Bite-sized mini golf on islands in the sky</p>
        <button class="big-btn primary" data-act="quick">
          <span class="btn-title">Quick Run</span><span class="btn-sub">9 fresh random holes</span>
        </button>
        <button class="big-btn" data-act="daily">
          <span class="btn-title">Daily Course</span><span class="btn-sub">${info.dailyLabel} · ${daily}</span>
        </button>
        <div class="stats">
          <div><b>${best}</b><span>best run</span></div>
          <div><b>${info.runs}</b><span>runs</span></div>
          <div><b>${info.holesInOne}</b><span>holes in one</span></div>
        </div>
        <p class="howto">Drag anywhere to pull back, release to shoot.<br/>Right-drag or two fingers to look around.</p>
      </div>`;
    this.menu.querySelector<HTMLElement>('[data-act=quick]')!.onclick = () => this.onQuick();
    this.menu.querySelector<HTMLElement>('[data-act=daily]')!.onclick = () => this.onDaily();
    this.menu.classList.remove('hidden');
  }

  showPause() {
    this.pause.innerHTML = `
      <div class="panel small">
        <h2>Paused</h2>
        <button class="big-btn primary" data-act="resume"><span class="btn-title">Resume</span></button>
        <button class="big-btn" data-act="restart"><span class="btn-title">Restart Hole</span></button>
        <button class="big-btn" data-act="quit"><span class="btn-title">Quit to Menu</span></button>
      </div>`;
    this.pause.querySelector<HTMLElement>('[data-act=resume]')!.onclick = () => this.onResume();
    this.pause.querySelector<HTMLElement>('[data-act=restart]')!.onclick = () => {
      this.onResume();
      this.onRestartHole();
    };
    this.pause.querySelector<HTMLElement>('[data-act=quit]')!.onclick = () => this.onQuit();
    this.pause.classList.remove('hidden');
  }

  showScorecard(info: ScorecardInfo) {
    this.hideScreens();
    this.hud.classList.add('hidden');
    this.hint(null);
    const totalPar = info.pars.reduce((a, b) => a + b, 0);
    const total = info.scores.reduce((a, b) => a + b, 0);
    const rel = total - totalPar;
    const cell = (s: number, p: number) => {
      const d = s - p;
      const cls = s === 1 ? 'ace' : d < 0 ? 'under' : d > 0 ? 'over' : 'even';
      return `<td class="${cls}">${s}</td>`;
    };
    this.card.innerHTML = `
      <div class="panel">
        <h2>${info.title}</h2>
        <div class="big-score ${rel < 0 ? 'under' : rel > 0 ? 'over' : ''}">${fmtRel(rel)}</div>
        <div class="sub">${total} strokes · par ${totalPar}${info.newBest ? ' · <span class="new-best">New best!</span>' : info.best !== null ? ` · best ${fmtRel(info.best)}` : ''}</div>
        <div class="table-wrap"><table>
          <tr><th>Hole</th>${info.pars.map((_, k) => `<th>${k + 1}</th>`).join('')}<th>Tot</th></tr>
          <tr><th>Par</th>${info.pars.map((p) => `<td>${p}</td>`).join('')}<td>${totalPar}</td></tr>
          <tr><th>You</th>${info.scores.map((s, k) => cell(s, info.pars[k])).join('')}<td><b>${total}</b></td></tr>
        </table></div>
        <button class="big-btn primary" data-act="again"><span class="btn-title">Play Again</span></button>
        <button class="big-btn" data-act="menu"><span class="btn-title">Menu</span></button>
      </div>`;
    this.card.querySelector<HTMLElement>('[data-act=again]')!.onclick = () => this.onPlayAgain();
    this.card.querySelector<HTMLElement>('[data-act=menu]')!.onclick = () => this.onQuit();
    this.card.classList.remove('hidden');
  }

  hideScreens() {
    this.menu.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.card.classList.add('hidden');
  }

  hidePause() {
    this.pause.classList.add('hidden');
  }

  setHud(info: HudInfo) {
    this.hud.classList.remove('hidden');
    this.hudInfo.innerHTML = `
      <div class="chip"><span>Hole</span><b>${info.hole}<small>/${info.holes}</small></b></div>
      <div class="chip"><span>Par</span><b>${info.par}</b></div>
      <div class="chip"><span>Strokes</span><b>${info.strokes}</b></div>
      ${info.total === null ? '' : `<div class="chip total"><span>Run</span><b>${fmtRel(info.total)}</b></div>`}`;
  }

  setMuted(muted: boolean) {
    this.muteBtn.innerHTML = icon(muted ? 'muted' : 'sound');
  }

  banner(title: string, sub = '', kind = '', ms = 1800) {
    clearTimeout(this.bannerTimer);
    this.bannerEl.className = `banner show ${kind}`;
    this.bannerEl.innerHTML = `<div class="banner-title">${title}</div>${sub ? `<div class="banner-sub">${sub}</div>` : ''}`;
    if (ms > 0) this.bannerTimer = window.setTimeout(() => this.clearBanner(), ms);
  }

  clearBanner() {
    clearTimeout(this.bannerTimer);
    this.bannerEl.className = 'banner';
  }

  hint(text: string | null) {
    this.hintEl.textContent = text ?? '';
    this.hintEl.classList.toggle('show', !!text);
  }
}

function icon(name: 'restart' | 'pause' | 'sound' | 'muted') {
  const paths = {
    restart: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><polyline points="4 3 4 8 9 8"/>',
    pause: '<line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/>',
    sound: '<polygon points="4 9 8 9 13 5 13 19 8 15 4 15"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
    muted: '<polygon points="4 9 8 9 13 5 13 19 8 15 4 15"/><line x1="17" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="17" y2="15"/>',
  };
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}
