/**
 * Generator atlas VFX skill tanpa model gambar eksternal.
 *
 * Setiap efek digambar sebagai 8 frame SVG vektor, dirender dengan sharp menjadi
 * PNG transparan, lalu disusun menjadi satu sprite sheet + manifest.json dengan
 * kontrak frame_layout ala sprite-gen:
 *
 *   client/public/assets/effects/skills/skill-atlas.png
 *   client/public/assets/effects/skills/manifest.json
 *
 * Jalankan: npm run assets:skills
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const FRAME = 128;
const FRAMES = 8;
const OUT_DIR = path.resolve('client/public/assets/effects/skills');
const TAU = Math.PI * 2;

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const n = (value) => Number(value.toFixed(2));

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME}" height="${FRAME}" viewBox="0 0 ${FRAME} ${FRAME}">
<defs>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="3.2" result="blur" />
    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
  </filter>
  <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="1.4" />
  </filter>
</defs>
${body}
</svg>`;
}

function sparkles({ cx, cy, count, radius, color, seed, t, size = 1.8 }) {
  const random = rng(seed);
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const angle = random() * TAU;
    const distance = radius * (0.35 + random() * 0.65) * (0.45 + t * 0.85);
    const x = n(cx + Math.cos(angle) * distance);
    const y = n(cy + Math.sin(angle) * distance);
    const r = n(size * (0.5 + random() * 0.9));
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${n(0.45 + random() * 0.55)}" />`;
  }
  return out;
}

function star(cx, cy, outer, inner, points, fill, stroke) {
  const vertices = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    vertices.push(`${n(cx + Math.cos(angle) * radius)},${n(cy + Math.sin(angle) * radius)}`);
  }
  return `<polygon points="${vertices.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" />`;
}

function arcPath(cx, cy, radius, from, to) {
  const x1 = n(cx + Math.cos(from) * radius);
  const y1 = n(cy + Math.sin(from) * radius);
  const x2 = n(cx + Math.cos(to) * radius);
  const y2 = n(cy + Math.sin(to) * radius);
  const large = Math.abs(to - from) > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${n(radius)} ${n(radius)} 0 ${large} 1 ${x2} ${y2}`;
}

/* ------------------------------------------------------------------ effects */

function pecutKilat(t) {
  const pulse = Math.sin(t * Math.PI);
  const span = 12 + t * 42;
  const startX = n(64 - span * 0.55);
  const endX = n(64 + span * 0.55);
  const startY = n(92 - t * 6);
  const endY = n(54 - t * 10);
  const path = `M ${startX} ${startY} Q 64 ${n(38 - t * 8)} ${endX} ${endY}`;
  const bolt = `M ${n(endX - 14)} ${n(endY + 6)} L ${n(endX - 4)} ${n(endY - 2)} L ${n(endX - 9)} ${n(endY - 3)} L ${n(endX + 2)} ${n(endY - 13)}`;
  return svg(`
    <path d="${path}" fill="none" stroke="#4a121a" stroke-width="13" stroke-linecap="round" opacity="${n(0.55 + pulse * 0.45)}" />
    <path d="${path}" fill="none" stroke="#e63946" stroke-width="8" stroke-linecap="round" />
    <path d="${path}" fill="none" stroke="#ffc2c6" stroke-width="2.4" stroke-linecap="round" opacity="${n(0.5 + pulse * 0.5)}" />
    <path d="${bolt}" fill="none" stroke="#5b3a00" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" filter="url(#glow)" />
    <path d="${bolt}" fill="none" stroke="#fff176" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
    ${sparkles({ cx: endX, cy: endY, count: 10, radius: 10 + pulse * 12, color: '#fff59d', seed: 11, t, size: 2 })}
    ${sparkles({ cx: endX, cy: endY, count: 5, radius: 6 + pulse * 8, color: '#ff8a80', seed: 23, t, size: 1.5 })}
  `);
}

function tornadoSarung(t) {
  const spin = t * 320;
  const grow = 1 + t * 0.5;
  let ribbons = '';
  for (let i = 0; i < 4; i += 1) {
    const angle = n(spin + i * 90);
    const width = n((11 + i * 5) * grow);
    const height = n(6 + i * 2);
    ribbons += `<g transform="rotate(${angle} 64 64)"><ellipse cx="64" cy="${n(64 + i * 3)}" rx="${width}" ry="${height}" fill="none" stroke="#4a121a" stroke-width="${n(5 - i * 0.6)}" opacity="0.9" /><ellipse cx="64" cy="${n(64 + i * 3)}" rx="${width}" ry="${height}" fill="none" stroke="${i % 2 ? '#ef5350' : '#e63946'}" stroke-width="${n(3 - i * 0.35)}" /></g>`;
  }
  return svg(`
    ${sparkles({ cx: 64, cy: 96, count: 14, radius: 26, color: '#d7ccc8', seed: 31, t, size: 3 })}
    ${ribbons}
    <path d="${arcPath(64, 64, 30 * grow, -0.6, 2.2)}" fill="none" stroke="#ffd54f" stroke-width="2.5" stroke-linecap="round" filter="url(#glow)" opacity="${n(0.6 + Math.sin(t * Math.PI) * 0.4)}" />
    ${sparkles({ cx: 64, cy: 64, count: 12, radius: 18 + t * 16, color: '#ffe082', seed: 47, t, size: 2 })}
  `);
}

function gebukPanci(t) {
  const drop = n(10 + t * 46);
  const impact = t > 0.45 ? (t - 0.45) / 0.55 : 0;
  const streakOpacity = n(1 - t * 0.7);
  return svg(`
    <g opacity="${streakOpacity}">
      <line x1="42" y1="4" x2="42" y2="${n(drop - 12)}" stroke="#90a4ae" stroke-width="3" stroke-linecap="round" />
      <line x1="64" y1="0" x2="64" y2="${n(drop - 14)}" stroke="#b0bec5" stroke-width="4" stroke-linecap="round" />
      <line x1="86" y1="4" x2="86" y2="${n(drop - 12)}" stroke="#90a4ae" stroke-width="3" stroke-linecap="round" />
    </g>
    <ellipse cx="64" cy="${drop}" rx="31" ry="11" fill="#37474f" />
    <ellipse cx="64" cy="${n(drop - 2)}" rx="29" ry="9" fill="#cfd8dc" stroke="#607d8b" stroke-width="2" />
    <ellipse cx="64" cy="${n(drop - 3)}" rx="19" ry="5" fill="none" stroke="#90a4ae" stroke-width="2" />
    <circle cx="64" cy="${n(drop - 8)}" r="5" fill="#78909c" stroke="#37474f" stroke-width="2" />
    ${impact > 0 ? star(64, 92, 20 + impact * 18, 9 + impact * 6, 8, '#fff176', '#8d6e63') : ''}
    ${sparkles({ cx: 64, cy: 92, count: 12, radius: 8 + t * 22, color: '#ffcc80', seed: 59, t, size: 2.4 })}
  `);
}

function kentongan(t) {
  const wave = t * 46;
  let rings = '';
  for (let i = 0; i < 3; i += 1) {
    const radius = n(12 + wave + i * 12);
    rings += `<circle cx="64" cy="62" r="${radius}" fill="none" stroke="${i === 0 ? '#80deea' : '#2a9d8f'}" stroke-width="${n(4 - i)}" opacity="${n(0.85 - i * 0.22)}" />`;
  }
  return svg(`
    ${rings}
    <g transform="translate(0 ${n(-2 + Math.sin(t * Math.PI * 2) * 2)})">
      <rect x="36" y="52" width="56" height="20" rx="7" fill="#3e2723" />
      <rect x="38" y="50" width="52" height="18" rx="6" fill="#a1887f" stroke="#5d4037" stroke-width="2.5" />
      <rect x="48" y="56" width="32" height="4" rx="2" fill="#3e2723" />
      <circle cx="44" cy="59" r="2" fill="#ffd54f" />
      <circle cx="84" cy="59" r="2" fill="#ffd54f" />
    </g>
    <path d="M 30 42 L 38 34 L 34 32 L 46 24" fill="none" stroke="#26c6da" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${n(1 - t * 0.5)}" />
    <path d="M 98 42 L 90 34 L 94 32 L 82 24" fill="none" stroke="#26c6da" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${n(1 - t * 0.5)}" />
    ${sparkles({ cx: 64, cy: 62, count: 10, radius: 14 + t * 20, color: '#b2ebf2', seed: 67, t, size: 2 })}
  `);
}

function rentenganMercon(t) {
  let bombs = '';
  for (let i = 0; i < 4; i += 1) {
    const x = n(24 + i * 17 + t * 26);
    const y = n(66 + Math.sin(i * 1.4 + t * 5) * 8);
    bombs += `<g transform="rotate(${n(i * 18 + t * 40)} ${x} ${y})">
      <rect x="${n(x - 6)}" y="${n(y - 8)}" width="12" height="16" rx="3" fill="#b71c1c" stroke="#5d1010" stroke-width="2" />
      <rect x="${n(x - 6)}" y="${n(y - 3)}" width="12" height="3" fill="#ffd54f" />
      <line x1="${n(x + 2)}" y1="${n(y - 8)}" x2="${n(x + 8)}" y2="${n(y - 14)}" stroke="#8d6e63" stroke-width="2" />
      <circle cx="${n(x + 8)}" cy="${n(y - 14)}" r="2.5" fill="#fff59d" filter="url(#glow)" />
    </g>`;
  }
  return svg(`
    <path d="M 16 74 Q 42 ${n(84 - t * 12)} ${n(100 + t * 12)} ${n(58 - t * 8)}" fill="none" stroke="#4e342e" stroke-width="2" stroke-dasharray="4 5" opacity="0.8" />
    ${bombs}
    ${sparkles({ cx: 96, cy: 58, count: 9, radius: 6 + t * 16, color: '#ffab40', seed: 71, t, size: 2 })}
  `);
}

function meriamBambu(t) {
  const flash = Math.sin(t * Math.PI);
  const smoke = t * 20;
  return svg(`
    <g transform="rotate(-16 64 74)">
      <rect x="20" y="64" width="66" height="19" rx="6" fill="#2e7d32" stroke="#1b5e20" stroke-width="3" />
      <rect x="22" y="66" width="62" height="5" rx="2" fill="#81c784" opacity="0.8" />
      <line x1="38" y1="64" x2="38" y2="83" stroke="#1b5e20" stroke-width="3" />
      <line x1="56" y1="64" x2="56" y2="83" stroke="#1b5e20" stroke-width="3" />
      <line x1="74" y1="64" x2="74" y2="83" stroke="#1b5e20" stroke-width="3" />
      <ellipse cx="86" cy="73.5" rx="6" ry="10" fill="#20351f" stroke="#1b5e20" stroke-width="2" />
    </g>
    ${star(94, 58, 12 + flash * 24, 5 + flash * 8, 9, '#fff59d', '#f57f17')}
    <circle cx="96" cy="57" r="${n(8 + flash * 12)}" fill="#ffab40" opacity="0.55" filter="url(#soft)" />
    ${sparkles({ cx: 96, cy: 57, count: 14, radius: 10 + t * 26, color: '#ffe082', seed: 83, t, size: 3 })}
    <circle cx="${n(88 + smoke)}" cy="${n(56 + t * 8)}" r="${n(7 + t * 9)}" fill="#e0e0e0" opacity="${n(0.5 - t * 0.25)}" />
    <circle cx="${n(94 + smoke)}" cy="${n(48 + t * 6)}" r="${n(5 + t * 7)}" fill="#bdbdbd" opacity="${n(0.45 - t * 0.2)}" />
  `);
}

function sapuDaster(t) {
  const sweep = -0.7 + t * 1.4;
  const pulse = Math.sin(t * Math.PI);
  return svg(`
    <path d="${arcPath(64, 70, 20 + t * 18, -1.1, 0.9)}" fill="none" stroke="#9d4edd" stroke-width="${n(8 + pulse * 5)}" stroke-linecap="round" opacity="0.9" />
    <path d="${arcPath(64, 70, 26 + t * 16, -0.7, 1.1)}" fill="none" stroke="#e0aaff" stroke-width="3" stroke-linecap="round" opacity="0.85" />
    <g transform="rotate(${n(sweep * 45)} 64 74)">
      <line x1="42" y1="92" x2="76" y2="52" stroke="#6d4c41" stroke-width="5" stroke-linecap="round" />
      <path d="M 76 52 L 88 44 L 92 56 L 80 62 Z" fill="#cddc39" stroke="#827717" stroke-width="2" />
      <line x1="78" y1="54" x2="94" y2="48" stroke="#827717" stroke-width="1.6" />
      <line x1="80" y1="57" x2="95" y2="53" stroke="#827717" stroke-width="1.6" />
      <line x1="82" y1="60" x2="96" y2="58" stroke="#827717" stroke-width="1.6" />
    </g>
    ${sparkles({ cx: 62, cy: 88, count: 12, radius: 10 + t * 22, color: '#d8b4fe', seed: 97, t, size: 2.6 })}
  `);
}

function badaiDapur(t) {
  const spin = t * 360;
  const grow = 1 + t * 0.45;
  let swirls = '';
  for (let i = 0; i < 4; i += 1) {
    const angle = n(spin + i * 90);
    const width = n((12 + i * 5) * grow);
    swirls += `<g transform="rotate(${angle} 64 62)"><ellipse cx="64" cy="${n(62 + i * 2)}" rx="${width}" ry="${n(6 + i * 2)}" fill="none" stroke="${i % 2 ? '#c77dff' : '#9d4edd'}" stroke-width="${n(4 - i * 0.4)}" /></g>`;
  }
  const tools = [0, 1, 2].map((i) => {
    const angle = n(spin * 0.8 + i * 120);
    return `<g transform="rotate(${angle} 64 62)"><circle cx="64" cy="${n(62 - 24 - i * 4)}" r="4" fill="#ffe082" stroke="#6d4c41" stroke-width="1.8" /><line x1="64" y1="${n(62 - 20 - i * 4)}" x2="64" y2="${n(62 - 12 - i * 4)}" stroke="#b0bec5" stroke-width="2.5" /></g>`;
  }).join('');
  return svg(`
    ${sparkles({ cx: 64, cy: 98, count: 14, radius: 26, color: '#e8d0f5', seed: 101, t, size: 3 })}
    ${swirls}
    ${tools}
    <path d="${arcPath(64, 62, 32 * grow, -0.4, 2.4)}" fill="none" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round" filter="url(#glow)" opacity="${n(0.5 + Math.sin(t * Math.PI) * 0.5)}" />
    ${sparkles({ cx: 64, cy: 62, count: 12, radius: 18 + t * 18, color: '#f3d7ff', seed: 113, t, size: 2 })}
  `);
}

const EFFECTS = [
  { key: 'bocil_sarung:skill1', label: 'Pecut Kilat', fps: 16, draw: pecutKilat },
  { key: 'bocil_sarung:ultimate', label: 'Tornado Sarung', fps: 12, draw: tornadoSarung },
  { key: 'abang_ronda:skill1', label: 'Gebuk Tutup Panci', fps: 14, draw: gebukPanci },
  { key: 'abang_ronda:ultimate', label: 'Kentongan Tanda Bahaya', fps: 12, draw: kentongan },
  { key: 'tukang_lodong:skill1', label: 'Rentengan Mercon Korek', fps: 16, draw: rentenganMercon },
  { key: 'tukang_lodong:ultimate', label: 'Meriam Bambu Karbit Raksasa', fps: 14, draw: meriamBambu },
  { key: 'emak_daster:skill1', label: 'Sapu Daster', fps: 16, draw: sapuDaster },
  { key: 'emak_daster:ultimate', label: 'Daster Badai Dapur', fps: 12, draw: badaiDapur },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const sheetWidth = FRAME * FRAMES;
  const sheetHeight = FRAME * EFFECTS.length;
  const composites = [];
  const rows = {};

  for (let rowIndex = 0; rowIndex < EFFECTS.length; rowIndex += 1) {
    const effect = EFFECTS[rowIndex];
    const frames = [];
    for (let frameIndex = 0; frameIndex < FRAMES; frameIndex += 1) {
      const t = frameIndex / (FRAMES - 1);
      const png = await sharp(Buffer.from(effect.draw(t))).png().toBuffer();
      const y = rowIndex * FRAME;
      const x = frameIndex * FRAME;
      composites.push({ input: png, left: x, top: y });
      frames.push({ index: frameIndex, x, y, w: FRAME, h: FRAME });
    }
    rows[effect.key] = {
      label: effect.label,
      fps: effect.fps,
      loop: false,
      durationMs: Math.round((FRAMES / effect.fps) * 1000),
      frames,
    };
    console.log(`  ${effect.key}: ${frames.length} frame`);
  }

  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png()
    .toFile(path.join(OUT_DIR, 'skill-atlas.png'));

  const manifest = {
    version: 1,
    generator: 'scripts/generate-skill-atlas.mjs',
    image: 'skill-atlas.png',
    sheetWidth,
    sheetHeight,
    frameWidth: FRAME,
    frameHeight: FRAME,
    frame_layout: { rows },
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Atlas siap: ${sheetWidth}x${sheetHeight}, ${EFFECTS.length} efek, ${FRAMES} frame/efek`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
