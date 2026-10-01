# ⛳ Pocket Golf

Bite-sized 3D mini golf on floating islands. Every hole is procedurally generated, so you never run out of courses.

## Play

```bash
npm install
npm run dev
```

Open the printed `Local` URL. To play on your phone, connect it to the same Wi-Fi and open the `Network` URL.

**Controls**

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Aim + shoot | Drag anywhere (pull back like a slingshot), release | Same |
| Look around | Right-drag, or A/D · W/S · arrow keys | Two-finger drag |
| Zoom | Scroll wheel, `+` / `-` | Pinch |
| Restart hole | `R` | ↻ button |
| Pause | `Esc` | ❚❚ button |
| Next hole | `Space` / `Enter` | Tap the banner |

**Modes**: *Quick Run* (9 random holes that get harder) and *Daily Course* (the same 9 holes for everyone that day). Best scores are saved in the browser.

## Course pieces

Fairway, sand (slow), ice (slippery), ramps, corner banks, narrow bridges (fall off = +1 stroke), bumpers, boost pads, sliding blocks, spinners and windmills.

## Project layout

```
src/
  config.ts          world scale + tuning constants
  course/            hole generator (seeded), tile → layout builder
  physics/world.ts   custom ball physics (sphere vs boxes/cylinders, rolling, cup)
  render/            three.js stage, hole meshes, ball + aim arrow
  input/             slingshot aiming, orbit camera
  game/              game flow, scoring, save data
  ui/                HUD, menus, scorecard
  audio/             synthesized sound effects (WebAudio, no files)
scripts/sim.ts       headless checks + bot that plays generated holes
```

## Dev

- `npm run sim` checks the generator and physics, then has a bot play generated holes to confirm they're finishable and par is sane. Use `npm run sim -- 90` for more holes.
- `npm run build` typechecks and builds to `dist/`.
- In dev, `?seed=123&hole=4` jumps straight into a run at a given hole, and `window.game` is exposed in the console.
