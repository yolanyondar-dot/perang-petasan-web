/**
 * Generator latar stage fighting satu layar (16:9) untuk Perang Petasan.
 *
 * Sumber: client/raw_assets/stage-kampung.jpg (gambar stage mentah dari desain).
 * Gambar dipotong tipis di sisi supaya rasio tepat 16:9, lalu di-resize ke
 * 1280x720. Tidak ada parallax/scrolling; renderer memakai satu gambar utuh.
 *
 * Jalankan: npm run assets:stage
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const W = 1280;
const H = 720;
const SOURCE = path.resolve('client/raw_assets/stage-kampung.jpg');
const OUT_DIR = path.resolve('client/public/assets/maps');
const TARGET_RATIO = W / H;

async function main() {
  const source = await readFile(SOURCE);
  const meta = await sharp(source).metadata();
  const srcW = meta.width ?? W;
  const srcH = meta.height ?? H;

  let left = 0;
  let top = 0;
  let width = srcW;
  let height = srcH;
  if (width / height > TARGET_RATIO) {
    const fitted = Math.round(height * TARGET_RATIO);
    left = Math.floor((width - fitted) / 2);
    width = fitted;
  } else {
    const fitted = Math.round(width / TARGET_RATIO);
    top = Math.floor((height - fitted) / 2);
    height = fitted;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await sharp(source)
    .extract({ left, top, width, height })
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toFile(path.join(OUT_DIR, 'stage-kampung.png'));
  console.log(`Stage siap: ${srcW}x${srcH} → ${W}x${H} → client/public/assets/maps/stage-kampung.png`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
