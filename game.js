const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const hpEl = document.getElementById("hp");
const killsEl = document.getElementById("kills");
const timeEl = document.getElementById("time");
const weaponEl = document.getElementById("weapon");
const slashModeEl = document.getElementById("slash-mode");
const netStatusEl = document.getElementById("net-status");
const versionBadgeEl = document.getElementById("version-badge");
const overlay = document.getElementById("overlay");
const restartBtn = document.getElementById("restart");
const finalTimeEl = document.getElementById("final-time");
const finalKillsEl = document.getElementById("final-kills");
const APP_VERSION = "20260305163202";

const WEAPON_PRESETS = [
  {
    name: "長矛",
    bladeStartRatio: 0.95,
    length: 9.0,
    weight: 5.2,
    center: 5.6,
    headSharpness: 9.4,
    shaftSharpness: 1.2
  },
  {
    name: "大劍",
    bladeStartRatio: 0.26,
    length: 7.1,
    weight: 7.8,
    center: 6.8,
    headSharpness: 8.3,
    shaftSharpness: 7.7
  },
  {
    name: "匕首",
    bladeStartRatio: 0.22,
    length: 3.4,
    weight: 2.2,
    center: 4.2,
    headSharpness: 9.6,
    shaftSharpness: 4.2
  },
  {
    name: "戰槌",
    bladeStartRatio: 0.97,
    length: 6.3,
    weight: 9.3,
    center: 7.6,
    headSharpness: 1.4,
    shaftSharpness: 1.0
  }
];

const ATTACK_MODES = [
  {
    id: "sweep",
    name: "劈砍",
    rangeMult: 1.0,
    arcOverride: (Math.PI * 2) / 3,
    arcMult: 1.0,
    cooldownMult: 1.12,
    damageMult: 1.12,
    knockbackMult: 2.25,
    impulseMult: 2.25
  },
  {
    id: "thrust",
    name: "突刺",
    rangeMult: 1.0,
    arcMult: 0.18,
    cooldownMult: 0.62,
    damageMult: 1.34,
    knockbackMult: 4,
    impulseMult: 4
  },
  {
    id: "breaker",
    name: "橫掃",
    rangeMult: 0.86,
    arcOverride: Math.PI * 2,
    arcMult: 1.42,
    cooldownMult: 1.9,
    damageMult: 0.78,
    knockbackMult: 1,
    impulseMult: 1
  }
];

const CONFIG = {
  player: {
    radius: 14,
    baseSpeed: 320,
    hp: 100,
    invincibleSec: 0.45,
    contactDamage: 12,
    blinkDistance: 290,
    blinkCooldownSec: 1.15
  },
  slash: {
    baseArc: Math.PI * 0.5,
    headHitThreshold: 0.68,
    visualKnockbackScale: 0.065,
    knockbackImpulseScale: 7.2,
    hitboxRadius: 16,
    swingDurationSec: 0.12
  },
  enemy: {
    spawnSec: 1.2,
    minSpawnSec: 0.45,
    accelPerMin: 0.16,
    maxCount: 120,
    edgePadding: 30,
    knockbackDrag: 8.5,
    stunSlowRatio: 0.18,
    weaponArc: Math.PI * 0.22,
    weaponSwingSec: 0.34,
    weaponCooldownSec: 1.3,
    weaponDamage: 4,
    turnLerpPerSec: 2.2
  },
  world: {
    width: 4200,
    height: 2800,
    cameraLerp: 12
  },
  weapon: {
    ...WEAPON_PRESETS[0]
  }
};

const NETWORK_SEND_INTERVAL_SEC = 0.066;
const NETWORK_STALE_SEC = 4;
const ENEMY_CULL_MARGIN = 140;

const state = {
  mouse: { x: 0, y: 0 },
  mouseScreen: { x: 0, y: 0 },
  player: null,
  camera: { x: 0, y: 0 },
  enemies: [],
  deathParticles: [],
  blinkEffects: [],
  elapsed: 0,
  kills: 0,
  spawnTimer: 0,
  slashTimer: 0,
  blinkTimer: 0,
  running: true,
  lastTs: 0,
  weaponIndex: 0,
  attackModeIndex: 0,
  weaponRuntime: null,
  lastHitLabel: "待命",
  slashDirection: 1,
  activeSlash: null,
  enemyById: new Map(),
  remotePlayers: new Map(),
  network: {
    enabled: false,
    status: "離線",
    url: "",
    ws: null,
    localId: "",
    sendTimer: 0
  }
};

const SERVER_ATTACK_KNOCKBACK = {
  thrust: 4,
  sweep: 2.25,
  breaker: 1
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleTo(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getMultiplayerUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("mp") || params.get("ws");
  const configured = window.DANMAKU_WS_URL ? String(window.DANMAKU_WS_URL).trim() : "";
  if (!raw) {
    return configured;
  }
  if (raw === "1" || raw === "on") {
    const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${wsProto}://${window.location.hostname}:8080`;
  }
  return raw;
}

function setNetworkStatus(text) {
  state.network.status = text;
  if (netStatusEl) {
    netStatusEl.textContent = text;
  }
}

function sendRespawnToServer() {
  if (!state.network.enabled || !state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const x = state.player ? state.player.x : CONFIG.world.width * 0.5;
  const y = state.player ? state.player.y : CONFIG.world.height * 0.5;
  state.network.ws.send(
    JSON.stringify({
      type: "respawn",
      state: { x, y }
    })
  );
}

function applyWorldEnemies(enemiesPayload) {
  const seen = new Set();
  for (const enemy of enemiesPayload) {
    const id = String(enemy.id || "");
    if (!id) {
      continue;
    }
    seen.add(id);
    const existing = state.enemyById.get(id);
    if (existing) {
      existing.x = Number(enemy.x) || 0;
      existing.y = Number(enemy.y) || 0;
      existing.vx = Number(enemy.vx) || 0;
      existing.vy = Number(enemy.vy) || 0;
      existing.radius = Number(enemy.radius) || 12;
      existing.sizeFactor = Number(enemy.sizeFactor) || 0.25;
      existing.facing = Number(enemy.facing) || 0;
      existing.weaponRange = Number(enemy.weaponRange) || 36;
      existing.weaponDamage = Number(enemy.weaponDamage) || 4;
      existing.attackState = enemy.attackState || null;
      existing.hitFlash = Number(enemy.hitFlash) || 0;
      existing.status = enemy.status || { bleedSec: 0, bleedDps: 0, stunSec: 0 };
      continue;
    }

    state.enemyById.set(id, {
      id,
      x: Number(enemy.x) || 0,
      y: Number(enemy.y) || 0,
      vx: Number(enemy.vx) || 0,
      vy: Number(enemy.vy) || 0,
      radius: Number(enemy.radius) || 12,
      speed: 0,
      sizeFactor: Number(enemy.sizeFactor) || 0.25,
      facing: Number(enemy.facing) || 0,
      weaponRange: Number(enemy.weaponRange) || 36,
      weaponCooldown: 1.3,
      weaponDamage: Number(enemy.weaponDamage) || 4,
      weaponSwingSec: 0.34,
      attackTimer: 0,
      attackState: enemy.attackState || null,
      hp: 1,
      hitFlash: Number(enemy.hitFlash) || 0,
      status: enemy.status || { bleedSec: 0, bleedDps: 0, stunSec: 0 }
    });
  }

  for (const id of state.enemyById.keys()) {
    if (!seen.has(id)) {
      state.enemyById.delete(id);
    }
  }

  state.enemies = Array.from(state.enemyById.values());
}

function upsertRemotePeer(peerState) {
  if (!peerState || !peerState.id || peerState.id === state.network.localId) {
    return;
  }
  const existing = state.remotePlayers.get(peerState.id);
  const next = {
    id: peerState.id,
    x: Number(peerState.x) || 0,
    y: Number(peerState.y) || 0,
    tx: Number(peerState.x) || 0,
    ty: Number(peerState.y) || 0,
    facing: Number(peerState.facing) || 0,
    hp: Number(peerState.hp) || 0,
    weapon: String(peerState.weapon || "未知"),
    modeId: String(peerState.modeId || "sweep"),
    bladeStartRatio: Number(peerState.bladeStartRatio) || 0.7,
    runtime: peerState.runtime || null,
    attackFx: existing ? existing.attackFx : null,
    t: Number(peerState.t) || Date.now()
  };

  if (existing) {
    next.x = existing.x;
    next.y = existing.y;
    next.tx = Number(peerState.x) || existing.tx;
    next.ty = Number(peerState.y) || existing.ty;
  }

  state.remotePlayers.set(next.id, next);
}

function setupMultiplayer() {
  const url = getMultiplayerUrl();
  if (!url) {
    setNetworkStatus("離線");
    return;
  }

  state.network.enabled = true;
  state.network.url = url;
  setNetworkStatus("連線中");

  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    setNetworkStatus("連線失敗");
    return;
  }

  state.network.ws = ws;

  ws.addEventListener("open", () => {
    setNetworkStatus("已連線(0)");
  });

  ws.addEventListener("close", () => {
    state.network.ws = null;
    state.network.localId = "";
    state.remotePlayers.clear();
    setNetworkStatus("連線中斷");
  });

  ws.addEventListener("error", () => {
    setNetworkStatus("連線錯誤");
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!msg || !msg.type) {
      return;
    }

    if (msg.type === "welcome") {
      state.network.localId = String(msg.id || "");
      state.remotePlayers.clear();
      const peers = Array.isArray(msg.peers) ? msg.peers : [];
      for (const p of peers) {
        upsertRemotePeer(p);
      }
      sendRespawnToServer();
    } else if (msg.type === "peer_join" || msg.type === "peer_state") {
      upsertRemotePeer(msg.peer);
    } else if (msg.type === "peer_attack" && msg.id) {
      const peer = state.remotePlayers.get(String(msg.id));
      if (peer && msg.attack) {
        peer.attackFx = {
          ...msg.attack,
          duration: Math.max(0.06, Number(msg.attack.duration) || 0.2),
          progress: 0
        };
      }
    } else if (msg.type === "peer_leave" && msg.id) {
      state.remotePlayers.delete(String(msg.id));
    } else if (msg.type === "world") {
      if (msg.you && Number.isFinite(Number(msg.you.hp))) {
        state.player.hp = Number(msg.you.hp);
      }
      if (Array.isArray(msg.enemies)) {
        applyWorldEnemies(msg.enemies);
      }
    }

    if (state.network.enabled) {
      setNetworkStatus(`已連線(${state.remotePlayers.size})`);
    }
  });
}

function updateMultiplayer(dt) {
  if (!state.network.enabled || !state.network.ws || !state.player) {
    return;
  }

  for (const [id, peer] of state.remotePlayers) {
    if (Date.now() - peer.t > NETWORK_STALE_SEC * 1000) {
      state.remotePlayers.delete(id);
      continue;
    }
    const t = 1 - Math.exp(-12 * dt);
    peer.x = lerp(peer.x, peer.tx, t);
    peer.y = lerp(peer.y, peer.ty, t);
    if (peer.attackFx) {
      peer.attackFx.progress = clamp(peer.attackFx.progress + dt / peer.attackFx.duration, 0, 1);
      if (peer.attackFx.progress >= 1) {
        peer.attackFx = null;
      }
    }
  }

  if (state.network.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  state.network.sendTimer += dt;
  if (state.network.sendTimer < NETWORK_SEND_INTERVAL_SEC) {
    return;
  }
  state.network.sendTimer = 0;

  state.network.ws.send(
    JSON.stringify({
      type: "state",
      state: {
        x: state.player.x,
        y: state.player.y,
        facing: state.player.facing,
        hp: state.player.hp,
        weapon: CONFIG.weapon.name,
        modeId: ATTACK_MODES[state.attackModeIndex].id,
        bladeStartRatio: CONFIG.weapon.bladeStartRatio ?? CONFIG.slash.headHitThreshold,
        runtime: {
          range: state.weaponRuntime.range,
          arc: state.weaponRuntime.arc,
          baseDamage: state.weaponRuntime.baseDamage,
          baseKnockback: state.weaponRuntime.baseKnockback,
          damageModeMult: state.weaponRuntime.damageModeMult,
          knockbackModeMult: state.weaponRuntime.knockbackModeMult
        }
      }
    })
  );
}

function pointSegmentInfo(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby || 1;
  const rawT = (apx * abx + apy * aby) / abLenSq;
  const t = clamp(rawT, 0, 1);
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  const dx = point.x - closestX;
  const dy = point.y - closestY;

  return {
    t,
    distance: Math.hypot(dx, dy)
  };
}

function spawnDeathShatter(enemy) {
  const shardCount = 10 + Math.floor(Math.random() * 6);
  for (let i = 0; i < shardCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 110 + Math.random() * 280 + enemy.radius * 2.2;
    const life = 0.22 + Math.random() * 0.26;
    const size = 2 + Math.random() * (enemy.radius * 0.22);

    state.deathParticles.push({
      x: enemy.x + Math.cos(angle) * (enemy.radius * 0.2),
      y: enemy.y + Math.sin(angle) * (enemy.radius * 0.2),
      vx: Math.cos(angle) * speed + enemy.vx * 0.12,
      vy: Math.sin(angle) * speed + enemy.vy * 0.12,
      life,
      maxLife: life,
      size,
      spin: (Math.random() - 0.5) * 12,
      rot: Math.random() * Math.PI * 2
    });
  }
}

function updateDeathParticles(dt) {
  const drag = Math.exp(-6.8 * dt);
  for (const p of state.deathParticles) {
    p.life -= dt;
    p.vx *= drag;
    p.vy *= drag;
    p.vy += 180 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }
  state.deathParticles = state.deathParticles.filter((p) => p.life > 0);
}

function drawDeathParticles() {
  for (const p of state.deathParticles) {
    const alpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = `rgba(255, 175, 205, ${alpha.toFixed(3)})`;
    ctx.fillRect(-p.size, -p.size * 0.55, p.size * 2, p.size * 1.1);
    ctx.restore();
  }
}

function spawnBlinkBurst(x, y) {
  state.blinkEffects.push({
    kind: "ring",
    x,
    y,
    r: 10,
    life: 0.26,
    maxLife: 0.26
  });

  const shardCount = 14;
  for (let i = 0; i < shardCount; i += 1) {
    const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.2;
    const speed = 160 + Math.random() * 210;
    const life = 0.18 + Math.random() * 0.22;
    state.blinkEffects.push({
      kind: "shard",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: 2 + Math.random() * 3
    });
  }
}

function tryBlink() {
  if (!state.running || !state.player) {
    return;
  }
  if (state.blinkTimer < CONFIG.player.blinkCooldownSec) {
    return;
  }

  const p = state.player;
  let dx = state.mouse.x - p.x;
  let dy = state.mouse.y - p.y;
  let len = Math.hypot(dx, dy);
  if (len < 0.001) {
    dx = Math.cos(p.facing);
    dy = Math.sin(p.facing);
    len = 1;
  }

  const step = Math.min(CONFIG.player.blinkDistance, len);
  const nx = dx / len;
  const ny = dy / len;
  const startX = p.x;
  const startY = p.y;

  p.x = clamp(startX + nx * step, CONFIG.player.radius, CONFIG.world.width - CONFIG.player.radius);
  p.y = clamp(startY + ny * step, CONFIG.player.radius, CONFIG.world.height - CONFIG.player.radius);
  p.facing = Math.atan2(ny, nx);
  state.blinkTimer = 0;
  state.lastHitLabel = "閃現";

  spawnBlinkBurst(startX, startY);
  spawnBlinkBurst(p.x, p.y);
  updateCamera(0.016);
}

function updateBlinkEffects(dt) {
  for (const fx of state.blinkEffects) {
    fx.life -= dt;
    if (fx.kind === "ring") {
      fx.r += 300 * dt;
    } else {
      fx.vx *= Math.exp(-8.5 * dt);
      fx.vy *= Math.exp(-8.5 * dt);
      fx.x += fx.vx * dt;
      fx.y += fx.vy * dt;
    }
  }
  state.blinkEffects = state.blinkEffects.filter((fx) => fx.life > 0);
}

function drawBlinkEffects() {
  for (const fx of state.blinkEffects) {
    const alpha = clamp(fx.life / fx.maxLife, 0, 1);
    if (fx.kind === "ring") {
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(130, 235, 255, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(168, 250, 255, ${alpha.toFixed(3)})`;
      ctx.fillRect(fx.x - fx.size, fx.y - fx.size * 0.5, fx.size * 2, fx.size);
    }
  }
}

function getCameraBounds() {
  const halfW = canvas.width * 0.5;
  const halfH = canvas.height * 0.5;
  return {
    minX: halfW,
    maxX: Math.max(halfW, CONFIG.world.width - halfW),
    minY: halfH,
    maxY: Math.max(halfH, CONFIG.world.height - halfH)
  };
}

function clampCamera() {
  const bounds = getCameraBounds();
  state.camera.x = clamp(state.camera.x, bounds.minX, bounds.maxX);
  state.camera.y = clamp(state.camera.y, bounds.minY, bounds.maxY);
}

function updateMouseWorld() {
  state.mouse.x = state.camera.x + state.mouseScreen.x - canvas.width * 0.5;
  state.mouse.y = state.camera.y + state.mouseScreen.y - canvas.height * 0.5;
}

function updateCamera(dt) {
  const bounds = getCameraBounds();
  const targetX = clamp(state.player.x, bounds.minX, bounds.maxX);
  const targetY = clamp(state.player.y, bounds.minY, bounds.maxY);
  const t = 1 - Math.exp(-CONFIG.world.cameraLerp * dt);
  state.camera.x = lerp(state.camera.x, targetX, t);
  state.camera.y = lerp(state.camera.y, targetY, t);
  clampCamera();
  updateMouseWorld();
}

function getNearestEnemyAngle(origin) {
  let nearest = null;
  let nearestDistSq = Infinity;
  for (const enemy of state.enemies) {
    const dx = enemy.x - origin.x;
    const dy = enemy.y - origin.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestDistSq) {
      nearestDistSq = d2;
      nearest = enemy;
    }
  }
  if (!nearest) {
    return angleTo(origin, state.mouse);
  }
  return angleTo(origin, nearest);
}

function cycleWeapon() {
  state.weaponIndex = (state.weaponIndex + 1) % WEAPON_PRESETS.length;
  Object.assign(CONFIG.weapon, WEAPON_PRESETS[state.weaponIndex]);
  state.weaponRuntime = deriveWeaponRuntime();
  state.lastHitLabel = "切換武器";
  updateHud();
}

function cycleAttackMode() {
  state.attackModeIndex = (state.attackModeIndex + 1) % ATTACK_MODES.length;
  state.weaponRuntime = deriveWeaponRuntime();
  state.lastHitLabel = "切換模式";
  updateHud();
}

function deriveWeaponRuntime() {
  const weapon = CONFIG.weapon;
  const mode = ATTACK_MODES[state.attackModeIndex];
  const L = clamp(weapon.length, 1, 10);
  const W = clamp(weapon.weight, 1, 10);
  const C = clamp(weapon.center, 1, 10);
  const headS = clamp(weapon.headSharpness, 1, 10);
  const shaftS = clamp(weapon.shaftSharpness, 1, 10);
  const avgS = (headS + shaftS) * 0.5;

  const moveMultiplier = clamp(1 - W / 16, 0.45, 1.0);
  const range = (46 + L * 11) * mode.rangeMult;
  const computedArc = (CONFIG.slash.baseArc + (L - 5.5) * 0.02) * mode.arcMult;
  const arc = clamp(mode.arcOverride ?? computedArc, Math.PI * 0.18, Math.PI * 2);
  const baseCooldown = clamp(0.46 - C * 0.024 + W * 0.018 + L * 0.01, 0.11, 0.9);
  const agilityBonus = clamp((6 - L) * 0.05 + (6 - W) * 0.045, -0.12, 0.36);
  const cooldown = clamp(baseCooldown * (1 - agilityBonus) * mode.cooldownMult, 0.06, 0.95);
  const baseDamage = 6 + W * 2.4 + C * 1.7 + L * 0.7;
  const baseKnockback = 30 + W * 9 + L * 4 + (5 - avgS) * 5;
  const bleedChanceBase = clamp((headS - 6) / 22 + (C - 5) / 70, 0.02, 0.45);
  const bleedDpsBase = 2 + headS * 0.9 + W * 0.35;
  const bleedDuration = clamp(0.9 + C * 0.18 + L * 0.05, 1.0, 3.4);
  const baseStunSec = clamp(0.04 + W * 0.013 + (5 - avgS) * 0.01, 0.04, 0.28);

  return {
    moveMultiplier,
    range,
    arc,
    cooldown,
    baseDamage,
    baseKnockback,
    bleedChanceBase,
    bleedDpsBase,
    bleedDuration,
    baseStunSec,
    damageModeMult: mode.damageMult,
    knockbackModeMult: mode.knockbackMult,
    impulseModeMult: mode.impulseMult
  };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(480, Math.floor(rect.width));
  const height = Math.max(270, Math.floor(rect.height));

  if (width === canvas.width && height === canvas.height) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
  if (state.player) {
    clampCamera();
    updateMouseWorld();
  }
}

function spawnEnemy() {
  const padding = CONFIG.enemy.edgePadding;
  const edge = Math.floor(Math.random() * 4);
  const viewLeft = state.camera.x - canvas.width * 0.5;
  const viewRight = state.camera.x + canvas.width * 0.5;
  const viewTop = state.camera.y - canvas.height * 0.5;
  const viewBottom = state.camera.y + canvas.height * 0.5;
  let x = 0;
  let y = 0;

  if (edge === 0) {
    x = lerp(viewLeft, viewRight, Math.random());
    y = viewTop - padding;
  } else if (edge === 1) {
    x = viewRight + padding;
    y = lerp(viewTop, viewBottom, Math.random());
  } else if (edge === 2) {
    x = lerp(viewLeft, viewRight, Math.random());
    y = viewBottom + padding;
  } else {
    x = viewLeft - padding;
    y = lerp(viewTop, viewBottom, Math.random());
  }

  x = clamp(x, padding, CONFIG.world.width - padding);
  y = clamp(y, padding, CONFIG.world.height - padding);

  const intensity = 1 + (state.elapsed / 60) * CONFIG.enemy.accelPerMin;
  const roll = Math.random();
  let radius = 12;
  let speedBase = 86;
  let hpBase = 160;
  let sizeFactor = 0.25;

  if (roll > 0.9) {
    radius = 22;
    speedBase = 62;
    hpBase = 360;
    sizeFactor = 1.2;
  } else if (roll > 0.62) {
    radius = 17;
    speedBase = 74;
    hpBase = 240;
    sizeFactor = 0.7;
  }

  const speed = speedBase * intensity;
  const weaponRange = radius * 1.85 + 16;
  const weaponCooldown = CONFIG.enemy.weaponCooldownSec + sizeFactor * 0.4;
  const weaponDamage = CONFIG.enemy.weaponDamage + sizeFactor * 2.6;
  const weaponSwingSec = CONFIG.enemy.weaponSwingSec + sizeFactor * 0.06;

  state.enemies.push({
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    speed,
    sizeFactor,
    facing: Math.random() * Math.PI * 2,
    weaponRange,
    weaponCooldown,
    weaponDamage,
    weaponSwingSec,
    attackTimer: Math.random() * weaponCooldown,
    attackState: null,
    hp: hpBase,
    hitFlash: 0,
    status: {
      bleedSec: 0,
      bleedDps: 0,
      stunSec: 0
    }
  });
}

function applyBleed(enemy, sharpness, runtime) {
  const chance = clamp(runtime.bleedChanceBase + (sharpness - 7) * 0.09, 0, 0.72);
  if (Math.random() >= chance) {
    return;
  }

  const dps = runtime.bleedDpsBase * (1 + (sharpness - 7) * 0.18);
  enemy.status.bleedSec = Math.max(enemy.status.bleedSec, runtime.bleedDuration);
  enemy.status.bleedDps = Math.max(enemy.status.bleedDps, dps);
}

function applyStun(enemy, runtime) {
  const weapon = CONFIG.weapon;
  const chance = clamp(0.1 + enemy.sizeFactor * 0.12 + weapon.weight * 0.012, 0, 0.65);
  if (Math.random() >= chance) {
    return;
  }

  const duration =
    runtime.baseStunSec *
    (0.65 + weapon.weight / 16) *
    (0.8 + enemy.sizeFactor * 0.25) *
    1.9;
  enemy.status.stunSec = Math.max(enemy.status.stunSec, duration);
}

function calculateHitEffect(enemy, hitRatio) {
  const weapon = CONFIG.weapon;
  const runtime = state.weaponRuntime;
  const bladeStartRatio = weapon.bladeStartRatio ?? CONFIG.slash.headHitThreshold;
  const isHeadHit = hitRatio >= bladeStartRatio;
  const sharpness = isHeadHit ? weapon.headSharpness : weapon.shaftSharpness;

  let damage = runtime.baseDamage;
  let knockback = runtime.baseKnockback;
  let hitLabel = "混合";

  if (sharpness >= 7) {
    const sharpBonus = 1 + (sharpness - 7) * 0.14;
    damage *= sharpBonus;
    knockback *= 1.6;
    applyBleed(enemy, sharpness, runtime);
    hitLabel = "利刃";
  } else if (sharpness <= 3) {
    const bluntEnergy = 1 + (3 - sharpness) * 0.16;
    knockback *= 0.5 * bluntEnergy;
    applyStun(enemy, runtime);
    hitLabel = "鈍擊";
  } else {
    const hybridBonus = 1 + (sharpness - 5) * 0.05;
    damage *= hybridBonus;
    hitLabel = "混合";
  }

  knockback *= 1 / (1 + enemy.sizeFactor);
  damage *= runtime.damageModeMult;
  knockback *= runtime.knockbackModeMult;

  return {
    damage,
    knockback,
    hitLabel
  };
}

function getSlashDuration(runtime, mode) {
  const cleaveArc = (Math.PI * 2) / 3;
  const baseDuration = Math.min(CONFIG.slash.swingDurationSec, runtime.cooldown * 0.6);
  const arcDurationScale = mode.id === "breaker" ? runtime.arc / cleaveArc : 1;
  return clamp(baseDuration * arcDurationScale, 0.08, runtime.cooldown * 0.95);
}

function sendAttackEvent(slash, mode, runtime) {
  if (!state.network.enabled || !state.network.ws || state.network.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  state.network.ws.send(
    JSON.stringify({
      type: "attack",
      attack: {
        modeId: mode.id,
        centerAngle: slash.centerAngle,
        startAngle: slash.startAngle,
        endAngle: slash.endAngle,
        direction: slash.direction,
        range: runtime.range,
        arc: runtime.arc,
        duration: slash.duration,
        bladeStartRatio: CONFIG.weapon.bladeStartRatio ?? CONFIG.slash.headHitThreshold
      }
    })
  );
}

function startSlash() {
  const player = state.player;
  const runtime = state.weaponRuntime;
  const mode = ATTACK_MODES[state.attackModeIndex];
  const facing = getNearestEnemyAngle(player);
  const direction = state.slashDirection;
  const halfArc = runtime.arc * 0.5;

  const startAngle = facing - halfArc * direction;
  const endAngle = facing + halfArc * direction;

  state.activeSlash = {
    progress: 0,
    direction,
    centerAngle: facing,
    startAngle,
    endAngle,
    currentAngle: startAngle,
    hitEnemyIds: new Set(),
    duration: getSlashDuration(runtime, mode),
    modeId: mode.id
  };

  state.slashDirection *= -1;
  state.lastHitLabel = "揮空";
  sendAttackEvent(state.activeSlash, mode, runtime);
}

function applySlashHitbox(slashAngle, hitEnemyIds, previewOnly = false) {
  const player = state.player;
  const runtime = state.weaponRuntime;
  const mode = ATTACK_MODES[state.attackModeIndex];
  const slashProgress = state.activeSlash ? state.activeSlash.progress : 1;
  const thrustBurst =
    mode.id === "thrust"
      ? (2.2 + Math.sin(slashProgress * Math.PI) * 1.3) * 0.2
      : 1;
  const tip = {
    x: player.x + Math.cos(slashAngle) * runtime.range,
    y: player.y + Math.sin(slashAngle) * runtime.range
  };

  for (const enemy of state.enemies) {
    if (hitEnemyIds.has(enemy)) {
      continue;
    }

    const segment = pointSegmentInfo(enemy, player, tip);
    const hitRadius = enemy.radius + CONFIG.slash.hitboxRadius;

    if (segment.distance > hitRadius) {
      continue;
    }

    const effect = calculateHitEffect(enemy, segment.t);
    if (!previewOnly) {
      enemy.hp -= effect.damage;
    }
    enemy.hitFlash = 0.08;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const len = Math.hypot(dx, dy);
    const pushX = len > 0.001 ? dx / len : Math.cos(slashAngle);
    const pushY = len > 0.001 ? dy / len : Math.sin(slashAngle);

    const previewScale = previewOnly ? 0.55 : 1;
    enemy.x += pushX * effect.knockback * CONFIG.slash.visualKnockbackScale * thrustBurst * previewScale;
    enemy.y += pushY * effect.knockback * CONFIG.slash.visualKnockbackScale * thrustBurst * previewScale;
    enemy.vx +=
      pushX *
      effect.knockback *
      CONFIG.slash.knockbackImpulseScale *
      runtime.impulseModeMult *
      thrustBurst *
      previewScale;
    enemy.vy +=
      pushY *
      effect.knockback *
      CONFIG.slash.knockbackImpulseScale *
      runtime.impulseModeMult *
      thrustBurst *
      previewScale;

    state.lastHitLabel = effect.hitLabel;
    hitEnemyIds.add(enemy);
  }
}

function updateActiveSlash(dt, applyHits = true, previewOnly = false) {
  if (!state.activeSlash) {
    return;
  }

  const slash = state.activeSlash;
  const nextProgress = clamp(slash.progress + dt / slash.duration, 0, 1);

  slash.progress = nextProgress;
  slash.currentAngle = lerp(slash.startAngle, slash.endAngle, slash.progress);
  if (applyHits) {
    applySlashHitbox(slash.currentAngle, slash.hitEnemyIds, previewOnly);
  }

  if (slash.progress >= 1) {
    state.activeSlash = null;
  }
}

function startEnemyAttack(enemy, targetAngle) {
  enemy.attackState = {
    progress: 0,
    centerAngle: targetAngle,
    currentAngle: targetAngle,
    reachScale: 0.62,
    hitApplied: false
  };
}

function tryEnemyWeaponHit(enemy) {
  if (!enemy.attackState || enemy.attackState.hitApplied) {
    return;
  }

  const player = state.player;
  const attack = enemy.attackState;
  const toPlayer = dist(enemy, player);
  const effectiveRange = enemy.weaponRange * attack.reachScale;
  if (toPlayer > effectiveRange + CONFIG.player.radius) {
    return;
  }

  const diff = Math.abs(angleDiff(angleTo(enemy, player), attack.currentAngle));
  if (diff > CONFIG.enemy.weaponArc * 0.5) {
    return;
  }

  if (player.invincible <= 0) {
    player.hp -= enemy.weaponDamage;
    player.invincible = CONFIG.player.invincibleSec;
  }
  enemy.attackState.hitApplied = true;
}

function update(dt) {
  if (!state.running) {
    return;
  }

  state.elapsed += dt;
  state.spawnTimer += dt;
  state.slashTimer += dt;
  state.blinkTimer += dt;

  const player = state.player;
  const runtime = state.weaponRuntime;

  const toMouseX = state.mouse.x - player.x;
  const toMouseY = state.mouse.y - player.y;
  const distance = Math.hypot(toMouseX, toMouseY);

  if (distance > 6) {
    const speed = CONFIG.player.baseSpeed * runtime.moveMultiplier;
    const moveDistance = Math.min(distance, speed * dt);
    player.x += (toMouseX / distance) * moveDistance;
    player.y += (toMouseY / distance) * moveDistance;
  }

  player.x = clamp(player.x, CONFIG.player.radius, CONFIG.world.width - CONFIG.player.radius);
  player.y = clamp(player.y, CONFIG.player.radius, CONFIG.world.height - CONFIG.player.radius);
  player.facing = getNearestEnemyAngle(player);
  updateCamera(dt);

  if (!state.network.enabled) {
    const spawnInterval = Math.max(
      CONFIG.enemy.minSpawnSec,
      CONFIG.enemy.spawnSec - state.elapsed * 0.004
    );

    while (state.spawnTimer >= spawnInterval && state.enemies.length < CONFIG.enemy.maxCount) {
      state.spawnTimer -= spawnInterval;
      spawnEnemy();
    }
  }

  if (!state.activeSlash && state.slashTimer >= runtime.cooldown) {
    state.slashTimer -= runtime.cooldown;
    startSlash();
  }

  updateActiveSlash(dt, true, state.network.enabled);

  if (!state.network.enabled) {
    for (const enemy of state.enemies) {
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);

      if (enemy.status.bleedSec > 0) {
        enemy.status.bleedSec = Math.max(0, enemy.status.bleedSec - dt);
        enemy.hp -= enemy.status.bleedDps * dt;
        if (enemy.status.bleedSec === 0) {
          enemy.status.bleedDps = 0;
        }
      }

      if (enemy.status.stunSec > 0) {
        enemy.status.stunSec = Math.max(0, enemy.status.stunSec - dt);
      }

      const drag = Math.exp(-CONFIG.enemy.knockbackDrag * dt);
      enemy.vx *= drag;
      enemy.vy *= drag;
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;

      const ang = angleTo(enemy, player);
      const turnT = 1 - Math.exp(-CONFIG.enemy.turnLerpPerSec * dt);
      enemy.facing = lerp(enemy.facing, ang, turnT);
      const chaseScale = enemy.status.stunSec > 0 ? CONFIG.enemy.stunSlowRatio : 1;
      enemy.x += Math.cos(ang) * enemy.speed * chaseScale * dt;
      enemy.y += Math.sin(ang) * enemy.speed * chaseScale * dt;

      if (enemy.attackState) {
        const attack = enemy.attackState;
        attack.progress = clamp(attack.progress + dt / enemy.weaponSwingSec, 0, 1);
        attack.currentAngle = attack.centerAngle;
        if (attack.progress < 0.28) {
          attack.reachScale = 0.62 + (attack.progress / 0.28) * 0.78;
        } else if (attack.progress < 0.58) {
          attack.reachScale = 1.4;
        } else {
          attack.reachScale = 1.4 - ((attack.progress - 0.58) / 0.42) * 0.58;
        }
        tryEnemyWeaponHit(enemy);
        if (attack.progress >= 1) {
          enemy.attackState = null;
          enemy.attackTimer = 0;
        }
      } else if (enemy.status.stunSec <= 0) {
        enemy.attackTimer += dt;
        if (
          enemy.attackTimer >= enemy.weaponCooldown &&
          dist(enemy, player) <= enemy.weaponRange + CONFIG.player.radius + 6
        ) {
          startEnemyAttack(enemy, enemy.facing);
        }
      }
    }
  }

  player.invincible = Math.max(0, player.invincible - dt);

  if (!state.network.enabled) {
    state.enemies = state.enemies.filter((enemy) => {
      if (enemy.hp > 0) {
        return true;
      }
      spawnDeathShatter(enemy);
      state.kills += 1;
      return false;
    });
  }

  updateDeathParticles(dt);
  updateBlinkEffects(dt);
  updateMultiplayer(dt);

  if (player.hp <= 0) {
    state.running = false;
    finalTimeEl.textContent = state.elapsed.toFixed(1);
    finalKillsEl.textContent = String(state.kills);
    overlay.classList.remove("hidden");
  }

  updateHud();
}

function drawWeaponHitbox() {
  const player = state.player;
  const runtime = state.weaponRuntime;
  const slash = state.activeSlash;
  if (!slash) {
    return;
  }
  const mode = ATTACK_MODES[state.attackModeIndex];
  const isThrustMode = mode.id === "thrust";
  const angle = slash
    ? (isThrustMode ? slash.centerAngle : slash.currentAngle)
    : player.facing;
  let reachScale = 1;
  if (slash && isThrustMode) {
    const p = slash.progress;
    if (p < 0.24) {
      reachScale = 0.58 + (p / 0.24) * 0.88;
    } else if (p < 0.56) {
      reachScale = 1.46;
    } else {
      reachScale = 1.46 - ((p - 0.56) / 0.44) * 0.56;
    }
  }

  const anchorX = player.x;
  const anchorY = player.y;
  const bladeStartRatio = CONFIG.weapon.bladeStartRatio ?? CONFIG.slash.headHitThreshold;
  const headStartDistance = runtime.range * bladeStartRatio * reachScale;
  const tipDistance = runtime.range * reachScale;
  const headStartX = anchorX + Math.cos(angle) * headStartDistance;
  const headStartY = anchorY + Math.sin(angle) * headStartDistance;
  const tipX = anchorX + Math.cos(angle) * tipDistance;
  const tipY = anchorY + Math.sin(angle) * tipDistance;
  const coreWidth = CONFIG.slash.hitboxRadius * 1.9;
  const shaftColor = "rgba(209, 168, 112, 0.96)";
  const bladeColor = "rgba(225, 248, 255, 0.98)";

  if (!isThrustMode) {
    ctx.beginPath();
    ctx.arc(
      player.x,
      player.y,
      runtime.range * 0.74,
      slash.startAngle,
      slash.currentAngle,
      slash.direction < 0
    );
    ctx.strokeStyle = "rgba(57, 217, 138, 0.25)";
    ctx.lineWidth = CONFIG.slash.hitboxRadius * 1.2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  if (isThrustMode) {
    const trailTipX = player.x + Math.cos(angle) * runtime.range * 1.52;
    const trailTipY = player.y + Math.sin(angle) * runtime.range * 1.52;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(trailTipX, trailTipY);
    ctx.strokeStyle = "rgba(180, 230, 245, 0.2)";
    ctx.lineWidth = CONFIG.slash.hitboxRadius;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(headStartX, headStartY);
  ctx.strokeStyle = shaftColor;
  ctx.lineWidth = coreWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(headStartX, headStartY);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = bladeColor;
  ctx.lineWidth = coreWidth * 0.82;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(headStartX, headStartY, coreWidth * 0.44, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(235, 210, 166, 0.9)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(tipX, tipY, coreWidth * 0.48, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(244, 251, 255, 0.95)";
  ctx.fill();
}

function drawEnemy(enemy) {
  const weaponAngle = enemy.attackState ? enemy.attackState.currentAngle : enemy.facing;
  const reachScale = enemy.attackState ? enemy.attackState.reachScale : 0.62;
  const weaponLength = enemy.weaponRange * reachScale;
  const handleLength = weaponLength * 0.66;
  const tipX = enemy.x + Math.cos(weaponAngle) * weaponLength;
  const tipY = enemy.y + Math.sin(weaponAngle) * weaponLength;
  const midX = enemy.x + Math.cos(weaponAngle) * handleLength;
  const midY = enemy.y + Math.sin(weaponAngle) * handleLength;

  if (enemy.attackState) {
    const trailX = enemy.x + Math.cos(weaponAngle) * enemy.weaponRange * 1.35;
    const trailY = enemy.y + Math.sin(weaponAngle) * enemy.weaponRange * 1.35;
    ctx.beginPath();
    ctx.moveTo(enemy.x, enemy.y);
    ctx.lineTo(trailX, trailY);
    ctx.strokeStyle = "rgba(255, 120, 120, 0.22)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(enemy.x, enemy.y);
  ctx.lineTo(midX, midY);
  ctx.strokeStyle = "rgba(132, 94, 74, 0.88)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = "rgba(218, 238, 250, 0.92)";
  ctx.lineWidth = 3.1;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);

  if (enemy.hitFlash > 0) {
    ctx.fillStyle = "#ffe07a";
  } else if (enemy.status.stunSec > 0) {
    ctx.fillStyle = "#ffb066";
  } else if (enemy.status.bleedSec > 0) {
    ctx.fillStyle = "#ff5a87";
  } else {
    ctx.fillStyle = "#ff6e6e";
  }

  ctx.fill();
}

function drawRemotePlayer(peer) {
  ctx.beginPath();
  ctx.arc(peer.x, peer.y, CONFIG.player.radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(136, 198, 255, 0.78)";
  ctx.fill();

  drawFacingArrow({
    x: peer.x,
    y: peer.y,
    facing: peer.facing
  });

  ctx.fillStyle = "rgba(188, 225, 255, 0.95)";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText(peer.weapon, peer.x, peer.y - CONFIG.player.radius - 12);
}

function drawRemoteAttack(peer) {
  if (!peer.attackFx) {
    return;
  }
  const fx = peer.attackFx;
  const modeId = fx.modeId || "sweep";
  const isThrustMode = modeId === "thrust";
  const progress = clamp(fx.progress, 0, 1);
  const range = Number(fx.range) || 90;
  const angle = isThrustMode
    ? Number(fx.centerAngle) || peer.facing
    : lerp(Number(fx.startAngle) || peer.facing, Number(fx.endAngle) || peer.facing, progress);
  const bladeStartRatio = Number(fx.bladeStartRatio) || 0.7;
  const coreWidth = CONFIG.slash.hitboxRadius * 1.8;
  const shaftDist = range * bladeStartRatio;
  const tipDist = range;

  const shaftX = peer.x + Math.cos(angle) * shaftDist;
  const shaftY = peer.y + Math.sin(angle) * shaftDist;
  const tipX = peer.x + Math.cos(angle) * tipDist;
  const tipY = peer.y + Math.sin(angle) * tipDist;

  if (!isThrustMode) {
    ctx.beginPath();
    ctx.arc(
      peer.x,
      peer.y,
      range * 0.72,
      Number(fx.startAngle) || peer.facing,
      angle,
      Number(fx.direction) < 0
    );
    ctx.strokeStyle = "rgba(130, 230, 160, 0.2)";
    ctx.lineWidth = CONFIG.slash.hitboxRadius * 1.1;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(peer.x, peer.y);
  ctx.lineTo(shaftX, shaftY);
  ctx.strokeStyle = "rgba(209, 168, 112, 0.88)";
  ctx.lineWidth = coreWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(shaftX, shaftY);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = "rgba(218, 245, 255, 0.92)";
  ctx.lineWidth = coreWidth * 0.8;
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawPlayer() {
  const player = state.player;

  ctx.beginPath();
  ctx.arc(player.x, player.y, CONFIG.player.radius, 0, Math.PI * 2);
  ctx.fillStyle = player.invincible > 0 ? "#7fd8ff" : "#d7e7ff";
  ctx.fill();

  drawFacingArrow(player);
}

function drawFacingArrow(player) {
  const angle = player.facing;
  const baseDist = CONFIG.player.radius + 9;
  const tipDist = baseDist + 24;
  const wingDist = tipDist - 10;
  const wingSpread = 0.62;

  const baseX = player.x + Math.cos(angle) * baseDist;
  const baseY = player.y + Math.sin(angle) * baseDist;
  const tipX = player.x + Math.cos(angle) * tipDist;
  const tipY = player.y + Math.sin(angle) * tipDist;
  const leftX = player.x + Math.cos(angle + wingSpread) * wingDist;
  const leftY = player.y + Math.sin(angle + wingSpread) * wingDist;
  const rightX = player.x + Math.cos(angle - wingSpread) * wingDist;
  const rightY = player.y + Math.sin(angle - wingSpread) * wingDist;

  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = "rgba(140, 255, 190, 0.98)";
  ctx.lineWidth = 3.6;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = "rgba(190, 255, 220, 0.98)";
  ctx.fill();
}

function drawWorldBackground() {
  const grid = 120;
  const startX = Math.floor((state.camera.x - canvas.width * 0.5) / grid) * grid;
  const endX = Math.ceil((state.camera.x + canvas.width * 0.5) / grid) * grid;
  const startY = Math.floor((state.camera.y - canvas.height * 0.5) / grid) * grid;
  const endY = Math.ceil((state.camera.y + canvas.height * 0.5) / grid) * grid;

  ctx.strokeStyle = "rgba(120, 145, 190, 0.18)";
  ctx.lineWidth = 1;
  for (let x = startX; x <= endX; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  for (let y = startY; y <= endY; y += grid) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(70, 95, 140, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, CONFIG.world.width, CONFIG.world.height);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width * 0.5 - state.camera.x, canvas.height * 0.5 - state.camera.y);

  drawWorldBackground();

  const viewLeft = state.camera.x - canvas.width * 0.5 - ENEMY_CULL_MARGIN;
  const viewRight = state.camera.x + canvas.width * 0.5 + ENEMY_CULL_MARGIN;
  const viewTop = state.camera.y - canvas.height * 0.5 - ENEMY_CULL_MARGIN;
  const viewBottom = state.camera.y + canvas.height * 0.5 + ENEMY_CULL_MARGIN;
  for (const enemy of state.enemies) {
    if (enemy.x < viewLeft || enemy.x > viewRight || enemy.y < viewTop || enemy.y > viewBottom) {
      continue;
    }
    drawEnemy(enemy);
  }
  for (const peer of state.remotePlayers.values()) {
    drawRemotePlayer(peer);
    drawRemoteAttack(peer);
  }
  drawBlinkEffects();
  drawDeathParticles();

  drawPlayer();
  if (state.activeSlash) {
    drawWeaponHitbox();
  }
  ctx.restore();
}

function updateHud() {
  const mode = ATTACK_MODES[state.attackModeIndex];
  const w = CONFIG.weapon;
  const statsText = `L${w.length.toFixed(1)} W${w.weight.toFixed(1)} C${w.center.toFixed(1)} S${w.headSharpness.toFixed(1)}|${w.shaftSharpness.toFixed(1)}`;
  hpEl.textContent = String(Math.max(0, Math.ceil(state.player.hp)));
  killsEl.textContent = String(state.kills);
  timeEl.textContent = state.elapsed.toFixed(1);
  weaponEl.textContent = `${w.name} [${statsText}]`;
  slashModeEl.textContent = `${mode.name} / ${state.lastHitLabel}`;
  if (netStatusEl) {
    if (state.network.enabled && state.network.ws && state.network.ws.readyState === WebSocket.OPEN) {
      netStatusEl.textContent = `已連線(${state.remotePlayers.size})`;
    } else {
      netStatusEl.textContent = state.network.status;
    }
  }
}

function reset() {
  resizeCanvas();
  Object.assign(CONFIG.weapon, WEAPON_PRESETS[state.weaponIndex]);
  state.weaponRuntime = deriveWeaponRuntime();

  state.player = {
    x: CONFIG.world.width * 0.5,
    y: CONFIG.world.height * 0.5,
    hp: CONFIG.player.hp,
    invincible: 0,
    facing: 0
  };

  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  clampCamera();
  state.mouseScreen.x = canvas.width * 0.5;
  state.mouseScreen.y = canvas.height * 0.5;
  updateMouseWorld();
  state.enemies = [];
  state.enemyById.clear();
  state.deathParticles = [];
  state.blinkEffects = [];
  state.elapsed = 0;
  state.kills = 0;
  state.spawnTimer = 0;
  state.slashTimer = 0;
  state.blinkTimer = CONFIG.player.blinkCooldownSec;
  state.running = true;
  state.lastTs = performance.now();
  state.lastHitLabel = "待命";
  state.slashDirection = 1;
  state.activeSlash = null;
  state.network.sendTimer = 0;
  overlay.classList.add("hidden");
  sendRespawnToServer();
  updateHud();
}

function tick(ts) {
  const dt = Math.min(0.033, (ts - state.lastTs) / 1000);
  state.lastTs = ts;

  resizeCanvas();
  update(dt);
  draw();

  requestAnimationFrame(tick);
}

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  state.mouseScreen.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  state.mouseScreen.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  updateMouseWorld();
});

canvas.addEventListener("mousedown", (event) => {
  if (event.button === 0) {
    cycleWeapon();
  } else if (event.button === 2) {
    cycleAttackMode();
  }
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    tryBlink();
  }
});

window.addEventListener("resize", resizeCanvas);
restartBtn.addEventListener("click", reset);
window.addEventListener("beforeunload", () => {
  if (state.network.ws) {
    state.network.ws.close();
  }
});
if (versionBadgeEl) {
  versionBadgeEl.textContent = `v${APP_VERSION}`;
}

setupMultiplayer();
reset();
requestAnimationFrame(tick);














