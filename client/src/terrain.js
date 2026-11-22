export class Terrain {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.generate();
  }

  generate(seed = Math.random()) {
    const { width: w, height: h, ctx } = this;
    ctx.clearRect(0, 0, w, h);
    const base = h * 0.72;
    const a1 = h * 0.11, a2 = h * 0.065, a3 = h * 0.035;
    const p1 = seed * Math.PI * 2, p2 = seed * 9.7, p3 = seed * 4.2;

    const surfaceY = (x) =>
      base +
      Math.sin((x / w) * Math.PI * 2.4 + p1) * a1 +
      Math.sin((x / w) * Math.PI * 5.1 + p2) * a2 +
      Math.sin((x / w) * Math.PI * 10.2 + p3) * a3;

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 2) ctx.lineTo(x, surfaceY(x));
    ctx.lineTo(w, h);
    ctx.closePath();

    const soil = ctx.createLinearGradient(0, h * 0.45, 0, h);
    soil.addColorStop(0, '#8b5a2b');
    soil.addColorStop(0.35, '#73461f');
    soil.addColorStop(1, '#4a2d12');
    ctx.fillStyle = soil;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = '#7bd35d';
    ctx.lineWidth = 10;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = surfaceY(x);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#4ea33b';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#000';
    for (let i = 0; i < 700; i++) {
      const x = (i * 89) % w;
      const y = Math.floor(h * 0.4 + ((i * 57) % (h * 0.6)));
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
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return false;
    const a = this.ctx.getImageData(xi, yi, 1, 1).data[3];
    return a > 10;
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
    ctx.drawImage(this.canvas, 0, 0);
  }
}