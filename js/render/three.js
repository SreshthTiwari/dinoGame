// Real 3D renderer (three.js) with a chase camera. It only reads the view snapshot from
// game.getView(); the game rules live in game.js.
//
// Scene units are the game's pixels. Game world (x across, y along the road, dino at y = PY)
// maps to scene (x - 240, up, y - PY): the dino sits at the origin facing -z, away from the
// camera, and obstacles come toward +z.
import * as THREE from '../../vendor/three/three.module.js';
import { LANES, PY, SPAWN_AHEAD } from '../game.js';
import { THEMES, THEME_ORDER, DEFAULT_THEME, AUTO, blendTheme, mixColor } from './themes.js';

export const THREE_DEFAULTS = { height: 160, distance: 330, lookAhead: 460, fov: 58, follow: 1 };
// height / distance = where the camera sits above / behind the dino, lookAhead = how far down the
// road it aims, fov = lens, follow = how much the camera drifts sideways with the dino
const SLIDERS = [
  { key: 'height', label: 'Height', min: 60, max: 600, step: 10 },
  { key: 'distance', label: 'Distance', min: 150, max: 900, step: 10 },
  { key: 'lookAhead', label: 'Look ahead', min: 100, max: 1200, step: 20 },
  { key: 'fov', label: 'FOV', min: 30, max: 100, step: 1 },
  { key: 'follow', label: 'Follow', min: 0, max: 1, step: 0.05 },
];

const CX = LANES[1];                 // x of the middle lane
const ROAD_W = LANES[2] - LANES[0] + 120, FAR = 3000, NEAR = 400;
const JUMP_VIS = 0.8;                // scene units of height per unit of game jump height
const DINO_SCALE = 1.4;
const FOG_START = 0.6;               // haze starts this fraction of the way to the spawn point (lower = obstacles fade in over a longer stretch)
// ducking dips the head and neck forward and down (the body stays put). Standing, the head is
// above a gate's bar; ducked, it is below it.
const DUCK_ANGLE = -1.2;             // radians the neck pitches forward-down at full duck
const DUCK_CROUCH = 3;               // how far the whole body sinks (model units)
const DUCK_SPEED = 18;               // how fast the duck eases in and out (per second)

// a small canvas drawn once, used as a repeating texture
function canvasTexture(w, h, paint, repeatX, repeatY, renderer) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// redraw a canvas texture in place (used when the theme changes)
function repaint(tex, paint) {
  const c = tex.image;
  paint(c.getContext('2d'), c.width, c.height);
  tex.needsUpdate = true;
}

// sky: a vertical gradient, plus optional stars and a setting sun. It is a screen-space background,
// so the sun sits at a fixed height on screen, about where the horizon is with the default camera.
function paintSky(g, w, h, t) {
  const { top, mid, horizon, stars, sun } = t.sky;
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, top);
  if (mid) gr.addColorStop(0.24, mid);
  gr.addColorStop(0.42, horizon); gr.addColorStop(1, horizon);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  if (stars) {
    let seed = 7;                                    // fixed seed: the same stars every time
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < stars; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.5})`;
      const r = 0.5 + rnd() * 1.2;
      g.fillRect(rnd() * w, rnd() * h * 0.34, r, r);
    }
  }
  if (sun) {
    const x = w / 2, y = h * 0.38, r = w * 0.15;
    const glow = g.createRadialGradient(x, y, r * 0.6, x, y, r * 3);
    glow.addColorStop(0, sun.glow + 'cc'); glow.addColorStop(1, sun.glow + '00');
    g.globalAlpha = sun.alpha ?? 1;                  // fades in / out while one theme blends into another
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.fillStyle = sun.color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
}

export function createThree(canvas2d, stage) {
  const W = canvas2d.width, H = canvas2d.height;
  const ctx2d = canvas2d.getContext('2d');
  const cam = { ...THREE_DEFAULTS };

  const canvas = document.createElement('canvas');
  canvas.id = 'c3d';
  stage.insertBefore(canvas, canvas2d);          // under the 2D canvas, which still draws the HUD
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const sky = canvasTexture(256, 384, () => {}, 1, 1, renderer);       // painted by applyTheme(); same 2:3 shape as the screen
  sky.wrapS = sky.wrapT = THREE.ClampToEdgeWrapping;
  scene.background = sky;
  scene.fog = new THREE.Fog(0x000000, 1000, 1700);

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(150, 400, 250);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(cam.fov, W / H, 10, FAR + 600);
  let lastFov = cam.fov;

  // ground grid and road: flat planes whose textures scroll toward the camera
  const flat = (w, len, tex, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), new THREE.MeshBasicMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, y, (NEAR - FAR) / 2);
    scene.add(m);
    return m;
  };
  const LEN = FAR + NEAR, GRID = 120, DASH = 60;
  const paintGround = t => (g, w, h) => {
    g.fillStyle = t.ground; g.fillRect(0, 0, w, h);
    g.strokeStyle = t.grid; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
  };
  const paintRoad = t => (g, w, h) => {
    g.fillStyle = t.road; g.fillRect(0, 0, w, h);
    g.fillStyle = t.dash;
    for (const lx of [(LANES[0] + LANES[1]) / 2, (LANES[1] + LANES[2]) / 2])    // dashes between the lanes
      g.fillRect(w / 2 + lx - CX - 2, 0, 4, h / 2);
  };
  const groundTex = canvasTexture(128, 128, () => {}, 4000 / GRID, LEN / GRID, renderer);
  flat(4000, LEN, groundTex, -0.5);
  const roadTex = canvasTexture(ROAD_W, DASH, () => {}, 1, LEN / DASH, renderer);
  flat(ROAD_W, LEN, roadTex, 0);
  const edge = new THREE.MeshBasicMaterial();
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(5, 3, LEN), edge);
    e.position.set(sx * ROAD_W / 2, 1.5, (NEAR - FAR) / 2);
    scene.add(e);
  }

  // ---- the dino: built from simple shapes, facing -z so the camera sees its back ----
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const bodyMat = mat(0xffffff), darkMat = mat(0xffffff), pinkMat = mat(0xffffff);   // coloured by the theme
  const eyeMat = mat(0xffffff), pupilMat = mat(0x0e0b1f);
  const dinoMats = [bodyMat, darkMat, pinkMat, eyeMat, pupilMat];
  for (const m of dinoMats) m.transparent = true;    // so the ghost powerup can fade the dino
  const dino = new THREE.Group();
  const model = new THREE.Group();               // the dino as a unit (sinks a little when ducking)
  dino.add(model);
  const add = (parent, geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); parent.add(m); return m;
  };
  const body = add(model, new THREE.SphereGeometry(1, 20, 14), bodyMat, 0, 16, 0);
  body.scale.set(16, 13, 22);
  // neck + head hang off a pivot at the front of the body, so ducking is just rotating the pivot
  const neck = new THREE.Group();
  neck.position.set(0, 20, -16);
  model.add(neck);
  const stalk = add(neck, new THREE.CylinderGeometry(5.5, 7.5, 17.5, 10), bodyMat, 0, 8, -3.5);
  stalk.rotation.x = -Math.atan(7 / 16);           // leans forward, away from the camera
  add(neck, new THREE.SphereGeometry(11, 16, 12), bodyMat, 0, 16, -7);          // head
  add(neck, new THREE.BoxGeometry(14, 10, 14), bodyMat, 0, 13, -18);            // snout
  for (const sx of [-1, 1]) {
    add(neck, new THREE.SphereGeometry(3.6, 10, 8), eyeMat, sx * 7, 20, -13);   // eyes
    add(neck, new THREE.SphereGeometry(1.8, 8, 6), pupilMat, sx * 7, 20, -16);
  }
  for (let i = 0; i < 4; i++) {                    // back plates along the spine (low enough to clear a gate)
    const p = add(model, new THREE.ConeGeometry(4.2 - i * 0.5, 7, 4), pinkMat, 0, 28.5, -10 + i * 8);
    p.rotation.y = Math.PI / 4;
  }
  const tailPivot = new THREE.Group();             // tail wags around where it joins the body
  tailPivot.position.set(0, 14, 18);
  const tail = add(tailPivot, new THREE.ConeGeometry(7, 30, 8), darkMat, 0, 0, 14);
  tail.rotation.x = Math.PI / 2;                   // tip toward the camera
  model.add(tailPivot);
  const legs = [-1, 1].map(sx => add(model, new THREE.BoxGeometry(8, 12, 10), darkMat, sx * 11, 6, 2));
  dino.scale.setScalar(DINO_SCALE);
  scene.add(dino);

  // shield: a glowing bubble round the dino (it expands and fades when it pops)
  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x4de8ff, transparent: true, opacity: 0.16, depthWrite: false });
  const bubbleWireMat = new THREE.MeshBasicMaterial({ color: 0x9ff3ff, wireframe: true, transparent: true, opacity: 0.35 });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(30, 20, 14), bubbleMat);
  bubble.position.y = 18; bubble.visible = false;
  const bubbleWire = new THREE.Mesh(new THREE.IcosahedronGeometry(30.5, 1), bubbleWireMat);
  bubble.add(bubbleWire);
  dino.add(bubble);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.6;
  scene.add(shadow);

  // ---- obstacles ----
  // Colours come from the theme (see applyTheme). Low obstacles stay under ~32 units tall, which
  // matches BLOCK_CLEAR in game.js (40 x the 0.8 jump scale); the gate bars start at 44.
  const crystalMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888, flatShading: true });
  const postMat = mat(0xffffff);
  const trimMat = new THREE.MeshBasicMaterial({ color: 0xffffff });              // glowing stripes
  const barMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const laserMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const laserGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
  const crystalGeo = new THREE.OctahedronGeometry(1), rockGeo = new THREE.DodecahedronGeometry(1);
  const postGeo = new THREE.BoxGeometry(8, 58, 8), barGeo = new THREE.BoxGeometry(96, 12, 10);
  const rnd = (a, b) => a + Math.random() * (b - a);

  function makeCrystals() {                          // a cluster of glowing crystals
    const g = new THREE.Group();
    for (const [x, z, h, r] of [[0, 0, 32, 12], [-26, 3, 20, 9], [26, 3, 23, 10], [-12, 12, 16, 8], [14, 10, 26, 9], [-3, -11, 19, 8]]) {
      const c = add(g, crystalGeo, crystalMat, x, h / 2, z);
      c.scale.set(r, h / 2, r);
      c.rotation.set(0, rnd(0, 3), rnd(-0.18, 0.18));
    }
    return g;
  }
  function makeRocks() {                             // jagged boulders
    const g = new THREE.Group();
    for (const [x, z, r] of [[-23, 0, 17], [6, 3, 19], [28, -2, 14], [-4, -13, 11]]) {
      const k = add(g, rockGeo, rockMat, x, r * 0.55, z);
      k.scale.set(r, r * 0.75, r * 0.9);
      k.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    }
    return g;
  }
  function makePillar() {                            // tall: no jumping or ducking this, only a lane change
    const g = new THREE.Group();
    add(g, new THREE.BoxGeometry(60, 12, 46), postMat, 0, 6, 0);                 // base
    add(g, new THREE.BoxGeometry(44, 104, 32), postMat, 0, 64, 0);               // shaft
    add(g, new THREE.BoxGeometry(58, 10, 44), postMat, 0, 121, 0);               // cap
    for (const y of [32, 64, 96]) add(g, new THREE.BoxGeometry(46, 3, 34), trimMat, 0, y, 0);   // glowing bands
    return g;
  }
  function makeBar() {                               // the classic gate
    const g = new THREE.Group();
    for (const sx of [-1, 1]) add(g, postGeo, postMat, sx * 44, 29, 0);
    add(g, barGeo, barMat, 0, 52, 0);                // bar bottom at 46: the dino has to duck under it
    return g;
  }
  function makeLaser() {                             // a laser between two emitters
    const g = new THREE.Group();
    for (const sx of [-1, 1]) {
      add(g, postGeo, postMat, sx * 44, 29, 0);
      add(g, new THREE.SphereGeometry(7, 12, 8), laserMat, sx * 44, 52, 0);      // emitter
    }
    const core = add(g, new THREE.CylinderGeometry(2.5, 2.5, 88, 8), laserMat, 0, 52, 0);
    const glow = add(g, new THREE.CylinderGeometry(8, 8, 88, 12), laserGlowMat, 0, 52, 0);
    core.rotation.z = glow.rotation.z = Math.PI / 2;
    return g;
  }
  const MAKERS = { 'block/crystal': makeCrystals, 'block/rock': makeRocks, 'pillar/pillar': makePillar, 'beam/bar': makeBar, 'beam/laser': makeLaser };

  // ---- powerup pickups: floating, spinning gems (fixed colours, whatever the theme) ----
  const glowMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
  function makeShieldPickup() {
    const g = new THREE.Group();
    add(g, new THREE.OctahedronGeometry(10), new THREE.MeshLambertMaterial({ color: 0x4de8ff, emissive: 0x1a8fa8 }), 0, 0, 0);
    const ring = add(g, new THREE.TorusGeometry(17, 1.8, 8, 28), new THREE.MeshBasicMaterial({ color: 0x9ff3ff }), 0, 0, 0);
    ring.rotation.x = 1.2;
    add(g, new THREE.SphereGeometry(24, 14, 10), glowMat(0x4de8ff), 0, 0, 0);
    return g;
  }
  function makeGhostPickup() {
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf1e9ff, emissive: 0x5a4a99 });
    add(g, new THREE.SphereGeometry(11, 16, 12), white, 0, 3, 0);
    add(g, new THREE.CylinderGeometry(11, 13, 11, 14), white, 0, -3, 0);
    for (const sx of [-1, 1]) add(g, new THREE.SphereGeometry(2.4, 8, 6), mat(0x1a1030), sx * 4.2, 4, 9.4);   // eyes face the camera (+z)
    add(g, new THREE.SphereGeometry(24, 14, 10), glowMat(0xb79cff), 0, 0, 0);
    return g;
  }
  const PICKUP_MAKERS = { shield: makeShieldPickup, ghost: makeGhostPickup };

  // ---- themes ----
  // `choice` is what the player picked: a theme id, or 'auto' (a new theme every AUTO.seconds of a run).
  // `now` is the theme that is on screen right now (part-way between two while a fade runs) and
  // `targetId` the theme it is heading for.
  let choice = DEFAULT_THEME, targetId = DEFAULT_THEME, now = THEMES[DEFAULT_THEME], fade = null;
  let onThemeChange = null;

  function applyTheme(t) {                           // paint a (possibly blended) theme onto everything
    now = t;
    repaint(sky, (g, w, h) => paintSky(g, w, h, t));
    repaint(groundTex, paintGround(t));
    repaint(roadTex, paintRoad(t));
    scene.fog.color.set(t.fog);
    edge.color.set(t.edge);
    bodyMat.color.set(t.dino.body); darkMat.color.set(t.dino.dark); pinkMat.color.set(t.dino.plates);
    crystalMat.color.set(t.spike); crystalMat.emissive.set(t.spike).multiplyScalar(0.7);
    rockMat.color.set(mixColor(t.post, '#8a8a8a', 0.55));
    postMat.color.set(t.post); trimMat.color.set(t.edge);
    laserMat.color.set(t.spike); laserGlowMat.color.set(t.spike);
    barMat.color.set(t.bar); barMat.emissive.set(t.barGlow);
    ambient.color.set(t.light.ambient[0]); ambient.intensity = t.light.ambient[1];
    sun.color.set(t.light.sun[0]); sun.intensity = t.light.sun[1];
  }
  function goTo(id, seconds) {                       // head for theme `id`, fading over `seconds` (0 = at once)
    targetId = id;
    if (seconds > 0) fade = { from: now, to: THEMES[id], k: 0, secs: seconds };
    else { fade = null; applyTheme(THEMES[id]); }
    onThemeChange?.();
  }
  function setTheme(id) {                            // a theme id, or 'auto'. Not remembered: every load starts on auto
    choice = id === AUTO.id || THEMES[id] ? id : AUTO.id;
    if (choice !== AUTO.id) goTo(choice, 0.6);
    else onThemeChange?.();                          // auto picks its theme on the next frame, from the run time
  }
  function stepFade(dt) {
    if (!fade) return;
    fade.k = Math.min(1, fade.k + dt / fade.secs);
    const e = fade.k * fade.k * (3 - 2 * fade.k);    // smoothstep: eases in and out
    applyTheme(fade.k >= 1 ? fade.to : blendTheme(fade.from, fade.to, e));
    if (fade.k >= 1) fade = null;
  }
  choice = AUTO.id;                                  // always start on auto (it begins with the default theme)
  goTo(DEFAULT_THEME, 0);

  const meshes = new Map();                          // game obstacle -> its mesh
  const pickupMeshes = new Map();                    // game pickup -> its mesh
  let duck = 0, lastT = 0;                           // eased duck amount; game time of the previous frame
  let ghostFade = 1;                                 // 1 = solid dino, lower = ghost

  function draw(v) {
    ctx2d.clearRect(0, 0, W, H);                     // the 2D canvas is transparent here: HUD only

    const dt = Math.min(0.1, Math.max(0, v.t - lastT)); lastT = v.t;
    if (choice === AUTO.id && v.state === 'play') {  // auto: the run time decides the world
      const id = THEME_ORDER[Math.floor(v.elapsed / AUTO.seconds) % THEME_ORDER.length];
      if (id !== targetId) goTo(id, AUTO.fade);
    }
    stepFade(dt);

    // The haze is fully opaque at the spot obstacles are created, wherever the camera is, and starts
    // thinning in FOG_START of the way there, so they fade in out of it as they come up the road
    // instead of popping into view, and are clear for the last stretch.
    const spawnDist = Math.hypot(cam.height, cam.distance + SPAWN_AHEAD);
    scene.fog.far = spawnDist * 0.97; scene.fog.near = scene.fog.far * FOG_START;

    groundTex.offset.y = v.scroll / GRID;
    roadTex.offset.y = v.scroll / DASH;

    const p = v.player;
    const px = p.x - CX, lift = p.z * JUMP_VIS;
    const running = p.z === 0 && v.state === 'play';
    const run = running ? Math.sin(v.phase * 22) : 0;
    dino.position.set(px, lift, 0);
    duck += ((p.ducking ? 1 : 0) - duck) * Math.min(1, dt * DUCK_SPEED);     // 0 = standing, 1 = fully ducked
    neck.rotation.x = DUCK_ANGLE * duck;
    neck.position.y = 20 + (running ? Math.abs(run) * 1.5 : 0);
    model.position.y = -DUCK_CROUCH * duck;
    legs[0].position.z = 2 + run * 5; legs[1].position.z = 2 - run * 5;
    tailPivot.rotation.y = Math.sin(v.phase * 9) * 0.35;
    const ss = Math.max(0.5, 1 - p.z / 250);
    shadow.position.x = px; shadow.scale.set(ss * DINO_SCALE, ss * DINO_SCALE, 1);

    const seen = new Set();
    for (const o of v.obstacles) {
      let m = meshes.get(o);
      if (!m) { m = MAKERS[`${o.kind}/${o.style}`](); scene.add(m); meshes.set(o, m); }
      m.position.set(LANES[o.lane] - CX, 0, o.y - PY);
      seen.add(o);
    }
    for (const [o, m] of meshes) if (!seen.has(o)) { scene.remove(m); meshes.delete(o); }
    laserGlowMat.opacity = 0.22 + 0.1 * Math.sin(v.t * 14);          // lasers hum

    const seenP = new Set();
    for (const q of v.pickups) {
      let m = pickupMeshes.get(q);
      if (!m) { m = PICKUP_MAKERS[q.type](); m.userData.phase = Math.random() * 6; m.scale.setScalar(1.5); scene.add(m); pickupMeshes.set(q, m); }
      m.position.set(LANES[q.lane] - CX, 42 + Math.sin(v.t * 3 + m.userData.phase) * 5, q.y - PY);
      m.rotation.y = v.t * 2 + m.userData.phase;
      seenP.add(q);
    }
    for (const [q, m] of pickupMeshes) if (!seenP.has(q)) { scene.remove(m); pickupMeshes.delete(q); }

    // powerup effects on the dino: shield bubble (pops outward), ghost (see-through, blinks as it runs out)
    const sincePop = v.t - v.shieldBreakT;
    if (v.shield) {
      bubble.visible = true; bubble.scale.setScalar(1 + 0.03 * Math.sin(v.t * 6));
      bubbleMat.opacity = 0.16; bubbleWireMat.opacity = 0.35; bubbleWire.rotation.y = v.t;
    } else if (v.shieldBreakT >= 0 && sincePop < 0.45) {
      const k = sincePop / 0.45;
      bubble.visible = true; bubble.scale.setScalar(1 + k * 1.2);
      bubbleMat.opacity = 0.3 * (1 - k); bubbleWireMat.opacity = 0.5 * (1 - k);
    } else bubble.visible = false;
    const ghostTarget = v.ghost > 0 ? (v.ghost < 1.2 && Math.floor(v.t * 10) % 2 ? 0.8 : 0.38) : 1;
    ghostFade += (ghostTarget - ghostFade) * Math.min(1, dt * 12);
    for (const m of dinoMats) { m.opacity = ghostFade; m.depthWrite = ghostFade > 0.97; }

    const cx = px * cam.follow;
    camera.position.set(cx, cam.height, cam.distance);
    camera.lookAt(cx, 20, -cam.lookAhead);
    // breather: the lens opens up a little while the world slows, for a calmer, wider view
    let breatherK = 0;
    if (v.breather) { const e = Math.min(v.breather.length - v.breather.left, v.breather.left, 1); breatherK = e * e * (3 - 2 * e); }
    const fovNow = cam.fov + 8 * breatherK;
    if (fovNow !== lastFov) { camera.fov = lastFov = fovNow; camera.updateProjectionMatrix(); }
    renderer.render(scene, camera);
  }

  return {
    name: 'three', cam, defaults: THREE_DEFAULTS, sliders: SLIDERS,
    // what the picker cycles through: every theme, then Auto
    themes: [...THEME_ORDER.map(id => ({ id, label: THEMES[id].label, accent: THEMES[id].edge })), { id: AUTO.id, label: AUTO.label }],
    get theme() { return choice; },                  // the picked id, or 'auto'
    get current() { return { id: targetId, label: THEMES[targetId].label, accent: THEMES[targetId].edge }; },   // what's showing (or fading in)
    set onThemeChange(fn) { onThemeChange = fn; },
    setTheme,
    activate() { canvas.classList.remove('hidden'); },
    deactivate() { canvas.classList.add('hidden'); },
    draw,
  };
}
