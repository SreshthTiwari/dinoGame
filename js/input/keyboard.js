// Keyboard + touch/pointer input. Drives the game through its action methods.
export function attachKeyboard(canvas, game) {
  const keys = {};

  addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') game.jump();
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') game.move(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') game.move(1);
    if (e.code === 'ArrowDown' || e.code === 'KeyS') game.start();
    game.setDuckHeld(!!(keys.ArrowDown || keys.KeyS));
  });
  addEventListener('keyup', e => {
    keys[e.code] = false;
    game.setDuckHeld(!!(keys.ArrowDown || keys.KeyS));
  });

  // touch: swipe up = jump, down = duck, left/right = change lane, tap = jump
  let sx, sy;
  canvas.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
  canvas.addEventListener('pointerup', e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.hypot(dx, dy) < 25) return game.jump();
    if (Math.abs(dx) > Math.abs(dy)) game.move(dx > 0 ? 1 : -1);
    else if (dy < 0) game.jump();
    else game.duckFor(0.6);
  });
}
