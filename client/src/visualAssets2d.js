// Procedural 2D visual assets for Perang Petasan.
// All drawing is Canvas 2D only - no external images required.

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawCharacter2D(ctx, c) {
  if (!c || c.eliminated) return;
  const { x, y, facing, name } = c;
  const s = c.skin || {};
  const t = performance.now() / 1000;
  const run = c.onGround && Math.abs(c.vx) > 20;
  const legSwing = run ? Math.sin(c.runPhase || 0) * 7 : Math.sin(t * 2) * 1.5;
  const bob = run ? Math.sin((c.runPhase || 0) * 2) * 1.5 : Math.sin(t * 2.5) * 0.8;
  const throwT = c.throwAnim > 0 ? 1 - c.throwAnim / 0.28 : 0;
  const armAim = -(c.aimAngle || 45) * Math.PI / 180;

  ctx.save();
  ctx.translate(x, y + bob);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (c.hurtAnim > 0) ctx.globalAlpha = 0.7 + Math.sin(t * 40) * 0.3;

  // knockout pose
  if (!c.alive) {
    ctx.globalAlpha = 0.85;
    ctx.rotate((facing || 1) * 0.15);
  }

  // buff shield
  if (c.buff) {
    ctx.save();
    ctx.globalAlpha = 0.25 + Math.sin(t * 8) * 0.08;
    ctx.strokeStyle = '#80deea';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -24, 28, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // legs
  ctx.strokeStyle = s.pants || '#5d4037';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, -14); ctx.lineTo(-4 - legSwing * 0.4, -2); ctx.lineTo(-6 - legSwing * 0.6, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -14); ctx.lineTo(4 + legSwing * 0.4, -2); ctx.lineTo(6 + legSwing * 0.6, 0); ctx.stroke();

  // torso
  ctx.fillStyle = s.shirt || c.color || '#e53935';
  roundRect(ctx, -10, -34, 20, 22, 6); ctx.fill();
  // shirt detail
  if (c.charId === 'udin') {
    ctx.fillStyle = '#fff'; ctx.fillRect(-10, -28, 20, 5); ctx.fillStyle = '#e53935'; ctx.fillRect(-10, -23, 20, 4);
  } else if (c.charId === 'sari') {
    ctx.fillStyle = s.shirt2 || '#fff59d'; roundRect(ctx, -8, -32, 16, 18, 4); ctx.fill();
  } else if (c.charId === 'hendra') {
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(ctx, -7, -31, 14, 16, 4); ctx.fill();
    ctx.strokeStyle = '#90a4ae'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -33); ctx.lineTo(0, -14); ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(ctx, -7, -31, 14, 8, 4); ctx.fill();
  }

  // back arm
  ctx.strokeStyle = s.skinTone || '#f2c9a0';
  ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6 * facing, -30); ctx.lineTo(-12 * facing, -20 + legSwing * 0.2); ctx.stroke();

  // front arm / aim
  ctx.save();
  ctx.translate(6 * facing, -30);
  const aimRot = facing === 1 ? armAim : Math.PI - armAim;
  const throwExtra = throwT > 0 ? Math.sin(throwT * Math.PI) * 0.8 : 0;
  ctx.rotate(aimRot - throwExtra * facing);
  ctx.strokeStyle = s.skinTone || '#f2c9a0';
  ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, 0); ctx.stroke();
  // petasan in hand
  ctx.fillStyle = '#d32f2f'; roundRect(ctx, 14, -4, 10, 8, 2); ctx.fill();
  ctx.fillStyle = '#ffd54f'; ctx.fillRect(22, -1, 4, 2);
  ctx.restore();

  // head
  ctx.fillStyle = s.skinTone || '#f2c9a0';
  ctx.beginPath(); ctx.arc(0, -43, 11, 0, Math.PI * 2); ctx.fill();

  drawAccessory2D(ctx, s.accessory, s, facing, t);

  // face
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(3 * facing, -44, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-3 * facing, -44, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (c.alive) ctx.arc(1 * facing, -40, 3, 0.1 * Math.PI, 0.9 * Math.PI);
  else { ctx.moveTo(-2 * facing, -39); ctx.lineTo(2 * facing, -41); } // KO face
  ctx.stroke();

  ctx.restore();
  drawCharacterHud2D(ctx, c);
}

export function drawAccessory2D(ctx, acc, s, facing, t) {
  // base hair
  ctx.fillStyle = s.hair || '#3e2723';
  ctx.beginPath();
  ctx.arc(0, -45, 11, Math.PI, Math.PI * 2);
  ctx.lineTo(11, -41);
  ctx.quadraticCurveTo(0, -38, -11, -41);
  ctx.closePath(); ctx.fill();

  if (acc === 'headband') {
    ctx.strokeStyle = '#ff1744'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(0, -45, 10.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-10 * facing, -46); ctx.quadraticCurveTo(-16 * facing, -48 - Math.sin(t * 4) * 2, -20 * facing, -44); ctx.stroke();
  } else if (acc === 'hat_ponytail') {
    ctx.fillStyle = '#ffb74d'; ctx.fillRect(-12, -49, 24, 4);
    ctx.beginPath(); ctx.arc(0, -49, 9, Math.PI, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = s.hair || '#4e342e'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8 * facing, -42); ctx.quadraticCurveTo(-16 * facing, -40, -18 * facing, -34 + Math.sin(t * 3) * 2); ctx.stroke();
  } else if (acc === 'goggles') {
    ctx.fillStyle = '#263238'; ctx.fillRect(-12, -51, 24, 4);
    ctx.strokeStyle = '#90a4ae'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(-4, -47, 3.2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(4, -47, 3.2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(129,212,250,0.5)';
    ctx.beginPath(); ctx.arc(-4, -47, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -47, 2.4, 0, Math.PI * 2); ctx.fill();
  } else if (acc === 'cap_back') {
    ctx.fillStyle = '#1e88e5'; ctx.beginPath(); ctx.arc(0, -46, 10.5, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1565c0'; ctx.fillRect(-14 * facing, -47, 10, 3);
  } else {
    ctx.fillStyle = '#263238'; ctx.fillRect(-13 * (facing * 0.2 + 0.8), -46, 18, 3);
  }
}

export function drawCharacterHud2D(ctx, c) {
  const { x, y, name, hp, maxHp, energy } = c;
  const top = y - 72;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 28, top - 2, 56, 12);
  ctx.fillStyle = '#fff';
  ctx.fillText(name || 'P', x, top + 7);
  // HP
  const bw = 56, bh = 6, bx = x - bw / 2, by = top + 13;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
  const pct = Math.max(0, Math.min(1, hp / (maxHp || 100)));
  ctx.fillStyle = pct > 0.5 ? '#66bb6a' : pct > 0.25 ? '#ffca28' : '#ef5350';
  ctx.fillRect(bx, by, bw * pct, bh);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
  // Energy
  const ey = by + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, ey, bw, 4);
  const ep = Math.max(0, Math.min(1, (energy || 0) / 100));
  ctx.fillStyle = ep >= 1 ? '#e040fb' : '#42a5f5';
  ctx.fillRect(bx, ey, bw * ep, 4);
  ctx.restore();
}

export function drawPickup2D(ctx, p) {
  if (!p || p.dead) return;
  const t = performance.now() / 1000 + (p.bob || 0);
  const bobY = p.landed ? Math.sin(t * 3) * 2 : 0;
  const x = p.x, y = p.y + bobY;

  if (!p.landed) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 10, y - 10); ctx.lineTo(x - 18, y - 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 10, y - 10); ctx.lineTo(x + 18, y - 34); ctx.stroke();
    ctx.fillStyle = '#ff7043';
    ctx.beginPath(); ctx.arc(x, y - 34, 20, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y - 34, 20, Math.PI, Math.PI * 1.5); ctx.lineTo(x, y - 34); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(0, 13, 12, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.type === 'energy' ? '#7e57c2' : p.type === 'hp' ? '#43a047' : '#039be5';
  roundRect(ctx, -13, -11, 26, 22, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#ffd54f';
  ctx.fillRect(-2, -11, 4, 22); ctx.fillRect(-13, -2, 26, 4);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(p.type === 'energy' ? '⚡' : p.type === 'hp' ? '+' : 'CD', 0, 1);
  ctx.restore();
}

export function drawExplosion2D(ctx, fx) {
  if (!fx) return;
  const t = fx.age / fx.duration;
  if (t >= 1) return;
  const alpha = 1 - t;
  const r = fx.r * (0.3 + 0.7 * Math.min(1, t * 2.5));

  ctx.save();
  ctx.globalAlpha = alpha * 0.6;
  ctx.fillStyle = fx.type === 'ulti' ? '#ff5722' : '#ff9800';
  ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = alpha * 0.45;
  ctx.fillStyle = '#fff176';
  ctx.beginPath(); ctx.arc(fx.x, fx.y, r * 0.55, 0, Math.PI * 2); ctx.fill();

  for (const p of (fx.particles || [])) {
    const px = fx.x + p.vx * fx.age;
    const py = fx.y + p.vy * fx.age + 120 * fx.age * fx.age;
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = p.color || '#ffcc80';
    ctx.beginPath(); ctx.arc(px, py, p.size * (1 - t * 0.5), 0, Math.PI * 2); ctx.fill();
  }

  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, r * (0.8 + t * 0.5), 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
