// Simple image asset loader. Put files under client/public/assets/... (served as /assets/...)
// If an image exists, it will be used; otherwise the game falls back to procedural drawing.

const cache = new Map();
const manifest = {
  characters: {}, // id -> {idle,aim,ko,walkSheet,...}
  maps: {},       // id -> {background,terrain,overlay}
  fx: {},         // name -> Image
};

function loadImage(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

async function tryLoad(src) {
  const img = await loadImage(src);
  return img && img.naturalWidth > 0 ? img : null;
}

export async function preloadAssets() {
  const charIds = ['udin', 'sari', 'hendra', 'dika'];
  const poses = ['idle', 'aim', 'throw', 'hurt', 'ko', 'avatar'];
  for (const id of charIds) {
    manifest.characters[id] = manifest.characters[id] || {};
    for (const pose of poses) {
      manifest.characters[id][pose] = await tryLoad(`/assets/characters/${id}/${pose}.png`);
    }
    // walk spritesheet optional
    manifest.characters[id].walkSheet = await tryLoad(`/assets/characters/${id}/walk-sheet.png`);
  }
  const mapIds = ['kampung_festival', 'atap_senja', 'jembatan_bulan'];
  for (const id of mapIds) {
    manifest.maps[id] = {
      background: await tryLoad(`/assets/maps/${id}/background.png`),
      terrain: await tryLoad(`/assets/maps/${id}/terrain.png`),
      overlay: await tryLoad(`/assets/maps/${id}/overlay.png`),
    };
  }
  const fxNames = ['explosion', 'explosion-small', 'explosion-medium', 'explosion-big', 'smoke', 'spark', 'pickup-energy', 'pickup-hp', 'pickup-cooldown', 'projectile-basic', 'projectile-skill', 'projectile-ulti'];
  for (const n of fxNames) manifest.fx[n] = await tryLoad(`/assets/fx/${n}.png`);
  return manifest;
}

export function getCharacterImage(charId, pose = 'idle') {
  return manifest.characters?.[charId]?.[pose] || null;
}
export function getCharacterWalkSheet(charId) {
  return manifest.characters?.[charId]?.walkSheet || null;
}
export function getMapImage(mapId, layer = 'background') {
  return manifest.maps?.[mapId]?.[layer] || null;
}
export function getFxImage(name) {
  return manifest.fx?.[name] || null;
}
export function getManifest() { return manifest; }
