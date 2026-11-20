/**
 * Pipeline aset: raw JPG/PNG hasil desain -> PNG siap pakai renderer Canvas2D / HUD.
 *
 * - Menghapus latar putih dengan flood-fill dari tepi gambar supaya highlight
 *   putih di dalam objek tidak ikut hilang.
 * - Memotong weapons_sheet.jpg menjadi 5 ikon lewat deteksi komponen terhubung.
 * - Memproses 11 portrait hero baru dan sheet desain map + tower.
 * - Menulis seluruh PNG ke client/public/assets sesuai AGENTS.md.
 *
 * Jalankan: npm run assets:process
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'client', 'raw_assets');
const OUT = path.join(ROOT, 'client', 'public', 'assets');

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const WEAPON_NAMES = [
  'sarung_pecut',
  'sandal_jepit',
  'petasan_banting',
  'mercon_sreng',
  'meriam_bambu',
];

/** 11 hero dari raw asset terbaru. ID pertama sengaja kompatibel dengan save lama. */
const HERO_SOURCES = [
  ['bocil_sarung', 'Hero 1 Bocil Sarungan (Role Assassin  Rusher).jpg'],
  ['abang_ronda', 'Hero 2 Abang Ronda(Role Tank).jpg'],
  ['tukang_lodong', 'Hero 3 Master Lodong(Role Marksman).jpg'],
  ['emak_daster', 'Hero 4 Emak Daster(Support  Mage).jpg'],
  ['pendekar_silat', 'Hero 5 Pendekar Silat(Role Fighter  Duelist).jpg'],
  ['pedagang_bakso', 'Hero 6 Pedagang Bakso(Role Fighter  Duelist).jpg'],
  ['bocil_roket', 'Hero 7 Bocil Roket(Role Marksman).png'],
  ['gadis_kembang_api', 'Hero 8 Gadis Kembang Api (Role Mage).png'],
  ['jawara_petasan', 'Hero 9 Jawara Petasan(Role Fighter  Tank).png'],
  ['bocil_petasan', 'Hero 10 Bocil Petasan (Role Assassin  Bomber).png'],
  ['penjaga_kentongan', 'Hero 11 Penjaga Kentongan (Role Tank  Support).png'],
];

/** Sheet 1536x1024: kiri = peta, kanan = tower. */
const DESIGN_SHEET = 'Deisgn Map dan tower.png';
const DESIGN_REGIONS = {
  map: { left: 0, top: 0, width: 1100, height: 1024 },
  tower: { left: 1080, top: 0, width: 456, height: 1024 },
};

/** Piksel yang masih dianggap "putih" (JPEG punya noise). */
function whiteMetrics(data, offset) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  return { min, sat: max - min };
}

/**
 * Tandai piksel latar: kandidat putih yang terhubung ke tepi gambar.
 * Dipakai baik untuk penghapusan background maupun deteksi objek di sheet.
 */
function floodBackground(data, width, height, candidate, radius = 1) {
  const background = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (index) => {
    if (background[index]) return;
    background[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    if (candidate[x]) push(x);
    if (candidate[(height - 1) * width + x]) push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    if (candidate[y * width]) push(y * width);
    if (candidate[y * width + width - 1]) push(y * width + width - 1);
  }

  const offsets = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) offsets.push([dx, dy]);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (candidate[ni] && !background[ni]) push(ni);
    }
  }
  return background;
}

/** Ubah alpha piksel latar menjadi 0 (dengan feather di tepian objek). */
function eraseWhiteBackground({ data, info }) {
  const { width, height, channels } = info;
  const candidate = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const { min, sat } = whiteMetrics(data, i * channels);
    candidate[i] = min >= 222 && sat <= 34 ? 1 : 0;
  }
  const background = floodBackground(data, width, height, candidate, 2);

  for (let i = 0; i < width * height; i += 1) {
    if (!background[i]) continue;
    const offset = i * channels + 3;
    const { min } = whiteMetrics(data, i * channels);
    // 250+ -> transparan penuh, 232- -> opaque; transisi halus di antaranya.
    data[offset] = Math.max(0, Math.min(255, Math.round(((250 - min) / 18) * 255)));
  }
  return { data, info };
}

/** Potong margin transparan dengan padding. */
function trimAlpha({ data, info }, paddingRatio = 0.02) {
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] <= 12) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { data, info };
  const padX = Math.round(width * paddingRatio);
  const padY = Math.round(height * paddingRatio);
  const left = Math.max(0, minX - padX);
  const top = Math.max(0, minY - padY);
  const right = Math.min(width, maxX + padX + 1);
  const bottom = Math.min(height, maxY + padY + 1);
  const outWidth = right - left;
  const outHeight = bottom - top;
  const out = Buffer.alloc(outWidth * outHeight * channels);
  for (let y = 0; y < outHeight; y += 1) {
    const from = ((top + y) * width + left) * channels;
    data.copy(out, y * outWidth * channels, from, from + outWidth * channels);
  }
  return { data: out, info: { ...info, width: outWidth, height: outHeight } };
}

async function readRgba(source, resize) {
  let pipeline = sharp(source).ensureAlpha();
  if (resize) pipeline = pipeline.resize(resize, resize, { fit: 'fill' });
  return pipeline.raw().toBuffer({ resolveWithObject: true });
}

async function cleanedPng(source, size, padding = 0.02) {
  const box = typeof size === 'number' ? { width: size, height: size } : size;
  const rgba = await readRgba(source);
  const cleaned = eraseWhiteBackground(rgba);
  const trimmed = trimAlpha(cleaned, padding);
  return sharp(trimmed.data, {
    raw: { width: trimmed.info.width, height: trimmed.info.height, channels: 4 },
  })
    .resize(box.width, box.height, { fit: 'contain', background: TRANSPARENT })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Deteksi 5 objek terpisah pada sheet (analisis dilakukan di 512px). */
async function findSheetRegions(source, expectedCount) {
  const { data, info } = await readRgba(source, 512);
  const { width, height, channels } = info;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const { min, sat } = whiteMetrics(data, i * channels);
    ink[i] = min < 238 || sat > 18 ? 1 : 0;
  }

  const seen = new Uint8Array(width * height);
  const stack = [];
  const regions = [];
  const scale = 2048 / 512;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!ink[start] || seen[start]) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      let sumX = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const index = stack.pop();
        const cx = index % width;
        const cy = Math.floor(index / width);
        count += 1;
        sumX += cx;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        // radius 2 menyatukan bagian objek yang terputus oleh highlight putih.
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (ink[ni] && !seen[ni]) {
              seen[ni] = 1;
              stack.push(ni);
            }
          }
        }
      }
      if (count > 200) {
        regions.push({
          left: Math.round(minX * scale),
          top: Math.round(minY * scale),
          width: Math.round((maxX - minX + 1) * scale),
          height: Math.round((maxY - minY + 1) * scale),
          area: count,
          centerX: sumX / count,
        });
      }
    }
  }

  regions.sort((a, b) => a.centerX - b.centerX);
  if (regions.length !== expectedCount) {
    throw new Error(
      `weapons_sheet: ditemukan ${regions.length} objek, diharapkan ${expectedCount}`,
    );
  }
  return regions;
}

async function sliceWeaponSheet(source) {
  const regions = await findSheetRegions(source, WEAPON_NAMES.length);
  const outputs = [];
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    const pad = 40;
    const left = Math.max(0, region.left - pad);
    const top = Math.max(0, region.top - pad);
    const right = Math.min(2048, region.left + region.width + pad);
    const bottom = Math.min(2048, region.top + region.height + pad);
    const rgba = await sharp(source)
      .extract({ left, top, width: right - left, height: bottom - top })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cleaned = trimAlpha(eraseWhiteBackground(rgba), 0.03);
    const buffer = await sharp(cleaned.data, {
      raw: { width: cleaned.info.width, height: cleaned.info.height, channels: 4 },
    })
      .resize(128, 128, { fit: 'contain', background: TRANSPARENT })
      .png({ compressionLevel: 9 })
      .toBuffer();
    outputs.push({ name: WEAPON_NAMES[i], buffer, region });
  }
  return outputs;
}

const svgGuardPost = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="18" y="58" width="92" height="54" rx="6" fill="#8d5524"/>
  <path d="M8 60 L64 14 L120 60 Z" fill="#5d4037"/>
  <rect x="28" y="70" width="24" height="22" rx="3" fill="#ffe0b2"/>
  <rect x="76" y="70" width="24" height="22" rx="3" fill="#ffe0b2"/>
  <rect x="58" y="80" width="12" height="32" fill="#4e342e"/>
  <circle cx="64" cy="44" r="9" fill="#ffd54f"/>
</svg>`);

async function main() {
  await Promise.all(
    ['characters', 'weapons', 'maps', 'ui', 'effects'].map((folder) =>
      mkdir(path.join(OUT, folder), { recursive: true }),
    ),
  );

  const written = [];
  const save = async (relative, buffer) => {
    const destination = path.join(OUT, relative);
    await writeFile(destination, buffer);
    written.push(relative);
  };

  for (const [id, source] of HERO_SOURCES) {
    await save(`characters/${id}.png`, await cleanedPng(path.join(RAW, source), { width: 320, height: 320 }, 0.03));
  }

  const sheet = path.join(RAW, 'weapons_sheet.jpg');
  for (const weapon of await sliceWeaponSheet(sheet)) {
    await save(`weapons/${weapon.name}.png`, weapon.buffer);
    console.log(`  sheet -> ${weapon.name}:`, weapon.region);
  }
  await save('weapons/weapons_sheet.png', await cleanedPng(sheet, 1024, 0.01));

  const map = path.join(RAW, 'map_kampung.jpg');
  await save(
    'maps/map_kampung.png',
    await sharp(map).resize(1600, 1000, { fit: 'cover', position: 'attention' }).png({ compressionLevel: 9 }).toBuffer(),
  );
  await save(
    'maps/tileset_kampung.png',
    await sharp(map).resize(512, 512, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer(),
  );
  await save('maps/pos_ronda.png', await sharp(svgGuardPost).png().toBuffer());

  // Sheet desain terbaru: dipakai sebagai referensi lobby, backdrop minimap,
  // dan kartu gardu ronda di renderer 2D.
  const designPath = path.join(RAW, DESIGN_SHEET);
  const designSheet = await sharp(designPath).png().toBuffer();
  await save(
    'maps/design_map_tower.png',
    await sharp(designSheet).resize(1200, 800, { fit: 'inside' }).png({ compressionLevel: 9 }).toBuffer(),
  );
  await save(
    'maps/design_map.png',
    await sharp(designSheet)
      .extract(DESIGN_REGIONS.map)
      .resize(1024, 1024, { fit: 'cover', position: 'attention' })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  const towerCrop = await sharp(designSheet).extract(DESIGN_REGIONS.tower).png().toBuffer();
  await save(
    'maps/design_tower.png',
    await cleanedPng(towerCrop, { width: 256, height: 512 }, 0.03),
  );

  await save('ui/icon_koin_thr.png', await cleanedPng(path.join(RAW, 'icon_koin_thr.jpg'), 128));
  const logoSource = path.join(RAW, 'logo.png');
  await save('ui/logo.png', await cleanedPng(logoSource, { width: 640, height: 360 }, 0.01));
  await save('effects/efek_ledakan.png', await cleanedPng(path.join(RAW, 'efek_ledakan.jpg'), 256));

  console.log(`\n${written.length} file PNG ditulis ke client/public/assets:`);
  for (const file of written) console.log(' -', file);
}

main().catch((error) => {
  console.error('[assets] gagal:', error);
  process.exitCode = 1;
});
