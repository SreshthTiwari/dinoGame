import { createGame } from './game.js';
import { attachKeyboard } from './input/keyboard.js';

const canvas = document.getElementById('c');
const game = createGame(canvas);
attachKeyboard(canvas, game);

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  game.update(dt);
  game.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
