import * as THREE from 'three';
import { BALL_R, HOLES_PER_RUN, MAX_OVER_PAR, PHYS_DT } from '../config';
import { Sfx } from '../audio/sfx';
import { hashSeed, mulberry32 } from '../core/rng';
import { generateHole } from '../course/generator';
import { buildLayout } from '../course/layout';
import type { HoleLayout, HoleSpec } from '../course/types';
import { CameraRig } from '../input/cameraRig';
import { Controls } from '../input/controls';
import { PhysicsWorld } from '../physics/world';
import { AimView, BallView } from '../render/ballView';
import { HoleView } from '../render/holeView';
import { Stage } from '../render/stage';
import { UI } from '../ui/ui';
import { loadSave, todayKey, writeSave } from './storage';

type State = 'menu' | 'intro' | 'aim' | 'rolling' | 'sinking' | 'out' | 'done' | 'scorecard';
type Mode = 'quick' | 'daily';

const SINK_ANIM = 0.35;
const DONE_DELAY = 2.4;
const OUT_DELAY = 1.1;

interface Hole {
  spec: HoleSpec;
  layout: HoleLayout;
  world: PhysicsWorld;
  view: HoleView;
}

export class Game {
  private stage: Stage;
  private rig: CameraRig;
  private ui: UI;
  private sfx = new Sfx();
  private save = loadSave();
  private ball: BallView;
  private aim: AimView;

  private state: State = 'menu';
  private paused = false;
  private mode: Mode = 'quick';
  private runSeed = 0;
  private specs: HoleSpec[] = [];
  private scores: number[] = [];
  private holeIdx = 0;
  private hole?: Hole;
  private strokes = 0;
  private lastRest = new THREE.Vector3();
  private stateTime = 0;
  private time = 0;
  private acc = 0;
  private sinkFrom = new THREE.Vector3();
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.rig = new CameraRig(this.stage.camera);
    this.ball = new BallView(this.stage.scene);
    this.aim = new AimView(this.stage.scene);
    this.ui = new UI(document.body);
    this.sfx.muted = this.save.muted;
    this.ui.setMuted(this.save.muted);

    const controls = new Controls(this.stage.renderer.domElement, this.rig, {
      canAim: () => this.state === 'aim' && !this.paused && !!this.hole?.world.ball.sleeping,
      onAim: (x, z, power) => {
        if (!this.hole) return;
        if (power <= 0) this.aim.hide();
        else this.aim.show(this.hole.world.ball.pos, x, z, power);
      },
      onAimCancel: () => this.aim.hide(),
      onShoot: (x, z, power) => this.shoot(x, z, power),
      onInput: () => {
        this.sfx.unlock();
        if (this.state === 'intro') this.skipIntro();
      },
    });

    this.ui.onQuick = () => this.startRun('quick');
    this.ui.onDaily = () => this.startRun('daily');
    this.ui.onPlayAgain = () => this.startRun(this.mode);
    this.ui.onRestartHole = () => this.restartHole();
    this.ui.onPause = () => this.setPaused(true);
    this.ui.onResume = () => this.setPaused(false);
    this.ui.onQuit = () => this.toMenu();
    this.ui.onMute = () => this.toggleMute();
    this.ui.onContinue = () => {
      if (this.state === 'done') this.nextHole();
    };
    document.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });

    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (this.state === 'menu' || this.state === 'scorecard') return;
        if (this.state === 'aim' && !this.paused) controls.cancelAim();
        this.setPaused(!this.paused);
      } else if (this.paused || this.state === 'menu' || this.state === 'scorecard') {
        return;
      } else if (k === 'r') this.restartHole();
      else if (k === 'm') this.toggleMute();
      else if (k === ' ' || k === 'enter') {
        if (this.state === 'intro') this.skipIntro();
        else if (this.state === 'done') this.nextHole();
      } else if (k === 'arrowleft' || k === 'a' || k === 'q') this.rig.rotate(-40, 0);
      else if (k === 'arrowright' || k === 'd' || k === 'e') this.rig.rotate(40, 0);
      else if (k === 'arrowup' || k === 'w') this.rig.rotate(0, -30);
      else if (k === 'arrowdown' || k === 's') this.rig.rotate(0, 30);
      else if (k === '=' || k === '+') this.rig.zoom(0.85);
      else if (k === '-' || k === '_') this.rig.zoom(1.18);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state !== 'menu' && this.state !== 'scorecard') this.setPaused(true);
    });

    this.toMenu();
    if (import.meta.env.DEV) this.devStart();
    this.stage.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- Flow ----------

  private toMenu() {
    this.paused = false;
    this.state = 'menu';
    this.ui.clearBanner();
    const today = todayKey();
    const daily = this.save.daily[today];
    this.ui.showMenu({
      bestQuick: this.save.bestQuick,
      dailyLabel: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      dailyResult: daily ? daily.rel : null,
      holesInOne: this.save.holesInOne,
      runs: this.save.runs,
    });
    // A random hole slowly turning behind the menu.
    const spec = generateHole(Math.floor(Math.random() * 1e9), 0.6);
    this.loadHoleSpec(spec);
    const { min, max } = this.hole!.layout;
    this.rig.showcase(min.clone().add(max).multiplyScalar(0.5), max.clone().sub(min).length() / 2);
    this.ball.mesh.visible = false;
  }

  /** Dev only: `?seed=123&hole=4` jumps straight into a quick run at that hole. */
  private devStart() {
    const q = new URLSearchParams(location.search);
    if (!q.has('seed')) return;
    this.startRun('quick', Number(q.get('seed')));
    const hole = Number(q.get('hole') ?? 1) - 1;
    if (hole > 0) {
      this.holeIdx = hole;
      this.scores = this.specs.slice(0, hole).map((s) => s.par);
      this.startHole();
    }
  }

  private startRun(mode: Mode, seed?: number) {
    this.mode = mode;
    this.runSeed = seed ?? (mode === 'daily' ? hashSeed('daily', todayKey()) : Math.floor(Math.random() * 2 ** 31));
    const rng = mulberry32(this.runSeed);
    this.specs = Array.from({ length: HOLES_PER_RUN }, (_, k) => {
      const difficulty = 0.08 + (0.85 * k) / (HOLES_PER_RUN - 1) + (rng() - 0.5) * 0.1;
      return generateHole(hashSeed(this.runSeed, k), difficulty);
    });
    this.scores = [];
    this.holeIdx = 0;
    this.paused = false;
    this.ui.hideScreens();
    this.rig.stopShowcase();
    this.startHole();
  }

  private startHole() {
    const spec = this.specs[this.holeIdx];
    this.loadHoleSpec(spec);
    const { layout } = this.hole!;
    this.strokes = 0;
    this.lastRest.copy(layout.tee);
    this.ball.mesh.visible = true;
    this.ball.reset(layout.tee);

    const [dx, dz] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ][layout.teeDir];
    const center = layout.min.clone().add(layout.max).multiplyScalar(0.5);
    const span = layout.max.clone().sub(layout.min).length() / 2;
    this.rig.startIntro(center, span, layout.tee, Math.atan2(-dx, -dz));
    this.setState('intro');
    this.updateHud();
    this.ui.banner(`Hole ${this.holeIdx + 1}`, `Par ${spec.par}`, '', 1600);
    this.ui.hint(this.save.seenHint ? null : 'Drag anywhere to pull back · release to shoot');
  }

  private loadHoleSpec(spec: HoleSpec) {
    this.hole?.view.dispose();
    const layout = buildLayout(spec);
    const world = new PhysicsWorld(layout);
    const view = new HoleView(layout);
    this.stage.scene.add(view.group);
    this.stage.frame(layout.min, layout.max);
    this.hole = { spec, layout, world, view };
    this.acc = 0;
  }

  private skipIntro() {
    this.rig.skipIntro();
    if (this.state === 'intro') this.setState('aim');
  }

  private restartHole() {
    if (!this.hole || this.state === 'menu' || this.state === 'scorecard' || this.state === 'done') return;
    this.strokes = 0;
    this.lastRest.copy(this.hole.layout.tee);
    this.hole.world.placeBall(this.hole.layout.tee);
    this.ball.reset(this.hole.layout.tee);
    this.ball.mesh.visible = true;
    this.aim.hide();
    this.ui.clearBanner();
    this.rig.skipIntro();
    this.setState('aim');
    this.updateHud();
  }

  private nextHole() {
    this.ui.clearBanner();
    this.holeIdx++;
    if (this.holeIdx >= this.specs.length) this.finishRun();
    else this.startHole();
  }

  private finishRun() {
    this.state = 'scorecard';
    const pars = this.specs.map((s) => s.par);
    const rel = this.scores.reduce((a, b) => a + b, 0) - pars.reduce((a, b) => a + b, 0);
    let newBest = false;
    let best: number | null;
    this.save.runs++;
    if (this.mode === 'quick') {
      newBest = this.save.bestQuick === null || rel < this.save.bestQuick;
      if (newBest) this.save.bestQuick = rel;
      best = this.save.bestQuick;
    } else {
      const key = todayKey();
      const prev = this.save.daily[key];
      newBest = !!prev && rel < prev.rel;
      if (!prev || rel < prev.rel) this.save.daily[key] = { strokes: this.scores.reduce((a, b) => a + b, 0), rel };
      best = this.save.daily[key].rel;
    }
    writeSave(this.save);
    this.ui.showScorecard({
      title: this.mode === 'daily' ? 'Daily Course' : 'Run Complete',
      pars,
      scores: this.scores,
      newBest,
      best,
    });
    if (newBest || rel < 0) this.sfx.cheer(2);
  }

  private setPaused(paused: boolean) {
    if (this.state === 'menu' || this.state === 'scorecard') return;
    this.paused = paused;
    if (paused) {
      this.aim.hide();
      this.ui.showPause();
    } else {
      this.ui.hidePause();
      this.clock.getDelta();
    }
  }

  private toggleMute() {
    this.save.muted = !this.save.muted;
    this.sfx.muted = this.save.muted;
    this.ui.setMuted(this.save.muted);
    writeSave(this.save);
  }

  private setState(s: State) {
    this.state = s;
    this.stateTime = 0;
  }

  private updateHud() {
    const pars = this.specs.slice(0, this.scores.length).map((s) => s.par);
    const played = this.scores.length;
    const total = played ? this.scores.reduce((a, b) => a + b, 0) - pars.reduce((a, b) => a + b, 0) : null;
    this.ui.setHud({
      hole: this.holeIdx + 1,
      holes: this.specs.length,
      par: this.hole!.spec.par,
      strokes: this.strokes,
      total,
    });
  }

  // ---------- Play ----------

  private shoot(x: number, z: number, power: number) {
    if (!this.hole) return;
    this.aim.hide();
    this.hole.world.shoot(x, z, power);
    this.strokes++;
    this.sfx.hit(power);
    this.setState('rolling');
    this.updateHud();
    if (!this.save.seenHint) {
      this.save.seenHint = true;
      writeSave(this.save);
      this.ui.hint(null);
    }
  }

  private maxStrokes() {
    return this.hole!.spec.par + MAX_OVER_PAR;
  }

  private handleEvents() {
    const world = this.hole!.world;
    for (const ev of world.events) {
      switch (ev.type) {
        case 'impact':
          this.sfx.impact(ev.mat, ev.speed);
          break;
        case 'lip':
          this.sfx.lip();
          break;
        case 'boost':
          this.sfx.boost();
          break;
        case 'sunk':
          if (this.state === 'menu') break;
          this.sinkFrom.copy(world.ball.pos);
          this.sfx.cup();
          this.setState('sinking');
          break;
        case 'oob':
          if (this.state === 'menu') break;
          this.strokes++;
          this.sfx.fall();
          this.ui.banner('Splash!', 'Out of bounds · +1 stroke', 'bad', 1400);
          this.setState('out');
          this.updateHud();
          break;
        case 'rest':
          if (this.state === 'rolling') this.onRest();
          break;
      }
    }
    world.events.length = 0;
  }

  private onRest() {
    this.lastRest.copy(this.hole!.world.ball.pos);
    if (this.strokes >= this.maxStrokes()) this.pickUp();
    else this.setState('aim');
  }

  private pickUp() {
    this.ui.banner('Picked up', `Max ${this.maxStrokes()} strokes`, 'bad', 0);
    this.completeHole(this.maxStrokes(), false);
  }

  private completeHole(score: number, sunk: boolean) {
    this.scores.push(score);
    this.setState('done');
    this.updateHud();
    if (!sunk) return;
    const diff = score - this.hole!.spec.par;
    let title: string;
    let kind = '';
    let level = 0;
    if (score === 1) {
      title = 'Hole in One!';
      kind = 'ace';
      level = 2;
      this.save.holesInOne++;
      writeSave(this.save);
    } else if (diff <= -3) [title, kind, level] = ['Albatross!', 'great', 2];
    else if (diff === -2) [title, kind, level] = ['Eagle!', 'great', 2];
    else if (diff === -1) [title, kind, level] = ['Birdie!', 'great', 1];
    else if (diff === 0) [title, level] = ['Par', 0];
    else if (diff === 1) [title, level] = ['Bogey', -1];
    else if (diff === 2) [title, level] = ['Double Bogey', -1];
    else [title, level] = [`+${diff}`, -1];
    const sub = `${score} stroke${score === 1 ? '' : 's'} · tap to continue`;
    this.ui.banner(title, sub, kind, 0);
    if (level >= 0) this.sfx.cheer(level);
  }

  // ---------- Frame ----------

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (this.paused) {
      this.stage.render();
      return;
    }
    this.time += dt;
    this.stateTime += dt;
    const hole = this.hole;
    if (!hole) return;
    const world = hole.world;

    this.acc += dt;
    while (this.acc >= PHYS_DT) {
      world.step(PHYS_DT);
      this.acc -= PHYS_DT;
    }
    this.handleEvents();

    switch (this.state) {
      case 'intro':
        if (!this.rig.introActive) this.setState('aim');
        break;
      case 'aim':
        // An obstacle can nudge a resting ball.
        if (!world.ball.sleeping) {
          this.aim.hide();
          this.setState('rolling');
        }
        break;
      case 'sinking': {
        const u = Math.min(1, this.stateTime / SINK_ANIM);
        const cup = hole.layout.cup;
        const p = world.ball.pos;
        p.x = THREE.MathUtils.lerp(this.sinkFrom.x, cup.x, Math.min(1, u * 1.6));
        p.z = THREE.MathUtils.lerp(this.sinkFrom.z, cup.z, Math.min(1, u * 1.6));
        p.y = cup.y + BALL_R - u * u * 0.32;
        if (u >= 1) {
          this.ball.mesh.visible = false;
          this.completeHole(this.strokes, true);
        }
        break;
      }
      case 'out':
        if (this.stateTime > OUT_DELAY) {
          world.placeBall(this.lastRest);
          this.ball.reset(this.lastRest);
          if (this.strokes >= this.maxStrokes()) this.pickUp();
          else this.setState('aim');
        }
        break;
      case 'done':
        if (this.stateTime > DONE_DELAY + (this.scores.at(-1) === 1 ? 1.2 : 0)) this.nextHole();
        break;
    }

    const ballPos = world.ball.pos;
    if (this.state !== 'menu') {
      // Don't chase the ball down into the void.
      if (this.state !== 'out') this.rig.follow(ballPos);
      this.ball.update(ballPos, this.state === 'rolling');
    }
    this.rig.update(dt);
    hole.view.update(this.time, dt, ballPos, this.state === 'sinking' || this.state === 'done');
    this.stage.update(dt);
    this.stage.render();
  }
}
