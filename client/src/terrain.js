import { renderBallisticMapBackdrop, paintStylizedTerrainLayer } from './ballisticStyleAssets.js';

export const MAPS = {
  kampung_festival: { id: 'kampung_festival', name: 'Kampung Festival' },
  atap_senja: { id: 'atap_senja', name: 'Atap Senja' },
  jembatan_bulan: { id: 'jembatan_bulan', name: 'Jembatan Bulan' },
};
export const MAP_LIST = Object.values(MAPS);

const MAP_ALIAS = {
  gang_kampung: 'kampung_festival',
  atap_rumah: 'atap_senja',
  jurang_kali: 'jembatan_bulan',
};

export function normalizeMapId(id) {
  if (MAPS[id]) return id;
  return MAP_ALIAS[id] || 'kampung_festival';
}

export class Terrain {
  constructor(width, height, mapId = 'kampung_festival') {
    this.width = width;
    this.height = height;
    this.mapId = normalizeMapId(mapId);
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.spawns = [];
    this.deathY = height + 80;
    this.decor = [];
    this.generate();
  }

  generate() {
    const { width: w, height: h } = this;
    this.ctx.clearRect(0, 0, w, h);
    this.decor = [];
    paintStylizedTerrainLayer(this.ctx, w, h, this.mapId);
    this._addDecor();
    this._ensureSpawns();
  }

  _addDecor() {
    const { width: w, height: h, mapId } = this;
    if (mapId === 'kampung_festival') {
      this.decor.push({ type: 'banner', x: w * 0.5, y: h * 0.18 });
      this.decor.push({ type: 'drum', x: 110, y: this.findSurfaceY(110) });
      this.decor.push({ type: 'drum', x: w - 110, y: this.findSurfaceY(w - 110) });
    } else if (mapId === 'atap_senja') {
      this.decor.push({ type: 'antenna', x: w * 0.5, y: h * 0.48 - 70 });
      this.decor.push({ type: 'lantern', x: w * 0.22, y: h * 0.58 - 55 });
      this.decor.push({ type: 'lantern', x: w * 0.78, y: h * 0.56 - 55 });
    } else {
      this.decor.push({ type: 'moon_flag', x: w * 0.5, y: h * 0.64 - 40 });
      this.decor.push({ type: 'lantern', x: w * 0.18, y: h * 0.54 - 45 });
      this.decor.push({ type: 'lantern', x: w * 0.82, y: h * 0.54 - 45 });
    }
  }

  _ensureSpawns() {
    const w = this.width, h = this.height;
    let candidates;
    if (this.mapId === 'atap_senja') candidates = [w * 0.18, w * 0.5, w * 0.82];
    else if (this.mapId === 'jembatan_bulan') candidates = [w * 0.18, w * 0.5, w * 0.82];
    else candidates = [w * 0.16, w * 0.5, w * 0.84];
    this.spawns = candidates.map(x => {
      const y = this.findSurfaceY(x, 0);
      return { x, y: y > h ? h * 0.6 : y };
    });
    // ensure middle spawn is on solid ground (jembatan_bulan has center island)
    this.spawns = this.spawns.map((s, i) => {
      let y = this.findSurfaceY(s.x, 0);
      if (y > this.height) {
        // search nearby
        for (let dx = 0; dx < 200; dx += 10) {
          for (const sign of [1, -1]) {
            const nx = s.x + dx * sign;
            const ny = this.findSurfaceY(nx, 0);
            if (ny <= this.height) { return { x: nx, y: ny }; }
          }
        }
        y = this.height * 0.6;
      }
      return { x: s.x, y };
    });
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
    renderBallisticMapBackdrop(ctx, this.width, this.height, this.mapId, performance.now() / 1000);
    ctx.drawImage(this.canvas, 0, 0);
    this._drawDecor(ctx);
  }

  _drawDecor(ctx) {
    for (const d of this.decor) {
      if (d.type === 'banner') drawBanner(ctx, d.x, d.y);
      else if (d.type === 'drum') drawDrum(ctx, d.x, d.y);
      else if (d.type === 'antenna') drawAntenna(ctx, d.x, d.y);
      else if (d.type === 'lantern') drawLantern(ctx, d.x, d.y);
      else if (d.type === 'moon_flag') drawMoonFlag(ctx, d.x, d.y);
    }
  }
}

function drawBanner(ctx, x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#ef4444'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-70, 0); ctx.lineTo(70, 0); ctx.lineTo(60, 34); ctx.lineTo(0, 24); ctx.lineTo(-60, 34); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('FESTIVAL PETASAN', 0, 18);
  ctx.restore();
}
function drawDrum(ctx, x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#b45309'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -10, 14, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.ellipse(0, -16, 14, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawAntenna(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -50); ctx.moveTo(-14, -38); ctx.lineTo(14, -38); ctx.moveTo(-9, -46); ctx.lineTo(9, -46); ctx.stroke();
  ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(0, -52, 3, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}
function drawLantern(ctx, x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(15,23,42,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0,-20); ctx.lineTo(0,-4); ctx.stroke();
  ctx.fillStyle = '#f97316'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(-8, -4, 16, 20, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.roundRect(-4, 0, 8, 12, 3); ctx.fill();
  ctx.restore();
}
function drawMoonFlag(ctx, x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, -30); ctx.stroke();
  ctx.fillStyle = '#38bdf8'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0,-28); ctx.lineTo(34,-20); ctx.lineTo(0,-12); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(16,-20,4,0,Math.PI*2); ctx.fill();
  ctx.restore();
}
