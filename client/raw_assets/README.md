# Aset mentah (JPG/PNG hasil desain)

## Aset lama
- `bocil_sarung.jpg`, `abang_ronda.jpg`, `tukang_lodong.jpg`
- `weapons_sheet.jpg` (5 senjata dalam satu sheet)
- `map_kampung.jpg`, `icon_koin_thr.jpg`, `efek_ledakan.jpg`, `logo.png`
- `mockup_lobby.jpg`, `mockup_gameplay.jpg`

## 12 aset baru (hero, map, tower)
- `Hero 1 Bocil Sarungan (Role Assassin  Rusher).jpg`
- `Hero 2 Abang Ronda(Role Tank).jpg`
- `Hero 3 Master Lodong(Role Marksman).jpg`
- `Hero 4 Emak Daster(Support  Mage).jpg`
- `Hero 5 Pendekar Silat(Role Fighter  Duelist).jpg`
- `Hero 6 Pedagang Bakso(Role Fighter  Duelist).jpg`
- `Hero 7 Bocil Roket(Role Marksman).png`
- `Hero 8 Gadis Kembang Api (Role Mage).png`
- `Hero 9 Jawara Petasan(Role Fighter  Tank).png`
- `Hero 10 Bocil Petasan (Role Assassin  Bomber).png`
- `Hero 11 Penjaga Kentongan (Role Tank  Support).png`
- `Deisgn Map dan tower.png` (kiri: peta, kanan: gardu ronda)

Jalankan dari root proyek:

```bash
npm install
npm run assets:process
```

Skrip `scripts/process-assets.mjs` akan:
1. Menghapus latar putih menjadi transparan (flood-fill dari tepi + toleransi warna).
2. Memotong `weapons_sheet.jpg` menjadi 5 PNG senjata.
3. Menulis 11 portrait hero ke `client/public/assets/characters/`.
4. Memotong `Deisgn Map dan tower.png` menjadi:
   - `maps/design_map.png` (seni arena + latar minimap),
   - `maps/design_tower.png` dan `maps/design_map_tower.png` (arsip desain; tidak dipakai di arena).
5. Menulis seluruh PNG ke `client/public/assets/` sesuai `AGENTS.md`.
