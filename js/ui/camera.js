// Slider panel for the active renderer's camera. Edits that renderer's live `cam` object and
// remembers the values per renderer. The sliders are rebuilt whenever the renderer changes.
export function createCameraPanel() {
  const panel = document.createElement('div');
  panel.id = 'camPanel';
  document.body.append(panel);

  function setRenderer(r) {
    const key = `blip-cam-${r.name}`;
    try {
      Object.assign(r.cam, JSON.parse(localStorage.getItem(key) || '{}'));
    } catch {}
    const save = () => { try { localStorage.setItem(key, JSON.stringify(r.cam)); } catch {} };

    panel.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = 'Camera';
    panel.append(title);
    const inputs = {};
    for (const sl of r.sliders) {
      const row = document.createElement('label');
      const name = document.createElement('span'); name.textContent = sl.label;
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', min: sl.min, max: sl.max, step: sl.step, value: r.cam[sl.key] });
      const val = document.createElement('output');
      const show = () => { val.textContent = String(+(+r.cam[sl.key]).toFixed(2)); };
      input.addEventListener('input', () => { r.cam[sl.key] = +input.value; show(); save(); });
      input.addEventListener('change', () => input.blur());   // so arrow keys / space go back to the game
      show();
      row.append(name, input, val);
      panel.append(row);
      inputs[sl.key] = { input, show };
    }
    const reset = document.createElement('button');
    reset.textContent = 'Reset camera';
    reset.addEventListener('click', () => {
      Object.assign(r.cam, r.defaults);
      for (const [k, { input, show }] of Object.entries(inputs)) { input.value = r.cam[k]; show(); }
      save(); reset.blur();
    });
    panel.append(reset);
  }

  return { setRenderer, toggle() { panel.classList.toggle('hidden'); } };
}
