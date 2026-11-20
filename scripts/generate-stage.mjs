/**
 * Generator latar stage fighting satu layar (16:9) untuk Perang Petasan.
 *
 * Konvensi docs/stage-background.md:
 * - satu gambar utuh (langit + latar + lantai), kamera diam
 * - pita lantai tampak dari samping-agak-atas di ~75-90% tinggi gambar
 * - tengah layar lapang, landmark di sepertiga kiri/kanan
 *
 * Jalankan: npm run assets:stage
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const W = 1280;
const H = 720;
const OUT_DIR = path.resolve('client/public/assets/maps');
const GROUND_TOP = 520;
const GROUND_BOTTOM = 655;

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const n = (value) => Number(value.toFixed(1));

function cloud(cx, cy, scale, opacity) {
  return `<g opacity="${opacity}" transform="translate(${n(cx)} ${n(cy)}) scale(${n(scale)})">
    <ellipse cx="0" cy="0" rx="62" ry="23" fill="#ffffff" />
    <ellipse cx="-42" cy="8" rx="38" ry="17" fill="#ffffff" />
    <ellipse cx="44" cy="7" rx="42" ry="19" fill="#ffffff" />
    <ellipse cx="4" cy="-16" rx="36" ry="20" fill="#ffffff" />
  </g>`;
}

function house(x, baseY, w, h, wall, roof) {
  return `<g>
    <rect x="${n(x)}" y="${n(baseY - h)}" width="${n(w)}" height="${n(h)}" fill="${wall}" stroke="#4e342e" stroke-width="2" />
    <path d="M ${n(x - 8)} ${n(baseY - h)} L ${n(x + w / 2)} ${n(baseY - h - 34)} L ${n(x + w + 8)} ${n(baseY - h)} Z" fill="${roof}" stroke="#3e2723" stroke-width="2" />
    <rect x="${n(x + w * 0.22)}" y="${n(baseY - h * 0.62)}" width="${n(w * 0.2)}" height="${n(h * 0.24)}" fill="#ffe082" stroke="#6d4c41" stroke-width="2" />
    <rect x="${n(x + w * 0.58)}" y="${n(baseY - h * 0.62)}" width="${n(w * 0.2)}" height="${n(h * 0.24)}" fill="#ffe082" stroke="#6d4c41" stroke-width="2" />
    <rect x="${n(x + w * 0.4)}" y="${n(baseY - h * 0.34)}" width="${n(w * 0.2)}" height="${n(h * 0.34)}" fill="#5d4037" />
  </g>`;
}

function kios(x, baseY, w = 150) {
  const stripes = 8;
  let awning = '';
  for (let i = 0; i < stripes; i += 1) {
    awning += `<rect x="${n(x + (i * w) / stripes)}" y="${n(baseY - 104)}" width="${n(w / stripes)}" height="26" fill="${i % 2 === 0 ? '#e53935' : '#fff8e1'}" />`;
  }
  return `<g opacity="0.96">
    <rect x="${n(x + 8)}" y="${n(baseY - 82)}" width="10" height="82" fill="#6d4c41" />
    <rect x="${n(x + w - 18)}" y="${n(baseY - 82)}" width="10" height="82" fill="#6d4c41" />
    ${awning}
    <rect x="${n(x)}" y="${n(baseY - 46)}" width="${n(w)}" height="16" fill="#8d6e63" stroke="#5d4037" stroke-width="2" />
    <rect x="${n(x + 18)}" y="${n(baseY - 30)}" width="${n(w - 36)}" height="30" fill="#a1887f" opacity="0.85" />
  </g>`;
}

function posRonda(x, baseY) {
  return `<g opacity="0.95">
    <rect x="${n(x - 34)}" y="${n(baseY - 86)}" width="68" height="86" fill="#8d5524" stroke="#5d4037" stroke-width="3" />
    <path d="M ${n(x - 48)} ${n(baseY - 86)} L ${n(x)} ${n(baseY - 130)} L ${n(x + 48)} ${n(baseY - 86)} Z" fill="#6d4c41" stroke="#3e2723" stroke-width="3" />
    <rect x="${n(x - 20)}" y="${n(baseY - 66)}" width="40" height="26" fill="#263238" stroke="#5d4037" stroke-width="2" />
    <rect x="${n(x - 8)}" y="${n(baseY - 40)}" width="16" height="40" fill="#5d4037" />
    <circle cx="${n(x)}" cy="${n(baseY - 108)}" r="8" fill="#ffd54f" />
  </g>`;
}

function gapura(x, baseY) {
  return `<g opacity="0.97">
    <rect x="${n(x - 78)}" y="${n(baseY - 178)}" width="22" height="178" fill="#b71c1c" stroke="#7f0000" stroke-width="3" />
    <rect x="${n(x + 56)}" y="${n(baseY - 178)}" width="22" height="178" fill="#b71c1c" stroke="#7f0000" stroke-width="3" />
    <rect x="${n(x - 92)}" y="${n(baseY - 186)}" width="184" height="24" fill="#8d5524" stroke="#5d4037" stroke-width="3" />
    <path d="M ${n(x - 108)} ${n(baseY - 186)} L ${n(x)} ${n(baseY - 226)} L ${n(x + 108)} ${n(baseY - 186)} Z" fill="#6d4c41" stroke="#3e2723" stroke-width="3" />
    <rect x="${n(x - 54)}" y="${n(baseY - 166)}" width="108" height="28" rx="5" fill="#fff8e1" stroke="#b71c1c" stroke-width="3" />
    <path d="M ${n(x - 40)} ${n(baseY - 152)} h 80 M ${n(x - 30)} ${n(baseY - 144)} h 60" stroke="#b71c1c" stroke-width="4" stroke-linecap="round" />
  </g>`;
}

function stringLights() {
  const colors = ['#ffd54f', '#ef5350', '#4fc3f7', '#81c784'];
  let bulbs = '';
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const x = 40 + t * 1200;
    const y = 74 + Math.sin(t * Math.PI) * 34;
    bulbs += `<circle cx="${n(x)}" cy="${n(y)}" r="5" fill="${colors[i % colors.length]}" />`;
  }
  return `<g>
    <path d="M 40 74 Q 640 142 1240 74" fill="none" stroke="#5d4037" stroke-width="3" opacity="0.7" />
    ${bulbs}
  </g>`;
}

function floorDetails() {
  const random = rng(20261120);
  let details = '';
  for (let i = 0; i < 90; i += 1) {
    const x = n(random() * W);
    const y = n(GROUND_TOP + 18 + random() * (GROUND_BOTTOM - GROUND_TOP - 30));
    const r = n(1 + random() * 2.4);
    details += `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${n(r * 0.6)}" fill="${i % 3 === 0 ? '#6d4c41' : '#a1887f'}" opacity="${n(0.25 + random() * 0.35)}" />`;
  }
  let grass = '';
  for (let i = 0; i < 70; i += 1) {
    const x = n(random() * W);
    const top = random() > 0.5;
    const y = top ? GROUND_TOP - 2 : GROUND_BOTTOM + 2;
    const dir = top ? -1 : 1;
    grass += `<path d="M ${x} ${y} q ${n(3 + random() * 4)} ${n(dir * (8 + random() * 9))} ${n(6 + random() * 5)} ${n(dir * 2)}" fill="none" stroke="${top ? '#66bb6a' : '#4caf50'}" stroke-width="2" stroke-linecap="round" />`;
  }
  return `${details}${grass}`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#74c9ec" />
    <stop offset="0.52" stop-color="#bfe3ef" />
    <stop offset="0.82" stop-color="#ffd9a0" />
    <stop offset="1" stop-color="#f6b26b" />
  </linearGradient>
  <linearGradient id="dirt" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#c49a6c" />
    <stop offset="0.5" stop-color="#b0855b" />
    <stop offset="1" stop-color="#9c724b" />
  </linearGradient>
</defs>

<rect width="${W}" height="${H}" fill="url(#sky)" />
<circle cx="1070" cy="112" r="56" fill="#fff3c4" opacity="0.85" />
${cloud(190, 122, 1.05, 0.85)}
${cloud(560, 88, 0.75, 0.7)}
${cloud(890, 146, 0.95, 0.75)}

<path d="M 0 470 Q 180 372 360 452 T 760 436 T 1280 460 L 1280 ${GROUND_TOP} L 0 ${GROUND_TOP} Z" fill="#79a88a" opacity="0.75" />
<path d="M 0 500 Q 240 426 470 488 T 980 480 T 1280 496 L 1280 ${GROUND_TOP} L 0 ${GROUND_TOP} Z" fill="#4f8468" opacity="0.75" />

${house(96, 512, 120, 96, '#d7b899', '#6d4c41')}
${house(232, 512, 96, 80, '#c8ad8f', '#5d4037')}
${posRonda(170, 512)}
${kios(268, 516, 150)}

${house(1000, 512, 120, 96, '#d7b899', '#6d4c41')}
${gapura(1040, 520)}
${kios(1140, 516, 132)}

<rect x="0" y="${GROUND_TOP - 20}" width="${W}" height="22" fill="#66bb6a" />
<rect x="0" y="${GROUND_TOP - 20}" width="${W}" height="6" fill="#81c784" />
<path d="M 0 ${GROUND_TOP} L ${W} ${GROUND_TOP} L ${W} ${GROUND_BOTTOM} L 0 ${GROUND_BOTTOM} Z" fill="url(#dirt)" />
<path d="M 0 ${GROUND_TOP + 4} Q ${W / 2} ${GROUND_TOP - 4} ${W} ${GROUND_TOP + 4}" fill="none" stroke="#a1887f" stroke-width="3" opacity="0.6" />
${floorDetails()}
<rect x="0" y="${GROUND_BOTTOM}" width="${W}" height="16" fill="#5fa85f" />
<rect x="0" y="${GROUND_BOTTOM + 16}" width="${W}" height="${H - GROUND_BOTTOM - 16}" fill="#3f6f4a" opacity="0.95" />

${stringLights()}
</svg>`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, 'stage-kampung.png'));
  console.log(`Stage siap: ${W}x${H} → client/public/assets/maps/stage-kampung.png`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
