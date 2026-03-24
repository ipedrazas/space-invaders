// ─── Canvas Setup ────────────────────────────────────────────────
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

// ─── Constants ───────────────────────────────────────────────────
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 20;
const PLAYER_SPEED = 3.5;
const PLAYER_BULLET_SPEED = 5;
const PLAYER_SHOOT_COOLDOWN = 400; // ms

const ENEMY_ROWS = 5;
const ENEMY_COLS = 11;
const ENEMY_WIDTH = 30;
const ENEMY_HEIGHT = 20;
const ENEMY_PAD_X = 15;
const ENEMY_PAD_Y = 12;
const ENEMY_BASE_SPEED = 0.5;
const ENEMY_DROP = 15;
const ENEMY_BULLET_SPEED = 2.5;
const ENEMY_SHOOT_INTERVAL = 2000; // ms base

const BULLET_WIDTH = 3;
const BULLET_HEIGHT = 10;

const STARTING_LIVES = 3;

// ─── Level Configuration ────────────────────────────────────────
// Each level scales difficulty: speed, shooting, enemy count
function getLevelConfig(level) {
  const lvl = Math.min(level, 10);
  return {
    rows: Math.min(3 + Math.floor(lvl / 3), ENEMY_ROWS),  // 3,3,4,4,4,5,5,5,5,5
    cols: Math.min(7 + Math.floor(lvl / 2), ENEMY_COLS),   // 7,7,8,8,9,9,10,10,11,11
    baseSpeed: ENEMY_BASE_SPEED + (lvl - 1) * 0.08,        // 0.5 → 1.22
    shootInterval: Math.max(ENEMY_SHOOT_INTERVAL - (lvl - 1) * 120, 800), // 2000 → 920
    bulletSpeed: ENEMY_BULLET_SPEED + (lvl - 1) * 0.15,    // 2.5 → 3.85
    startY: 60 - (lvl - 1) * 2,                            // enemies start slightly lower each level
  };
}

// ─── Game State ──────────────────────────────────────────────────
const STATE = { START: 0, PLAYING: 1, GAME_OVER: 2, VICTORY: 3, BOSS: 4 };

let gameState = STATE.START;
let score = 0;
let lives = STARTING_LIVES;
let level = 1;
let lastEnemyShot = 0;
let lastPlayerShot = 0;

// ─── Boss State ─────────────────────────────────────────────────
let boss = null;
let bossPhase = 0;           // 0=moving, 1=charging, 2=spread attack
let bossPhaseTimer = 0;
let bossBullets = [];
const BOSS_MAX_HP = 80;
const BOSS_WIDTH = 90;
const BOSS_HEIGHT = 55;
const BOSS_SPEED = 1.5;
const BOSS_BULLET_SPEED = 3;

// ─── Input ───────────────────────────────────────────────────────
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  if (e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
  }
  if (gameState === STATE.START && e.key === "Enter") {
    startGame();
  }
  if ((gameState === STATE.GAME_OVER || gameState === STATE.VICTORY) && e.key === "Enter") {
    resetGame();
  }
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });

// ─── Player ──────────────────────────────────────────────────────
const player = {
  x: W / 2 - PLAYER_WIDTH / 2,
  y: H - 50,
  w: PLAYER_WIDTH,
  h: PLAYER_HEIGHT,
  invincibleUntil: 0,

  update() {
    if (keys["ArrowLeft"] && this.x > 0) this.x -= PLAYER_SPEED;
    if (keys["ArrowRight"] && this.x + this.w < W) this.x += PLAYER_SPEED;
  },

  draw() {
    const blinking = this.invincibleUntil > performance.now();
    if (blinking && Math.floor(performance.now() / 100) % 2 === 0) return;

    ctx.fillStyle = "#0f0";
    // Ship body
    ctx.fillRect(this.x, this.y + 6, this.w, this.h - 6);
    // Cannon
    ctx.fillRect(this.x + this.w / 2 - 2, this.y, 4, 10);
    // Wings
    ctx.fillRect(this.x - 3, this.y + this.h - 4, 6, 4);
    ctx.fillRect(this.x + this.w - 3, this.y + this.h - 4, 6, 4);
  },

  shoot(now) {
    if (keys[" "] && now - lastPlayerShot > PLAYER_SHOOT_COOLDOWN) {
      lastPlayerShot = now;
      playerBullets.push({
        x: this.x + this.w / 2 - BULLET_WIDTH / 2,
        y: this.y,
        w: BULLET_WIDTH,
        h: BULLET_HEIGHT,
      });
    }
  },

  hit() {
    lives--;
    if (lives <= 0) {
      gameState = STATE.GAME_OVER;
    } else {
      this.invincibleUntil = performance.now() + 2000;
      this.x = W / 2 - PLAYER_WIDTH / 2;
    }
  },
};

// ─── Enemies ─────────────────────────────────────────────────────
let enemies = [];
let enemyDirection = 1;
let totalEnemies = 0;

function createEnemyGrid() {
  enemies = [];
  const cfg = getLevelConfig(level);
  const rows = cfg.rows;
  const cols = cfg.cols;
  const gridW = cols * (ENEMY_WIDTH + ENEMY_PAD_X) - ENEMY_PAD_X;
  const startX = (W - gridW) / 2;
  const startY = cfg.startY;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let type;
      if (r === 0) type = 2;         // top row — small, high value
      else if (r < Math.ceil(rows / 2)) type = 1;  // middle rows
      else type = 0;                  // bottom rows

      enemies.push({
        x: startX + c * (ENEMY_WIDTH + ENEMY_PAD_X),
        y: startY + r * (ENEMY_HEIGHT + ENEMY_PAD_Y),
        w: ENEMY_WIDTH,
        h: ENEMY_HEIGHT,
        alive: true,
        type,
      });
    }
  }
  totalEnemies = enemies.length;
  enemyDirection = 1;
}

function aliveEnemies() {
  return enemies.filter((e) => e.alive);
}

function updateEnemies() {
  const alive = aliveEnemies();
  if (alive.length === 0) {
    if (level >= 10) {
      // Start boss fight after level 10
      startBossFight();
    } else {
      // Advance to next level
      advanceLevel();
    }
    return;
  }

  // Speed scales as enemies are destroyed — the classic accidental feature
  const cfg = getLevelConfig(level);
  const speedMultiplier = 1 + (totalEnemies - alive.length) / totalEnemies * 2;
  const speed = cfg.baseSpeed * speedMultiplier;

  // Check if any enemy hit a wall
  let shouldDrop = false;
  for (const e of alive) {
    if ((enemyDirection === 1 && e.x + e.w + speed > W) ||
        (enemyDirection === -1 && e.x - speed < 0)) {
      shouldDrop = true;
      break;
    }
  }

  if (shouldDrop) {
    enemyDirection *= -1;
    for (const e of enemies) {
      e.y += ENEMY_DROP;
    }
    // Check if enemies reached the player
    for (const e of alive) {
      if (e.y + e.h >= player.y) {
        gameState = STATE.GAME_OVER;
        return;
      }
    }
  } else {
    for (const e of enemies) {
      e.x += speed * enemyDirection;
    }
  }
}

function drawEnemies() {
  for (const e of enemies) {
    if (!e.alive) continue;
    const colors = ["#ff4444", "#ff8800", "#ffff00"];
    ctx.fillStyle = colors[e.type];
    drawInvader(e.x, e.y, e.w, e.h, e.type);
  }
}

function drawInvader(x, y, w, h, type) {
  ctx.fillRect(x + 4, y, w - 8, h);       // body
  ctx.fillRect(x, y + 4, w, h - 8);        // middle band
  if (type === 0) {
    // "crab" — side bumps
    ctx.fillRect(x - 3, y + 6, 4, 6);
    ctx.fillRect(x + w - 1, y + 6, 4, 6);
  } else if (type === 1) {
    // "squid" — top antennae
    ctx.fillRect(x + 4, y - 3, 3, 4);
    ctx.fillRect(x + w - 7, y - 3, 3, 4);
  } else {
    // "octopus" — small with a bump
    ctx.fillRect(x + w / 2 - 2, y - 3, 4, 4);
  }
  // eyes
  ctx.fillStyle = "#000";
  ctx.fillRect(x + 8, y + 6, 4, 4);
  ctx.fillRect(x + w - 12, y + 6, 4, 4);
  ctx.fillStyle = "#fff"; // reset for next
}

// ─── Projectiles ─────────────────────────────────────────────────
let playerBullets = [];
let enemyBullets = [];

function updatePlayerBullets() {
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    playerBullets[i].y -= PLAYER_BULLET_SPEED;
    if (playerBullets[i].y + playerBullets[i].h < 0) {
      playerBullets.splice(i, 1);
    }
  }
}

function updateEnemyBullets() {
  const cfg = getLevelConfig(level);
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    enemyBullets[i].y += cfg.bulletSpeed;
    if (enemyBullets[i].y > H) {
      enemyBullets.splice(i, 1);
    }
  }
}

function enemyShoot(now) {
  const alive = aliveEnemies();
  if (alive.length === 0) return;

  const cfg = getLevelConfig(level);
  const interval = cfg.shootInterval * (alive.length / totalEnemies);
  if (now - lastEnemyShot < Math.max(interval, 400)) return;

  lastEnemyShot = now;

  // Pick a random alive enemy from the bottom-most row per column
  const bottomEnemies = getBottomRowEnemies(alive);
  const shooter = bottomEnemies[Math.floor(Math.random() * bottomEnemies.length)];

  enemyBullets.push({
    x: shooter.x + shooter.w / 2 - BULLET_WIDTH / 2,
    y: shooter.y + shooter.h,
    w: BULLET_WIDTH,
    h: BULLET_HEIGHT,
  });
}

function getBottomRowEnemies(alive) {
  const columns = {};
  for (const e of alive) {
    const col = Math.round(e.x);
    if (!columns[col] || e.y > columns[col].y) {
      columns[col] = e;
    }
  }
  return Object.values(columns);
}

function drawBullets() {
  ctx.fillStyle = "#0f0";
  for (const b of playerBullets) {
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  ctx.fillStyle = "#f55";
  for (const b of enemyBullets) {
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
}

// ─── Shields ─────────────────────────────────────────────────────
const SHIELD_COUNT = 4;
const SHIELD_BLOCK = 4;        // each pixel-block is 4×4 px
const SHIELD_COLS = 11;
const SHIELD_ROWS = 8;
const SHIELD_Y = H - 120;

// Each shield is a 2D grid of booleans (true = solid)
let shields = [];

function createShieldShape() {
  // Classic arch shape
  const grid = [];
  for (let r = 0; r < SHIELD_ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < SHIELD_COLS; c++) {
      // Top corners rounded off
      if (r === 0 && (c === 0 || c === SHIELD_COLS - 1)) { grid[r][c] = false; continue; }
      // Bottom arch cutout (rows 6-7, middle columns)
      if (r >= 6 && c >= 4 && c <= 6) { grid[r][c] = false; continue; }
      grid[r][c] = true;
    }
  }
  return grid;
}

function createShields() {
  shields = [];
  const shieldW = SHIELD_COLS * SHIELD_BLOCK;
  const totalW = SHIELD_COUNT * shieldW;
  const gap = (W - totalW) / (SHIELD_COUNT + 1);

  for (let i = 0; i < SHIELD_COUNT; i++) {
    const sx = gap + i * (shieldW + gap);
    shields.push({
      x: sx,
      y: SHIELD_Y,
      grid: createShieldShape(),
    });
  }
}

function drawShields() {
  ctx.fillStyle = "#0f0";
  for (const s of shields) {
    for (let r = 0; r < SHIELD_ROWS; r++) {
      for (let c = 0; c < SHIELD_COLS; c++) {
        if (s.grid[r][c]) {
          ctx.fillRect(s.x + c * SHIELD_BLOCK, s.y + r * SHIELD_BLOCK, SHIELD_BLOCK, SHIELD_BLOCK);
        }
      }
    }
  }
}

function bulletHitsShield(bullet, removeBullet) {
  for (const s of shields) {
    const sw = SHIELD_COLS * SHIELD_BLOCK;
    const sh = SHIELD_ROWS * SHIELD_BLOCK;
    // Quick bounding-box check
    if (bullet.x + bullet.w < s.x || bullet.x > s.x + sw) continue;
    if (bullet.y + bullet.h < s.y || bullet.y > s.y + sh) continue;

    // Check individual blocks
    for (let r = 0; r < SHIELD_ROWS; r++) {
      for (let c = 0; c < SHIELD_COLS; c++) {
        if (!s.grid[r][c]) continue;
        const bx = s.x + c * SHIELD_BLOCK;
        const by = s.y + r * SHIELD_BLOCK;
        if (bullet.x < bx + SHIELD_BLOCK && bullet.x + bullet.w > bx &&
            bullet.y < by + SHIELD_BLOCK && bullet.y + bullet.h > by) {
          // Destroy a small cluster around the hit
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < SHIELD_ROWS && nc >= 0 && nc < SHIELD_COLS) {
                s.grid[nr][nc] = false;
              }
            }
          }
          return true;
        }
      }
    }
  }
  return false;
}

// ─── Collision Detection ─────────────────────────────────────────
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function checkCollisions(now) {
  // Player bullets → shields → enemies
  for (let bi = playerBullets.length - 1; bi >= 0; bi--) {
    const b = playerBullets[bi];

    // Check shields first
    if (bulletHitsShield(b)) {
      playerBullets.splice(bi, 1);
      continue;
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      if (rectsOverlap(b, e)) {
        e.alive = false;
        playerBullets.splice(bi, 1);
        score += (e.type + 1) * 10;
        break;
      }
    }
  }

  // Enemy bullets → shields → player
  for (let bi = enemyBullets.length - 1; bi >= 0; bi--) {
    const b = enemyBullets[bi];

    // Check shields first
    if (bulletHitsShield(b)) {
      enemyBullets.splice(bi, 1);
      continue;
    }

    if (now > player.invincibleUntil && rectsOverlap(b, player)) {
      enemyBullets.splice(bi, 1);
      player.hit();
      break;
    }
  }
}

// ─── HUD ─────────────────────────────────────────────────────────
function drawHUD() {
  ctx.fillStyle = "#fff";
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`SCORE: ${score}`, 10, 25);
  ctx.textAlign = "center";
  ctx.fillText(gameState === STATE.BOSS ? "BOSS" : `LEVEL ${level}/10`, W / 2, 25);
  ctx.textAlign = "right";
  ctx.fillText(`LIVES: ${"▲".repeat(lives)}`, W - 10, 25);
  ctx.textAlign = "left";

  // Divider line
  ctx.strokeStyle = "#333";
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.lineTo(W, 38);
  ctx.stroke();
}

// ─── Screens ─────────────────────────────────────────────────────
function drawStartScreen() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0f0";
  ctx.font = "bold 48px monospace";
  ctx.textAlign = "center";
  ctx.fillText("SPACE INVADERS", W / 2, H / 2 - 80);

  ctx.fillStyle = "#fff";
  ctx.font = "18px monospace";
  ctx.fillText("← → to move      SPACE to fire", W / 2, H / 2 - 20);

  ctx.fillStyle = "#ff4444";
  ctx.font = "14px monospace";
  ctx.fillText("10 pts", W / 2 + 60, H / 2 + 30);
  drawInvader(W / 2 - 70, H / 2 + 16, 30, 20, 0);

  ctx.fillStyle = "#ff8800";
  ctx.fillText("20 pts", W / 2 + 60, H / 2 + 60);
  drawInvader(W / 2 - 70, H / 2 + 46, 30, 20, 1);

  ctx.fillStyle = "#ffff00";
  ctx.fillText("30 pts", W / 2 + 60, H / 2 + 90);
  drawInvader(W / 2 - 70, H / 2 + 76, 30, 20, 2);

  ctx.fillStyle = "#0f0";
  ctx.font = "20px monospace";
  const blink = Math.floor(performance.now() / 500) % 2;
  if (blink) ctx.fillText("PRESS ENTER TO START", W / 2, H / 2 + 150);

  ctx.textAlign = "left";
}

function drawGameOverScreen() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#f00";
  ctx.font = "bold 48px monospace";
  ctx.textAlign = "center";
  ctx.fillText("GAME OVER", W / 2, H / 2 - 30);

  ctx.fillStyle = "#fff";
  ctx.font = "22px monospace";
  ctx.fillText(`FINAL SCORE: ${score}`, W / 2, H / 2 + 20);

  ctx.font = "18px monospace";
  const blink = Math.floor(performance.now() / 500) % 2;
  if (blink) ctx.fillText("PRESS ENTER TO RESTART", W / 2, H / 2 + 70);

  ctx.textAlign = "left";
}

function drawVictoryScreen() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0f0";
  ctx.font = "bold 48px monospace";
  ctx.textAlign = "center";
  ctx.fillText("PLANET CLEARED!", W / 2, H / 2 - 50);

  ctx.fillStyle = "#ffff00";
  ctx.font = "bold 28px monospace";
  ctx.fillText("BOSS DEFEATED!", W / 2, H / 2);

  ctx.fillStyle = "#fff";
  ctx.font = "22px monospace";
  ctx.fillText(`FINAL SCORE: ${score}`, W / 2, H / 2 + 40);

  ctx.font = "18px monospace";
  const blink = Math.floor(performance.now() / 500) % 2;
  if (blink) ctx.fillText("PRESS ENTER TO PLAY AGAIN", W / 2, H / 2 + 90);

  ctx.textAlign = "left";
}

// ─── Level Advance ──────────────────────────────────────────────
let levelTransition = false;
let levelTransitionEnd = 0;

function advanceLevel() {
  level++;
  levelTransition = true;
  levelTransitionEnd = performance.now() + 2000;
  playerBullets = [];
  enemyBullets = [];
  createEnemyGrid();
  createShields();
}

function drawLevelTransition() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0f0";
  ctx.font = "bold 40px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`LEVEL ${level}`, W / 2, H / 2 - 10);

  ctx.fillStyle = "#fff";
  ctx.font = "18px monospace";
  ctx.fillText("GET READY!", W / 2, H / 2 + 30);
  ctx.textAlign = "left";
}

// ─── Boss ───────────────────────────────────────────────────────
function startBossFight() {
  gameState = STATE.BOSS;
  playerBullets = [];
  enemyBullets = [];
  bossBullets = [];
  enemies = [];
  bossPhase = 0;
  bossPhaseTimer = performance.now() + 3000;
  boss = {
    x: W / 2 - BOSS_WIDTH / 2,
    y: 60,
    w: BOSS_WIDTH,
    h: BOSS_HEIGHT,
    hp: BOSS_MAX_HP,
    direction: 1,
    flashUntil: 0,
  };
}

function updateBoss(now) {
  if (!boss) return;

  // Movement — side to side
  boss.x += BOSS_SPEED * boss.direction;
  if (boss.x + boss.w > W - 10) boss.direction = -1;
  if (boss.x < 10) boss.direction = 1;

  // Phase transitions every 3 seconds
  if (now > bossPhaseTimer) {
    bossPhase = (bossPhase + 1) % 3;
    bossPhaseTimer = now + 3000;
  }

  // Shooting based on phase
  if (bossPhase === 0) {
    // Aimed shot at player
    if (Math.random() < 0.02) {
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h;
      const dx = (player.x + player.w / 2) - cx;
      const dy = (player.y) - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      bossBullets.push({
        x: cx - 2, y: cy, w: 4, h: 10,
        vx: (dx / dist) * BOSS_BULLET_SPEED,
        vy: (dy / dist) * BOSS_BULLET_SPEED,
      });
    }
  } else if (bossPhase === 1) {
    // Spread shot — 3 bullets in a fan
    if (Math.random() < 0.015) {
      const cx = boss.x + boss.w / 2;
      const cy = boss.y + boss.h;
      for (let angle = -0.3; angle <= 0.3; angle += 0.3) {
        bossBullets.push({
          x: cx - 2, y: cy, w: 4, h: 10,
          vx: Math.sin(angle) * BOSS_BULLET_SPEED,
          vy: Math.cos(angle) * BOSS_BULLET_SPEED,
        });
      }
    }
  } else {
    // Rapid fire — straight down from random positions
    if (Math.random() < 0.04) {
      const rx = boss.x + Math.random() * boss.w;
      bossBullets.push({
        x: rx - 2, y: boss.y + boss.h, w: 4, h: 10,
        vx: 0, vy: BOSS_BULLET_SPEED * 1.2,
      });
    }
  }
}

function updateBossBullets() {
  for (let i = bossBullets.length - 1; i >= 0; i--) {
    const b = bossBullets[i];
    b.x += b.vx;
    b.y += b.vy;
    if (b.y > H || b.y < 0 || b.x < 0 || b.x > W) {
      bossBullets.splice(i, 1);
    }
  }
}

function checkBossCollisions(now) {
  // Player bullets → boss
  for (let bi = playerBullets.length - 1; bi >= 0; bi--) {
    const b = playerBullets[bi];
    if (rectsOverlap(b, boss)) {
      playerBullets.splice(bi, 1);
      boss.hp--;
      boss.flashUntil = now + 100;
      score += 5;
      if (boss.hp <= 0) {
        score += 500;  // Boss kill bonus
        boss = null;
        gameState = STATE.VICTORY;
        return;
      }
    }
  }

  // Boss bullets → shields → player
  for (let bi = bossBullets.length - 1; bi >= 0; bi--) {
    const b = bossBullets[bi];
    if (bulletHitsShield(b)) {
      bossBullets.splice(bi, 1);
      continue;
    }
    if (now > player.invincibleUntil && rectsOverlap(b, player)) {
      bossBullets.splice(bi, 1);
      player.hit();
      break;
    }
  }
}

function drawBoss(now) {
  if (!boss) return;

  const flash = boss.flashUntil > now;

  // Body — large menacing shape
  ctx.fillStyle = flash ? "#fff" : "#ff00ff";
  ctx.fillRect(boss.x + 15, boss.y, boss.w - 30, boss.h);         // core
  ctx.fillRect(boss.x, boss.y + 10, boss.w, boss.h - 20);         // wide middle

  // Wings/arms
  ctx.fillStyle = flash ? "#fff" : "#cc00cc";
  ctx.fillRect(boss.x - 8, boss.y + 15, 12, 25);                  // left arm
  ctx.fillRect(boss.x + boss.w - 4, boss.y + 15, 12, 25);         // right arm

  // Crown spikes
  ctx.fillStyle = flash ? "#fff" : "#ff44ff";
  ctx.fillRect(boss.x + 20, boss.y - 8, 6, 10);
  ctx.fillRect(boss.x + boss.w / 2 - 3, boss.y - 12, 6, 14);
  ctx.fillRect(boss.x + boss.w - 26, boss.y - 8, 6, 10);

  // Eyes — large and red
  ctx.fillStyle = flash ? "#fff" : "#f00";
  ctx.fillRect(boss.x + 22, boss.y + 18, 10, 8);
  ctx.fillRect(boss.x + boss.w - 32, boss.y + 18, 10, 8);

  // Eye pupils
  ctx.fillStyle = "#000";
  ctx.fillRect(boss.x + 26, boss.y + 20, 4, 4);
  ctx.fillRect(boss.x + boss.w - 28, boss.y + 20, 4, 4);

  // Mouth
  ctx.fillStyle = flash ? "#fff" : "#f00";
  ctx.fillRect(boss.x + 30, boss.y + 35, boss.w - 60, 6);
  // Teeth
  ctx.fillStyle = "#fff";
  for (let t = boss.x + 33; t < boss.x + boss.w - 33; t += 8) {
    ctx.fillRect(t, boss.y + 35, 4, 3);
  }

  // HP bar
  const barW = 120;
  const barH = 8;
  const barX = W / 2 - barW / 2;
  const barY = 44;
  const hpPct = boss.hp / BOSS_MAX_HP;
  ctx.fillStyle = "#333";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = hpPct > 0.3 ? "#f0f" : "#f00";
  ctx.fillRect(barX, barY, barW * hpPct, barH);
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(barX, barY, barW, barH);

  // Boss name
  ctx.fillStyle = "#ff44ff";
  ctx.font = "12px monospace";
  ctx.textAlign = "center";
  ctx.fillText("OVERLORD", W / 2, barY - 4);
  ctx.textAlign = "left";
}

function drawBossBullets() {
  ctx.fillStyle = "#f0f";
  for (const b of bossBullets) {
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
}

// ─── Game Lifecycle ──────────────────────────────────────────────
function startGame() {
  gameState = STATE.PLAYING;
  score = 0;
  level = 1;
  lives = STARTING_LIVES;
  player.x = W / 2 - PLAYER_WIDTH / 2;
  player.invincibleUntil = 0;
  playerBullets = [];
  enemyBullets = [];
  bossBullets = [];
  boss = null;
  lastEnemyShot = 0;
  lastPlayerShot = 0;
  levelTransition = false;
  createEnemyGrid();
  createShields();
}

function resetGame() {
  gameState = STATE.START;
  boss = null;
  bossBullets = [];
}

// ─── Main Game Loop (60 FPS) ─────────────────────────────────────
function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  switch (gameState) {
    case STATE.START:
      drawStartScreen();
      break;

    case STATE.PLAYING:
      // Level transition overlay
      if (levelTransition && timestamp < levelTransitionEnd) {
        drawHUD();
        player.draw();
        drawEnemies();
        drawShields();
        drawLevelTransition();
        break;
      }
      if (levelTransition) levelTransition = false;

      // Update
      player.update();
      player.shoot(timestamp);
      updateEnemies();
      updatePlayerBullets();
      updateEnemyBullets();
      enemyShoot(timestamp);
      checkCollisions(timestamp);

      // Draw
      drawHUD();
      player.draw();
      drawEnemies();
      drawShields();
      drawBullets();
      break;

    case STATE.BOSS:
      // Update
      player.update();
      player.shoot(timestamp);
      updateBoss(timestamp);
      updatePlayerBullets();
      updateBossBullets();
      if (boss) checkBossCollisions(timestamp);

      // Draw
      drawHUD();
      player.draw();
      drawShields();
      drawBoss(timestamp);
      drawBullets();
      drawBossBullets();
      break;

    case STATE.GAME_OVER:
      drawHUD();
      player.draw();
      drawEnemies();
      drawShields();
      drawBullets();
      if (boss) drawBoss(timestamp);
      drawBossBullets();
      drawGameOverScreen();
      break;

    case STATE.VICTORY:
      drawHUD();
      drawVictoryScreen();
      break;
  }
}

// Kick off
requestAnimationFrame(gameLoop);
