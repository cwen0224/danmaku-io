const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const hpEl = document.getElementById("hp");
const killsEl = document.getElementById("kills");
const timeEl = document.getElementById("time");
const weaponEl = document.getElementById("weapon");
const slashModeEl = document.getElementById("slash-mode");
const overlay = document.getElementById("overlay");
const restartBtn = document.getElementById("restart");
const finalTimeEl = document.getElementById("final-time");
const finalKillsEl = document.getElementById("final-kills");

const WEAPON_PRESETS = [
  {
    name: "長矛",
    bladeStartRatio: 0.95,
    length: 9.0,
    weight: 5.2,
    center: 5.6,
    headSharpness: 9.4,
    shaftSharpness: 1.2,
    baseDamage: 20,
    baseKnockback: 110,
    baseCooldown: 0.27,
    bleedChanceBase: 0.16,
    bleedDpsBase: 7,
    bleedDuration: 2.6,
    baseStunSec: 0.1
  },
  {
    name: "大劍",
    bladeStartRatio: 0.26,
    length: 7.1,
    weight: 7.8,
    center: 6.8,
    headSharpness: 8.3,
    shaftSharpness: 7.7,
    baseDamage: 29,
    baseKnockback: 92,
    baseCooldown: 0.33,
    bleedChanceBase: 0.12,
    bleedDpsBase: 6.5,
    bleedDuration: 2.2,
    baseStunSec: 0.08
  },
  {
    name: "匕首",
    bladeStartRatio: 0.22,
    length: 3.4,
    weight: 2.2,
    center: 4.2,
    headSharpness: 9.6,
    shaftSharpness: 4.2,
    baseDamage: 12,
    baseKnockback: 54,
    baseCooldown: 0.13,
    bleedChanceBase: 0.2,
    bleedDpsBase: 8.5,
    bleedDuration: 2.1,
    baseStunSec: 0.04
  },
  {
    name: "戰槌",
    bladeStartRatio: 0.97,
    length: 6.3,
    weight: 9.3,
    center: 7.6,
    headSharpness: 1.4,
    shaftSharpness: 1.0,
    baseDamage: 32,
    baseKnockback: 165,
    baseCooldown: 0.41,
    bleedChanceBase: 0.03,
    bleedDpsBase: 4.5,
    bleedDuration: 1.6,
    baseStunSec: 0.16
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
    knockbackMult: 3.0,
    impulseMult: 3.0
  },
  {
    id: "thrust",
    name: "突刺",
    rangeMult: 1.26,
    arcMult: 0.36,
    cooldownMult: 0.62,
    damageMult: 1.34,
    knockbackMult: 2.6,
    impulseMult: 5.5
  },
  {
    id: "breaker",
    name: "橫掃",
    rangeMult: 0.86,
    arcOverride: Math.PI * 2,
    arcMult: 1.42,
    cooldownMult: 1.9,
    damageMult: 0.78,
    knockbackMult: 3.24,
    impulseMult: 3.6
  }
];

const CONFIG = {
  player: {
    radius: 14,
    baseSpeed: 320,
    hp: 100,
    invincibleSec: 0.45,
    contactDamage: 12
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
    spawnSec: 0.72,
    minSpawnSec: 0.2,
    accelPerMin: 0.24,
    edgePadding: 30,
    knockbackDrag: 8.5,
    stunSlowRatio: 0.18
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

const state = {
  mouse: { x: 0, y: 0 },
  mouseScreen: { x: 0, y: 0 },
  player: null,
  camera: { x: 0, y: 0 },
  enemies: [],
  elapsed: 0,
  kills: 0,
  spawnTimer: 0,
  slashTimer: 0,
  running: true,
  lastTs: 0,
  weaponIndex: 0,
  attackModeIndex: 0,
  weaponRuntime: null,
  lastHitLabel: "待命",
  slashDirection: 1,
  activeSlash: null
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
  const moveMultiplier = clamp(1 - weapon.weight / 16, 0.45, 1.0);
  const range = (54 + weapon.length * 9) * mode.rangeMult;
  const computedArc = (CONFIG.slash.baseArc + (weapon.length - 5.5) * 0.02) * mode.arcMult;
  const arc = clamp(mode.arcOverride ?? computedArc, Math.PI * 0.18, Math.PI * 2);
  const weightSlow = 1 + (weapon.weight - 5) * 0.06;
  const lengthSlow = 1 + (weapon.length - 6) * 0.03;
  const centerSpeed = 1 - (weapon.center - 5.5) * 0.03;
  const cooldown = clamp(
    weapon.baseCooldown * weightSlow * lengthSlow * centerSpeed * mode.cooldownMult,
    0.08,
    0.95
  );
  const damageWeightMult = 1 + weapon.weight / 20;
  const damageCenterMult = 1 + (weapon.center - 5.5) / 15;

  return {
    moveMultiplier,
    range,
    arc,
    cooldown,
    damageWeightMult,
    damageCenterMult,
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
  let hpBase = 90;
  let sizeFactor = 0.25;

  if (roll > 0.9) {
    radius = 22;
    speedBase = 62;
    hpBase = 190;
    sizeFactor = 1.2;
  } else if (roll > 0.62) {
    radius = 17;
    speedBase = 74;
    hpBase = 130;
    sizeFactor = 0.7;
  }

  const speed = speedBase * intensity;

  state.enemies.push({
    x,
    y,
    vx: 0,
    vy: 0,
    radius,
    speed,
    sizeFactor,
    hp: hpBase,
    hitFlash: 0,
    status: {
      bleedSec: 0,
      bleedDps: 0,
      stunSec: 0
    }
  });
}

function applyBleed(enemy, sharpness) {
  const weapon = CONFIG.weapon;
  const chance = clamp(weapon.bleedChanceBase + (sharpness - 7) * 0.09, 0, 0.72);
  if (Math.random() >= chance) {
    return;
  }

  const dps = weapon.bleedDpsBase * (1 + (sharpness - 7) * 0.18);
  enemy.status.bleedSec = Math.max(enemy.status.bleedSec, weapon.bleedDuration);
  enemy.status.bleedDps = Math.max(enemy.status.bleedDps, dps);
}

function applyStun(enemy) {
  const weapon = CONFIG.weapon;
  const chance = clamp(0.1 + enemy.sizeFactor * 0.12 + weapon.weight * 0.012, 0, 0.65);
  if (Math.random() >= chance) {
    return;
  }

  const duration =
    weapon.baseStunSec *
    (0.65 + weapon.weight / 16) *
    (0.8 + enemy.sizeFactor * 0.25);
  enemy.status.stunSec = Math.max(enemy.status.stunSec, duration);
}

function calculateHitEffect(enemy, hitRatio) {
  const weapon = CONFIG.weapon;
  const runtime = state.weaponRuntime;
  const bladeStartRatio = weapon.bladeStartRatio ?? CONFIG.slash.headHitThreshold;
  const isHeadHit = hitRatio >= bladeStartRatio;
  const sharpness = isHeadHit ? weapon.headSharpness : weapon.shaftSharpness;

  let damage = weapon.baseDamage * runtime.damageWeightMult * runtime.damageCenterMult;
  let knockback = weapon.baseKnockback * (1 + weapon.weight / 12);
  let hitLabel = "混合";

  if (sharpness >= 7) {
    const sharpBonus = 1 + (sharpness - 7) * 0.14;
    damage *= sharpBonus;
    knockback *= 0.55;
    applyBleed(enemy, sharpness);
    hitLabel = "利刃";
  } else if (sharpness <= 3) {
    const bluntEnergy = 1 + (3 - sharpness) * 0.16;
    knockback *= 1.5 * bluntEnergy;
    applyStun(enemy);
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

function startSlash() {
  const player = state.player;
  const runtime = state.weaponRuntime;
  const facing = angleTo(player, state.mouse);
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
    hitEnemyIds: new Set()
  };

  state.slashDirection *= -1;
  state.lastHitLabel = "揮空";
}

function applySlashHitbox(slashAngle, hitEnemyIds) {
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
    enemy.hp -= effect.damage;
    enemy.hitFlash = 0.08;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const len = Math.hypot(dx, dy);
    const pushX = len > 0.001 ? dx / len : Math.cos(slashAngle);
    const pushY = len > 0.001 ? dy / len : Math.sin(slashAngle);

    enemy.x += pushX * effect.knockback * CONFIG.slash.visualKnockbackScale * thrustBurst;
    enemy.y += pushY * effect.knockback * CONFIG.slash.visualKnockbackScale * thrustBurst;
    enemy.vx += pushX * effect.knockback * CONFIG.slash.knockbackImpulseScale * runtime.impulseModeMult * thrustBurst;
    enemy.vy += pushY * effect.knockback * CONFIG.slash.knockbackImpulseScale * runtime.impulseModeMult * thrustBurst;

    state.lastHitLabel = effect.hitLabel;
    hitEnemyIds.add(enemy);
  }
}

function updateActiveSlash(dt) {
  if (!state.activeSlash) {
    return;
  }

  const runtime = state.weaponRuntime;
  const mode = ATTACK_MODES[state.attackModeIndex];
  const cleaveArc = (Math.PI * 2) / 3;
  const baseDuration = Math.min(CONFIG.slash.swingDurationSec, runtime.cooldown * 0.6);
  const arcDurationScale = mode.id === "breaker" ? runtime.arc / cleaveArc : 1;
  const duration = clamp(baseDuration * arcDurationScale, 0.08, runtime.cooldown * 0.95);
  const slash = state.activeSlash;
  const nextProgress = clamp(slash.progress + dt / duration, 0, 1);

  slash.progress = nextProgress;
  slash.currentAngle = lerp(slash.startAngle, slash.endAngle, slash.progress);
  applySlashHitbox(slash.currentAngle, slash.hitEnemyIds);

  if (slash.progress >= 1) {
    state.activeSlash = null;
  }
}

function update(dt) {
  if (!state.running) {
    return;
  }

  state.elapsed += dt;
  state.spawnTimer += dt;
  state.slashTimer += dt;

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
  player.facing = angleTo(player, state.mouse);
  updateCamera(dt);

  const spawnInterval = Math.max(
    CONFIG.enemy.minSpawnSec,
    CONFIG.enemy.spawnSec - state.elapsed * 0.004
  );

  while (state.spawnTimer >= spawnInterval) {
    state.spawnTimer -= spawnInterval;
    spawnEnemy();
  }

  if (!state.activeSlash && state.slashTimer >= runtime.cooldown) {
    state.slashTimer -= runtime.cooldown;
    startSlash();
  }

  updateActiveSlash(dt);

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
    const chaseScale = enemy.status.stunSec > 0 ? CONFIG.enemy.stunSlowRatio : 1;
    enemy.x += Math.cos(ang) * enemy.speed * chaseScale * dt;
    enemy.y += Math.sin(ang) * enemy.speed * chaseScale * dt;

    if (dist(enemy, player) <= enemy.radius + CONFIG.player.radius) {
      if (player.invincible <= 0) {
        player.hp -= CONFIG.player.contactDamage;
        player.invincible = CONFIG.player.invincibleSec;
      }
    }
  }

  player.invincible = Math.max(0, player.invincible - dt);

  state.enemies = state.enemies.filter((enemy) => {
    if (enemy.hp > 0) {
      return true;
    }
    state.kills += 1;
    return false;
  });

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
  const baseDist = CONFIG.player.radius + 8;
  const tipDist = baseDist + 18;
  const wingDist = tipDist - 9;
  const wingSpread = 0.52;

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
  ctx.strokeStyle = "rgba(120, 248, 180, 0.95)";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = "rgba(164, 255, 208, 0.95)";
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

  for (const enemy of state.enemies) {
    drawEnemy(enemy);
  }

  drawPlayer();
  drawWeaponHitbox();
  ctx.restore();
}

function updateHud() {
  const mode = ATTACK_MODES[state.attackModeIndex];
  hpEl.textContent = String(Math.max(0, Math.ceil(state.player.hp)));
  killsEl.textContent = String(state.kills);
  timeEl.textContent = state.elapsed.toFixed(1);
  weaponEl.textContent = `${CONFIG.weapon.name} (${Math.round(state.weaponRuntime.moveMultiplier * 100)}%移速 / ${state.weaponRuntime.cooldown.toFixed(2)}s攻速)`;
  slashModeEl.textContent = `${mode.name} / ${state.lastHitLabel}`;
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
  state.elapsed = 0;
  state.kills = 0;
  state.spawnTimer = 0;
  state.slashTimer = 0;
  state.running = true;
  state.lastTs = performance.now();
  state.lastHitLabel = "待命";
  state.slashDirection = 1;
  state.activeSlash = null;
  overlay.classList.add("hidden");
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

window.addEventListener("resize", resizeCanvas);
restartBtn.addEventListener("click", reset);

reset();
requestAnimationFrame(tick);
