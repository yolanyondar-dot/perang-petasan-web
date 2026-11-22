export const MAPS = {
  gang_kampung: { id: 'gang_kampung', name: 'Gang Kampung' },
  atap_rumah: { id: 'atap_rumah', name: 'Atap Rumah' },
  jurang_kali: { id: 'jurang_kali', name: 'Jurang Kali' },
};
export const MAP_LIST = Object.values(MAPS);

export class Terrain {
  constructor(width, height, mapId = 'gang_kampung') {
    this.width = width;
    this.height = height;
    this.mapId = MAPS[mapId] ? mapId : 'gang_kampung';
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.spawns = [];
    this.deathY = height + 80;
    this.decor = []; // visual-only decorations
    this.generate();
  }

  generate(seed = Math.random()) {
    const { ctx, width: w, height: h } = this;
    ctx.clearRect(0, 0, w, h);
    this.decor = [];
    if (this.mapId === 'atap_rumah') this._genAtap(w, h, seed);
    else if (this.mapId === 'jurang_kali') this._genJurang(w, h, seed);
    else this._genKampung(w, h, seed);
    this._ensureSpawns();
  }

  _ensureSpawns() {
    if (!this.spawns.length) {
      this.spawns = [200, this.width / 2, this.width - 220].map(x => ({ x, y: this.findSurfaceY(x) }));
    }
    this.spawns = this.spawns.map(s => {
      const y = this.findSurfaceY(s.x, 0);
      return { x: s.x, y: y > this.height ? this.height * 0.6 : y };
    });
  }

  _fillGround(pathFn, topColor = '#7bd35d') {
    const { ctx, width: w, height: h } = this;
    ctx.save();
    ctx.beginPath();
    pathFn();
    ctx.closePath();
    const soil = ctx.createLinearGradient(0, h * 0.3, 0, h);
    soil.addColorStop(0, '#8b5a2b');
    soil.addColorStop(0.4, '#73461f');
    soil.addColorStop(1, '#4a2d12');
    ctx.fillStyle = soil;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = topColor;
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  _genKampung(w, h, seed) {
    this.deathY = h + 80;
    const base = h * 0.74;
    const a1 = h * 0.07, a2 = h * 0.04;
    const p1 = seed * 6.2, p2 = seed * 3.1;
    const sy = (x) => base + Math.sin((x / w) * Math.PI * 2.2 + p1) * a1 + Math.sin((x / w) * Math.PI * 5.5 + p2) * a2;
    this._fillGround(() => { ctxMovePath(this.ctx, w, h, sy); });
    // small dirt texture
    this._texture(0.06);

    // decorations (visual only): fence, trees, pots
    this.decor.push({ type: 'sky_hills' });
    for (const x of [120, 360, 640, 920, 1120]) {
      const y = sy(x);
      this.decor.push({ type: 'tree', x, y: y - 2, s: 0.8 + (x % 3) * 0.15 });
    }
    for (const x of [260, 520, 760, 1000]) {
      const y = sy(x);
      this.decor.push({ type: 'fence', x, y: y - 1 });
    }
    for (const x of [300, 700, 980]) {
      const y = sy(x);
      this.decor.push({ type: 'pot', x, y: y - 1 });
    }

    this.spawns = [
      { x: 160, y: sy(160) },
      { x: w * 0.5, y: sy(w * 0.5) },
      { x: w - 160, y: sy(w - 160) },
    ];
  }

  _genAtap(w, h, seed) {
    this.deathY = h + 80;
    const { ctx } = this;
    // background ground far below (just for abyss feel) - none; gaps fall to deathY
    // roof segments: [x1,x2,peakY,leftY,rightY]
    const roofs = [
      { x1: 40, x2: 360, y1: h * 0.62, y2: h * 0.52, y3: h * 0.64 },
      { x1: 430, x2: 720, y1: h * 0.58, y2: h * 0.46, y3: h * 0.56 },
      { x1: 790, x2: 1060, y1: h * 0.64, y2: h * 0.53, y3: h * 0.62 },
      { x1: 1120, x2: 1240, y1: h * 0.68, y2: h * 0.60, y3: h * 0.70 },
    ];
    for (const r of roofs) this._drawRoof(r);

    // chimney / water tank decor on roofs
    this.decor.push({ type: 'chimney', x: 560, y: h * 0.46 });
    this.decor.push({ type: 'tank', x: 940, y: h * 0.53 });
    this.decor.push({ type: 'antenna', x: 240, y: h * 0.52 });

    this.spawns = [
      { x: 180, y: this.findSurfaceY(180) },
      { x: 580, y: this.findSurfaceY(580) },
      { x: 930, y: this.findSurfaceY(930) },
    ];
  }

  _drawRoof(r) {
    const { ctx } = this;
    const mid = (r.x1 + r.x2) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(r.x1, r.y1);
    ctx.lineTo(mid, r.y2);
    ctx.lineTo(r.x2, r.y3);
    ctx.lineTo(r.x2, r.y3 + 28);
    ctx.lineTo(r.x1, r.y1 + 28);
    ctx.closePath();
    ctx.fillStyle = '#8d4b2d';
    ctx.fill();
    // tile texture
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let y = r.y2; y < r.y3 + 40; y += 10) {
      ctx.beginPath(); ctx.moveTo(r.x1, y); ctx.lineTo(r.x2, y); ctx.stroke();
    }
    for (let x = r.x1; x < r.x2; x += 18) {
      ctx.beginPath(); ctx.moveTo(x, r.y2); ctx.lineTo(x, r.y3 + 40); ctx.stroke();
    }
    ctx.restore();
    // ridge
    ctx.strokeStyle = '#5d2e14';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(mid, r.y2); ctx.lineTo(r.x2, r.y3); ctx.stroke();
  }

  _genJurang(w, h, seed) {
    this.deathY = h + 80;
    const { ctx } = this;
    // left side
    const leftTop = h * 0.62;
    const rightTop = h * 0.62;
    const gapL = w * 0.42, gapR = w * 0.58;
    const bridgeY = h * 0.82;

    // left land
    this._fillGround(() => {
      ctx.moveTo(0, h); ctx.lineTo(0, leftTop);
      for (let x = 0; x <= gapL; x += 4) {
        const y = leftTop + Math.sin(x * 0.01 + seed) * 12;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(gapL, h); ctx.closePath();
    });

    // right land
    this._fillGround(() => {
      ctx.moveTo(gapR, h);
      for (let x = gapR; x <= w; x += 4) {
        const y = rightTop + Math.sin(x * 0.012 + seed * 2) * 12;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath();
    });

    // small platform below
    ctx.save();
    ctx.fillStyle = '#6d4c41';
    roundRectPath(ctx, w * 0.46, bridgeY, w * 0.08, 16, 4);
    ctx.fill();
    ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    // decorations
    this.decor.push({ type: 'tree', x: 120, y: leftTop - 2, s: 1 });
    this.decor.push({ type: 'tree', x: w - 140, y: rightTop - 2, s: 1 });
    this.decor.push({ type: 'sign', x: gapL - 30, y: leftTop });
    this.decor.push({ type: 'sign', x: gapR + 30, y: rightTop });

    this.spawns = [
      { x: 160, y: this.findSurfaceY(160) },
      { x: w * 0.5, y: this.findSurfaceY(w * 0.5) },
      { x: w - 160, y: this.findSurfaceY(w - 160) },
    ];
  }

  _texture(alpha = 0.06) {
    const { ctx, width: w, height: h } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    for (let i = 0; i < 700; i++) {
      const x = (i * 89) % w;
      const y = Math.floor(h * 0.35 + ((i * 57) % (h * 0.65)));
      if (this.isSolid(x, y)) ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();
  }

  carveCrater(x, y, radius) {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  isSolid(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return false;
    return this.ctx.getImageData(xi, yi, 1, 1).data[3] > 10;
  }

  findSurfaceY(x, fromY = 0) {
    const xi = Math.floor(Math.max(0, Math.min(this.width - 1, x)));
    const start = Math.max(0, Math.floor(fromY));
    const img = this.ctx.getImageData(xi, 0, 1, this.height).data;
    for (let y = start; y < this.height; y++) {
      if (img[y * 4 + 3] > 10) return y;
    }
    return this.height + 1;
  }

  draw(ctx) {
    this._drawBackground(ctx);
    ctx.drawImage(this.canvas, 0, 0);
    this._drawDecor(ctx);
  }

  _drawBackground(ctx) {
    const { width: w, height: h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (this.mapId === 'atap_rumah') {
      g.addColorStop(0, '#7ec8ff'); g.addColorStop(0.6, '#c9ebff'); g.addColorStop(1, '#ffe7c2');
    } else if (this.mapId === 'jurang_kali') {
      g.addColorStop(0, '#74c0fc'); g.addColorStop(0.55, '#cdeffd'); g.addColorStop(1, '#e8f7ff');
    } else {
      g.addColorStop(0, '#6ec6ff'); g.addColorStop(0.55, '#bde7ff'); g.addColorStop(1, '#eaf8ff');
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const t = performance.now() * 0.008;
    for (let i = 0; i < 6; i++) {
      const x = ((i * 260 + t * (8 + i * 2)) % (w + 200)) - 100;
      const y = 55 + (i % 3) * 32;
      ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2); ctx.arc(x + 24, y - 10, 26, 0, Math.PI * 2); ctx.arc(x + 52, y, 20, 0, Math.PI * 2); ctx.fill();
    }
    if (this.mapId === 'jurang_kali') {
      // river at bottom
      ctx.fillStyle = 'rgba(66,165,245,0.35)';
      ctx.fillRect(0, h - 45, w, 45);
    }
  }

  _drawDecor(ctx) {
    for (const d of this.decor) {
      if (d.type === 'tree') drawTree(ctx, d.x, d.y, d.s || 1);
      else if (d.type === 'fence') drawFence(ctx, d.x, d.y);
      else if (d.type === 'pot') drawPot(ctx, d.x, d.y);
      else if (d.type === 'chimney') drawChimney(ctx, d.x, d.y);
      else if (d.type === 'tank') drawTank(ctx, d.x, d.y);
      else if (d.type === 'antenna') drawAntenna(ctx, d.x, d.y);
      else if (d.type === 'sign') drawSign(ctx, d.x, d.y);
    }
  }
}

function ctxMovePath(ctx, w, h, sy) {
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 2) ctx.lineTo(x, sy(x));
  ctx.lineTo(w, h);
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawTree(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#6d4c41'; ctx.fillRect(-4, -34, 8, 34);
  ctx.fillStyle = '#66bb6a'; ctx.beginPath(); ctx.arc(0, -46, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#81c784'; ctx.beginPath(); ctx.arc(-10, -40, 14, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawFence(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 3;
  for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 12, 0); ctx.lineTo(i * 12, -22); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-16, -16); ctx.lineTo(16, -16); ctx.moveTo(-16, -8); ctx.lineTo(16, -8); ctx.stroke();
  ctx.restore();
}
function drawPot(ctx, x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#a1887f'; ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(8, -12); ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#66bb6a'; ctx.beginPath(); ctx.arc(0, -16, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawChimney(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#795548'; ctx.fillRect(-10, -28, 20, 28);
  ctx.fillStyle = '#5d4037'; ctx.fillRect(-13, -32, 26, 6); ctx.restore();
}
function drawTank(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#90a4ae'; roundRectPath(ctx, -14, -26, 28, 26, 5); ctx.fill();
  ctx.fillStyle = '#78909c'; ctx.fillRect(-4, -32, 8, 6); ctx.restore();
}
function drawAntenna(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#616161'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -34); ctx.moveTo(-10, -24); ctx.lineTo(10, -24); ctx.stroke(); ctx.restore();
}
function drawSign(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -24); ctx.stroke();
  ctx.fillStyle = '#ffcc80'; ctx.fillRect(-12, -36, 24, 14); ctx.strokeStyle = '#8d6e63'; ctx.strokeRect(-12, -36, 24, 14);
  ctx.restore();
}