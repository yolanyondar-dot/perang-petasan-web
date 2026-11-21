# Deploy — Perang Petasan (Vite + Express + Socket.IO)

Arsitektur saat ini: **Node.js server** (`server/index.js`) menyajikan build client (`client/dist`) dan Socket.IO di origin yang sama.

## Jalankan lokal / VPS

```bash
npm ci
npm run build
npm start
```

- Default port: `3001` (override dengan `PORT`)
- Health check: `GET /health`
- Controller: `http://<host>:<port>/controller.html`

## Render (gratis, sudah ada `render.yaml`)

1. Push repo ini ke GitHub.
2. Di Render, buat **Web Service** dari repo, branch `main`.
3. Render akan membaca `render.yaml`:
   - Build: `npm ci && npm run build`
   - Start: `npm start`
   - Health: `/health`
4. Setelah deploy, set custom domain `petasan.yondarprojects.my.id` di dashboard Render, lalu arahkan DNS domain sesuai instruksi Render.

**Catatan free tier Render**: service bisa sleep saat idle (cold start), dan state room Socket.IO di memori akan hilang saat restart/sleep. Ini cocok untuk demo/coba-coba; untuk ramai2 stabil butuh plan berbayar/hosting Node persisten.

## cPanel (jika hosting mendukung Node.js App)

Beberapa cPanel punya fitur **Setup Node.js App**. Jika ada:

1. Upload/clone repo ke server.
2. Set Node >= 20, app root ke folder repo, startup file `server/index.js`.
3. Jalankan `npm ci && npm run build`.
4. Set env `NODE_ENV=production` dan `PORT` sesuai yang diberikan cPanel.
5. Pastikan proxy/passenger mendukung WebSocket/Socket.IO; jika tidak, multiplayer real-time bisa gagal.

Jika cPanel hanya shared hosting PHP/static tanpa Node process persisten, gunakan Render/VPS Node.
