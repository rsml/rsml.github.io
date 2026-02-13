const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const roofY = 370;
const gravity = 0.55;
const friction = 0.8;
const maxLives = 3;

const keys = { left: false, right: false, up: false };

const santa = {
  x: 80,
  y: roofY - 60,
  w: 42,
  h: 60,
  vx: 0,
  vy: 0,
  onGround: true,
  lives: maxLives,
  invulnUntil: 0,
  carryingPresents: true,
};

const snowman = { x: 760, y: roofY - 60, w: 46, h: 64 };
const snowballs = [];

const goal = { x: 830, w: 40, h: 90 };
let presents = [];
let unicorns = [];

let lastTime = 0;
let throwTimer = 0;
let state = "playing"; // playing | delivering | win | over
let statusText = "Get across the roof.";

const livesEl = document.getElementById("lives");
const statusEl = document.getElementById("status-text");

function resetSanta() {
  santa.x = 80;
  santa.y = roofY - santa.h;
  santa.vx = 0;
  santa.vy = 0;
  santa.onGround = true;
}

function resetGame(full = false) {
  snowballs.length = 0;
  presents = [];
  unicorns = [];
  state = "playing";
  statusText = "Get across the roof.";
  throwTimer = 0;
  santa.carryingPresents = true;
  resetSanta();
  if (full) {
    santa.lives = maxLives;
  }
}

function spawnSnowball() {
  const speed = - (4 + Math.random() * 2.4);
  const upward = - (6 + Math.random() * 2.5);
  snowballs.push({
    x: snowman.x,
    y: snowman.y + 10,
    vx: speed,
    vy: upward,
    r: 10 + Math.random() * 3,
  });
}

function update(dt) {
  if (state === "delivering" || state === "win" || state === "over") {
    return;
  }

  const speed = 0.85;
  if (keys.left) santa.vx -= speed;
  if (keys.right) santa.vx += speed;
  santa.vx *= friction;
  santa.vx = Math.max(Math.min(santa.vx, 6), -6);

  santa.vy += gravity;
  santa.x += santa.vx;
  santa.y += santa.vy;

  if (santa.y + santa.h >= roofY) {
    santa.y = roofY - santa.h;
    santa.vy = 0;
    santa.onGround = true;
  } else {
    santa.onGround = false;
  }

  santa.x = Math.max(20, Math.min(canvas.width - santa.w - 10, santa.x));

  if (throwTimer <= 0) {
    spawnSnowball();
    throwTimer = 900 + Math.random() * 800;
  } else {
    throwTimer -= dt;
  }

  snowballs.forEach((b) => {
    b.x += b.vx;
    b.y += b.vy;
    b.vy += 0.18;
  });
  while (snowballs.length && snowballs[0].x < -50) snowballs.shift();

  checkCollisions();
  checkGoal();
}

function checkCollisions() {
  const now = performance.now();
  snowballs.forEach((b) => {
    if (rectCircleCollides(santa, b) && now > santa.invulnUntil) {
      santa.lives -= 1;
      santa.invulnUntil = now + 1100;
      statusText = "Snowball hit!";
      if (santa.lives <= 0) {
        state = "over";
        statusText = "Out of lives. Press R to restart.";
      }
    }
  });

  if (rectsCollide(santa, snowman) && now > santa.invulnUntil && state === "playing") {
    santa.lives -= 1;
    santa.invulnUntil = now + 1100;
    statusText = "Snowman bump! Back to start.";
    resetSanta();
    if (santa.lives <= 0) {
      state = "over";
      statusText = "Out of lives. Press R to restart.";
    }
  }
}

function checkGoal() {
  if (state !== "playing") return;
  if (santa.x + santa.w >= goal.x) {
    state = "delivering";
    statusText = "Dropping presents...";
    santa.vx = 0;
    santa.vy = 0;
    santa.x = goal.x - santa.w - 4;
    dropPresents();
    setTimeout(() => {
      spawnUnicorns();
      state = "win";
      statusText = "Unicorns open the presents! Press R to play again.";
    }, 1600);
  }
}

function dropPresents() {
  const count = 4;
  presents = [];
  for (let i = 0; i < count; i++) {
    presents.push({
      x: goal.x - 20,
      y: roofY - (i + 1) * 18,
      size: 18,
      tint: i % 2 === 0 ? "#d95064" : "#42b0e8",
    });
  }
  santa.carryingPresents = false;
}

function spawnUnicorns() {
  unicorns = [
    { x: goal.x + 16, y: roofY - 30, color: "#ffd166" },
    { x: goal.x - 18, y: roofY - 35, color: "#9b6efb" },
  ];
}

function rectsCollide(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function rectCircleCollides(rect, circle) {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.w);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.h);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy < circle.r * circle.r;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function drawBackground() {
  ctx.fillStyle = "#0a1934";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#0f2345";
  ctx.fillRect(0, roofY, canvas.width, canvas.height - roofY);

  ctx.fillStyle = "#162f57";
  ctx.fillRect(0, roofY - 40, canvas.width, 40);

  ctx.fillStyle = "#d6e6ff";
  ctx.beginPath();
  ctx.arc(90, 100, 50, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f3f6ff44";
  for (let i = 0; i < 120; i++) {
    const x = (i * 67) % canvas.width;
    const y = (i * 139) % roofY;
    ctx.fillRect(x, (y % roofY), 2, 2);
  }
}

function drawHouse() {
  ctx.fillStyle = "#1e3b66";
  ctx.fillRect(goal.x - 30, roofY - goal.h, goal.w + 40, goal.h);
  ctx.fillStyle = "#0f1f3d";
  ctx.fillRect(goal.x + 8, roofY - goal.h + 10, 14, 30);
  ctx.fillStyle = "#c14444";
  ctx.fillRect(goal.x + 10, roofY - goal.h, 20, 20);
}

function drawSnowman() {
  ctx.fillStyle = "#f4f7fb";
  ctx.beginPath();
  ctx.arc(snowman.x + snowman.w / 2, snowman.y + 25, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(snowman.x + snowman.w / 2, snowman.y - 5, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f89c3c";
  ctx.fillRect(snowman.x + snowman.w / 2, snowman.y - 5, 12, 4);
  ctx.fillStyle = "#000";
  ctx.fillRect(snowman.x + 10, snowman.y - 16, 8, 8);
  ctx.fillRect(snowman.x + 26, snowman.y - 16, 8, 8);
  ctx.fillStyle = "#222";
  ctx.fillRect(snowman.x + 12, snowman.y - 35, 20, 8);
  ctx.fillRect(snowman.x + 10, snowman.y - 27, 24, 4);
}

function drawSanta() {
  const flashing = performance.now() < santa.invulnUntil && Math.floor(performance.now() / 120) % 2 === 0;
  if (flashing) return;
  ctx.fillStyle = "#e43b4f";
  ctx.fillRect(santa.x, santa.y, santa.w, santa.h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(santa.x, santa.y - 6, santa.w, 8);
  ctx.fillRect(santa.x + 5, santa.y + 6, 10, 10);
  ctx.fillStyle = "#f4d6b7";
  ctx.fillRect(santa.x + 10, santa.y + 10, 20, 20);
  ctx.fillStyle = "#222";
  ctx.fillRect(santa.x + 10, santa.y + 30, 20, 12);
  if (santa.carryingPresents) {
    ctx.fillStyle = "#3db2ff";
    ctx.fillRect(santa.x - 10, santa.y + 8, 10, 30);
  }
}

function drawSnowballs() {
  ctx.fillStyle = "#e7f4ff";
  snowballs.forEach((b) => {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPresents() {
  presents.forEach((p) => {
    ctx.fillStyle = p.tint;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(p.x + p.size / 2 - 2, p.y, 4, p.size);
    ctx.fillRect(p.x, p.y + p.size / 2 - 2, p.size, 4);
  });
}

function drawUnicorns() {
  unicorns.forEach((u, i) => {
    ctx.fillStyle = "#f8f9fb";
    ctx.fillRect(u.x, u.y, 26, 30);
    ctx.fillStyle = u.color;
    ctx.fillRect(u.x, u.y + 8, 26, 6);
    ctx.fillStyle = "#fcbad3";
    ctx.fillRect(u.x + 8, u.y - 6, 6, 10);
    ctx.fillStyle = "#333";
    ctx.fillRect(u.x + 6, u.y + 4, 4, 4);
    ctx.fillRect(u.x + 16, u.y + 4, 4, 4);
    const hoofLift = i % 2 === 0 ? -4 : 0;
    ctx.fillRect(u.x - 4, u.y + 16 + hoofLift, 8, 8);
    ctx.fillRect(u.x + 22, u.y + 16 - hoofLift, 8, 8);
  });
}

function drawStatusOverlay() {
  ctx.fillStyle = "#ffffff10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#cfd8e6";
  ctx.font = "18px 'Trebuchet MS', sans-serif";
  ctx.fillText("Press R to restart", 20, 30);
}

function loop(timestamp) {
  const dt = lastTime ? timestamp - lastTime : 16;
  lastTime = timestamp;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  drawBackground();
  drawHouse();
  drawSnowman();
  drawSnowballs();
  drawPresents();
  drawUnicorns();
  drawSanta();
  if (state === "win" || state === "over") drawStatusOverlay();
  livesEl.textContent = `Lives: ${santa.lives}`;
  statusEl.textContent = statusText;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") keys.left = true;
  if (e.key === "ArrowRight") keys.right = true;
  if (e.key === "ArrowUp") {
    if (santa.onGround && state === "playing") {
      santa.vy = -12.5;
      santa.onGround = false;
    }
    keys.up = true;
  }
  if (e.key === "r" || e.key === "R") {
    resetGame(true);
  }
});

document.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft") keys.left = false;
  if (e.key === "ArrowRight") keys.right = false;
  if (e.key === "ArrowUp") keys.up = false;
});

resetGame(true);
requestAnimationFrame(loop);
