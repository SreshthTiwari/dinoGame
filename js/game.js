export const LANES = [120, 240, 360];
export const PY = 590;               // where the dino sits along the road (world y)
// Obstacles and pickups are created this far up the road, out in the haze, and drive toward the dino.
// The 3D renderer fogs out everything at this distance, so they fade into view instead of popping in.
export const SPAWN_AHEAD = 1300;
export const SPAWN_Y = PY - SPAWN_AHEAD;
const GRAVITY = 1800, JUMP_V = 640;
const BLOCK_CLEAR = 40;              // must be at least this high to hop a block (the crystals are ~32 tall, x0.8 jump scale)
const LANE_SLIDE = 30;               // how fast the dino slides into a new lane (higher = snappier)

// Difficulty ramps linearly from the START values to the END values over RAMP_SECONDS, then holds.
const RAMP_SECONDS = 150;
const START_SPEED = 300, END_SPEED = 600;         // px/s the road scrolls; starts gentle so body controls have time to react
const GAP_START = 2.0, GAP_END = 1.1;             // seconds between obstacle rows...
const EXTRA_START = 1.0, EXTRA_END = 0.5;         // ...plus a random 0..this extra
const TWO_LANE_START = 0.1, TWO_LANE_END = 0.3;   // chance a row blocks two lanes at once
const lerp = (a, b, d) => a + (b - a) * d;

// What a row can contain (weights). 'block' is low (crystals / rocks): hop it, or dodge it.
// 'beam' is overhead (gate / laser): duck it. 'pillar' is tall: it can only be dodged by changing
// lane. Plank mode has no jumping, so its blocks are dodged too, and it leans on gates (pushups).
const MIX = {
  standing: { block: 45, beam: 35, pillar: 20 },
  plank: { block: 25, beam: 50, pillar: 25 },
};
const STYLES = { block: ['crystal', 'rock'], beam: ['bar', 'laser'], pillar: ['pillar'] };

// Powerups: run through one in your lane to pick it up.
const POWERUPS = ['shield', 'ghost'];
const GHOST_SECONDS = 5;             // ghost: pass through everything for this long
const SHIELD_GRACE = 0.8;            // after a shield absorbs a hit you can't be hit again for this long
const PICKUP_FIRST = 12;             // seconds until the first powerup appears...
const PICKUP_EVERY = [14, 22];       // ...then one every this many (random in range)

// Breather: after BREATHER_EVERY seconds of playing, the world slows down for BREATHER_LENGTH seconds,
// then speeds back up. A break, not a power: it only changes the pace.
const BREATHER_EVERY = 60, BREATHER_LENGTH = 10, BREATHER_SLOW = 0.55;   // slows to 55% of normal speed
const pickWeighted = mix => {
  let r = Math.random() * Object.values(mix).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(mix)) if ((r -= w) < 0) return k;
};
const choose = list => list[Math.floor(Math.random() * list.length)];

export function difficultyAt(seconds) {
  const d = Math.min(1, seconds / RAMP_SECONDS);
  return {
    d, level: 1 + Math.floor(d * 9),
    speed: lerp(START_SPEED, END_SPEED, d),
    gap: lerp(GAP_START, GAP_END, d),
    extra: lerp(EXTRA_START, EXTRA_END, d),
    twoLane: lerp(TWO_LANE_START, TWO_LANE_END, d),
  };
}

// canStart() lets the app hold back a start request (e.g. until the camera is calibrated)
export function createGame(canvas, { canStart = () => true } = {}) {
  const W = canvas.width, H = canvas.height;

  let plank = false;                   // plank mode: no jumping, so a different obstacle mix
  let state = 'start', player, obstacles, pickups, score, speed, spawnIn, t = 0, scroll = 0;
  let shield = false, ghostT = 0, graceT = 0, shieldBreakT = -1, pickupIn = PICKUP_FIRST;   // powerup state
  let sinceBreak = 0, breather = null;                                                      // breather: { t } while one is running
  let elapsed = 0, phase = 0;          // seconds into the run; run-cycle phase (advances faster as the dino speeds up)
  let best = +(localStorage.getItem('blip-td-best') || 0);
  const duckSources = {};              // keyboard and pose each hold their own duck flag
  const duckHeld = () => Object.values(duckSources).some(Boolean);
  const jumpSources = {};              // same for "keep jumping": while held, the dino jumps again on every landing
  const jumpHeld = () => Object.values(jumpSources).some(Boolean);

  function newPlayer() { return { lane: 1, x: LANES[1], z: 0, vz: 0, duckT: 0 }; }
  player = newPlayer(); obstacles = []; pickups = []; score = 0; speed = START_SPEED;

  function reset() {
    player = newPlayer(); obstacles = []; pickups = [];
    score = 0; speed = START_SPEED; elapsed = 0; spawnIn = 0.3; state = 'play';       // (the first row still has the whole road to cross)
    shield = false; ghostT = 0; graceT = 0; pickupIn = PICKUP_FIRST; sinceBreak = 0; breather = null;
  }
  function start() { if (state !== 'play' && canStart()) reset(); }

  function jump() {
    if (state !== 'play') return start();
    if (player.z === 0) player.vz = JUMP_V;
  }
  function move(d) {
    if (state !== 'play') return start();
    player.lane = Math.max(0, Math.min(2, player.lane + d));
  }
  function setLane(lane) {
    if (state === 'play') player.lane = Math.max(0, Math.min(2, lane));
  }
  function duckFor(seconds) {
    if (state === 'play') player.duckT = seconds; else start();
  }
  function setDuckHeld(held, source = 'keys') { duckSources[source] = held; }
  function setJumpHeld(held, source = 'keys') { jumpSources[source] = held; }
  const isPlaying = () => state === 'play';
  function setPlank(on) { plank = on; }

  const ducking = () => player.z === 0 && (duckHeld() || player.duckT > 0);

  function spawn() {
    const dif = difficultyAt(elapsed);
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const rowLanes = lanes.slice(0, Math.random() < dif.twoLane ? 2 : 1);
    const mix = plank ? MIX.plank : MIX.standing;
    for (const l of rowLanes) {
      const kind = pickWeighted(mix);
      obstacles.push({ lane: l, y: SPAWN_Y, kind, style: choose(STYLES[kind]) });
    }
    spawnIn = dif.gap + Math.random() * dif.extra;

    // a powerup now and then, in a free lane, halfway to the next row so it never sits in an obstacle
    if (pickupIn <= 0) {
      let type = choose(POWERUPS);
      if (type === 'shield' && shield) type = 'ghost';             // no point offering a second shield
      pickups.push({ lane: lanes[rowLanes.length], y: SPAWN_Y - 0.5 * spawnIn * dif.speed, type });
      pickupIn = lerp(PICKUP_EVERY[0], PICKUP_EVERY[1], Math.random());
    }
  }

  function die() {
    state = 'dead';
    if (score > best) { best = Math.floor(score); localStorage.setItem('blip-td-best', best); }
  }

  function update(dt) {
    t += dt;
    if (state !== 'play') { phase += dt * 0.4; scroll += 40 * dt; return; }

    // breather: every BREATHER_EVERY seconds the world eases down to BREATHER_SLOW speed for a while.
    // wdt is "world time": it drives the road, spawning and the run animation, while the dino's own
    // moves (lane slide, jumping, ducking) stay on real time so the controls never feel sluggish.
    let pace = 1;
    if (breather) {
      breather.t += dt;
      if (breather.t >= BREATHER_LENGTH) { breather = null; sinceBreak = 0; }
      else {
        const e = Math.min(breather.t, BREATHER_LENGTH - breather.t, 1);   // 1 s ease in and out
        pace = 1 - (1 - BREATHER_SLOW) * e * e * (3 - 2 * e);
      }
    } else if ((sinceBreak += dt) >= BREATHER_EVERY) breather = { t: 0 };
    const wdt = dt * pace;

    phase += wdt * speed / START_SPEED;
    elapsed += wdt;
    speed = difficultyAt(elapsed).speed;
    scroll += speed * wdt;

    ghostT = Math.max(0, ghostT - dt); graceT = Math.max(0, graceT - dt);
    player.x += (LANES[player.lane] - player.x) * Math.min(1, dt * LANE_SLIDE);
    player.duckT = Math.max(0, player.duckT - dt);
    if (jumpHeld() && player.z === 0 && player.vz === 0) player.vz = JUMP_V;
    if (player.z > 0 || player.vz > 0) {
      player.vz -= GRAVITY * dt;
      if (duckHeld()) player.vz -= 1800 * dt;
      player.z += player.vz * dt;
      if (player.z <= 0) { player.z = 0; player.vz = 0; }
    }

    score += speed * wdt / 12;
    spawnIn -= wdt; pickupIn -= wdt;
    if (spawnIn <= 0) spawn();

    for (const o of obstacles) o.y += speed * wdt;
    for (const p of pickups) p.y += speed * wdt;
    obstacles = obstacles.filter(o => o.y < H + 80);
    pickups = pickups.filter(p => p.y < H + 80);

    const near = o => Math.abs(o.y - PY) <= 26 && Math.abs(LANES[o.lane] - player.x) <= 36;
    pickups = pickups.filter(p => {
      if (!near(p)) return true;
      if (p.type === 'shield') shield = true; else ghostT = GHOST_SECONDS;
      return false;                                              // collected
    });

    const duck = ducking();
    for (const o of obstacles) {
      if (!near(o)) continue;
      const hit = o.kind === 'pillar' ? true : o.kind === 'block' ? player.z < BLOCK_CLEAR : !duck;
      if (!hit || ghostT > 0 || graceT > 0) continue;
      if (shield) {                                              // the shield takes the hit and the obstacle is smashed
        shield = false; graceT = SHIELD_GRACE; shieldBreakT = t; o.smashed = true;
        continue;
      }
      die();
      break;
    }
    obstacles = obstacles.filter(o => !o.smashed);
  }

  // Everything a renderer needs to draw the current frame (read-only snapshot).
  function getView() {
    return {
      W, H, state, plank, t, scroll, phase, speed, elapsed, score, best,
      level: difficultyAt(elapsed).level, obstacles, pickups,
      player: { x: player.x, z: player.z, lane: player.lane, ducking: ducking() },
      shield, ghost: ghostT, shieldBreakT,                       // powerups: shield on/off, ghost seconds left, when a shield last popped
      breather: breather ? { left: BREATHER_LENGTH - breather.t, length: BREATHER_LENGTH } : null,
    };
  }

  return { update, getView, start, jump, move, setLane, duckFor, setDuckHeld, setJumpHeld, setPlank, isPlaying };
}
