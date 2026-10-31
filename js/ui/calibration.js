// DOM side of the calibration screen and the small in-game camera preview.
// One #camBox element (video + overlay canvas) moves between the big calibration
// card and a small corner preview.
export function createCalibrationUI() {
  const $ = id => document.getElementById(id);
  const cal = $('cal'), slot = $('calSlot'), box = $('camBox'), msg = $('calMsg'), bar = $('calBar'), toast = $('toast');
  let toastTimer;

  return {
    setAspect(a) { box.style.aspectRatio = String(a); },
    open(message) { cal.classList.remove('hidden'); this.setMessage(message); this.setProgress(0); },
    close() { cal.classList.add('hidden'); },
    setMessage(text) { msg.textContent = text; },
    setProgress(p) { bar.style.width = `${Math.round(p * 100)}%`; },
    showBig() { slot.append(box); box.className = 'big'; box.removeAttribute('data-off'); cal.classList.remove('hidden'); },
    showMini() { document.body.append(box); box.className = 'mini'; cal.classList.add('hidden'); },
    hideCam() { box.className = 'hidden'; },
    toggleMini() { if (box.className === 'mini') box.toggleAttribute('data-off'); },
    toast(text, ms = 3500) {
      toast.textContent = text; toast.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
    },
  };
}
