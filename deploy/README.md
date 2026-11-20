# Deploy Produksi — Perang Petasan: Arena PvP 2D

## Topologi (dipakai Render)

Satu **Render Web Service** menjalankan **client statis (Vite build)** dan
**Colyseus** pada origin yang sama:

```
Browser --HTTPS--> Render :$PORT --/ws/*--> Colyseus (matchmake + WebSocket)
                             |
                             +--> /client/dist (SPA + aset PNG)
```

- Room: `moba`, mode `3v3` / `5v5` / `10v10` (difilter via `filterBy(['mode'])`).
- Client memakai `wss://<host>/ws` secara default. Tidak perlu `VITE_SERVER_URL`.
- `GET /health` mengembalikan `{"ok":true,"game":"perang-petasan"}`.
- Render men-set env `PORT`; server memakainya dan bind ke `0.0.0.0`.
- Free plan:**service tidur setelah ~15 menit tanpa trafik**, jadi join pertama
  bisa menunggu ±1 menit saat service bangun.

Alamat produksi: `https://petasan.yondarprojects.my.id`.

---

## Deploy dari GitHub (Render Blueprint)

Repo: `https://github.com/yolanyondar-dot/perang-petasan-web`

### 1. Prasyarat

- Akun Render terhubung ke GitHub sebagai `yolanyondar-dot`.
- Repo sudah public sehingga Render bisa membaca tanpa install GitHub App khusus.
- File `render.yaml` ada di root repo.

Isi `render.yaml`:

```yaml
services:
  - type: web
    name: perang-petasan
    runtime: node
    plan: free
    region: singapore
    branch: main
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /health
    domains:
      - petasan.yondarprojects.my.id
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: NODE_ENV
        value: production
```

> Jangan set `PORT` manual — Render yang menyuntiknya.

### 2. Push perubahan

Dari root proyek:

```bash
git add .
git commit -m "Deploy arena PvP ke Render"
git push origin main
```

### 3. Buat Blueprint di Render

1. Buka https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect repo `yolanyondar-dot/perang-petasan-web`, branch `main`.
3. Render mendeteksi `render.yaml` → **Apply**.
4. Tunggu build & deploy selesai. Cek log jika gagal.

Service juga bisa dibuat manual:

- **Runtime:** Node
- **Build command:** `npm ci && npm run build`
- **Start command:** `npm start`
- **Health check:** `/health`
- **Plan:** Free
- **Environment:** `NODE_VERSION=22`, `NODE_ENV=production`

### 4. Pasang domain `petasan.yondarprojects.my.id`

`domains` di `render.yaml` hanya mendaftarkan domain di Render; DNS masih harus
diarahkan manual.

1. Di Render → service `perang-petasan` → **Settings** → **Custom Domains** →
   salin **DNS target** (bentuknya `<service>.onrender.com`).
2. Di **cPanel → Zone Editor**, hapus/ubah A record `petasan` yang dibuat saat
   subdomain dibuat, lalu buat CNAME:

```
Name:   petasan.yondarprojects.my.id.
Type:   CNAME
Target: <DNS target dari Render>
TTL:    300
```

> **Jangan ubah** `ceki.yondarprojects.my.id`.

3. Tunggu propagasi DNS. Render akan mengeluarkan sertifikat TLS otomatis.

### 5. Verifikasi beta

1. Buka `https://petasan.yondarprojects.my.id/` — logo tampil, arena kartun 2D di latar.
2. Pilih hero + mode, klik **MASUK ARENA**. Di Network harus tampil:
   - `POST /ws/matchmake/joinOrCreate/moba` → **200**
   - `wss://.../ws/<roomId>/<sessionId>` → **101 Switching Protocols**
3. `GET /health` → `{"ok":true,"game":"perang-petasan"}`.
4. Buka dua tab dengan mode berbeda; keduanya harus masuk room mode masing-masing.
5. Console browser tidak ada error.

### 6. Troubleshooting Render

| Gejala | Penyebab / solusi |
|---|---|
| Build gagal di `npm ci` | Pastikan `package-lock.json` ikut ter-commit. |
| `404` di `/matchmake/...` | Prefix `/ws` tidak terbuang. Pastikan `server/src/index.ts` versi terbaru aktif. |
| WS langsung tertutup | Cek Render logs; pastikan start command `npm start`. |
| Domain belum HTTPS | Cek CNAME di cPanel masih mengarah ke target Render, lalu Render → **Custom Domains** → **Refresh**. |
| Halaman putih | Cek build Vite sukses dan `client/dist/index.html` ada. |
| Join pertama lambat | Normal pada free plan; tunggu service bangun (~1 menit). |

---

## Opsi cadangan — VPS sendiri (tidak dipakai sekarang)

Topologi: **Nginx** (80/443) menyajikan build Vite dan meneruskan `matchmake` +
WebSocket ke **Colyseus** yang dijalankan **PM2** di `127.0.0.1:2567`.

```bash
npm ci
npm run build
pm2 start ecosystem.config.cjs --env production
sudo cp deploy/nginx.conf /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d example.com
```

`deploy/nginx.conf` dan `ecosystem.config.cjs` disimpan sebagai referensi VPS.

---

## Catatan environment

- `client/.env.production`: biarkan kosong. Endpoint default sudah same-origin `/ws`.
- `.env.production` di root hanya dipakai PM2/VPS. Di Render, Render yang men-set
  `PORT`. Jangan set `HOST=127.0.0.1` di Render.
- `CLIENT_DIST` opsional untuk override lokasi `client/dist`.
- Deploy lama Koyeb dibatalkan karena akun organisasi meminta upgrade plan.
