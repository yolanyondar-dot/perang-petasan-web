/**
 * Generator sprite sheet karakter fighting dari raw asset `*-move.jpg`.
 *
 * Konvensi docs/sprite-pipeline.md + docs/sprite-runtime.md:
 * - satu base per karakter, semua state memakai proporsi/palet yang sama
 * - menghadap kanan, anchor di kaki, flip di anchor
 * - idle/walk/run/jump/attack/cast/hurt/down/ultimate
 * - manifest.frame_layout + manifest.animation, sel 128x128
 *
 * Pipeline ekstraksi: background near-white dibersihkan dengan flood-fill dari
 * tepi, komponen terhubung dihitung, komponen kecil mengambang (artifact di atas
 * kepala) dibuang, lalu 5 pose utama dinormalisasi ke anchor kaki.
 *
 * Jalankan: npm run assets:characters
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const RAW_DIR = path.resolve('client/raw_assets');
const OUT_DIR = path.resolve('client/public/assets/characters/sprites');
const CELL = 128;
const ANCHOR_X = 64;
const ANCHOR_Y = 120;

/** File move mentah dipetakan ke hero id. `master-lodong` memakai id tukang_lodong. */
const MOVE_SOURCES = [
  { heroId: 'bocil_sarung', file: 'bocil-sarung-move.jpg' },
  { heroId: 'abang_ronda', file: 'abang-ronda-move.jpg' },
  { heroId: 'tukang_lodong', file: 'master-lodong-move.jpg' },
  { heroId: 'emak_daster', file: 'emak-daster-move.jpg' },
  { heroId: 'pendekar_silat', file: 'pendekar-silat-move.jpg' },
  { heroId: 'abang_nasi_goreng', file: 'abang-nasi-goreng-move.jpg' },
  { heroId: 'tukang_parkir', file: 'tukang-parkir-move.jpg' },
];

const STATES = [
  { name: 'idle', fps: 5, loop: true },
  { name: 'walk', fps: 8, loop: true },
  { name: 'run', fps: 12, loop: true },
  { name: 'jump', fps: 8, loop: false },
  { name: 'attack', fps: 12, loop: false },
  { name: 'cast', fps: 8, loop: false },
  { name: 'hurt', fps: 12, loop: false },
  { name: 'down', fps: 8, loop: false },
  { name: 'ultimate', fps: 6, loop: false },
];

/** Susunan state memakai 5 pose asli; urutan ini memberi gerakan tanpa menggambar ulang. */
const POSE_ROWS = {
  idle: { frames: [0], fps: 5, loop: true },
  walk: { frames: [0, 1, 2, 3, 4], fps: 8, loop: true },
  run: { frames: [1, 2, 3, 4], fps: 12, loop: true },
  jump: { frames: [2, 3, 4], fps: 8, loop: false },
  attack: { frames: [3, 4, 1], fps: 12, loop: false },
  cast: { frames: [4], fps: 8, loop: false },
  hurt: { frames: [1, 0], fps: 12, loop: false },
  down: { frames: [4, 3], fps: 8, loop: false },
  ultimate: { frames: [4], fps: 6, loop: false },
};

function colorDistance(data, i, bg) {
  return Math.hypot(
    (data[i] ?? 0) - bg[0],
    (data[i + 1] ?? 0) - bg[1],
    (data[i + 2] ?? 0) - bg[2],
  );
}

/** Bersihkan background datar, kembalikan buffer RGBA dengan alpha subjek saja. */
async function loadCleanPixels(sourcePath) {
  const source = await readFile(sourcePath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const bg = [data[0] ?? 255, data[1] ?? 255, data[2] ?? 255];
  const distance = (i) => colorDistance(data, i, bg);

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };
  for (let x = 0; x < w; x += 1) {
    visit(x, 0);
    visit(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    visit(0, y);
    visit(w - 1, y);
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    if (distance(idx * ch) > 48) continue;
    data[idx * ch + 3] = 0;
    const x = idx % w;
    const y = Math.floor(idx / w);
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }
  for (let i = 0; i < w * h; i += 1) {
    if (distance(i * ch) < 26) data[i * ch + 3] = 0;
  }
  return { data, w, h, ch };
}

/** Labeli komponen terhubung (8-neighbor) pada alpha yang sudah bersih. */
function labelComponents(data, w, h, ch) {
  const labels = new Int32Array(w * h);
  labels.fill(-1);
  const components = [];
  const stack = new Int32Array(w * h);
  const neighbors = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x;
      if ((data[start * ch + 3] ?? 0) < 12 || labels[start] >= 0) continue;
      const id = components.length;
      let top = 0;
      stack[top] = start;
      top += 1;
      labels[start] = id;
      let area = 0;
      let sumX = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (top > 0) {
        top -= 1;
        const idx = stack[top];
        const cx = idx % w;
        const cy = Math.floor(idx / w);
        area += 1;
        sumX += cx;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [dx, dy] of neighbors) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (labels[ni] >= 0 || (data[ni * ch + 3] ?? 0) < 12) continue;
          labels[ni] = id;
          stack[top] = ni;
          top += 1;
        }
      }
      components.push({
        id,
        area,
        cx: Math.round(sumX / area),
        minX,
        maxX,
        minY,
        maxY,
      });
    }
  }
  return { labels, components };
}

function measureRegion(labels, w, region) {
  let area = 0;
  let sumX = 0;
  let minX = region.maxX;
  let maxX = region.minX;
  let minY = region.maxY;
  let maxY = region.minY;
  for (let y = region.minY; y <= region.maxY; y += 1) {
    for (let x = region.minX; x <= region.maxX; x += 1) {
      if (labels[y * w + x] !== region.id) continue;
      area += 1;
      sumX += x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { ...region, area, cx: area ? Math.round(sumX / area) : region.cx, minX, maxX, minY, maxY };
}

/** Cari celah vertikal paling kosong untuk memisahkan dua pose yang saling menempel. */
function findSplitX(labels, w, region) {
  const span = region.maxX - region.minX + 1;
  const counts = new Int32Array(span);
  for (let y = region.minY; y <= region.maxY; y += 1) {
    for (let x = region.minX; x <= region.maxX; x += 1) {
      if (labels[y * w + x] === region.id) counts[x - region.minX] += 1;
    }
  }
  const lo = Math.floor(region.minX + span * 0.3);
  const hi = Math.ceil(region.minX + span * 0.7);
  const center = (lo + hi) / 2;
  let bestX = Math.round(center);
  let bestCount = Number.POSITIVE_INFINITY;
  for (let x = lo; x <= hi; x += 1) {
    const count = counts[x - region.minX] ?? 0;
    if (count < bestCount || (count === bestCount && Math.abs(x - center) < Math.abs(bestX - center))) {
      bestCount = count;
      bestX = x;
    }
  }
  return bestX;
}

async function frameCell(pngBuffer, cropW, cropH) {
  const scale = Math.min((CELL - 8) / cropW, (CELL - 12) / cropH);
  const targetW = Math.max(1, Math.round(cropW * scale));
  const targetH = Math.max(1, Math.round(cropH * scale));
  const resized = await sharp(pngBuffer)
    .resize(targetW, targetH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: CELL,
      height: CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: resized,
        left: Math.round((CELL - targetW) / 2),
        top: Math.round(ANCHOR_Y - targetH),
      },
    ])
    .png()
    .toBuffer();
}

/** Ambil 5 pose utama dari satu move sheet, buang komponen kecil mengambang. */
async function extractMoveFrames(fileName) {
  const { data, w, h, ch } = await loadCleanPixels(path.join(RAW_DIR, fileName));
  const { labels, components } = labelComponents(data, w, h, ch);
  if (!components.length) throw new Error(`Tidak ada subjek terdeteksi di ${fileName}`);

  const maxArea = Math.max(...components.map((component) => component.area));
  // Artifact mengambang jauh lebih kecil dari pose utama; ambang ini membuangnya.
  const minArea = maxArea * 0.22;
  let regions = components
    .filter((component) => component.area >= minArea)
    .map((component) => ({ ...component }));

  if (regions.length > 5) {
    regions = regions.sort((a, b) => b.area - a.area).slice(0, 5);
  }

  // Sebagian sheet punya dua pose yang saling menempel (mis. emak-daster),
  // jadi pecah komponen terbesar sampai terkumpul 5 region pose.
  let guard = 0;
  while (regions.length < 5 && guard < 8) {
    guard += 1;
    const largest = [...regions].sort((a, b) => b.area - a.area)[0];
    const cut = findSplitX(labels, w, largest);
    if (cut <= largest.minX || cut >= largest.maxX) break;
    const left = measureRegion(labels, w, { ...largest, maxX: cut });
    const right = measureRegion(labels, w, { ...largest, minX: cut + 1 });
    regions = [...regions.filter((region) => region !== largest), left, right];
  }

  if (regions.length !== 5) {
    throw new Error(`${fileName}: dapat ${regions.length} pose, harusnya 5`);
  }
  regions.sort((a, b) => a.cx - b.cx);

  const frames = [];
  for (const region of regions) {
    const measured = measureRegion(labels, w, region);
    const cropW = measured.maxX - measured.minX + 1;
    const cropH = measured.maxY - measured.minY + 1;
    const raw = Buffer.alloc(cropW * cropH * 4);
    for (let y = measured.minY; y <= measured.maxY; y += 1) {
      for (let x = measured.minX; x <= measured.maxX; x += 1) {
        if (labels[y * w + x] !== region.id) continue;
        const src = (y * w + x) * ch;
        const dst = ((y - measured.minY) * cropW + (x - measured.minX)) * 4;
        raw[dst] = data[src] ?? 0;
        raw[dst + 1] = data[src + 1] ?? 0;
        raw[dst + 2] = data[src + 2] ?? 0;
        raw[dst + 3] = data[src + 3] ?? 0;
      }
    }
    const png = await sharp(raw, { raw: { width: cropW, height: cropH, channels: 4 } })
      .png()
      .toBuffer();
    frames.push(await frameCell(png, cropW, cropH));
  }
  return frames;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const framesByHero = new Map();
  for (const source of MOVE_SOURCES) {
    const frames = await extractMoveFrames(source.file);
    if (frames.length !== 5) {
      throw new Error(`${source.heroId}: ekstraksi gagal, dapat ${frames.length} pose`);
    }
    framesByHero.set(source.heroId, frames);
    console.log(`Sprite ${source.heroId}: 5 pose dari ${source.file}`);
  }

  const frames = [];
  const frameLayout = {};
  const animation = {};
  let cursor = 0;

  for (const source of MOVE_SOURCES) {
    const poseFrames = framesByHero.get(source.heroId);
    for (const state of STATES) {
      const row = POSE_ROWS[state.name];
      const key = `${source.heroId}:${state.name}`;
      const rects = [];
      for (let i = 0; i < row.frames.length; i += 1) {
        const png = poseFrames[row.frames[i] ?? 0];
        frames.push({ input: png, left: (cursor % 8) * CELL, top: Math.floor(cursor / 8) * CELL });
        rects.push({
          index: i,
          x: (cursor % 8) * CELL,
          y: Math.floor(cursor / 8) * CELL,
          w: CELL,
          h: CELL,
        });
        cursor += 1;
      }
      frameLayout[key] = {
        label: `${source.heroId} ${state.name}`,
        source: `client/raw_assets/${source.file}`,
        frames: rects,
      };
      animation[key] = {
        fps: row.fps,
        loop: row.loop,
        durationMs: Math.round((row.frames.length / row.fps) * 1000),
      };
    }
  }

  const columns = 8;
  const rows = Math.ceil(cursor / columns);
  await sharp({
    create: {
      width: columns * CELL,
      height: rows * CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(frames)
    .png()
    .toFile(path.join(OUT_DIR, 'hero-atlas.png'));

  const manifest = {
    version: 1,
    generator: 'scripts/generate-character-sprites.mjs',
    image: 'hero-atlas.png',
    sheetWidth: columns * CELL,
    sheetHeight: rows * CELL,
    cell: { w: CELL, h: CELL, anchorX: ANCHOR_X, anchorY: ANCHOR_Y },
    frame_layout: { rows: frameLayout },
    animation: { rows: animation },
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Sprite karakter siap: ${columns * CELL}x${rows * CELL}, ${cursor} frame, ${MOVE_SOURCES.length} hero`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
