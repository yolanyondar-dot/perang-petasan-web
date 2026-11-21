import * as THREE from "three";

export function createFirecrackerTexture(options = {}) {
  const {
    bodyColor = "#dc2626",
    stripeColor = "#facc15",
    labelText = "PETASAN",
  } = options;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  // Dasar kertas petasan
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, 256, 256);

  // Pita emas/kuning atas & bawah
  ctx.fillStyle = stripeColor;
  ctx.fillRect(0, 18, 256, 26);
  ctx.fillRect(0, 212, 256, 26);

  // Tekstur serat kertas halus
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let i = 0; i < 180; i++) {
    const x = (i * 37) % 256;
    const y = (i * 73) % 256;
    ctx.fillRect(x, y, 8, 2);
  }

  // Label teks
  ctx.fillStyle = "#fef9c3";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(labelText, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildCharacterMockup({
  color = "#ef4444",
  characterType = "klasik",
} = {}) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: "#f3c69f",
    roughness: 0.55,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: "#1f2937",
    roughness: 0.35,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: "#fbbf24",
    roughness: 0.4,
  });

  // Badan kapsul gaya mainan
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.42, 8, 16),
    bodyMat
  );
  torso.castShadow = true;
  group.add(torso);

  // Kepala bulat
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), skinMat);
  head.position.set(0, 0.86, 0);
  head.castShadow = true;
  group.add(head);

  // Mata
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const leftEye = new THREE.Mesh(eyeGeo, darkMat);
  leftEye.position.set(-0.12, 0.9, 0.3);
  const rightEye = new THREE.Mesh(eyeGeo, darkMat);
  rightEye.position.set(0.12, 0.9, 0.3);
  group.add(leftEye, rightEye);

  // Tangan melayang
  const handGeo = new THREE.SphereGeometry(0.16, 12, 12);
  const leftHand = new THREE.Mesh(handGeo, skinMat);
  leftHand.position.set(-0.58, 0.06, 0.12);
  leftHand.castShadow = true;

  const rightHand = new THREE.Mesh(handGeo, skinMat);
  rightHand.position.set(0.58, 0.06, 0.12);
  rightHand.castShadow = true;
  group.add(leftHand, rightHand);

  // Variasi aksesori ringan sesuai tipe karakter
  if (characterType === "topi") {
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.38, 12),
      accentMat
    );
    hat.position.set(0, 1.32, 0);
    hat.castShadow = true;
    group.add(hat);
  } else if (characterType === "visor") {
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.14, 0.16),
      darkMat
    );
    visor.position.set(0, 0.92, 0.28);
    group.add(visor);
  } else if (characterType === "tanduk") {
    const hornGeo = new THREE.ConeGeometry(0.1, 0.28, 8);
    const leftHorn = new THREE.Mesh(hornGeo, bodyMat);
    leftHorn.position.set(-0.24, 1.22, 0);
    leftHorn.rotation.z = 0.28;

    const rightHorn = new THREE.Mesh(hornGeo, bodyMat);
    rightHorn.position.set(0.24, 1.22, 0);
    rightHorn.rotation.z = -0.28;
    group.add(leftHorn, rightHorn);
  }

  return {
    group,
    leftHand,
    rightHand,
    head,
  };
}

export function buildPetasanMockup(variant = "normal") {
  const group = new THREE.Group();

  const palette = {
    normal: { body: "#dc2626", stripe: "#facc15", label: "DOR!" },
    banting: { body: "#ea580c", stripe: "#fef08a", label: "BANTING" },
    renteng: { body: "#16a34a", stripe: "#fde047", label: "RENTENG" },
  };
  const cfg = palette[variant] || palette.normal;

  const tex = createFirecrackerTexture({
    bodyColor: cfg.body,
    stripeColor: cfg.stripe,
    labelText: cfg.label,
  });

  const cylMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.45,
  });

  if (variant === "renteng") {
    // Ikatan beberapa silinder kecil
    const offsets = [
      [-0.1, 0, -0.08],
      [0.1, 0, -0.08],
      [-0.1, 0, 0.08],
      [0.1, 0, 0.08],
      [0, 0.06, 0],
    ];
    offsets.forEach(([x, y, z]) => {
      const mini = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.42, 10),
        cylMat
      );
      mini.position.set(x, y, z);
      mini.castShadow = true;
      group.add(mini);
    });
  } else {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.52, 14),
      cylMat
    );
    body.castShadow = true;
    group.add(body);
  }

  // Sumbu + percikan api
  const fuseMat = new THREE.MeshStandardMaterial({ color: "#d6d3d1" });
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.18, 8),
    fuseMat
  );
  fuse.position.set(0, 0.34, 0);
  group.add(fuse);

  const sparkMat = new THREE.MeshBasicMaterial({ color: "#ffedd5" });
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), sparkMat);
  spark.position.set(0, 0.44, 0);
  group.add(spark);

  return { group, spark };
}