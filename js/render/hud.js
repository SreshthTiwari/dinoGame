// Score, level and the start / game-over text, drawn on the 2D canvas over whichever renderer is active.
export function drawHud(ctx, v) {
  const { W, state, plank } = v;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 6;     // keeps the text readable on bright themes
  ctx.fillStyle = '#e8e4ff'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'right';
  ctx.fillText(String(Math.floor(v.score)).padStart(5, '0'), W - 16, 30);
  ctx.fillStyle = '#8c82c8'; ctx.textAlign = 'left';
  ctx.fillText('HI ' + String(v.best).padStart(5, '0'), 16, 30);
  ctx.fillStyle = '#ffd35e'; ctx.textAlign = 'center';
  ctx.fillText(`LV ${v.level}`, W / 2, 30);

  ctx.textAlign = 'center';

  // active powerups and the breather, as small chips under the level
  if (state === 'play') {
    const chips = [];
    if (v.shield) chips.push({ text: 'SHIELD', color: '#4de8ff' });
    if (v.ghost > 0) chips.push({ text: `GHOST ${v.ghost.toFixed(1)}`, color: '#c9b6ff' });
    ctx.font = 'bold 14px monospace';
    let y = 46;
    for (const c of chips) {
      const w = ctx.measureText(c.text).width + 22;
      ctx.fillStyle = 'rgba(14,11,31,0.6)'; ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, y, w, 22, 11); ctx.fill();
      ctx.fillStyle = c.color; ctx.fillText(c.text, W / 2, y + 16);
      y += 28;
    }
    if (v.breather) {                                  // a break: the world is slowed down, with a timer bar
      const { left, length } = v.breather, fade = Math.min(1, left, length - left);
      ctx.globalAlpha = Math.max(0, Math.min(1, fade));
      ctx.fillStyle = '#9ff3d0'; ctx.font = 'bold 18px monospace'; ctx.fillText('BREATHER', W / 2, y + 22);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(W / 2 - 60, y + 30, 120, 4);
      ctx.fillStyle = '#9ff3d0'; ctx.fillRect(W / 2 - 60, y + 30, 120 * (left / length), 4);
      ctx.globalAlpha = 1;
    }
  }

  if (state === 'start') {
    ctx.fillStyle = '#e8e4ff'; ctx.font = 'bold 40px monospace'; ctx.fillText('DINOGAME', W / 2, 200);
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
  ctx.restore();
}
