// Asset loader with fallback: IndexedDB overrides (uploaded in Asset Studio) -> /public/assets files -> procedural.

const cache = new Map();
const manifest = {
  characters: {},
  maps: {},
  fx: {},
};
const overrides = new Map(); // key -> dataURL

const DB_NAME = 'perang-petasan-assets';
const STORE = 'images';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbKeys() {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

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
async function loadFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const img = await loadImage(dataUrl);
  return img && img.naturalWidth > 0 ? img : null;
}

export function assetKey(kind, id, name) { return `${kind}:${id}:${name}`; }

export async function loadOverrides() {
  const keys = await idbKeys();
  for (const k of keys) {
    const v = await idbGet(k);
    if (typeof v === 'string' && v.startsWith('data:image')) overrides.set(k, v);
  }
}

export async function setAssetOverride(key, dataUrl) {
  if (!dataUrl) return;
  overrides.set(key, dataUrl);
  cache.delete(dataUrl);
  await idbSet(key, dataUrl);
}
export async function clearAssetOverride(key) {
  overrides.delete(key);
  await idbDel(key);
}
export function getAssetOverride(key) { return overrides.get(key) || null; }
export function listOverrideKeys() { return [...overrides.keys()]; }

async function resolveAsset(key, filePath) {
  const ov = overrides.get(key);
  if (ov) return await loadFromDataUrl(ov);
  return await tryLoad(filePath);
}

export async function preloadAssets() {
  await loadOverrides();
  const charIds = ['udin', 'sari', 'hendra', 'dika'];
  const poses = ['idle', 'aim', 'throw', 'hurt', 'ko', 'avatar'];
  for (const id of charIds) {
    manifest.characters[id] = manifest.characters[id] || {};
    for (const pose of poses) {
      manifest.characters[id][pose] = await resolveAsset(assetKey('char', id, pose), `/assets/characters/${id}/${pose}.png`);
    }
    manifest.characters[id].walkSheet = await resolveAsset(assetKey('char', id, 'walk-sheet'), `/assets/characters/${id}/walk-sheet.png`);
  }
  const mapIds = ['kampung_festival', 'atap_senja', 'jembatan_bulan'];
  for (const id of mapIds) {
    manifest.maps[id] = {
      background: await resolveAsset(assetKey('map', id, 'background'), `/assets/maps/${id}/background.png`),
      terrain: await resolveAsset(assetKey('map', id, 'terrain'), `/assets/maps/${id}/terrain.png`),
      overlay: await resolveAsset(assetKey('map', id, 'overlay'), `/assets/maps/${id}/overlay.png`),
    };
  }
  const fxNames = ['explosion', 'explosion-small', 'explosion-medium', 'explosion-big', 'smoke', 'spark', 'pickup-energy', 'pickup-hp', 'pickup-cooldown', 'projectile-basic', 'projectile-skill', 'projectile-ulti'];
  for (const n of fxNames) manifest.fx[n] = await resolveAsset(assetKey('fx', n, 'main'), `/assets/fx/${n}.png`);
  return manifest;
}

export function assetFilePath(key) {
  const [kind, id, name] = key.split(':');
  if (kind === 'char') return `/assets/characters/${id}/${name === 'walk-sheet' ? 'walk-sheet' : name}.png`;
  if (kind === 'map') return `/assets/maps/${id}/${name}.png`;
  if (kind === 'fx') return `/assets/fx/${id}.png`;
  return null;
}

export async function reloadAsset(key, filePath = assetFilePath(key)) {
  const img = await resolveAsset(key, filePath);
  const [kind, id, name] = key.split(':');
  if (kind === 'char') { manifest.characters[id] = manifest.characters[id] || {}; manifest.characters[id][name] = img; }
  if (kind === 'map') { manifest.maps[id] = manifest.maps[id] || {}; manifest.maps[id][name] = img; }
  if (kind === 'fx') { manifest.fx[id] = img; }
  return img;
}

export async function clearAllOverrides() {
  const keys = [...overrides.keys()];
  for (const k of keys) await clearAssetOverride(k);
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
