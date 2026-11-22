export const CHARACTERS = {
  udin: {
    id: 'udin',
    name: 'Bang Udin',
    short: 'Udin',
    color: '#d32f2f',
    skin: { shirt: '#e53935', shirt2: '#ffffff', pants: '#5d4037', hair: '#3e2723', skinTone: '#f2c9a0', accessory: 'headband' },
    skills: {
      basic:  { key: 'basic',  label: 'Basic', name: 'Lempar Petasan', cooldown: 0.45, type: 'projectile', projectile: { radius: 34, damage: 22, knock: 220, count: 1, spread: 0, fuse: 4.5, speedMul: 5.2, gravityMul: 1, windMul: 1, bounce: 0 } },
      skill1: { key: 'skill1', label: 'S1', name: 'Petasan Banting', cooldown: 5.0, type: 'projectile', projectile: { radius: 46, damage: 34, knock: 320, count: 1, spread: 0, fuse: 4.5, speedMul: 5.8, gravityMul: 1, windMul: 1, bounce: 0, explodeOnImpact: true } },
      skill2: { key: 'skill2', label: 'S2', name: 'Loncat Dorong', cooldown: 7.0, type: 'dash_jump', dash: { vx: 320, vy: -620, landingRadius: 42, landingDamage: 20, landingKnock: 260 } },
      ulti:   { key: 'ulti',   label: 'ULTI', name: 'Mercon Baret Raksasa', cooldown: 0, type: 'projectile', projectile: { radius: 92, damage: 60, knock: 620, count: 1, spread: 0, fuse: 5.0, speedMul: 4.8, gravityMul: 1, windMul: 1, bounce: 0 } },
    },
  },
  sari: {
    id: 'sari',
    name: 'Mbak Sari',
    short: 'Sari',
    color: '#ec4899',
    skin: { shirt: '#f06292', shirt2: '#fff59d', pants: '#7e57c2', hair: '#4e342e', skinTone: '#f7d1b5', accessory: 'hat_ponytail' },
    skills: {
      basic:  { key: 'basic',  label: 'Basic', name: 'Lempar Petasan', cooldown: 0.45, type: 'projectile', projectile: { radius: 32, damage: 20, knock: 210, count: 1, spread: 0, fuse: 4.5, speedMul: 5.2, gravityMul: 1, windMul: 1, bounce: 0 } },
      skill1: { key: 'skill1', label: 'S1', name: 'Petasan Renteng', cooldown: 6.0, type: 'projectile', projectile: { radius: 30, damage: 18, knock: 150, count: 1, spread: 0, fuse: 4.5, speedMul: 5.0, gravityMul: 1, windMul: 1, bounce: 0, burst: { count: 4, interval: 0.22, radius: 28, damage: 14, knock: 120 } } },
      skill2: { key: 'skill2', label: 'S2', name: 'Petasan Asap', cooldown: 8.0, type: 'projectile', projectile: { radius: 24, damage: 10, knock: 80, count: 1, spread: 0, fuse: 4.5, speedMul: 4.8, gravityMul: 1, windMul: 1, bounce: 0, smoke: { duration: 4.0, radius: 62 } } },
      ulti:   { key: 'ulti',   label: 'ULTI', name: 'Hujan Kembang Api', cooldown: 0, type: 'projectile', projectile: { radius: 34, damage: 24, knock: 180, count: 1, spread: 0, fuse: 5.0, speedMul: 5.0, gravityMul: 1, windMul: 1, bounce: 0, rain: { count: 6, spread: 90, delay: 0.18, radius: 34, damage: 22, knock: 170 } } },
    },
  },
  hendra: {
    id: 'hendra',
    name: 'Mas Hendra',
    short: 'Hendra',
    color: '#455a64',
    skin: { shirt: '#37474f', shirt2: '#90a4ae', pants: '#263238', hair: '#212121', skinTone: '#e0b38f', accessory: 'goggles' },
    skills: {
      basic:  { key: 'basic',  label: 'Basic', name: 'Lempar Petasan', cooldown: 0.45, type: 'projectile', projectile: { radius: 34, damage: 22, knock: 220, count: 1, spread: 0, fuse: 4.5, speedMul: 5.2, gravityMul: 1, windMul: 1, bounce: 0 } },
      skill1: { key: 'skill1', label: 'S1', name: 'Mercon Dorong', cooldown: 5.5, type: 'projectile', projectile: { radius: 40, damage: 20, knock: 560, count: 1, spread: 0, fuse: 4.5, speedMul: 5.4, gravityMul: 1, windMul: 1, bounce: 0 } },
      skill2: { key: 'skill2', label: 'S2', name: 'Tahan Ledak', cooldown: 10.0, type: 'buff', buff: { duration: 3.0, damageMul: 0.45, knockMul: 0.35 } },
      ulti:   { key: 'ulti',   label: 'ULTI', name: 'Ledakan Berantai', cooldown: 0, type: 'projectile', projectile: { radius: 54, damage: 38, knock: 360, count: 1, spread: 0, fuse: 5.0, speedMul: 4.9, gravityMul: 1, windMul: 1, bounce: 0, chain: { count: 2, delay: 0.28, spacing: 44, radius: 42, damage: 26, knock: 260 } } },
    },
  },
  dika: {
    id: 'dika',
    name: 'Dika',
    short: 'Dika',
    color: '#43a047',
    skin: { shirt: '#66bb6a', shirt2: '#c5e1a5', pants: '#1565c0', hair: '#4e342e', skinTone: '#f2c9a0', accessory: 'cap_back' },
    skills: {
      basic:  { key: 'basic',  label: 'Basic', name: 'Lempar Petasan', cooldown: 0.4, type: 'projectile', projectile: { radius: 32, damage: 20, knock: 210, count: 1, spread: 0, fuse: 4.5, speedMul: 5.3, gravityMul: 1, windMul: 1, bounce: 0 } },
      skill1: { key: 'skill1', label: 'S1', name: 'Lemparan Kilat', cooldown: 4.5, type: 'projectile', projectile: { radius: 30, damage: 26, knock: 240, count: 1, spread: 0, fuse: 3.5, speedMul: 8.2, gravityMul: 0.55, windMul: 0.4, bounce: 0 } },
      skill2: { key: 'skill2', label: 'S2', name: 'Petasan Pantul', cooldown: 6.5, type: 'projectile', projectile: { radius: 34, damage: 28, knock: 260, count: 1, spread: 0, fuse: 5.5, speedMul: 5.6, gravityMul: 1, windMul: 1, bounce: 1 } },
      ulti:   { key: 'ulti',   label: 'ULTI', name: 'Kipas Petasan', cooldown: 0, type: 'projectile', projectile: { radius: 36, damage: 26, knock: 240, count: 3, spread: 0.12, fuse: 5.0, speedMul: 5.4, gravityMul: 1, windMul: 1, bounce: 0 } },
    },
  },
};

export const CHARACTER_LIST = Object.values(CHARACTERS);
export function getCharacter(id) { return CHARACTERS[id] || CHARACTERS.udin; }