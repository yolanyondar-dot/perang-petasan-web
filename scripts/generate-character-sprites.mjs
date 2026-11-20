/**
 * Generator sprite sheet karakter fighting 4 hero beta (SVG vektor -> PNG via sharp).
 *
 * Konvensi docs/sprite-pipeline.md + docs/sprite-runtime.md:
 * - satu base per karakter, semua state memakai proporsi/palet yang sama
 * - menghadap kanan, anchor di kaki, kaki di satu garis
 * - idle/walk/jump/attack/cast/hurt/down
 * - manifest.frame_layout + manifest.animation, sel 128x128
 *
 * Jalankan: npm run assets:characters
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Sumber nyata 5 pose bocil (dibaca dari raw_assets, bukan digambar ulang). */
const BOCIL_SOURCE = path.resolve('client/raw_assets/bocil-sarung-move.jpg');
const BOCIL_SEGMENTS = [
  [182, 492],
  [595, 1088],
  [1202, 1565],
  [1621, 2063],
  [2090, 2682],
];
const BOCIL_CONTENT_BOTTOM = 1180;

const CELL = 128;
const ANCHOR_X = 64;
const ANCHOR_Y = 116;
const OUT_DIR = path.resolve('client/public/assets/characters/sprites');

const HEROES = [
  {
    id: 'bocil_sarung',
    skin: '#ffd166',
    cloth: '#e63946',
    dark: '#a31621',
    accent: '#ffd54f',
    hair: '#3e2723',
    prop: 'sarung',
  },
  {
    id: 'abang_ronda',
    skin: '#ffcc80',
    cloth: '#2a9d8f',
    dark: '#1d6f66',
    accent: '#ffd54f',
    hair: '#263238',
    prop: 'panci',
  },
  {
    id: 'tukang_lodong',
    skin: '#ffb74d',
    cloth: '#2e7d32',
    dark: '#1b5e20',
    accent: '#ffee58',
    hair: '#4e342e',
    prop: 'lodong',
  },
  {
    id: 'emak_daster',
    skin: '#ffd1a9',
    cloth: '#9d4edd',
    dark: '#6a1b9a',
    accent: '#f3d7ff',
    hair: '#4a148c',
    prop: 'sapu',
  },
];

const STATES = [
  { name: 'idle', frames: 4, fps: 5, loop: true },
  { name: 'walk', frames: 6, fps: 10, loop: true },
  { name: 'jump', frames: 4, fps: 8, loop: false },
  { name: 'attack', frames: 4, fps: 12, loop: false },
  { name: 'cast', frames: 4, fps: 10, loop: false },
  { name: 'hurt', frames: 4, fps: 12, loop: false },
  { name: 'down', frames: 4, fps: 8, loop: false },
  { name: 'ultimate', frames: 4, fps: 8, loop: false },
];

const n = (value) => Number(value.toFixed(2));

function outline(color = '#2b2118', width = 2.6) {
  return `stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;
}

/** Garis anggota tubuh: dark outline di bawah, warna utama di atas. */
function limb(x1, y1, x2, y2, color, width = 6) {
  const coords = `x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"`;
  return `<line ${coords} stroke="#2b2118" stroke-width="${n(width + 2)}" stroke-linecap="round" />
      <line ${coords} stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" />`;
}

function prop(hero, x, y, angle) {
  const g = `<g transform="rotate(${n(angle)} ${n(x)} ${n(y)})">`;
  if (hero.prop === 'panci') {
    return `${g}
      <circle cx="${n(x)}" cy="${n(y)}" r="11" fill="#cfd8dc" ${outline('#546e7a', 2.4)} />
      <circle cx="${n(x)}" cy="${n(y)}" r="5" fill="none" stroke="#90a4ae" stroke-width="2" />
      <circle cx="${n(x)}" cy="${n(y - 13)}" r="3.5" fill="#607d8b" ${outline('#37474f', 1.8)} />
    </g>`;
  }
  if (hero.prop === 'lodong') {
    return `${g}
      <rect x="${n(x - 5)}" y="${n(y - 14)}" width="10" height="28" rx="3" fill="#8d6e63" ${outline('#4e342e', 2)} />
      <line x1="${n(x - 5)}" y1="${n(y - 4)}" x2="${n(x + 5)}" y2="${n(y - 4)}" stroke="#4e342e" stroke-width="1.6" />
      <line x1="${n(x - 5)}" y1="${n(y + 5)}" x2="${n(x + 5)}" y2="${n(y + 5)}" stroke="#4e342e" stroke-width="1.6" />
      <circle cx="${n(x + 2)}" cy="${n(y - 16)}" r="3" fill="${hero.accent}" />
    </g>`;
  }
  if (hero.prop === 'sapu') {
    return `${g}
      <line x1="${n(x)}" y1="${n(y - 20)}" x2="${n(x)}" y2="${n(y + 12)}" stroke="#6d4c41" stroke-width="4" stroke-linecap="round" />
      <path d="M ${n(x - 9)} ${n(y + 10)} L ${n(x + 9)} ${n(y + 10)} L ${n(x + 6)} ${n(y + 20)} L ${n(x - 6)} ${n(y + 20)} Z" fill="#cddc39" ${outline('#827717', 2)} />
      <line x1="${n(x - 4)}" y1="${n(y + 12)}" x2="${n(x - 5)}" y2="${n(y + 19)}" stroke="#827717" stroke-width="1.4" />
      <line x1="${n(x + 4)}" y1="${n(y + 12)}" x2="${n(x + 5)}" y2="${n(y + 19)}" stroke="#827717" stroke-width="1.4" />
    </g>`;
  }
  return `${g}
    <path d="M ${n(x - 10)} ${n(y - 8)} Q ${n(x + 12)} ${n(y - 14)} ${n(x + 16)} ${n(y + 14)} L ${n(x + 4)} ${n(y + 22)} Q ${n(x - 2)} ${n(y)} ${n(x - 10)} ${n(y - 8)} Z" fill="${hero.dark}" ${outline('#5d1010', 2)} />
    <path d="M ${n(x - 6)} ${n(y - 6)} Q ${n(x + 8)} ${n(y - 8)} ${n(x + 11)} ${n(y + 10)}" fill="none" stroke="${hero.cloth}" stroke-width="3" />
  </g>`;
}

function standingFighter(hero, pose) {
  const bob = pose.bob ?? 0;
  const lean = pose.lean ?? 0;
  const front = pose.front ?? 0;
  const back = pose.back ?? 0;
  const arm = pose.arm ?? 0;
  const headTilt = pose.headTilt ?? 0;
  const dx = pose.dx ?? 0;
  const glow = pose.glow ?? 0;

  const hipY = 100 + bob;
  const headY = 60 + bob;
  const torsoTop = 72 + bob;

  return `<g transform="translate(${n(dx)} 0)">
    ${glow ? `<circle cx="70" cy="${n(headY + 4)}" r="${n(24 + glow * 10)}" fill="${hero.accent}" opacity="${n(0.15 + glow * 0.2)}" />` : ''}
    <g transform="rotate(${n(lean)} 64 ${n(hipY)})">
      ${limb(59, hipY, 59 + back * 0.45, 115, hero.dark, 6)}
      ${limb(69, hipY, 69 + front * 0.55, 115, hero.cloth, 6)}
      <ellipse cx="${n(59 + back * 0.45)}" cy="115" rx="8" ry="4" fill="#3e2723" />
      <ellipse cx="${n(69 + front * 0.55)}" cy="115" rx="8" ry="4" fill="#3e2723" />

      <path d="M 50 ${n(torsoTop)} L 78 ${n(torsoTop)} L 82 ${n(hipY + 6)} L 46 ${n(hipY + 6)} Z" fill="${hero.cloth}" ${outline()} />
      <path d="M 48 ${n(hipY - 2)} Q 64 ${n(hipY + 10)} 80 ${n(hipY - 2)} L 82 ${n(hipY + 8)} L 46 ${n(hipY + 8)} Z" fill="${hero.dark}" ${outline()} />
      <rect x="52" y="${n(torsoTop + 4)}" width="24" height="7" rx="3" fill="${hero.accent}" opacity="0.85" />

      ${limb(52, torsoTop + 6, 46 - arm * 0.35, torsoTop + 24 - arm * 0.2, hero.skin, 6)}
      ${prop(hero, 91 + arm * 0.5, torsoTop + 22 - arm * 0.35, arm)}
      ${limb(76, torsoTop + 8, 84 + arm * 0.35, torsoTop + 22 - arm * 0.25, hero.skin, 6)}

      <g transform="rotate(${n(headTilt)} 64 ${n(headY)})">
        <circle cx="64" cy="${n(headY)}" r="17" fill="${hero.skin}" ${outline()} />
        <path d="M 47 ${n(headY - 4)} Q 64 ${n(headY - 26)} 81 ${n(headY - 4)} Q 72 ${n(headY - 12)} 64 ${n(headY - 11)} Q 55 ${n(headY - 12)} 47 ${n(headY - 4)} Z" fill="${hero.hair}" stroke="#2b2118" stroke-width="2" />
        <circle cx="70" cy="${n(headY + 1)}" r="2.2" fill="#1f2937" />
        <circle cx="77" cy="${n(headY + 1)}" r="1.6" fill="#1f2937" />
        <path d="M 68 ${n(headY + 9)} q 5 3 9 -1" fill="none" stroke="#8d4b3c" stroke-width="2" stroke-linecap="round" />
      </g>
    </g>
  </g>`;
}

function lyingFighter(hero, frame) {
  const rise = [0, -6, 2, 0][frame] ?? 0;
  return `<g>
    <ellipse cx="64" cy="112" rx="32" ry="6" fill="rgba(0,0,0,0.12)" />
    <g transform="translate(0 ${n(rise)})">
      ${limb(56, 98, 34, 104, hero.dark, 7)}
      ${limb(58, 104, 32, 112, hero.cloth, 7)}
      <path d="M 48 84 L 78 84 L 90 104 L 46 106 Z" fill="${hero.cloth}" ${outline()} />
      <path d="M 46 100 Q 66 110 88 100 L 90 106 L 46 108 Z" fill="${hero.dark}" ${outline()} />
      ${limb(78, 88, 96, 80, hero.skin, 6)}
      ${prop(hero, 100, 78, -70)}
      <g transform="rotate(-72 40 88)">
        <circle cx="40" cy="88" r="16" fill="${hero.skin}" ${outline()} />
        <path d="M 24 84 Q 40 62 56 84 Q 47 74 40 75 Q 31 74 24 84 Z" fill="${hero.hair}" stroke="#2b2118" stroke-width="2" />
        <circle cx="47" cy="89" r="2" fill="#1f2937" />
        <path d="M 44 97 q 4 2 7 -1" fill="none" stroke="#8d4b3c" stroke-width="2" />
      </g>
    </g>
  </g>`;
}

function poseFor(state, frame, frames) {
  const t = frames > 1 ? frame / (frames - 1) : 0;
  if (state === 'idle') return { bob: Math.sin(t * Math.PI * 2) * 1.2, arm: Math.sin(t * Math.PI * 2) * 3 };
  if (state === 'walk') {
    const cycle = (frame / frames) * Math.PI * 2;
    return {
      front: Math.sin(cycle) * 9,
      back: -Math.sin(cycle) * 9,
      bob: Math.abs(Math.sin(cycle)) * 1.5,
      arm: -Math.sin(cycle) * 11,
      lean: 2,
    };
  }
  if (state === 'jump') {
    const poses = [
      { bob: 4, lean: -3 },
      { bob: -6, front: 6, back: -5, arm: -18 },
      { bob: -13, front: 2, back: -2, arm: -28 },
      { bob: -4, front: -5, back: 7, arm: 12 },
    ];
    return poses[frame] ?? poses[0];
  }
  if (state === 'attack') {
    const poses = [
      { arm: -34, lean: -5 },
      { arm: 8, lean: 4, dx: 2 },
      { arm: 42, lean: 10, dx: 5 },
      { arm: 4, lean: 2, dx: 2 },
    ];
    return poses[frame] ?? poses[0];
  }
  if (state === 'cast') {
    const poses = [
      { arm: -18, glow: 0.2 },
      { arm: -34, glow: 0.7 },
      { arm: -46, glow: 1 },
      { arm: -30, glow: 0.5 },
    ];
    return poses[frame] ?? poses[0];
  }
  if (state === 'hurt') {
    const poses = [
      { headTilt: -18, lean: -12, dx: -6, arm: 24 },
      { headTilt: -12, lean: -8, dx: -9, arm: 14 },
      { headTilt: -6, lean: 6, dx: -7, bob: 5, arm: -4 },
      { headTilt: 0, lean: 0, dx: -2, arm: 0 },
    ];
    return poses[frame] ?? poses[0];
  }
  if (state === 'ultimate') {
    const poses = [
      { arm: -26, glow: 0.35, bob: 2 },
      { arm: -46, glow: 0.8, bob: 0 },
      { arm: -58, glow: 1, bob: -3, lean: -5 },
      { arm: -34, glow: 0.6, bob: 0, lean: 3 },
    ];
    return poses[frame] ?? poses[0];
  }
  return {};
}

function frameSvg(hero, state, frame, frames) {
  const body = state === 'down'
    ? lyingFighter(hero, frame)
    : standingFighter(hero, poseFor(state, frame, frames));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 ${CELL} ${CELL}">
    ${body}
  </svg>`;
}

/**
 * Ekstrak 5 pose horizontal dari foto sebagai sprite-gen-style run:
 * background near-white dibersihkan dengan flood-fill dari tepi, lalu crop ke alpha,
 * diskalakan seragam, dan diletakkan dengan anchor kaki di tengah sel.
 */
async function extractBocilFrames() {
  const source = await readFile(BOCIL_SOURCE);
  const meta = await sharp(source).metadata();
  const result = [];

  for (const [startX, endX] of BOCIL_SEGMENTS) {
    const left = Math.max(0, startX - 8);
    const right = Math.min(meta.width ?? 2752, endX + 9);
    const top = 0;
    const bottom = Math.min(meta.height ?? 1536, BOCIL_CONTENT_BOTTOM);
    const { data, info } = await sharp(source)
      .extract({ left, top, width: right - left, height: bottom - top })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const ch = info.channels;
    const bg = [data[0] ?? 250, data[1] ?? 250, data[2] ?? 250];
    const distance = (i) =>
      Math.hypot((data[i] ?? 0) - bg[0], (data[i + 1] ?? 0) - bg[1], (data[i + 2] ?? 0) - bg[2]);

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

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if ((data[(y * w + x) * ch + 3] ?? 0) < 12) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) continue;

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const crop = await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: ch } })
      .extract({ left: minX, top: minY, width: cropW, height: cropH })
      .png()
      .toBuffer();
    const scale = Math.min((CELL - 16) / cropW, (CELL - 24) / cropH);
    const targetW = Math.max(1, Math.round(cropW * scale));
    const targetH = Math.max(1, Math.round(cropH * scale));
    const resized = await sharp(crop)
      .resize(targetW, targetH, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    const cell = await sharp({
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
    result.push(cell);
  }
  return result;
}

/** Susunan state memakai 5 pose asli; urutan ini memberi gerakan tanpa menggambar ulang. */
const BOCIL_ROWS = {
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const bocilFrames = await extractBocilFrames();
  if (bocilFrames.length !== 5) {
    throw new Error(`Ekstraksi bocil gagal: dapat ${bocilFrames.length} pose, harusnya 5`);
  }

  const frames = [];
  const frameLayout = {};
  const animation = {};
  let cursor = 0;

  for (const hero of HEROES) {
    for (const state of STATES) {
      const key = `${hero.id}:${state.name}`;
      const rects = [];
      const row = hero.id === 'bocil_sarung' ? BOCIL_ROWS[state.name] : null;
      const frameCount = row ? row.frames.length : state.frames;
      for (let i = 0; i < frameCount; i += 1) {
        const png = row
          ? bocilFrames[row.frames[i] ?? 0]
          : await sharp(Buffer.from(frameSvg(hero, state.name, i, state.frames)))
              .png()
              .toBuffer();
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
        label: `${hero.id} ${state.name}`,
        source: row ? 'client/raw_assets/bocil-sarung-move.jpg' : 'svg-procedural',
        frames: rects,
      };
      animation[key] = row
        ? { fps: row.fps, loop: row.loop, durationMs: Math.round((frameCount / row.fps) * 1000) }
        : {
            fps: state.fps,
            loop: state.loop,
            durationMs: Math.round((state.frames / state.fps) * 1000),
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
  console.log(`Sprite karakter siap: ${columns * CELL}x${rows * CELL}, ${cursor} frame, ${HEROES.length} hero`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
