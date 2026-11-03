const LANES = [120, 240, 360];
const PY = 590;                      // player's screen y
const GRAVITY = 1800, JUMP_V = 640;
const BLOCK_CLEAR = 30;              // must be at least this high to hop a block
// Fake 3D camera (live-adjustable: see ui/camera.js).  horizon = screen y of the horizon,
// back = how far behind the dino the camera sits (smaller = stronger perspective),
// follow = how much the camera drifts sideways with the dino (0 = fixed).
export const CAM_DEFAULTS = { horizon: 140, back: 350, follow: 0.35 };
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
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  let plank = false;                   // plank mode: gates only (no spikes, so no jumping)
  let state = 'start', player, obstacles, score, speed, spawnIn, t = 0, scroll = 0;
  const cam = { ...CAM_DEFAULTS };
  let camX = 240;                      // world x the camera looks along
  let elapsed = 0, phase = 0;          // seconds into the run; run-cycle phase (advances faster as the dino speeds up)
  let best = +(localStorage.getItem('blip-td-best') || 0);
  const duckSources = {};              // keyboard and pose each hold their own duck flag
  const duckHeld = () => Object.values(duckSources).some(Boolean);
  const jumpSources = {};              // same for "keep jumping": while held, the dino jumps again on every landing
  const jumpHeld = () => Object.values(jumpSources).some(Boolean);
  const stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 2 + 0.5 }));

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

  // Chase-camera projection. World x runs across the road and y along it (the player sits at
  // y = PY, where s = 1). s shrinks toward the horizon, so far things are smaller and higher up.
  function project(wx, wy) {
    const s = cam.back / (cam.back + PY - wy);
    return { x: W / 2 + (wx - camX) * s, y: cam.horizon + (PY - cam.horizon) * s, s };
  }
  // draw fn(ctx) at world (wx, wy), scaled by perspective and faded into the distance
  function inWorld(wx, wy, fn) {
    if (wy > PY + cam.back * 0.5) return;
    const p = project(wx, wy);
    if (p.y > H + 120) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, (p.s - 0.2) / 0.25));
    ctx.translate(p.x, p.y); ctx.scale(p.s, p.s);
    fn();
    ctx.restore();
  }

  function drawBlock() {
    const x = 0, y = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 36, y - 6, 72, 26);
    ctx.fillStyle = '#ff5d8f';
    for (let i = 0; i < 3; i++) {
      const bx = x - 33 + i * 22;
      ctx.beginPath(); ctx.moveTo(bx, y + 14); ctx.lineTo(bx + 11, y - 14); ctx.lineTo(bx + 22, y + 14); ctx.fill();
    }
    ctx.fillStyle = '#ffa3c0';
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 24 + i * 22, y - 2, 4, 4);
  }

  function drawBeam() {
    const x = 0, y = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 40, y + 4, 80, 20); // shadow on the floor
    ctx.fillStyle = '#7a5cff';                                              // posts
    ctx.fillRect(x - 42, y - 10, 10, 24); ctx.fillRect(x + 32, y - 10, 10, 24);
    ctx.fillStyle = '#ffd35e';                                              // bar, raised overhead
    ctx.fillRect(x - 44, y - 16, 88, 12);
    ctx.fillStyle = '#e0a82e';
    for (let i = 0; i < 6; i++) ctx.fillRect(x - 42 + i * 15, y - 16, 7, 12);
  }

  function drawPlayer() {
    const duck = ducking();
    const sc = 1 + player.z / 260 - (duck ? 0.3 : 0);
    const x = project(player.x, PY).x, y = PY - player.z * 0.45;
    // shadow stays on the floor, shrinks as you rise
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const ss = Math.max(0.5, 1 - player.z / 250);
    ctx.beginPath(); ctx.ellipse(x, PY + 6, 20 * ss, 14 * ss, 0, 0, 7); ctx.fill();

    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    const run = player.z === 0 && state === 'play' ? Math.sin(phase * 22) : 0;   // legs and tail follow the speed
    const wag = Math.sin(phase * 9) * 7;
    const body = duck ? '#3fc9a5' : '#5ef2c8', dark = '#2bb894';
    ctx.fillStyle = dark;                                     // tail, wagging
    ctx.beginPath(); ctx.moveTo(-9, 12); ctx.quadraticCurveTo(wag * 0.5, 24, wag, 38); ctx.quadraticCurveTo(wag * 0.5 + 3, 24, 9, 12); ctx.fill();
    ctx.fillRect(-21, -4 + run * 5, 8, 11); ctx.fillRect(13, -4 - run * 5, 8, 11);  // feet
    ctx.fillStyle = body;                                     // body from above
    ctx.beginPath(); ctx.ellipse(0, 2, 16, 20, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff5d8f';                                // back plates along the spine
    for (let i = 0; i < 4; i++) {
      const py = -6 + i * 7, w = 5 - i * 0.6;
      ctx.beginPath(); ctx.moveTo(0, py - 4); ctx.lineTo(w, py); ctx.lineTo(0, py + 4); ctx.lineTo(-w, py); ctx.fill();
    }
    ctx.fillStyle = body;                                     // head + snout
    ctx.beginPath(); ctx.ellipse(0, -21, 11, 12, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.roundRect(-7, -38, 14, 14, 6); ctx.fill();
    ctx.fillStyle = dark; ctx.fillRect(-4, -35, 2, 3); ctx.fillRect(2, -35, 2, 3);  // nostrils
    ctx.fillStyle = '#fff';                                   // eyes
    ctx.beginPath(); ctx.arc(-7, -22, 4, 0, 7); ctx.arc(7, -22, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#0e0b1f';
    ctx.beginPath(); ctx.arc(-7, -23, 2, 0, 7); ctx.arc(7, -23, 2, 0, 7); ctx.fill();
    ctx.restore();
  }

  function draw() {
    camX = W / 2 + (player.x - W / 2) * cam.follow;
    const vx = project(camX, -1e6).x;                         // vanishing point

    // sky, with stars, fading to a glow at the horizon
    const sky = ctx.createLinearGradient(0, 0, 0, cam.horizon);
    sky.addColorStop(0, '#0e0b1f'); sky.addColorStop(1, '#2d1a6b');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, cam.horizon);
    for (const st of stars) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(st.x, (st.y / H) * cam.horizon * 0.9, st.s, st.s); }

    // ground: a grid that scrolls toward the camera, so speed reads
    ctx.fillStyle = '#0e0b1f'; ctx.fillRect(0, cam.horizon, W, H - cam.horizon);
    ctx.lineWidth = 1;
    for (let k = -8; k <= 8; k++) {
      const a = project(W / 2 + k * 120, PY - 3000), c = project(W / 2 + k * 120, PY + 200);
      ctx.strokeStyle = 'rgba(122,92,255,0.18)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    const off = scroll % 60;
    for (let wy = 780 + off - 60; wy > PY - 3000; wy -= 60) {
      const p = project(0, wy);
      ctx.strokeStyle = `rgba(122,92,255,${Math.min(0.25, p.s * 0.3)})`;
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(W, p.y); ctx.stroke();
    }

    // road
    const rl = LANES[0] - 60, rr = LANES[2] + 60;
    const [fl, fr, nl, nr] = [project(rl, PY - 3000), project(rr, PY - 3000), project(rl, PY + 200), project(rr, PY + 200)];
    ctx.fillStyle = '#1b1040';
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y); ctx.fill();
    ctx.strokeStyle = '#5ef2c8'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(nl.x, nl.y); ctx.moveTo(fr.x, fr.y); ctx.lineTo(nr.x, nr.y); ctx.stroke();
    ctx.fillStyle = '#3a2a7a';
    for (const lx of [(LANES[0] + LANES[1]) / 2, (LANES[1] + LANES[2]) / 2])
      for (let wy = 780 + off - 60; wy > PY - 3000; wy -= 60) {
        const a = project(lx, wy), c = project(lx, wy - 30);   // dash from wy back to wy - 30
        ctx.beginPath();
        ctx.moveTo(a.x - 2 * a.s, a.y); ctx.lineTo(a.x + 2 * a.s, a.y); ctx.lineTo(c.x + 2 * c.s, c.y); ctx.lineTo(c.x - 2 * c.s, c.y); ctx.fill();
      }

    // haze at the horizon hides where the road ends
    const haze = ctx.createLinearGradient(0, cam.horizon, 0, cam.horizon + 90);
    haze.addColorStop(0, 'rgba(45,26,107,1)'); haze.addColorStop(1, 'rgba(45,26,107,0)');
    ctx.fillStyle = haze; ctx.fillRect(0, cam.horizon, W, 90);

    const far2near = (a, b) => a.y - b.y;                     // smaller y = farther away = draw first
    obstacles.filter(o => o.kind === 'block').sort(far2near).forEach(o => inWorld(LANES[o.lane], o.y, drawBlock));
    drawPlayer();
    obstacles.filter(o => o.kind === 'beam').sort(far2near).forEach(o => inWorld(LANES[o.lane], o.y, drawBeam));   // overhead, so drawn over the player

    ctx.fillStyle = '#e8e4ff'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'right';
    ctx.fillText(String(Math.floor(score)).padStart(5, '0'), W - 16, 30);
    ctx.fillStyle = '#8c82c8'; ctx.textAlign = 'left';
    ctx.fillText('HI ' + String(best).padStart(5, '0'), 16, 30);
    ctx.fillStyle = '#ffd35e'; ctx.textAlign = 'center';
    ctx.fillText(`LV ${difficultyAt(elapsed).level}`, W / 2, 30);

    ctx.textAlign = 'center';
    if (state === 'start') {
      ctx.fillStyle = '#e8e4ff'; ctx.font = 'bold 40px monospace'; ctx.fillText('BLIP DASH', W / 2, 200);
      ctx.font = '15px monospace'; ctx.fillStyle = '#8c82c8';
      if (plank) {
        ctx.fillText('PLANK MODE', W / 2, 225);
        ctx.fillText('tap a shoulder (opposite hand) = switch lane', W / 2, 252);
        ctx.fillText('pushup = duck (gates)', W / 2, 276);
      } else {
        ctx.fillText('LEFT / RIGHT = switch lane', W / 2, 240);
        ctx.fillText('SPACE / UP = jump (spikes)', W / 2, 264);
        ctx.fillText('DOWN = duck (gates)', W / 2, 288);
      }
      ctx.fillText('press space to start', W / 2, 330);
      ctx.fillText(`P = ${plank ? 'standing' : 'plank'} mode  C = recalibrate  Esc = keyboard only`, W / 2, 360);
    } else if (state === 'dead') {
      ctx.fillStyle = '#ff5d8f'; ctx.font = 'bold 40px monospace'; ctx.fillText('ZAPPED', W / 2, 240);
      ctx.fillStyle = '#8c82c8'; ctx.font = '16px monospace'; ctx.fillText('space to retry', W / 2, 275);
    }
  }

  return { update, draw, start, jump, move, setLane, duckFor, setDuckHeld, setJumpHeld, setPlank, isPlaying, cam };
}
