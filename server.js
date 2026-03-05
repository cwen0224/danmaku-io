const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8080);
const TICK_RATE = 20;
const DT = 1 / TICK_RATE;
const WORLD = { width: 4200, height: 2800 };
const PLAYER_RADIUS = 14;
const ENEMY = {
  spawnSec: 1.2,
  minSpawnSec: 0.45,
  accelPerMin: 0.16,
  edgePadding: 30,
  knockbackDrag: 8.5,
  stunSlowRatio: 0.18,
  weaponArc: Math.PI * 0.22,
  weaponSwingSec: 0.34,
  weaponCooldownSec: 1.3,
  weaponDamage: 4,
  turnLerpPerSec: 2.2
};
const ATTACK_MODE_MULT = {
  thrust: 4,
  sweep: 2.25,
  breaker: 1
};

const peers = new Map();
const enemies = [];
let enemySeq = 0;
let elapsedSec = 0;
let spawnTimer = 0;

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
  return { t, distance: Math.hypot(dx, dy) };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload, exceptId) {
  for (const [id, peer] of peers) {
    if (id === exceptId) {
      continue;
    }
    safeSend(peer.ws, payload);
  }
}

function spawnEnemy() {
  const padding = ENEMY.edgePadding;
  const edge = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;

  if (edge === 0) {
    x = Math.random() * WORLD.width;
    y = -padding;
  } else if (edge === 1) {
    x = WORLD.width + padding;
    y = Math.random() * WORLD.height;
  } else if (edge === 2) {
    x = Math.random() * WORLD.width;
    y = WORLD.height + padding;
  } else {
    x = -padding;
    y = Math.random() * WORLD.height;
  }

  x = clamp(x, padding, WORLD.width - padding);
  y = clamp(y, padding, WORLD.height - padding);

  const intensity = 1 + (elapsedSec / 60) * ENEMY.accelPerMin;
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
  const weaponCooldown = ENEMY.weaponCooldownSec + sizeFactor * 0.4;
  const weaponDamage = ENEMY.weaponDamage + sizeFactor * 2.6;
  const weaponSwingSec = ENEMY.weaponSwingSec + sizeFactor * 0.06;

  enemies.push({
    id: `e${++enemySeq}`,
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
    status: { bleedSec: 0, bleedDps: 0, stunSec: 0 }
  });
}

function nearestLivingPlayer(from) {
  let nearest = null;
  let best = Infinity;
  for (const peer of peers.values()) {
    if (peer.state.hp <= 0) {
      continue;
    }
    const dx = peer.state.x - from.x;
    const dy = peer.state.y - from.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      nearest = peer.state;
    }
  }
  return nearest;
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

function resolveEnemyAttackHit(enemy) {
  if (!enemy.attackState || enemy.attackState.hitApplied) {
    return;
  }
  for (const peer of peers.values()) {
    const player = peer.state;
    if (player.hp <= 0) {
      continue;
    }
    const effectiveRange = enemy.weaponRange * enemy.attackState.reachScale;
    const toPlayer = dist(enemy, player);
    if (toPlayer > effectiveRange + PLAYER_RADIUS) {
      continue;
    }
    const diff = Math.abs(angleDiff(angleTo(enemy, player), enemy.attackState.currentAngle));
    if (diff > ENEMY.weaponArc * 0.5) {
      continue;
    }
    if (player.invincible <= 0) {
      player.hp = Math.max(0, player.hp - enemy.weaponDamage);
      player.invincible = 0.45;
    }
    enemy.attackState.hitApplied = true;
    break;
  }
}

function updateWorld(dt) {
  elapsedSec += dt;
  spawnTimer += dt;

  for (const peer of peers.values()) {
    peer.state.invincible = Math.max(0, peer.state.invincible - dt);
  }

  const spawnInterval = Math.max(ENEMY.minSpawnSec, ENEMY.spawnSec - elapsedSec * 0.004);
  while (spawnTimer >= spawnInterval) {
    spawnTimer -= spawnInterval;
    spawnEnemy();
  }

  for (const enemy of enemies) {
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

    const drag = Math.exp(-ENEMY.knockbackDrag * dt);
    enemy.vx *= drag;
    enemy.vy *= drag;
    enemy.x += enemy.vx * dt;
    enemy.y += enemy.vy * dt;

    const target = nearestLivingPlayer(enemy);
    if (!target) {
      continue;
    }

    const ang = angleTo(enemy, target);
    const turnT = 1 - Math.exp(-ENEMY.turnLerpPerSec * dt);
    enemy.facing = lerp(enemy.facing, ang, turnT);
    const chaseScale = enemy.status.stunSec > 0 ? ENEMY.stunSlowRatio : 1;
    enemy.x += Math.cos(ang) * enemy.speed * chaseScale * dt;
    enemy.y += Math.sin(ang) * enemy.speed * chaseScale * dt;
    enemy.x = clamp(enemy.x, enemy.radius, WORLD.width - enemy.radius);
    enemy.y = clamp(enemy.y, enemy.radius, WORLD.height - enemy.radius);

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
      resolveEnemyAttackHit(enemy);
      if (attack.progress >= 1) {
        enemy.attackState = null;
        enemy.attackTimer = 0;
      }
    } else if (enemy.status.stunSec <= 0) {
      enemy.attackTimer += dt;
      if (enemy.attackTimer >= enemy.weaponCooldown && dist(enemy, target) <= enemy.weaponRange + PLAYER_RADIUS + 6) {
        startEnemyAttack(enemy, enemy.facing);
      }
    }
  }

  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    if (enemies[i].hp <= 0) {
      enemies.splice(i, 1);
    }
  }
}

function processPlayerAttack(peer, attack) {
  const player = peer.state;
  const runtime = player.runtime || {};
  const modeId = String(attack.modeId || player.modeId || "sweep");
  const centerAngle = Number(attack.centerAngle);
  const startAngle = Number(attack.startAngle);
  const endAngle = Number(attack.endAngle);
  const range = clamp(Number(attack.range) || Number(runtime.range) || 90, 20, 220);
  const arc = clamp(Number(attack.arc) || Number(runtime.arc) || Math.PI * 0.5, 0.12, Math.PI * 2);
  const duration = clamp(Number(attack.duration) || 0.2, 0.06, 1.2);
  const bladeStartRatio = clamp(Number(attack.bladeStartRatio) || Number(player.bladeStartRatio) || 0.7, 0.05, 0.99);
  const baseDamage = Number(runtime.baseDamage) || 24;
  const baseKnockback = Number(runtime.baseKnockback) || 60;
  const damageMult = Number(runtime.damageModeMult) || 1;
  const knockMult = Number(runtime.knockbackModeMult) || ATTACK_MODE_MULT[modeId] || 1;

  for (const enemy of enemies) {
    let isHit = false;
    let hitRatio = 0.5;

    if (modeId === "thrust") {
      const tip = {
        x: player.x + Math.cos(centerAngle) * range,
        y: player.y + Math.sin(centerAngle) * range
      };
      const segment = pointSegmentInfo(enemy, player, tip);
      const hitRadius = enemy.radius + 16;
      isHit = segment.distance <= hitRadius;
      hitRatio = segment.t;
    } else {
      const d = dist(player, enemy);
      if (d <= range + enemy.radius) {
        const ang = angleTo(player, enemy);
        const diff = Math.abs(angleDiff(ang, centerAngle));
        isHit = diff <= arc * 0.5;
        hitRatio = clamp(d / Math.max(1, range), 0, 1);
      }
    }

    if (!isHit) {
      continue;
    }

    const headBonus = hitRatio >= bladeStartRatio ? 1.2 : 0.95;
    const damage = baseDamage * damageMult * headBonus;
    const knockback = baseKnockback * knockMult;
    enemy.hp -= damage;
    enemy.hitFlash = 0.1;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    enemy.x += nx * knockback * 0.07;
    enemy.y += ny * knockback * 0.07;
    enemy.vx += nx * knockback * 6.2;
    enemy.vy += ny * knockback * 6.2;
    if (enemy.hp <= 0) {
      peer.state.kills += 1;
    }
  }

  broadcast(
    {
      type: "peer_attack",
      id: player.id,
      attack: { modeId, centerAngle, startAngle, endAngle, range, arc, duration, bladeStartRatio, direction: Number(attack.direction) || 1 }
    },
    player.id
  );
}

function worldPayload() {
  return enemies.map((enemy) => ({
    id: enemy.id,
    x: enemy.x,
    y: enemy.y,
    vx: enemy.vx,
    vy: enemy.vy,
    radius: enemy.radius,
    speed: enemy.speed,
    sizeFactor: enemy.sizeFactor,
    facing: enemy.facing,
    weaponRange: enemy.weaponRange,
    weaponCooldown: enemy.weaponCooldown,
    weaponDamage: enemy.weaponDamage,
    weaponSwingSec: enemy.weaponSwingSec,
    attackTimer: enemy.attackTimer,
    attackState: enemy.attackState,
    hp: enemy.hp,
    hitFlash: enemy.hitFlash,
    status: enemy.status
  }));
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: peers.size, enemies: enemies.length }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Danmaku IO relay server is running.\\n");
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  const id = randomId();
  peers.set(id, {
    ws,
    state: {
      id,
      x: WORLD.width * 0.5,
      y: WORLD.height * 0.5,
      facing: 0,
      hp: 100,
      invincible: 0,
      kills: 0,
      weapon: "未知",
      modeId: "sweep",
      bladeStartRatio: 0.7,
      runtime: null,
      t: Date.now()
    }
  });

  const peer = peers.get(id);
  const peerList = Array.from(peers.values())
    .map((p) => p.state)
    .filter((s) => s.id !== id);
  safeSend(ws, { type: "welcome", id, peers: peerList });
  safeSend(ws, { type: "world", enemies: worldPayload(), you: { hp: peer.state.hp } });
  broadcast({ type: "peer_join", peer: peer.state }, id);

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const current = peers.get(id);
    if (!current) {
      return;
    }

    if (message.type === "state" && message.state) {
      current.state = {
        ...current.state,
        x: clamp(Number(message.state.x) || 0, PLAYER_RADIUS, WORLD.width - PLAYER_RADIUS),
        y: clamp(Number(message.state.y) || 0, PLAYER_RADIUS, WORLD.height - PLAYER_RADIUS),
        facing: Number(message.state.facing) || 0,
        weapon: String(message.state.weapon || "未知"),
        modeId: String(message.state.modeId || "sweep"),
        bladeStartRatio: Number(message.state.bladeStartRatio) || 0.7,
        runtime: message.state.runtime || null,
        t: Date.now()
      };
      broadcast({ type: "peer_state", peer: current.state }, id);
    } else if (message.type === "attack" && message.attack) {
      processPlayerAttack(current, message.attack);
    }
  });

  ws.on("close", () => {
    peers.delete(id);
    broadcast({ type: "peer_leave", id });
  });
  ws.on("error", () => ws.close());
});

setInterval(() => {
  updateWorld(DT);
  const enemiesSnapshot = worldPayload();
  for (const peer of peers.values()) {
    safeSend(peer.ws, {
      type: "world",
      enemies: enemiesSnapshot,
      you: { hp: peer.state.hp }
    });
  }
}, Math.floor(1000 / TICK_RATE));

server.listen(PORT, () => {
  console.log(`Relay server listening on ws://localhost:${PORT}`);
});
