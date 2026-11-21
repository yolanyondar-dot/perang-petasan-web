/**
 * modeManager.js — aturan mode permainan: FFA, KOTH, CTF.
 */
import * as THREE from 'three';
import { ARENA } from './arena.js';

const TEAM_COLORS = { A: 0x42a5f5, B: 0xef5350 };
const TEAM_NAMES = { A: 'Tim A', B: 'Tim B' };

function makeCircleZone(radius, color = 0xffd54f) {
  const group = new THREE.Group();
  group.name = 'koth-zone';
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.18, radius, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius - 0.2, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.025;
  group.add(disc);
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 2.6, 12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, transparent: true, opacity: 0.35 })
  );
  pillar.position.y = 1.3;
  group.add(pillar);
  const light = new THREE.PointLight(color, 1.2, radius * 3);
  light.position.y = 1.2;
  group.add(light);
  return { group, ring, disc, pillar, light };
}

function makeFlag(team) {
  const color = TEAM_COLORS[team] || 0xffffff;
  const group = new THREE.Group();
  group.name = `flag-${team}`;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.6, 10),
    new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4, metalness: 0.2 })
  );
  pole.position.y = 0.8;
  pole.castShadow = true;
  group.add(pole);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.45),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide, roughness: 0.7 })
  );
  cloth.position.set(0.38, 1.35, 0);
  cloth.castShadow = true;
  group.add(cloth);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 })
  );
  base.position.y = 0.06;
  base.receiveShadow = true;
  group.add(base);
  return { group, cloth, pole, base };
}

function disposeObj(obj) {
  if (!obj) return;
  if (obj.parent) obj.parent.remove(obj);
  obj.traverse?.((n) => {
    if (n.geometry) n.geometry.dispose?.();
    if (n.material) {
      if (Array.isArray(n.material)) n.material.forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
      else { n.material.map?.dispose?.(); n.material.dispose?.(); }
    }
  });
}

export function createModeManager(scene, options = {}) {
  const getPlayers = options.getPlayers || (() => []);
  const getArena = options.getArena || (() => ARENA);
  const onModeEvent = typeof options.onModeEvent === 'function' ? options.onModeEvent : null;

  let mode = 'ffa';
  let roundActive = true;

  // KOTH state
  let kothZone = null;
  let kothScores = new Map(); // player -> points
  let kothStatus = 'Kosong';
  let kothLeader = null;
  const KOTH_TARGET = 100;

  // CTF state
  let ctfFlags = null; // { A: flagState, B: flagState }
  let ctfScores = { A: 0, B: 0 };
  const CTF_TARGET = 3;
  const CTF_BASE_RADIUS = 1.6;
  const CTF_PICKUP_RADIUS = 1.2;
  let teamAssignIndex = 0;

  function getTeam(p) { return p?.team === 'B' ? 'B' : (p?.team === 'A' ? 'A' : null); }

  function assignTeam(player) {
    if (!player) return null;
    if (player.team === 'A' || player.team === 'B') return player.team;
    player.team = teamAssignIndex % 2 === 0 ? 'A' : 'B';
    teamAssignIndex += 1;
    return player.team;
  }

  function ensureTeams() {
    for (const p of getPlayers()) assignTeam(p);
  }

  function resetTeams() {
    teamAssignIndex = 0;
    for (const p of getPlayers()) { p.team = null; assignTeam(p); }
  }

  function clearKoth() {
    if (kothZone?.group) disposeObj(kothZone.group);
    kothZone = null;
    kothScores.clear();
    kothStatus = 'Kosong';
    kothLeader = null;
  }

  function clearCtf() {
    if (ctfFlags) {
      for (const k of ['A', 'B']) {
        const f = ctfFlags[k];
        if (f?.mesh?.group) disposeObj(f.mesh.group);
      }
    }
    ctfFlags = null;
    ctfScores = { A: 0, B: 0 };
  }

  function clearModeObjects() {
    clearKoth();
    clearCtf();
  }

  function initKoth() {
    clearKoth();
    const arena = getArena();
    const hz = arena?.hillZone || ARENA.hillZone || { center: new THREE.Vector3(0, 0, 0), radius: 2.5 };
    kothZone = makeCircleZone(hz.radius, 0xffd54f);
    kothZone.group.position.set(hz.center.x, (hz.center.y || 0) + 0.02, hz.center.z);
    scene.add(kothZone.group);
    for (const p of getPlayers()) kothScores.set(p, 0);
    kothStatus = 'Kosong';
  }

  function initCtf() {
    clearCtf();
    ensureTeams();
    const arena = getArena();
    const fs = arena?.flagSpawns || ARENA.flagSpawns;
    ctfScores = { A: 0, B: 0 };
    ctfFlags = {};
    for (const team of ['A', 'B']) {
      const mesh = makeFlag(team);
      const basePos = (fs?.[team] ? fs[team] : new THREE.Vector3(team === 'A' ? -7 : 7, 0.8, 0)).clone();
      mesh.group.position.copy(basePos);
      scene.add(mesh.group);
      ctfFlags[team] = {
        team,
        mesh,
        basePos: basePos.clone(),
        carrier: null,
        atBase: true,
        dropped: false,
        dropPos: basePos.clone(),
      };
    }
  }

  function setMode(nextMode) {
    mode = ['ffa', 'koth', 'ctf'].includes(nextMode) ? nextMode : 'ffa';
    clearModeObjects();
    if (mode === 'koth') initKoth();
    if (mode === 'ctf') initCtf();
    return mode;
  }

  function getMode() { return mode; }

  function resetRound(arena) {
    roundActive = true;
    if (mode === 'koth') {
      initKoth();
    } else if (mode === 'ctf') {
      initCtf();
    }
  }

  function resetMatch() {
    teamAssignIndex = 0;
    for (const p of getPlayers()) p.team = null;
    if (mode === 'ctf') ensureTeams();
    resetRound();
  }

  function onArenaChanged() {
    // Recreate mode visuals for new arena
    clearModeObjects();
    if (mode === 'koth') initKoth();
    if (mode === 'ctf') initCtf();
  }

  function playerPos(p) {
    try { const t = p.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); } catch (_) { return p.group?.position?.clone() || new THREE.Vector3(); }
  }

  function isActivePlayer(p) {
    return p && !p.eliminated && !p.respawning && (p.hp > 0 || mode !== 'ffa');
  }

  function dropFlag(flagTeam, pos, reason = 'drop') {
    const f = ctfFlags?.[flagTeam];
    if (!f) return;
    if (f.carrier) {
      if (f.carrier.carriedFlag === flagTeam) f.carrier.carriedFlag = null;
      f.carrier = null;
    }
    f.atBase = false;
    f.dropped = true;
    f.dropPos = pos.clone();
    f.dropPos.y = Math.max(0.5, f.dropPos.y);
    f.mesh.group.position.copy(f.dropPos);
    f.mesh.group.rotation.set(0, 0, 0);
    f.mesh.group.visible = true;
    try { onModeEvent?.({ type: 'ctf_drop', team: flagTeam, reason }); } catch (_) {}
  }

  function returnFlag(flagTeam, reason = 'return') {
    const f = ctfFlags?.[flagTeam];
    if (!f) return;
    if (f.carrier && f.carrier.carriedFlag === flagTeam) f.carrier.carriedFlag = null;
    f.carrier = null;
    f.atBase = true;
    f.dropped = false;
    f.mesh.group.position.copy(f.basePos);
    f.mesh.group.rotation.set(0, 0, 0);
    f.mesh.group.visible = true;
    try { onModeEvent?.({ type: 'ctf_return', team: flagTeam, reason }); } catch (_) {}
  }

  function captureFlag(scoringTeam) {
    const enemy = scoringTeam === 'A' ? 'B' : 'A';
    const f = ctfFlags?.[enemy];
    if (!f) return;
    if (f.carrier && f.carrier.carriedFlag === enemy) f.carrier.carriedFlag = null;
    f.carrier = null;
    ctfScores[scoringTeam] = (ctfScores[scoringTeam] || 0) + 1;
    returnFlag(enemy, 'capture');
    try { onModeEvent?.({ type: 'ctf_capture', team: scoringTeam, scores: { ...ctfScores } }); } catch (_) {}
    if (ctfScores[scoringTeam] >= CTF_TARGET) {
      roundActive = false;
      try { onModeEvent?.({ type: 'ctf_win', winnerTeam: scoringTeam, scores: { ...ctfScores } }); } catch (_) {}
    }
  }

  function updateKoth(dt) {
    if (!kothZone) return;
    const center = kothZone.group.position;
    const radius = (getArena()?.hillZone?.radius ?? ARENA.hillZone?.radius ?? 2.5);
    const inside = [];
    for (const p of getPlayers()) {
      if (!p || p.eliminated || p.respawning) continue;
      if (p.hp <= 0) continue;
      const pos = playerPos(p);
      const dx = pos.x - center.x;
      const dz = pos.z - center.z;
      if ((dx * dx + dz * dz) <= radius * radius) inside.push(p);
    }

    if (inside.length === 0) {
      kothStatus = 'Kosong';
      kothLeader = null;
      kothZone.ring.material.color.setHex(0xffd54f);
      kothZone.disc.material.color.setHex(0xffd54f);
      kothZone.light.color.setHex(0xffd54f);
    } else if (inside.length === 1) {
      const p = inside[0];
      kothLeader = p;
      kothStatus = `Dikuasai ${p.name}`;
      const prev = kothScores.get(p) || 0;
      const next = prev + dt * 10; // 10 poin/detik
      kothScores.set(p, next);
      const col = p.color ?? 0xffd54f;
      kothZone.ring.material.color.setHex(col);
      kothZone.disc.material.color.setHex(col);
      kothZone.light.color.setHex(col);
      if (next >= KOTH_TARGET && roundActive) {
        roundActive = false;
        try { onModeEvent?.({ type: 'koth_win', winner: p, scores: getKothScores() }); } catch (_) {}
      }
    } else {
      kothStatus = 'Diperebutkan';
      kothLeader = null;
      kothZone.ring.material.color.setHex(0xff7043);
      kothZone.disc.material.color.setHex(0xff7043);
      kothZone.light.color.setHex(0xff7043);
    }

    // animate zone
    const t = performance.now() * 0.001;
    kothZone.ring.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.15;
    kothZone.pillar.rotation.y += dt * 0.8;
  }

  function updateCtf(dt) {
    if (!ctfFlags) return;
    ensureTeams();
    const arena = getArena();
    const fallY = arena?.fallY ?? ARENA.fallY ?? -12;

    for (const team of ['A', 'B']) {
      const f = ctfFlags[team];
      if (!f) continue;
      const enemyTeam = team === 'A' ? 'B' : 'A';

      // Carrier logic
      if (f.carrier) {
        const c = f.carrier;
        const invalid = !c || c.eliminated || c.respawning || c.hp <= 0 || c.knockoutTimer > 0;
        if (invalid) {
          const pos = playerPos(c);
          dropFlag(team, pos, 'knockout');
        } else {
          // follow carrier
          const pos = playerPos(c);
          const yaw = c.facingYaw || 0;
          f.mesh.group.position.set(pos.x - Math.sin(yaw) * 0.35, pos.y + 0.6, pos.z - Math.cos(yaw) * 0.35);
          f.mesh.group.rotation.y = yaw;
          f.atBase = false;
          f.dropped = false;

          // capture: carrier touches own base
          const base = ctfFlags[c.team]?.basePos;
          if (base) {
            const dx = pos.x - base.x;
            const dz = pos.z - base.z;
            if ((dx * dx + dz * dz) <= CTF_BASE_RADIUS * CTF_BASE_RADIUS) {
              // only if own flag is at base (classic rule) - keep simple and require own flag at base
              const ownFlag = ctfFlags[c.team];
              if (ownFlag?.atBase) {
                captureFlag(c.team);
              }
            }
          }
        }
      }

      // Dropped flag: can be returned by own team, picked by enemy
      if (f.dropped && !f.carrier) {
        const fp = f.mesh.group.position;
        if (fp.y < fallY) { returnFlag(team, 'void'); continue; }
        for (const p of getPlayers()) {
          if (!p || p.eliminated || p.respawning || p.hp <= 0) continue;
          const pos = playerPos(p);
          const dx = pos.x - fp.x; const dz = pos.z - fp.z; const dy = pos.y - fp.y;
          if ((dx * dx + dz * dz + dy * dy) <= CTF_PICKUP_RADIUS * CTF_PICKUP_RADIUS) {
            if (getTeam(p) === team) {
              returnFlag(team, 'returned');
              break;
            } else if (getTeam(p) === enemyTeam && !p.carriedFlag) {
              f.carrier = p; f.dropped = false; f.atBase = false; p.carriedFlag = team;
              try { onModeEvent?.({ type: 'ctf_pickup', team: enemyTeam, flag: team }); } catch (_) {}
              break;
            }
          }
        }
      }

      // At base: enemy can pick up
      if (f.atBase && !f.carrier) {
        const fp = f.basePos;
        for (const p of getPlayers()) {
          if (!p || p.eliminated || p.respawning || p.hp <= 0) continue;
          if (getTeam(p) === team) continue;
          if (p.carriedFlag) continue;
          const pos = playerPos(p);
          const dx = pos.x - fp.x; const dz = pos.z - fp.z; const dy = pos.y - fp.y;
          if ((dx * dx + dz * dz + dy * dy) <= CTF_PICKUP_RADIUS * CTF_PICKUP_RADIUS) {
            f.carrier = p; f.atBase = false; f.dropped = false; p.carriedFlag = team;
            try { onModeEvent?.({ type: 'ctf_pickup', team: enemyTeam, flag: team }); } catch (_) {}
            break;
          }
        }
      }

      // idle bob at base/dropped
      if (!f.carrier) {
        const bobY = (f.atBase ? f.basePos.y : Math.max(0.5, f.dropPos.y)) + Math.sin(performance.now() * 0.003 + (team === 'A' ? 0 : 1.7)) * 0.05;
        f.mesh.group.position.y = bobY;
        f.mesh.group.rotation.y += dt * 1.2;
      }
    }
  }

  function update(dt) {
    if (!roundActive) return;
    if (mode === 'koth') updateKoth(dt);
    if (mode === 'ctf') updateCtf(dt);
  }

  function onPlayerOut(player) {
    if (mode !== 'ctf' || !player) return;
    const flagTeam = player.carriedFlag;
    if (flagTeam) {
      const pos = playerPos(player);
      dropFlag(flagTeam, pos, 'out');
    }
  }

  function onPlayerImpact(player, impact = {}) {
    if (mode !== 'ctf' || !player) return;
    const flagTeam = player.carriedFlag;
    if (!flagTeam) return;
    const mag = impact.magnitude ?? impact.impulse?.length?.() ?? 0;
    const strong = mag >= 8.0 || (player.knockoutTimer > 0);
    if (strong) {
      const pos = playerPos(player);
      dropFlag(flagTeam, pos, 'impact');
    }
  }

  function getKothScores() {
    const out = [];
    for (const p of getPlayers()) out.push({ player: p, score: kothScores.get(p) || 0 });
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function getStatus() {
    if (mode === 'ffa') {
      return { mode, label: 'Free-For-All', detail: 'Bertahan hidup sampai akhir ronde.' };
    }
    if (mode === 'koth') {
      const scores = getKothScores().map((s) => `${s.player.name}: ${Math.floor(s.score)}`).join(' | ');
      return { mode, label: 'King of the Hill', detail: `Zona: ${kothStatus} | Target ${KOTH_TARGET} | ${scores}` };
    }
    if (mode === 'ctf') {
      const a = ctfScores.A || 0; const b = ctfScores.B || 0;
      const carrierA = getPlayers().find((p) => p.carriedFlag === 'B');
      const carrierB = getPlayers().find((p) => p.carriedFlag === 'A');
      const fa = ctfFlags?.A?.atBase ? 'Base' : ctfFlags?.A?.carrier ? `Dibawa ${ctfFlags.A.carrier.name}` : 'Jatuh';
      const fb = ctfFlags?.B?.atBase ? 'Base' : ctfFlags?.B?.carrier ? `Dibawa ${ctfFlags.B.carrier.name}` : 'Jatuh';
      return { mode, label: 'Capture the Flag', detail: `${TEAM_NAMES.A} ${a} - ${b} ${TEAM_NAMES.B} | Bendera A: ${fa} | Bendera B: ${fb}` };
    }
    return { mode, label: mode, detail: '' };
  }

  function getWinner() {
    if (mode === 'koth') {
      const scores = getKothScores();
      return scores[0]?.score >= KOTH_TARGET ? scores[0].player : null;
    }
    if (mode === 'ctf') {
      if ((ctfScores.A || 0) >= CTF_TARGET) return { team: 'A', name: TEAM_NAMES.A };
      if ((ctfScores.B || 0) >= CTF_TARGET) return { team: 'B', name: TEAM_NAMES.B };
      return null;
    }
    return null;
  }

  function isRoundOver() {
    if (mode === 'ffa') return false; // handled by main existing logic
    if (mode === 'koth') return !roundActive;
    if (mode === 'ctf') return !roundActive;
    return false;
  }

  function dispose() {
    clearModeObjects();
  }

  return {
    setMode,
    getMode,
    resetRound,
    resetMatch,
    onArenaChanged,
    update,
    onPlayerOut,
    onPlayerImpact,
    getStatus,
    getWinner,
    isRoundOver,
    assignTeam,
    ensureTeams,
    resetTeams,
    getKothScores,
    get ctfScores() { return { ...ctfScores }; },
    TEAM_COLORS,
  };
}