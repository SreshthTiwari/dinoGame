// Colour themes for the three.js renderer. Pure data: edit freely, then refresh.
//
//   sky      gradient from `top` (screen top) down to `horizon` (where the road meets the sky), with an
//            optional `mid` band between them. Stars and a sun are optional.
//   fog      far things fade into this colour, so it should be (close to) the sky's `horizon` colour.
//            (How far away the haze is comes from where obstacles are created: see FOG_START in three.js.)
//   ground / grid / road / dash / edge   the floor grid, the road, its lane dashes and its glowing edges.
//   dino     body, dark (legs and tail) and plates (back spikes).
//   spike / post / bar / barGlow   the spikes you jump, and the gate you duck under (posts + bar).
//   light    ambient + sun light, which also set how bright the dino and obstacles look.
export const THEMES = {
  neon: {
    label: 'Neon Night',
    sky: { top: '#0e0b1f', horizon: '#2d1a6b', stars: 60 },
    fog: '#2d1a6b',
    ground: '#0e0b1f', grid: 'rgba(122,92,255,0.45)', road: '#1b1040', dash: '#3a2a7a', edge: '#5ef2c8',
    dino: { body: '#5ef2c8', dark: '#2bb894', plates: '#ff5d8f' },
    spike: '#ff5d8f', post: '#7a5cff', bar: '#ffd35e', barGlow: '#6b4a00',
    light: { ambient: ['#ffffff', 0.9], sun: ['#ffffff', 1.1] },
  },
  sunset: {
    label: 'Sunset Drive',
    sky: { top: '#1b0a45', mid: '#b02a7a', horizon: '#ff8a5b', sun: { color: '#ffe29a', glow: '#ff5e7e' } },
    fog: '#ff8a5b',
    ground: '#1d0838', grid: 'rgba(255,79,216,0.55)', road: '#2c1050', dash: '#ff9d4f', edge: '#ff4fd8',
    dino: { body: '#7dffe0', dark: '#2fc9a8', plates: '#ff3d81' },
    spike: '#ff2e63', post: '#8a5cff', bar: '#ffe066', barGlow: '#7a5a00',
    light: { ambient: ['#ffd6c4', 0.85], sun: ['#ffb27a', 1.2] },
  },
  day: {
    label: 'Sunny Day',
    sky: { top: '#2f8fe8', horizon: '#cfeeff' },
    fog: '#cfeeff',
    ground: '#4da64d', grid: 'rgba(255,255,255,0.22)', road: '#4a4f5a', dash: '#f4f4f4', edge: '#ffffff',
    dino: { body: '#ff9f43', dark: '#e1761f', plates: '#e84118' },
    spike: '#e74c3c', post: '#2c3e50', bar: '#f9ca24', barGlow: '#5a4500',
    light: { ambient: ['#ffffff', 0.95], sun: ['#fff4d6', 1.3] },
  },
  desert: {
    label: 'Desert Dusk',
    sky: { top: '#5b3a7a', mid: '#e0836a', horizon: '#f7d49a', sun: { color: '#fff3c4', glow: '#ffb15e' } },
    fog: '#f7d49a',
    ground: '#d9a566', grid: 'rgba(150,95,45,0.45)', road: '#7a4f33', dash: '#f0d9a8', edge: '#ff9f43',
    dino: { body: '#3fb8a5', dark: '#1f8a78', plates: '#ffd166' },
    spike: '#b5412d', post: '#5d3a2a', bar: '#ffcc66', barGlow: '#6b4a00',
    light: { ambient: ['#ffe8cc', 0.9], sun: ['#ffc98a', 1.2] },
  },
  arctic: {
    label: 'Arctic',
    sky: { top: '#0b1d3a', mid: '#3d78b5', horizon: '#bfe4ff', stars: 40 },
    fog: '#bfe4ff',
    ground: '#eaf6ff', grid: 'rgba(120,180,225,0.55)', road: '#5d88b0', dash: '#ffffff', edge: '#38e1ff',
    dino: { body: '#ff8fab', dark: '#d9607f', plates: '#ffd166' },
    spike: '#7fe3ff', post: '#264653', bar: '#ffd166', barGlow: '#5a4500',
    light: { ambient: ['#e8f4ff', 0.95], sun: ['#ffffff', 1.2] },
  },
  candy: {
    label: 'Candy Land',
    sky: { top: '#9b59f0', mid: '#ff8ed4', horizon: '#ffe3f1' },
    fog: '#ffe3f1',
    ground: '#ffd0ea', grid: 'rgba(255,120,190,0.5)', road: '#6c5ce7', dash: '#ffffff', edge: '#ff6b9d',
    dino: { body: '#55efc4', dark: '#1fbf93', plates: '#ff6b9d' },
    spike: '#fd79a8', post: '#0984e3', bar: '#fdcb6e', barGlow: '#6b4a00',
    light: { ambient: ['#fff0f8', 0.95], sun: ['#ffffff', 1.1] },
  },
  matrix: {
    label: 'Matrix',
    sky: { top: '#000000', horizon: '#04170b', stars: 90 },
    fog: '#04170b',
    ground: '#000000', grid: 'rgba(0,255,102,0.5)', road: '#02100a', dash: '#00b84d', edge: '#00ff66',
    dino: { body: '#00ff88', dark: '#009955', plates: '#b6ff00' },
    spike: '#ff2a2a', post: '#00aa44', bar: '#ccff00', barGlow: '#445500',
    light: { ambient: ['#ccffe0', 0.85], sun: ['#aaffcc', 1.0] },
  },
};

export const THEME_ORDER = Object.keys(THEMES);
export const DEFAULT_THEME = 'neon';

// ---- Auto mode: the world changes as you play ----
export const AUTO = {
  id: 'auto',
  label: 'Auto',
  seconds: 20,          // a new theme every this many seconds of a run (in THEME_ORDER order, then around again)
  fade: 2.5,            // seconds to cross-fade into the next theme
};

// colours are '#rrggbb' or 'rgba(r,g,b,a)'; mixing gives '#rrggbb' when both are opaque
const parse = c => {
  if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
  const m = c.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
};
const hex = n => Math.round(n).toString(16).padStart(2, '0');
export function mixColor(a, b, k) {
  const x = parse(a), y = parse(b), m = x.map((v, i) => v + (y[i] - v) * k);
  return x[3] === 1 && y[3] === 1
    ? `#${hex(m[0])}${hex(m[1])}${hex(m[2])}`
    : `rgba(${Math.round(m[0])},${Math.round(m[1])},${Math.round(m[2])},${m[3].toFixed(3)})`;
}

// A theme part-way between a and b (k = 0 is a, 1 is b). Stars fade in by count and the sun by alpha.
export function blendTheme(a, b, k) {
  const c = (x, y) => mixColor(x, y, k), n = (x, y) => x + (y - x) * k;
  const midOf = t => t.sky.mid ?? mixColor(t.sky.top, t.sky.horizon, 0.24 / 0.42);   // same look as having no mid band
  const sa = a.sky.sun, sb = b.sky.sun, s1 = sa || sb, s2 = sb || sa;
  return {
    sky: {
      top: c(a.sky.top, b.sky.top), mid: c(midOf(a), midOf(b)), horizon: c(a.sky.horizon, b.sky.horizon),
      stars: Math.round(n(a.sky.stars || 0, b.sky.stars || 0)),
      sun: s1 ? { color: c(s1.color, s2.color), glow: c(s1.glow, s2.glow), alpha: n(sa ? 1 : 0, sb ? 1 : 0) } : null,
    },
    fog: c(a.fog, b.fog),
    ground: c(a.ground, b.ground), grid: c(a.grid, b.grid), road: c(a.road, b.road), dash: c(a.dash, b.dash), edge: c(a.edge, b.edge),
    dino: { body: c(a.dino.body, b.dino.body), dark: c(a.dino.dark, b.dino.dark), plates: c(a.dino.plates, b.dino.plates) },
    spike: c(a.spike, b.spike), post: c(a.post, b.post), bar: c(a.bar, b.bar), barGlow: c(a.barGlow, b.barGlow),
    light: {
      ambient: [c(a.light.ambient[0], b.light.ambient[0]), n(a.light.ambient[1], b.light.ambient[1])],
      sun: [c(a.light.sun[0], b.light.sun[0]), n(a.light.sun[1], b.light.sun[1])],
    },
  };
}
