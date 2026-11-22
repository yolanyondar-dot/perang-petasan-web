# Asset Mockup - Perang Petasan

Folder ini adalah tempat referensi **mockup/aset visual saat ini** agar mudah diedit lalu diterapkan kembali ke game.

## Status aset saat ini

Saat ini **hampir semua visual dibuat prosedural (gambar lewat kode Canvas 2D)**, bukan file PNG/JPG. Jadi untuk "mengedit gambar", Anda bisa:
1. **Ganti dengan file gambar** (PNG/WebP/SVG) lalu ubah kode gambar agar memuat file tersebut, atau
2. **Edit kode gambar prosedural** di file sumber yang disebutkan di bawah.

## Struktur folder

```text
assets-mockup/
  README.md
  characters/      # referensi/mockup karakter
  maps/            # referensi/mockup map/background
  ui/              # referensi/mockup UI/lobby/waiting room
  fx/              # referensi/mockup efek ledakan/item/smoke
```

## Peta file sumber visual

### 1) Karakter (chibi Ballistic)
- **File utama**: `client/src/ballisticStyleAssets.js`
- **Fungsi**: `drawChibiHero2D(ctx, options)`
- **Dipakai di**:
  - Arena: `client/src/character.js` (method `draw`)
  - Lobby hero showcase: `client/src/uiScreens.js` (`drawHeroPreview`)
  - Avatar waiting room: `client/src/uiScreens.js` (`renderWaiting`)
- **Yang bisa diedit**: bentuk badan/kepala, mata, aksesori per `characterId` (`udin`, `sari`, `hendra`, `dika`), warna, pedestal, pose bidik/jalan.
- **ID karakter config**: `client/src/charactersConfig.js` (nama, skill, warna, skin).

### 2) Map / Terrain / Background
- **File utama**: `client/src/ballisticStyleAssets.js`
  - `renderBallisticMapBackdrop(ctx, width, height, mapId, time)` - langit, awan, bukit, dekor belakang.
  - `paintStylizedTerrainLayer(terrainCtx, width, height, mapId)` - bentuk tanah/atap padat yang bisa dihancurkan.
- **File terrain game**: `client/src/terrain.js`
  - Mengatur map ID (`kampung_festival`, `atap_senja`, `jembatan_bulan`), spawn, dekor, `carveCrater`, collision.
- **Catatan penting**: `paintStylizedTerrainLayer` menggambar terrain **padat** ke canvas terrain. `carveCrater()` menghapus area dengan `destination-out`, jadi bentuk tanah harus tetap digambar ke canvas terrain ini.

### 3) UI Lobby / Waiting Room / Login
- **Layout/markup/CSS**: `client/index.html`
- **Logic/render UI**: `client/src/uiScreens.js`
  - Login/Lobby/Waiting screen, hero preview, map thumbnail, QR, slot pemain, badge skill.
- **Aset UI yang saat ini prosedural**: background lobby/login/waiting, partikel ringan, thumbnail map, avatar chibi slot.

### 4) Efek & Item
- **Item drop**: `client/src/pickup2d.js` + visual di `client/src/visualAssets2d.js` (`drawPickup2D`)
- **Ledakan/percikan**: `client/src/petasan.js` (`ExplosionFX`) + visual di `client/src/visualAssets2d.js` (`drawExplosion2D`)
- **Smoke**: digambar di `client/src/main.js` (`drawSmokes`)
- **Proyektil**: `client/src/petasan.js` dan render di `client/src/main.js` (`projDraw`)

## Cara menerapkan jika Anda mengganti dengan file gambar

Contoh penempatan yang disarankan:
```text
client/public/assets/characters/udin.png
client/public/assets/maps/kampung_festival_bg.png
client/public/assets/ui/logo.png
```

Lalu muat di kode (contoh):
```js
const img = new Image();
img.src = '/assets/characters/udin.png';
await img.decode();
ctx.drawImage(img, x, y, w, h);
```

Untuk performa, **preload** gambar sebelum game mulai (bisa di `main.js` atau modul asset loader).

## Rekomendasi ekspor mockup

Jika ingin saya siapkan, saya bisa mengekspor PNG referensi saat ini ke folder ini:
- `characters/udin.png`, `sari.png`, `hendra.png`, `dika.png`
- `maps/kampung_festival.png`, `atap_senja.png`, `jembatan_bulan.png`
- `ui/lobby.png`, `ui/waiting-room.png`

PNG tersebut bisa Anda jadikan acuan saat mengedit/menggambar ulang.
