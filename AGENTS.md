# PROJECT SPECIFICATION: PERANG PETASAN 2D ARENA PVP (WEB MULTIPLAYER)

## 1. Project Overview
- **Title:** Perang Petasan: Arena PvP 2D
- **Genre:** 2D top-down cartoon arena PvP dengan skill MOBA (tanpa lane), web-based.
- **Theme:** Indonesian Kampung Street & Festival Culture (Perang Sarung, Petasan, Pos Ronda, Gapura Kampung). Kartun 2D ringan (non-gore; hero kalah jadi gosong lalu respawn di zona tim).
- **Tampilan:** Landscape + fullscreen. Lobby menampilkan panduan orientasi portrait; tombol fullscreen tersedia di semua layar dan diminta otomatis saat klik join.
- **Game Modes:** `3v3`, `5v5`, dan `10v10` sebagai ukuran tim dengan intelligent AI Bot backfill untuk slot kosong. Mode dipisah di matchmaking lewat `filterBy(['mode'])`.
- **Kondisi Menang:** Pertandingan 300 detik (atau berhenti lebih awal di skor 40). Tim dengan **skor kill terbanyak** saat waktu habis menang; seri bisa terjadi.
- **Retention & Progression Loop:**
  - **Out-of-Match (Lobby):** Spend `Koin THR` to permanently upgrade Hero Base Stats & Weapon Tiers (Lv.1–Lv.10).
  - **In-Match (Arena Loop):** Lawan adalah hero tim lain (player/bot). Kills & assists memberi `Koin Receh` dan XP, buka skill, dan beli item taktis sementara.

## 2. Tech Stack & Architecture
- **Monorepo Structure:**
  - `/client`: **Canvas2D** + **TypeScript** + **Vite** (renderer top-down ringan tanpa Three.js/WebGL; kamera follow halus, particle, efek ledakan 2D, HUD HTML/CSS responsif untuk Desktop WASD/Mouse & Mobile Dual-Thumb Virtual Joystick + Skill Aiming).
  - `/server`: **Node.js** + **TypeScript** + **Colyseus** (Authoritative arena server running at 20Hz tick rate).
  - `/shared`: Shared TypeScript interfaces, arena coordinates, and balancing data (`heroes.json`, `items.json`, `ARENA_BALANCE`).
- **Hosting beta:** Vite `server`/`preview` meneruskan `/ws` ke Colyseus, sehingga client dan server bisa diakses lewat satu origin/public tunnel.

## 3. Aset 2D
- **Tanpa aset 3D / `.glb`.** Renderer menggambar arena (ring festival, zona spawn, prop cover), semak, hero, projectile, dan efek langsung ke `Canvas2D`.
- **2D Assets (`/client/public/assets/`):**
  - `ui/logo.png` dan `ui/icon_koin_thr.png` dipakai di Lobby & HUD.
  - 11 portrait hero di `characters/` dipakai untuk kartu Hero Select, HUD, dan token melingkar di arena.
  - `maps/design_map.png` sebagai seni peta arena + latar minimap. `maps/design_tower.png` dan `maps/design_map_tower.png` tersimpan sebagai arsip desain (tidak dipakai di arena).
  - `effects/efek_ledakan.png` sebagai overlay ledakan.
  - `effects/skills/skill-atlas.png` + `manifest.json`: atlas 8 efek × 8 frame (skill 1 & ultimate 4 hero beta) untuk animasi VFX; dihasilkan oleh `npm run assets:skills` lewat `scripts/generate-skill-atlas.mjs`.

## 4. Arena Map & Gameplay Mechanics (Colyseus Authoritative)
- **Arena Simetris Kampung (`160x160` world units):**
  - **Zona Spawn:** Tim Merah di sisi kiri, Tim Putih di sisi kanan; hero lahir kembali di zona tim dengan spawn protection singkat.
  - **Ring Tengah:** Area pertemuan utama di pusat arena dengan radius 12 unit.
  - **Prop Cover:** Kiosk, bak air, dan pos ronda menghalangi projectile sekaligus jadi dekorasi festival.
  - **Tidak ada** lane, minion, turret, base, atau boss.
- **Hero Combat & Skill System (4 Actions per Hero):**
  - `Basic Attack`: Fast melee/ranged attack with zero cooldown cost.
  - `Skill 1 (Damage)`: High-burst firecracker throw / sarung slam (4–6s cooldown).
  - `Skill 2 (Crowd Control / Mobility)`: Smoke bomb slow/blind or speed dash (7–10s cooldown).
  - `Ultimate (Game Changer)`: Massive area-of-effect attack (e.g., *Meriam Bambu Karbit Barrage*, *Kentongan Shockwave*, *Tornado Sarung*) unlocked at match level 4 (20–30s cooldown).
- **In-Match Shop & Leveling:**
  - Heroes gain XP during the match (Lv.1 to Lv.15) from kills and assists to unlock and power up skills.
  - Players earn `Koin Receh` during the match to buy up to 6 items from a quick-buy overlay (`Sandal Jepit Turbo`, `Tutup Panci Baja`, `Minyak Karbit`, `Korek Api Gas`, `Jamu Kuat`, `Sarung Tenun Sakti`).

## 5. Catatan Implementasi
1. Renderer utama ada di `client/src/engine/MobaRenderer.ts` dan memakai API `createMobaRenderer()` yang sama seperti sebelumnya.
2. `shared/heroes.json` dan `shared/items.json` menjadi sumber 11 Hero dan item toko; angka arena ada di `ARENA_BALANCE` (`shared/src/mobaBalance.ts`).
3. `MobaRoom` di `/server` tetap menjadi otoritas gameplay, bot, economy, dan kondisi menang. State `MobaState` dipertahankan agar kompatibel: `minions`/`turrets`/`bases` kosong dan `boss` tidak aktif.
4. HUD menampilkan minimap arena, skor kill/timer, joystick, skill wheel, quick shop, killfeed, dan panel hasil pertandingan.
5. Untuk beta hosting, jalankan server Colyseus + Vite preview dan publikasikan satu port; `/ws` otomatis diteruskan ke Colyseus. Mode room difilter server agar pilihan mode lobby selalu dipatuhi.
