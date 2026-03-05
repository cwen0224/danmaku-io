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
    visualKnockbackScale: 0.016
  },
  enemy: {
    spawnSec: 0.72,
    minSpawnSec: 0.2,
    accelPerMin: 0.24,
    edgePadding: 30
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
    baseStunSec: 0.14
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
  lastHitLabel: "待命"
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
  const chance = clamp(0.22 + enemy.sizeFactor * 0.25 + weapon.weight * 0.02, 0, 0.95);
  if (Math.random() >= chance) {
    return;
  }

  const duration = weapon.baseStunSec * (1 + weapon.weight / 10) * (1 + enemy.sizeFactor * 0.45);
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

function applySlash() {
  const player = state.player;
  const runtime = state.weaponRuntime;
  const facing = angleTo(player, state.mouse);
  player.facing = facing;
  state.lastHitLabel = "揮空";

  for (const enemy of state.enemies) {
    const distance = dist(player, enemy);
    if (distance > runtime.range + enemy.radius) {
      continue;
    }

    const enemyAngle = angleTo(player, enemy);
    const diff = Math.abs(angleDiff(enemyAngle, facing));
    if (diff > runtime.arc * 0.5) {
      continue;
    }

    const hitRatio = clamp((distance - CONFIG.player.radius) / runtime.range, 0, 1);
    const effect = calculateHitEffect(enemy, hitRatio);

    enemy.hp -= effect.damage;
    enemy.hitFlash = 0.08;
    enemy.x += Math.cos(enemyAngle) * effect.knockback * CONFIG.slash.visualKnockbackScale;
    enemy.y += Math.sin(enemyAngle) * effect.knockback * CONFIG.slash.visualKnockbackScale;

    state.lastHitLabel = effect.hitLabel;
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

  while (state.slashTimer >= runtime.cooldown) {
    state.slashTimer -= runtime.cooldown;
    applySlash();
  }

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
      continue;
    }

    const ang = angleTo(enemy, player);
    enemy.x += Math.cos(ang) * enemy.speed * dt;
    enemy.y += Math.sin(ang) * enemy.speed * dt;

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

function drawSlashPreview() {
  const player = state.player;
  const runtime = state.weaponRuntime;
  const ready = clamp(state.slashTimer / runtime.cooldown, 0, 1);
  const alpha = 0.14 + 0.22 * ready;

  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.arc(
    player.x,
    player.y,
    runtime.range,
    player.facing - runtime.arc * 0.5,
    player.facing + runtime.arc * 0.5
  );
  ctx.closePath();
  ctx.fillStyle = `rgba(57, 217, 138, ${alpha.toFixed(3)})`;
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
    player.x + Math.cos(player.facing) * 24,
    player.y + Math.sin(player.facing) * 24
  );
  ctx.strokeStyle = "#39d98a";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawSlashPreview();

  for (const enemy of state.enemies) {
    drawEnemy(enemy);
  }

  drawPlayer();
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
