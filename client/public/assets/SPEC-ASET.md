# Spesifikasi Aset Gambar - Perang Petasan

Dokumen ini mendefinisikan format aset gambar agar bisa dibaca/diterapkan ke game. **Lokasi yang disarankan**: `client/public/assets/...`

## Aturan umum

- **Format**: PNG (transparan) direkomendasikan. WebP juga boleh. JPG hanya untuk background tanpa transparansi.
- **Orientasi game**: canvas 1280x720 (16:9, landscape).
- **Pivot/anchor**: titik yang ditulis di bawah adalah titik yang harus ditempatkan di koordinat game.
- **Penamaan file**: gunakan huruf kecil, `-` atau `_`, sesuai nama di spec ini.
- **Setelah menambah aset**: kode loader/integrasi perlu diperbarui (lihat bagian "Cara integrasi"). Saya bisa bantu wiring-nya setelah Anda menaruh file.

## 1. Karakter

Ada 4 karakter: `udin`, `sari`, `hendra`, `dika`.

### Opsi A - Sprite sederhana (direkomendasikan untuk mulai)
Satu PNG per pose per karakter:

```text
client/public/assets/characters/
  udin/
    idle.png
    walk.png        (opsional spritesheet, lihat Opsi B)
    aim.png
    ko.png
    avatar.png      (opsional, untuk UI/waiting slot)
  sari/...
  hendra/...
  dika/...
```

**Ukuran kanvas rekomendasi**: 256x256 px (transparan).  
**Pivot**: tengah-bawah karakter (kaki) berada di **(128, 220)** pada kanvas 256x256.  
**Arah default**: menghadap ke **kanan**; game akan mirror otomatis untuk kiri.  
**Area aman**: jangan melewati batas kanvas; sisakan ruang atas untuk efek/lompatan.

### Opsi B - Spritesheet animasi (lebih halus)
`walk.png` sebagai spritesheet horizontal:
- Frame size: 256x256 per frame
- Jumlah frame: 4 atau 6 frame
- Urutan: frame kiri ke kanan
- Nama: `walk-sheet.png`
- File metadata opsional: `walk-sheet.json` dengan `{ "frameWidth":256, "frameHeight":256, "frames":6, "fps":10 }`

Pose yang berguna:
- `idle.png` - berdiri
- `aim.png` - lengan mengangkat petasan
- `throw.png` - saat lempar (opsional)
- `hurt.png` - kena damage (opsional)
- `ko.png` - tumbang

### Opsi C - Hero showcase lobby
- `showcase.png` ukuran 512x512, pivot tengah-bawah (256, 430) jika pakai kanvas lebih tinggi. Atau gunakan `idle.png` yang sama; lobby akan scale 2.3x.

## 2. Map / Arena

Ada 3 map: `kampung_festival`, `atap_senja`, `jembatan_bulan`. Ukuran canvas game **1280x720**.

```text
client/public/assets/maps/
  kampung_festival/
    background.png      # 1280x720, langit/paralaks/dekor belakang (tidak padat)
    terrain.png         # 1280x720, PNG transparan, tanah/atap PADAT (alpha > 10)
    overlay.png         # opsional, dekor depan yang tidak padat
  atap_senja/...
  jembatan_bulan/...
```

### background.png
- Ukuran: **1280x720**
- Berisi: langit, awan, gunung, bangunan jauh, dekor belakang.
- **Tidak mempengaruhi collision**.
- Bisa JPG jika tidak butuh transparansi.

### terrain.png (PENTING)
- Ukuran: **1280x720**, PNG transparan.
- Pixel tanah/atap/pijakan = **alpha > 10** (padat, bisa diinjak).
- Pixel kosong/udara = **alpha 0** (transparan).
- Game akan memakai alpha ini untuk: pijakan karakter, deteksi tabrakan proyektil, dan `carveCrater()` saat ledakan.
- **Jangan** pakai semi-transparan di area yang harus padat; gunakan alpha penuh atau hampir penuh.

### overlay.png (opsional)
- Ukuran: **1280x720**, PNG transparan.
- Dekor di depan terrain (rumput depan, tiang, papan) yang tidak mempengaruhi collision.

## 3. Efek (FX)

```text
client/public/assets/fx/
  explosion-small.png
  explosion-medium.png
  explosion-big.png
  smoke.png
  spark.png
  projectile-basic.png
  projectile-skill.png
  projectile-ulti.png
```

### Ledakan
Spritesheet direkomendasikan:
- `explosion.png`: spritesheet horizontal, mis. 8 frame, tiap frame 256x256, pivot tengah (128,128).
- Atau 3 file terpisah per ukuran.

### Proyektil
- Ukuran: 64x64 atau 128x128, pivot tengah.
- Arah default: menghadap kanan.

### Smoke/partikel
- PNG transparan, pivot tengah. Bisa 64x64/128x128.

## 4. Item Drop

```text
client/public/assets/fx/
  pickup-energy.png
  pickup-hp.png
  pickup-cooldown.png
  pickup-parachute.png
```

- Ukuran rekomendasi: 128x128, pivot tengah-bawah kotak item.
- Transparan.

## 5. UI

```text
client/public/assets/ui/
  logo.png
  lobby-bg.png        (opsional, ganti background prosedural)
  button-main.png     (opsional)
  button-room.png     (opsional)
  panel.png           (opsional 9-slice style)
```

UI saat ini banyak pakai CSS/DOM; penggantian UI gambar perlu perubahan HTML/CSS.

## 6. Cara integrasi ke kode

Setelah file ditaruh di `client/public/assets/...`, file bisa diakses dengan path absolut dari root web, contoh: `/assets/characters/udin/idle.png`.

Contoh loader sederhana:

```js
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
```

Titik integrasi utama:
- `client/src/character.js` - ganti `drawChibiHero2D(...)` dengan `ctx.drawImage(...)` berdasarkan pose/state.
- `client/src/terrain.js` - load `background.png` untuk backdrop, load `terrain.png` ke terrain canvas agar collision/crater tetap jalan.
- `client/src/visualAssets2d.js` / `client/src/pickup2d.js` / `client/src/petasan.js` - ganti gambar FX/item.
- `client/src/uiScreens.js` - ganti hero preview/avatar/map thumbnail bila pakai aset UI gambar.

## 7. Checklist sebelum kirim aset

- [ ] Nama file sesuai spec.
- [ ] Ukuran sesuai (terutama map 1280x720).
- [ ] PNG transparan untuk karakter/FX/terrain.
- [ ] Pivot/anchor sesuai.
- [ ] Karakter menghadap kanan.
- [ ] Terrain alpha bersih (padat vs transparan).