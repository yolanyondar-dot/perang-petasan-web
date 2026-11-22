export function renderBallisticMapBackdrop(ctx, width, height, mapId = "kampung_festival", time = 0) {
  ctx.save();

  const themes = {
    kampung_festival: {
      skyTop: "#1d4ed8",
      skyMid: "#38bdf8",
      skyBottom: "#fef08a",
      farHill: "#60a5fa",
      midHill: "#2563eb",
      accent: "#f97316",
    },
    atap_senja: {
      skyTop: "#4c1d95",
      skyMid: "#db2777",
      skyBottom: "#fdba74",
      farHill: "#7e22ce",
      midHill: "#581c87",
      accent: "#facc15",
    },
    jembatan_bulan: {
      skyTop: "#0f172a",
      skyMid: "#1e3a8a",
      skyBottom: "#38bdf8",
      farHill: "#1e293b",
      midHill: "#0f172a",
      accent: "#fb7185",
    },
  };

  const t = themes[mapId] || themes.kampung_festival;

  // Gradasi langit cerah khas anime-casual
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
  skyGrad.addColorStop(0, t.skyTop);
  skyGrad.addColorStop(0.6, t.skyMid);
  skyGrad.addColorStop(1, t.skyBottom);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Matahari / Bulan bercahaya lembut
  const orbX = width * 0.78;
  const orbY = height * 0.22;
  const orbGlow = ctx.createRadialGradient(orbX, orbY, 10, orbX, orbY, 110);
  orbGlow.addColorStop(0, "rgba(255, 251, 235, 0.95)");
  orbGlow.addColorStop(0.35, "rgba(254, 240, 138, 0.45)");
  orbGlow.addColorStop(1, "rgba(254, 240, 138, 0)");
  ctx.fillStyle = orbGlow;
  ctx.beginPath();
  ctx.arc(orbX, orbY, 110, 0, Math.PI * 2);
  ctx.fill();

  // Awan bergaya kartun tebal
  ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 310 + time * 14) % (width + 240)) - 120;
    const cy = 65 + (i % 2) * 42;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.arc(cx + 22, cy - 6, 30, 0, Math.PI * 2);
    ctx.arc(cx + 48, cy, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  // Siluet perbukitan / atap kota jauh (Layer Paralaks 1)
  ctx.fillStyle = t.farHill;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width + 80; x += 80) {
    const hillY = height * 0.62 + Math.sin(x * 0.008 + 1.2) * 34;
    ctx.lineTo(x, hillY);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Siluet rumah / bangunan kampung & atap (Layer Paralaks 2)
  ctx.fillStyle = t.midHill;
  const step = 110;
  for (let x = -20; x < width + step; x += step) {
    const houseH = 55 + ((Math.abs(x * 13) % 45));
    const baseY = height * 0.78;
    ctx.fillRect(x, baseY - houseH, 76, houseH + 140);

    // Atap segitiga
    ctx.beginPath();
    ctx.moveTo(x - 8, baseY - houseH);
    ctx.lineTo(x + 38, baseY - houseH - 26);
    ctx.lineTo(x + 84, baseY - houseH);
    ctx.closePath();
    ctx.fill();
  }

  // Dekorasi tali lentera festival petasan di bagian atas
  ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 24);
  ctx.quadraticCurveTo(width * 0.5, 64, width, 20);
  ctx.stroke();

  for (let i = 1; i <= 7; i++) {
    const ratio = i / 8;
    const lx = width * ratio;
    const ly = 24 + Math.sin(ratio * Math.PI) * 20;
    ctx.fillStyle = i % 2 === 0 ? "#ef4444" : "#facc15";
    ctx.beginPath();
    ctx.roundRect(lx - 6, ly, 12, 16, 4);
    ctx.fill();
  }

  ctx.restore();
}

export function paintStylizedTerrainLayer(terrainCtx, width, height, mapId = "kampung_festival") {
  terrainCtx.save();
  terrainCtx.clearRect(0, 0, width, height);

  const palettes = {
    kampung_festival: {
      topRim: "#bef264",
      grass: "#22c55e",
      soilTop: "#92400e",
      soilDeep: "#451a03",
    },
    atap_senja: {
      topRim: "#fde047",
      grass: "#ea580c",
      soilTop: "#475569",
      soilDeep: "#1e293b",
    },
    jembatan_bulan: {
      topRim: "#7dd3fc",
      grass: "#0284c7",
      soilTop: "#334155",
      soilDeep: "#0f172a",
    },
  };
  const p = palettes[mapId] || palettes.kampung_festival;

  // Buat bentuk daratan sesuai map
  const path = new Path2D();
  if (mapId === "atap_senja") {
    // 3 blok atap bertingkat dengan celah lompatan
    path.roundRect(70, height * 0.58, width * 0.27, height * 0.45, 16);
    path.roundRect(width * 0.38, height * 0.48, width * 0.24, height * 0.55, 16);
    path.roundRect(width * 0.66, height * 0.56, width * 0.27, height * 0.47, 16);
  } else if (mapId === "jembatan_bulan") {
    // Kiri & kanan tinggi + pulau tengah kecil
    path.roundRect(50, height * 0.54, width * 0.28, height * 0.48, 18);
    path.roundRect(width * 0.41, height * 0.64, width * 0.18, height * 0.36, 14);
    path.roundRect(width * 0.67, height * 0.54, width * 0.28, height * 0.48, 18);
  } else {
    // Kampung festival: dataran luas bergelombang halus
    path.moveTo(40, height);
    path.lineTo(40, height * 0.62);
    for (let x = 40; x <= width - 40; x += 20) {
      const y = height * 0.6 + Math.sin((x / width) * Math.PI * 2.5) * 26;
      path.lineTo(x, y);
    }
    path.lineTo(width - 40, height);
    path.closePath();
  }

  // Isi lapisan tanah dengan gradasi dalam
  const soilGrad = terrainCtx.createLinearGradient(0, height * 0.45, 0, height);
  soilGrad.addColorStop(0, p.soilTop);
  soilGrad.addColorStop(1, p.soilDeep);
  terrainCtx.fillStyle = soilGrad;
  terrainCtx.fill(path);

  // Pola batuan/tekstur ringan di dalam tanah
  terrainCtx.save();
  terrainCtx.clip(path);
  terrainCtx.fillStyle = "rgba(255, 255, 255, 0.06)";
  for (let y = Math.floor(height * 0.5); y < height; y += 34) {
    for (let x = 50; x < width - 50; x += 48) {
      terrainCtx.beginPath();
      terrainCtx.arc(x + ((y / 34) % 2) * 20, y, 10, 0, Math.PI * 2);
      terrainCtx.fill();
    }
  }
  terrainCtx.restore();

  // Garis rumput/atap tebal + rim highlight ala Ballistic Hero
  terrainCtx.lineJoin = "round";
  terrainCtx.lineWidth = 14;
  terrainCtx.strokeStyle = p.grass;
  terrainCtx.stroke(path);

  terrainCtx.lineWidth = 4;
  terrainCtx.strokeStyle = p.topRim;
  terrainCtx.stroke(path);

  terrainCtx.restore();
}

export function drawChibiHero2D(ctx, options = {}) {
  const {
    x = 0,
    y = 0,
    scale = 1,
    facing = 1,
    characterId = "udin",
    primaryColor = "#ef4444",
    accentColor = "#facc15",
    walkPhase = 0,
    aimAngle = 0,
    isAiming = false,
    showPedestal = false, // true saat tampil di Lobby
  } = options;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  // Panggung bercahaya di bawah karakter (khusus Lobby ala Ballistic Hero)
  if (showPedestal) {
    const pedGrad = ctx.createRadialGradient(0, 6, 6, 0, 6, 56);
    pedGrad.addColorStop(0, "rgba(254, 240, 138, 0.9)");
    pedGrad.addColorStop(0.6, "rgba(56, 189, 248, 0.45)");
    pedGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
    ctx.fillStyle = pedGrad;
    ctx.beginPath();
    ctx.ellipse(0, 6, 56, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 6, 40, 11, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const legSwing = Math.sin(walkPhase) * 6;

  // Sepatu & kaki chibi
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(-11 - legSwing * 0.4, -9, 10, 8, 4);
  ctx.roundRect(1 + legSwing * 0.4, -9, 10, 8, 4);
  ctx.fill();

  // Badan/kostum chibi ber-outline tegas
  ctx.fillStyle = primaryColor;
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(-13, -29, 26, 21, 8);
  ctx.fill();
  ctx.stroke();

  // Syal / kerah aksen
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.roundRect(-11, -30, 22, 6, 3);
  ctx.fill();

  // Kepala chibi besar ekspresif
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(0, -44, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Mata anime besar & kilau putih
  const ex = facing * 5;
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.ellipse(ex - 4, -44, 2.6, 3.6, 0, 0, Math.PI * 2);
  ctx.ellipse(ex + 5, -44, 2.6, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ex - 4.6, -45.2, 1.1, 0, Math.PI * 2);
  ctx.arc(ex + 4.4, -45.2, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Aksesori karakter
  if (characterId === "udin") {
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(-15, -53, 30, 6);
    ctx.strokeRect(-15, -53, 30, 6);
  } else if (characterId === "sari") {
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.ellipse(0, -56, 21, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (characterId === "hendra") {
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.roundRect(-12, -54, 24, 7, 3);
    ctx.fill();
    ctx.stroke();
  } else if (characterId === "dika") {
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.arc(0, -47, 15.5, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(-facing * 18, -50, 12, 4.5);
  }

  // Lengan & peluncur/petasan
  const armRot = isAiming ? aimAngle : -0.25 * facing;
  ctx.save();
  ctx.translate(facing * 5, -22);
  ctx.rotate(armRot);

  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.roundRect(0, -3.5, 14, 7, 3.5);
  ctx.fill();
  ctx.stroke();

  // Petasan / launcher mini di tangan
  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.roundRect(11, -5, 13, 10, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fef08a";
  ctx.beginPath();
  ctx.arc(26, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.restore();
}