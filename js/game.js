export const LANES = [120, 240, 360];
export const PY = 590;               // where the dino sits along the road (world y)
const GRAVITY = 1800, JUMP_V = 640;
const BLOCK_CLEAR = 30;              // must be at least this high to hop a block
const LANE_SLIDE = 30;               // how fast the dino slides into a new lane (higher = snappier)

// Difficulty ramps linearly from the START values to the END values over RAMP_SECONDS, then holds.
const RAMP_SECONDS = 150;
const START_SPEED = 300, END_SPEED = 600;         // px/s the road scrolls; starts gentle so body controls have time to react
const GAP_START = 2.0, GAP_END = 1.1;             // seconds between obstacle rows...
const EXTRA_START = 1.0, EXTRA_END = 0.5;         // ...plus a random 0..this extra
const TWO_LANE_START = 0.1, TWO_LANE_END = 0.3;   // chance a row blocks two lanes at once
const lerp = (a, b, d) => a + (b - a) * d;

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

  let plank = false;                   // plank mode: gates only (no spikes, so no jumping)
  let state = 'start', player, obstacles, score, speed, spawnIn, t = 0, scroll = 0;
  let elapsed = 0, phase = 0;          // seconds into the run; run-cycle phase (advances faster as the dino speeds up)
  let best = +(localStorage.getItem('blip-td-best') || 0);
  const duckSources = {};              // keyboard and pose each hold their own duck flag
  const duckHeld = () => Object.values(duckSources).some(Boolean);
  const jumpSources = {};              // same for "keep jumping": while held, the dino jumps again on every landing
  const jumpHeld = () => Object.values(jumpSources).some(Boolean);

  function newPlayer() { return { lane: 1, x: LANES[1], z: 0, vz: 0, duckT: 0 }; }
  player = newPlayer(); obstacles = []; score = 0; speed = START_SPEED;

  function reset() {
    player = newPlayer(); obstacles = [];
    score = 0; speed = START_SPEED; elapsed = 0; spawnIn = 1.5; state = 'play';
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
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, Math.random() < dif.twoLane ? 2 : 1);
    for (const l of lanes) obstacles.push({ lane: l, y: -60, kind: plank || Math.random() < 0.45 ? 'beam' : 'block' });
    spawnIn = dif.gap + Math.random() * dif.extra;
  }

  function update(dt) {
    t += dt;
    phase += dt * (state === 'play' ? speed / START_SPEED : 0.4);
    if (state !== 'play') { scroll += 40 * dt; return; }
    elapsed += dt;
    speed = difficultyAt(elapsed).speed;
    scroll += speed * dt;

    player.x += (LANES[player.lane] - player.x) * Math.min(1, dt * LANE_SLIDE);
    player.duckT = Math.max(0, player.duckT - dt);
    if (jumpHeld() && player.z === 0 && player.vz === 0) player.vz = JUMP_V;
    if (player.z > 0 || player.vz > 0) {
      player.vz -= GRAVITY * dt;
      if (duckHeld()) player.vz -= 1800 * dt;
      player.z += player.vz * dt;
      if (player.z <= 0) { player.z = 0; player.vz = 0; }
    }

    score += speed * dt / 12;
    spawnIn -= dt;
    if (spawnIn <= 0) spawn();

    for (const o of obstacles) o.y += speed * dt;
    obstacles = obstacles.filter(o => o.y < H + 80);

    const duck = ducking();
    for (const o of obstacles) {
      if (Math.abs(o.y - PY) > 26 || Math.abs(LANES[o.lane] - player.x) > 36) continue;
      const hit = o.kind === 'block' ? player.z < BLOCK_CLEAR : !duck;
      if (hit) {
        state = 'dead';
        if (score > best) { best = Math.floor(score); localStorage.setItem('blip-td-best', best); }
      }
    }
  }

  // Everything a renderer needs to draw the current frame (read-only snapshot).
  function getView() {
    return {
      W, H, state, plank, t, scroll, phase, speed, elapsed, score, best,
      level: difficultyAt(elapsed).level, obstacles,
      player: { x: player.x, z: player.z, lane: player.lane, ducking: ducking() },
    };
  }

  return { update, getView, start, jump, move, setLane, duckFor, setDuckHeld, setJumpHeld, setPlank, isPlaying };
}
