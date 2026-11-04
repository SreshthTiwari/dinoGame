// Roadside scenery: props on both sides of the road that scroll toward the camera with it.
// Each theme has its own set (neon towers, palms, trees, cacti, pines, lollipops, code columns).
//
// A fixed set of "slots" (PER_SIDE on each side) is spread along the road. A slot's position comes
// straight from the road's scroll distance; when it wraps from behind the camera back out to the
// far end (where the fog hides it), it is rebuilt as a fresh prop from the CURRENT theme. So when
// the theme changes, new props simply start arriving from the horizon while the old ones drive
// past: the world changes along the road instead of popping.
import * as THREE from '../../vendor/three/three.module.js';

const SPAN = 1900;                    // length of road covered; props wrap from the near end to the far end
const Z_FAR = -1550;                  // far end of that stretch (it is deep in the fog)
const PER_SIDE = 26;                  // slots per side of the road
const SCALE = 1.4;                    // overall prop size (the camera sits close, so everything is scaled up)
const ROAD_EDGE = 190;                // props start this far from the middle of the road (the road is 360 wide)

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

// ---- shared geometry and materials, built once ----
const cache = new Map();
const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const lambert = (c, extra = {}) => memo('L' + c + JSON.stringify(extra), () => new THREE.MeshLambertMaterial({ color: c, ...extra }));
const basic = (c, extra = {}) => memo('B' + c + JSON.stringify(extra), () => new THREE.MeshBasicMaterial({ color: c, ...extra }));
const box = (w, h, d) => memo(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, seg = 8) => memo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const cone = (r, h, seg = 8) => memo(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const ball = (r, detail = 1) => memo(`ico${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
const sphere = r => memo(`sph${r}`, () => new THREE.SphereGeometry(r, 14, 10));
const octa = () => memo('octa', () => new THREE.OctahedronGeometry(1));

function put(parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  parent.add(m);
  return m;
}

// ---- the props. Each builder returns a Group standing on y = 0 ----
const NEON = ['#ff4fd8', '#5ef2c8', '#7a5cff', '#ffd35e'];
function tower() {                                       // a dark skyscraper with glowing bands and edges
  const g = new THREE.Group(), w = rnd(34, 64), h = rnd(110, 320), glow = pick(NEON);
  put(g, box(w, h, w), lambert('#1c1448'), 0, h / 2, 0);
  for (let y = 30; y < h - 10; y += rnd(36, 60)) put(g, box(w + 2, 3, w + 2), basic(glow), 0, y, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, box(2.5, h, 2.5), basic(glow), sx * w / 2, h / 2, sz * w / 2);
  return g;
}
function neonPyramid() {                                  // a floating glowing pyramid
  const g = new THREE.Group(), c = pick(NEON);
  const p = put(g, cone(26, 52, 4), basic(c, { wireframe: true }), 0, rnd(90, 190), 0);
  p.rotation.y = rnd(0, 3);
  return g;
}
function palm() {
  const g = new THREE.Group(), h = rnd(120, 190), dark = lambert('#240c3a');
  const trunk = put(g, cyl(3.5, 6, h, 6), dark, 0, h / 2, 0);
  trunk.rotation.z = rnd(-0.14, 0.14);
  for (let i = 0; i < 7; i++) {                           // fronds fan out from the top and droop
    const f = new THREE.Group(); f.position.set(0, h, 0); f.rotation.y = i * Math.PI * 2 / 7;
    const leaf = put(f, cone(7, 70, 4), dark, 0, 0, 0); leaf.rotation.z = Math.PI / 2 + 0.45; leaf.position.x = 34; leaf.scale.set(1, 1, 0.35);
    g.add(f);
  }
  return g;
}
function mountain() {                                      // a big low-poly peak, far from the road
  const g = new THREE.Group(), r = rnd(160, 300);
  put(g, cone(r, r * rnd(0.9, 1.4), 5), lambert('#3a1058', { flatShading: true }), 0, r * 0.5, 0);
  return g;
}
function tree() {
  const g = new THREE.Group(), s = rnd(0.8, 1.5);
  put(g, cyl(5, 7, 44 * s, 6), lambert('#6b4a2b'), 0, 22 * s, 0);
  put(g, ball(34 * s), lambert(pick(['#3fa34d', '#4fbf5a', '#2f8f45']), { flatShading: true }), 0, 66 * s, 0);
  put(g, ball(24 * s), lambert('#58cf63', { flatShading: true }), rnd(-8, 8), 96 * s, rnd(-8, 8));
  return g;
}
function bush() {
  const g = new THREE.Group();
  put(g, ball(rnd(16, 26)), lambert(pick(['#3fa34d', '#4fbf5a']), { flatShading: true }), 0, 12, 0, 1, 0.75, 1);
  return g;
}
function hill() {
  const g = new THREE.Group(), r = rnd(200, 340);
  put(g, sphere(r), lambert(pick(['#5fbf5f', '#6fcf6a'])), 0, -r * 0.45, 0, 1, 0.6, 1);
  return g;
}
function cactus() {
  const g = new THREE.Group(), h = rnd(70, 130), green = lambert('#3f8f4a');
  put(g, cyl(8, 9, h, 8), green, 0, h / 2, 0);
  put(g, sphere(8), green, 0, h, 0);
  for (const sx of [-1, 1]) if (Math.random() < 0.75) {  // arms: out, then up
    const y = rnd(h * 0.35, h * 0.65);
    put(g, cyl(5, 5, 30, 8), green, sx * 20, y, 0).rotation.z = Math.PI / 2;
    put(g, cyl(5, 5, rnd(24, 44), 8), green, sx * 34, y + 14, 0);
  }
  return g;
}
function mesa() {
  const g = new THREE.Group(), w = rnd(160, 300), h = rnd(130, 240);
  put(g, box(w, h, w * 0.8), lambert('#c4673a'), 0, h / 2, 0);
  put(g, box(w + 4, h * 0.18, w * 0.8 + 4), lambert('#a5502d'), 0, h * 0.3, 0);
  put(g, box(w + 4, h * 0.12, w * 0.8 + 4), lambert('#e08a52'), 0, h * 0.66, 0);
  return g;
}
function boulder() {
  const g = new THREE.Group(), r = rnd(14, 30);
  const m = put(g, memo('dodeca', () => new THREE.DodecahedronGeometry(1)), lambert('#b98b5e', { flatShading: true }), 0, r * 0.5, 0, r, r * 0.7, r * 0.9);
  m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
  return g;
}
function pine() {                                          // snow-covered pine: stacked cones
  const g = new THREE.Group(), s = rnd(0.8, 1.5);
  put(g, cyl(4, 5, 24 * s, 6), lambert('#6b4a2b'), 0, 12 * s, 0);
  [[38, 24], [29, 56], [20, 84]].forEach(([r, y], i) => {
    put(g, cone(r * s, 46 * s, 8), lambert(i ? '#f4fbff' : '#cfe8f2', { flatShading: true }), 0, y * s + 16 * s, 0);
  });
  return g;
}
function iceCrystal() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const h = rnd(40, 100);
    const c = put(g, octa(), lambert('#9be7ff', { emissive: 0x2a6a80, transparent: true, opacity: 0.8 }), rnd(-16, 16), h / 2, rnd(-12, 12), rnd(8, 14), h / 2, rnd(8, 14));
    c.rotation.z = rnd(-0.2, 0.2);
  }
  return g;
}
function snowMound() {
  const g = new THREE.Group(), r = rnd(30, 70);
  put(g, sphere(r), lambert('#ffffff'), 0, 0, 0, 1, 0.5, 1);
  return g;
}
const CANDY = ['#ff6b9d', '#ffd166', '#55efc4', '#74b9ff', '#fd79a8', '#a29bfe'];
function lollipop() {
  const g = new THREE.Group(), h = rnd(80, 150), c = pick(CANDY);
  put(g, cyl(3, 3, h, 6), lambert('#ffffff'), 0, h / 2, 0);
  const disc = put(g, cyl(rnd(24, 34), rnd(24, 34), 7, 20), lambert(c), 0, h + 20, 0);
  disc.rotation.x = Math.PI / 2;                           // faces the camera
  const ring = put(g, memo('torus', () => new THREE.TorusGeometry(18, 3, 8, 24)), lambert('#ffffff'), 0, h + 20, 4);
  ring.scale.setScalar(0.9);
  g.userData.noSpin = true;
  return g;
}
function gumdrop() {
  const g = new THREE.Group(), r = rnd(18, 34);
  put(g, sphere(r), lambert(pick(CANDY)), 0, r * 0.3, 0, 1, 0.8, 1);
  return g;
}
function codeColumn() {                                    // a tall translucent beam with bright glyph blocks in it
  const g = new THREE.Group(), h = rnd(160, 420);
  put(g, box(rnd(10, 18), h, 14), basic('#00ff66', { transparent: true, opacity: 0.22 }), 0, h / 2, 0);
  for (let i = 0; i < 9; i++) put(g, box(rnd(5, 10), rnd(6, 14), 8), basic(pick(['#aaffcc', '#00ff88', '#00cc55'])), rnd(-3, 3), rnd(10, h), rnd(-5, 5));
  return g;
}
function wireCube() {
  const g = new THREE.Group(), s = rnd(20, 50);
  const edges = memo('edges', () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)));
  const l = new THREE.LineSegments(edges, memo('lineG', () => new THREE.LineBasicMaterial({ color: 0x00ff66 })));
  l.scale.setScalar(s); l.position.y = rnd(40, 160); l.rotation.set(rnd(0, 3), rnd(0, 3), 0);
  g.add(l);
  return g;
}

// per theme: what to build, how likely, how far from the road (near: ROAD_EDGE + the range; far = big
// backdrop pieces), how often a slot stays empty
const SETS = {
  neon:   { empty: 0.15, props: [[tower, 6, [10, 170]], [neonPyramid, 1.5, [30, 250]], [tower, 2, [500, 900]]] },
  sunset: { empty: 0.3,  props: [[palm, 6, [15, 170]], [mountain, 1.5, [450, 1000]]] },
  day:    { empty: 0.2,  props: [[tree, 6, [15, 180]], [bush, 4, [10, 110]], [hill, 1.2, [450, 1000]]] },
  desert: { empty: 0.35, props: [[cactus, 5, [15, 180]], [boulder, 3, [15, 160]], [mesa, 1.3, [450, 1000]]] },
  arctic: { empty: 0.2,  props: [[pine, 6, [15, 180]], [iceCrystal, 2, [15, 160]], [snowMound, 3, [10, 130]]] },
  candy:  { empty: 0.2,  props: [[lollipop, 5, [15, 170]], [gumdrop, 5, [10, 130]]] },
  matrix: { empty: 0.15, props: [[codeColumn, 6, [10, 200]], [wireCube, 2, [15, 200]], [codeColumn, 2, [500, 900]]] },
};

export function createScenery(scene) {
  let themeId = 'neon';
  const slots = [];
  for (const side of [-1, 1]) for (let i = 0; i < PER_SIDE; i++) {
    slots.push({ side, offset: (i + (side > 0 ? 0.5 : 0)) * (SPAN / PER_SIDE), cycle: -Infinity, group: null });
  }

  function build(slot) {
    if (slot.group) { scene.remove(slot.group); slot.group = null; }
    const set = SETS[themeId];
    if (Math.random() < set.empty) return;
    let r = Math.random() * set.props.reduce((a, p) => a + p[1], 0);
    const [make, , range] = set.props.find(p => (r -= p[1]) < 0) ?? set.props[0];
    const g = make();
    const far = range[0] > 300;
    g.scale.setScalar(far ? 1 : SCALE);              // the big backdrop pieces are already large
    slot.x = slot.side * (ROAD_EDGE + rnd(range[0], range[1]));
    slot.jitterZ = rnd(-25, 25);
    if (!g.userData.noSpin) g.rotation.y += rnd(0, Math.PI * 2);
    scene.add(g);
    slot.group = g;
  }

  return {
    // the theme whose props new slots are built from (existing props are replaced as they come round)
    setTheme(id) { if (SETS[id]) themeId = id; },
    update(scroll) {
      for (const s of slots) {
        const u = s.offset + scroll, cycle = Math.floor(u / SPAN);
        if (cycle !== s.cycle) { s.cycle = cycle; build(s); }
        if (s.group) s.group.position.set(s.x, 0, Z_FAR + (u - cycle * SPAN) + s.jitterZ);
      }
    },
  };
}
