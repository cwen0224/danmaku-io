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
  weapon: {
    name: "訓練長戟",
    length: 8.2,
    weight: 6.4,
    center: 6.0,
    headSharpness: 9.0,
    shaftSharpness: 1.8,
    baseDamage: 22,
    baseKnockback: 95,
    baseCooldown: 0.3,
    bleedChanceBase: 0.16,
    bleedDpsBase: 7,
    bleedDuration: 2.6,
    baseStunSec: 0.1
  }
};

const state = {
  mouse: { x: 0, y: 0 },
  player: null,
  enemies: [],
  elapsed: 0,
  kills: 0,
  spawnTimer: 0,
  slashTimer: 0,
  running: true,
  lastTs: 0,
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

function deriveWeaponRuntime() {
  const weapon = CONFIG.weapon;
  const moveMultiplier = clamp(1 - weapon.weight / 40, 0.72, 1.0);
  const range = 54 + weapon.length * 9;
  const arc = clamp(CONFIG.slash.baseArc + (weapon.length - 5.5) * 0.02, Math.PI * 0.4, Math.PI * 0.7);
  const cooldown = clamp(weapon.baseCooldown * (1 - (weapon.center - 5.5) * 0.03), 0.18, 0.52);
  const damageWeightMult = 1 + weapon.weight / 20;
  const damageCenterMult = 1 + (weapon.center - 5.5) / 15;

  return {
    moveMultiplier,
    range,
    arc,
    cooldown,
    damageWeightMult,
    damageCenterMult
  };
}

function resizeCanvas() {
  const previousWidth = canvas.width || 1;
  const previousHeight = canvas.height || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(480, Math.floor(rect.width));
  const height = Math.max(270, Math.floor(rect.height));

  if (width === canvas.width && height === canvas.height) {
    return;
  }

  const playerRatioX = state.player ? state.player.x / previousWidth : 0.5;
  const playerRatioY = state.player ? state.player.y / previousHeight : 0.5;
  const mouseRatioX = state.mouse.x / previousWidth;
  const mouseRatioY = state.mouse.y / previousHeight;

  canvas.width = width;
  canvas.height = height;

  if (state.player) {
    state.player.x = clamp(playerRatioX * width, CONFIG.player.radius, width - CONFIG.player.radius);
    state.player.y = clamp(playerRatioY * height, CONFIG.player.radius, height - CONFIG.player.radius);
  }

  state.mouse.x = clamp(mouseRatioX * width, 0, width);
  state.mouse.y = clamp(mouseRatioY * height, 0, height);
}

function spawnEnemy() {
  const padding = CONFIG.enemy.edgePadding;
  const edge = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;

  if (edge === 0) {
    x = Math.random() * canvas.width;
    y = -padding;
  } else if (edge === 1) {
    x = canvas.width + padding;
    y = Math.random() * canvas.height;
  } else if (edge === 2) {
    x = Math.random() * canvas.width;
    y = canvas.height + padding;
  } else {
    x = -padding;
    y = Math.random() * canvas.height;
  }

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
  const isHeadHit = hitRatio >= CONFIG.slash.headHitThreshold;
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

    enemy.x += pushX * effect.knockback * CONFIG.slash.visualKnockbackScale;
    enemy.y += pushY * effect.knockback * CONFIG.slash.visualKnockbackScale;
    enemy.vx += pushX * effect.knockback * CONFIG.slash.knockbackImpulseScale;
    enemy.vy += pushY * effect.knockback * CONFIG.slash.knockbackImpulseScale;

    state.lastHitLabel = effect.hitLabel;
    hitEnemyIds.add(enemy);
  }
}

function updateActiveSlash(dt) {
  if (!state.activeSlash) {
    return;
  }

  const runtime = state.weaponRuntime;
  const duration = Math.min(CONFIG.slash.swingDurationSec, runtime.cooldown * 0.6);
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

  player.x = clamp(player.x, CONFIG.player.radius, canvas.width - CONFIG.player.radius);
  player.y = clamp(player.y, CONFIG.player.radius, canvas.height - CONFIG.player.radius);
  player.facing = angleTo(player, state.mouse);

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
  const idleReady = clamp(state.slashTimer / runtime.cooldown, 0, 1);
  const angle = slash ? slash.currentAngle : player.facing;
  const tipX = player.x + Math.cos(angle) * runtime.range;
  const tipY = player.y + Math.sin(angle) * runtime.range;
  const coreWidth = slash ? CONFIG.slash.hitboxRadius * 1.9 : 7 + idleReady * 4;

  if (slash) {
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

  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = slash ? "rgba(131, 255, 200, 0.95)" : `rgba(57, 217, 138, ${(0.5 + idleReady * 0.3).toFixed(3)})`;
  ctx.lineWidth = coreWidth;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(tipX, tipY, coreWidth * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = slash ? "rgba(200, 255, 225, 0.92)" : "rgba(100, 230, 170, 0.7)";
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

  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.lineTo(
    player.x + Math.cos(player.facing) * 18,
    player.y + Math.sin(player.facing) * 18
  );
  ctx.strokeStyle = "rgba(57, 217, 138, 0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const enemy of state.enemies) {
    drawEnemy(enemy);
  }

  drawPlayer();
  drawWeaponHitbox();
}

function updateHud() {
  hpEl.textContent = String(Math.max(0, Math.ceil(state.player.hp)));
  killsEl.textContent = String(state.kills);
  timeEl.textContent = state.elapsed.toFixed(1);
  weaponEl.textContent = CONFIG.weapon.name;
  slashModeEl.textContent = state.lastHitLabel;
}

function reset() {
  resizeCanvas();
  state.weaponRuntime = deriveWeaponRuntime();

  state.player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    hp: CONFIG.player.hp,
    invincible: 0,
    facing: 0
  };

  state.mouse.x = canvas.width / 2;
  state.mouse.y = canvas.height / 2;
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
  state.mouse.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  state.mouse.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
});

window.addEventListener("resize", resizeCanvas);
restartBtn.addEventListener("click", reset);

reset();
requestAnimationFrame(tick);
