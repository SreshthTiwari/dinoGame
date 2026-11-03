// Slider panel for the fake-3D camera. Edits the game's live `cam` object and remembers the values.
import { CAM_DEFAULTS } from '../game.js';

const SLIDERS = [
  { key: 'back', label: 'Distance', min: 120, max: 900, step: 10 },     // camera distance behind the dino
  { key: 'horizon', label: 'Horizon', min: 40, max: 400, step: 5 },     // screen height of the horizon
  { key: 'follow', label: 'Follow', min: 0, max: 1, step: 0.05 },       // sideways drift with the dino
];
const STORE = 'blip-cam';

export function createCameraPanel(cam) {
  try { Object.assign(cam, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(cam)); } catch {} };

  const panel = document.createElement('div');
  panel.id = 'camPanel';
  const inputs = {};
  for (const sl of SLIDERS) {
    const row = document.createElement('label');
    const name = document.createElement('span'); name.textContent = sl.label;
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: sl.min, max: sl.max, step: sl.step, value: cam[sl.key] });
    const val = document.createElement('output');
    const show = () => { val.textContent = String(+(+cam[sl.key]).toFixed(2)); };
    input.addEventListener('input', () => { cam[sl.key] = +input.value; show(); save(); });
    input.addEventListener('change', () => input.blur());   // so arrow keys / space go back to the game
    show();
    row.append(name, input, val);
    panel.append(row);
    inputs[sl.key] = { input, show };
  }
  const reset = document.createElement('button');
  reset.textContent = 'Reset camera';
  reset.addEventListener('click', () => {
    Object.assign(cam, CAM_DEFAULTS);
    for (const [k, { input, show }] of Object.entries(inputs)) { input.value = cam[k]; show(); }
    save(); reset.blur();
  });
  panel.append(reset);
  document.body.append(panel);

  return { toggle() { panel.classList.toggle('hidden'); } };
}
