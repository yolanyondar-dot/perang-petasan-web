# Deploy Produksi — Perang Petasan: Fighting PvP 2D Side-View

## Topologi (dipakai Cloudflare Workers)

Satu **Cloudflare Worker** menyajikan build Vite (statik) **dan** endpoint
matchmaking/WebSocket pada origin yang sama:

```
Browser --HTTPS--> Cloudflare Edge --/ws--> FightRoom Durable Object (20Hz)
                          |                Matchmaker Durable Object
                          +--> /assets (client/dist, SPA + PNG)
```

- Akun: `Yolan.yondar@gmail.com` (`d19c7b1d5b7972c31ce85743ea2a23fd`).
- Worker: `perang-petasan` (`https://perang-petasan.perang-petasan-pp.workers.dev`).
- Produksi: `https://petasan.yondarprojects.my.id`.
- Room: `moba`, mode `3v3` / `5v5` / `10v10` (difilter lewat `filterBy(['mode'])`).
- Client memakai `wss://<host>/ws` same-origin. `VITE_SERVER_URL` dikosongkan.
- `GET /health` → `{"ok":true,"game":"perang-petasan","runtime":"cloudflare-worker"}`.
- Free plan: 100K request Worker/hari, Durable Objects SQLite, tanpa kartu kredit.

---

## 1. DNS & zone Cloudflare

Zone yang dipakai adalah **root** `yondarprojects.my.id` (Free plan).
Cloudflare saat ini tidak mengizinkan zone hanya untuk subdomain, jadi seluruh
DNS domain dipindah ke Cloudflare dengan record lama dipertahankan.

Nameserver Cloudflare yang harus dipasang di **Clientzone Rumahweb → Domain →
Manage → Nameserver Setting**:

```
clayton.ns.cloudflare.com
mira.ns.cloudflare.com
```

Hapus keempat nameserver Rumahweb lama (`ns1.rumahweb.com`,
`ns2.rumahweb.com`, `ns3.rumahweb.net`, `ns4.rumahweb.net`). Propagasi biasanya
beberapa menit sampai 24 jam.

Record yang sudah ada di Cloudflare:

| Name | Type | Content | Proxy |
|---|---|---|---|
| `yondarprojects.my.id` | A | `203.175.8.19` | Auto |
| `www` | CNAME | `yondarprojects.my.id` | Auto |
| `ceki` | A | `203.175.8.19` | **DNS only** (tidak diubah) |
| `petasan` | AAAA | `100::` (originless) | **Proxied** (dikelola Cloudflare) |
| MX / SPF / DKIM / DMARC / SRV cPanel | — | sesuai hasil scan Cloudflare | DNS only |

`petasan.yondarprojects.my.id` terdaftar sebagai **Custom Domain** Worker (bukan
Route), karena Worker yang menjadi origin aset statis. Konfigurasi di
`worker/wrangler.toml`:

```toml
[[routes]]
pattern = "petasan.yondarprojects.my.id"
custom_domain = true
```

> Jangan buat ulang A record `petasan`; Cloudflare yang mengelola record
> AAAA `100::` untuk Custom Domain ini. Custom Domain dan Route lama tidak
> boleh aktif bersamaan — Route lama sudah dihapus.

> **Jangan ubah nilai record `ceki.yondarprojects.my.id`.**

---

## 2. Deploy

Prasyarat: Node 22+, `npm ci`, dan `wrangler` login (`npx wrangler login`).

```bash
npm ci
npm run typecheck
npm run deploy:cloudflare
```

`deploy:cloudflare` menjalankan `build:worker` (shared + client) lalu
`wrangler deploy` dari folder `worker/`. Deploy juga bisa langsung:

```bash
npm run build:worker
npm run deploy -w @pp/worker
```

Untuk development lokal dengan Worker:

```bash
npm run dev            # client + wrangler dev di :8787
# atau
npm run dev -w @pp/worker -- --port 8787
```

---

## 3. Verifikasi beta

1. `GET https://petasan.yondarprojects.my.id/health` → JSON `ok: true`.
2. Buka `https://petasan.yondarprojects.my.id/` — logo tampil, stage fighting 2D di latar.
3. Pilih 4 hero beta (`bocil_sarung`, `abang_ronda`, `tukang_lodong`, `emak_daster`)
   + mode, klik **MASUK ARENA**. Di Network harus tampil:
   - `POST /ws/matchmake/joinOrCreate/moba` → **200**
   - `wss://petasan.yondarprojects.my.id/ws?session=...` → **101 Switching Protocols**
4. Buka dua tab dengan mode berbeda; masing-masing harus masuk room mode tersebut
   (3 / 5 / 20 slot).
5. Cek `ceki.yondarprojects.my.id` masih seperti semula.
6. Console browser tidak ada error.

---

## 4. Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| Domain belum aktif | NS Rumahweb belum diganti / propagasi. Cek `dig NS yondarprojects.my.id`. |
| `520` / halaman putih | Cek build Vite sukses dan `client/dist/index.html` ada; lihat `wrangler tail`. |
| WebSocket gagal | Pastikan record `petasan` **proxied** dan route Worker aktif. |
| `401 session tidak valid` | Klik join ulang; sesi matchmaker berumur pendek. |
| Mode tercampur | Pastikan `filterBy(['mode'])` dan header `x-pp-mode` masih ada di `worker/src/index.ts`. |
| Email berhenti | Cek MX/SPF/DKIM/DMARC masih ada di Cloudflare DNS. |

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
Deploy Render/Koyeb dibatalkan (butuh kartu kredit / upgrade plan).
