// Score, level and the start / game-over text, drawn on the 2D canvas over whichever renderer is active.
export function drawHud(ctx, v) {
  const { W, state, plank } = v;
  ctx.fillStyle = '#e8e4ff'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'right';
  ctx.fillText(String(Math.floor(v.score)).padStart(5, '0'), W - 16, 30);
  ctx.fillStyle = '#8c82c8'; ctx.textAlign = 'left';
  ctx.fillText('HI ' + String(v.best).padStart(5, '0'), 16, 30);
  ctx.fillStyle = '#ffd35e'; ctx.textAlign = 'center';
  ctx.fillText(`LV ${v.level}`, W / 2, 30);

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
