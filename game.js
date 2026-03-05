const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const hpEl = document.getElementById("hp");
const killsEl = document.getElementById("kills");
const timeEl = document.getElementById("time");
const overlay = document.getElementById("overlay");
const restartBtn = document.getElementById("restart");
const finalTimeEl = document.getElementById("final-time");
const finalKillsEl = document.getElementById("final-kills");

const CONFIG = {
  player: {
    radius: 14,
    speed: 320,
    hp: 100,
    invincibleSec: 0.45,
    contactDamage: 12
  },
  slash: {
    cooldownSec: 0.22,
    range: 90,
    arc: Math.PI * 0.55,
    damage: 100,
    knockback: 130
  },
  enemy: {
    baseRadius: 12,
    baseSpeed: 70,
    spawnSec: 0.7,
    minSpawnSec: 0.18,
    accelPerMin: 0.22
  }
};

const state = {
  mouse: { x: canvas.width / 2, y: canvas.height / 2 },
  player: null,
  enemies: [],
  elapsed: 0,
  kills: 0,
  spawnTimer: 0,
  slashTimer: 0,
  running: true,
  lastTs: 0
};

function reset() {
  state.player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    hp: CONFIG.player.hp,
    invincible: 0,
    facing: 0
  };
  state.enemies = [];
  state.elapsed = 0;
  state.kills = 0;
  state.spawnTimer = 0;
  state.slashTimer = 0;
  state.running = true;
  state.lastTs = performance.now();
  overlay.classList.add("hidden");
  updateHud();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function angleTo(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function spawnEnemy() {
  const padding = 30;
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
  const radius = CONFIG.enemy.baseRadius + Math.random() * 7;
  const speed = (CONFIG.enemy.baseSpeed + Math.random() * 30) * intensity;

  state.enemies.push({ x, y, radius, speed, hp: 100, hitFlash: 0 });
}

function applySlash() {
  const p = state.player;
  const facing = angleTo(p, state.mouse);
  p.facing = facing;

  for (const enemy of state.enemies) {
    const d = dist(p, enemy);
    if (d > CONFIG.slash.range + enemy.radius) {
      continue;
    }
    const enemyAngle = angleTo(p, enemy);
    const diff = Math.abs(angleDiff(enemyAngle, facing));
    if (diff <= CONFIG.slash.arc * 0.5) {
      enemy.hp -= CONFIG.slash.damage;
      enemy.hitFlash = 0.08;
      const kb = CONFIG.slash.knockback;
      enemy.x += Math.cos(enemyAngle) * kb * 0.016;
      enemy.y += Math.sin(enemyAngle) * kb * 0.016;
    }
  }

  state.enemies = state.enemies.filter((enemy) => {
    if (enemy.hp > 0) {
      return true;
    }
    state.kills += 1;
    return false;
  });
}

function update(dt) {
  if (!state.running) {
    return;
  }

  state.elapsed += dt;
  state.spawnTimer += dt;
  state.slashTimer += dt;

  const p = state.player;
  const toMouseX = state.mouse.x - p.x;
  const toMouseY = state.mouse.y - p.y;
  const distance = Math.hypot(toMouseX, toMouseY);

  if (distance > 6) {
    const moveDist = Math.min(distance, CONFIG.player.speed * dt);
    p.x += (toMouseX / distance) * moveDist;
    p.y += (toMouseY / distance) * moveDist;
  }

  p.x = clamp(p.x, p.radius, canvas.width - p.radius);
  p.y = clamp(p.y, p.radius, canvas.height - p.radius);
  p.facing = angleTo(p, state.mouse);

  const spawnInterval = Math.max(
    CONFIG.enemy.minSpawnSec,
    CONFIG.enemy.spawnSec - state.elapsed * 0.0045
  );

  while (state.spawnTimer >= spawnInterval) {
    state.spawnTimer -= spawnInterval;
    spawnEnemy();
  }

  if (state.slashTimer >= CONFIG.slash.cooldownSec) {
    state.slashTimer -= CONFIG.slash.cooldownSec;
    applySlash();
  }

  for (const enemy of state.enemies) {
    const ang = angleTo(enemy, p);
    enemy.x += Math.cos(ang) * enemy.speed * dt;
    enemy.y += Math.sin(ang) * enemy.speed * dt;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);

    if (dist(enemy, p) <= enemy.radius + CONFIG.player.radius) {
      if (p.invincible <= 0) {
        p.hp -= CONFIG.player.contactDamage;
        p.invincible = CONFIG.player.invincibleSec;
      }
    }
  }

  p.invincible = Math.max(0, p.invincible - dt);

  if (p.hp <= 0) {
    state.running = false;
    finalTimeEl.textContent = state.elapsed.toFixed(1);
    finalKillsEl.textContent = String(state.kills);
    overlay.classList.remove("hidden");
  }

  updateHud();
}

function drawSlashPreview() {
  const p = state.player;
  const ready = state.slashTimer / CONFIG.slash.cooldownSec;
  const alpha = 0.15 + 0.2 * ready;

  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.arc(
    p.x,
    p.y,
    CONFIG.slash.range,
    p.facing - CONFIG.slash.arc * 0.5,
    p.facing + CONFIG.slash.arc * 0.5
  );
  ctx.closePath();
  ctx.fillStyle = `rgba(57, 217, 138, ${alpha.toFixed(3)})`;
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawSlashPreview();

  for (const enemy of state.enemies) {
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
    ctx.fillStyle = enemy.hitFlash > 0 ? "#ffe07a" : "#ff6e6e";
    ctx.fill();
  }

  const p = state.player;
  ctx.beginPath();
  ctx.arc(p.x, p.y, CONFIG.player.radius, 0, Math.PI * 2);
  ctx.fillStyle = p.invincible > 0 ? "#7fd8ff" : "#d7e7ff";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(
    p.x + Math.cos(p.facing) * 24,
    p.y + Math.sin(p.facing) * 24
  );
  ctx.strokeStyle = "#39d98a";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function updateHud() {
  hpEl.textContent = String(Math.max(0, Math.ceil(state.player.hp)));
  killsEl.textContent = String(state.kills);
  timeEl.textContent = state.elapsed.toFixed(1);
}

function tick(ts) {
  const dt = Math.min(0.033, (ts - state.lastTs) / 1000);
  state.lastTs = ts;
  update(dt);
  draw();
  requestAnimationFrame(tick);
}

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  state.mouse.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
});

restartBtn.addEventListener("click", reset);

reset();
requestAnimationFrame(tick);
