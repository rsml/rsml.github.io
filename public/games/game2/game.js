const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const toast = document.getElementById("toast");

const princessImg = new Image();
princessImg.src = "assets/princess.png";
const queenImg = new Image();
queenImg.src = "assets/queen.png";

const SPRITE_SCALE = 2.5;
const FRAME_W = 24;
const FRAME_H = 32;
const DRAW_W = FRAME_W * SPRITE_SCALE;
const DRAW_H = FRAME_H * SPRITE_SCALE;

const player = {
  worldX: 120,
  y: 0,
  vy: 0,
  w: DRAW_W * 0.9,
  h: DRAW_H,
  grounded: false,
  coyote: 0,
  anim: 0,
};

const state = {
  levelIndex: 0,
  level: null,
  speed: 3.4,
  gravity: 1.1,
  jumpHoldGravity: 0.45,
  topHoldGravity: 0.18,
  topHoldWindow: 2.2,
  jumpReleaseBoost: 1.4,
  jumpVelocity: -18.5,
  maxFall: 20,
  status: "waiting", // waiting | running | crashed | won
  failTimer: 0,
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (state.level) {
    setupLevel(state.levelIndex);
  }
}
window.addEventListener("resize", resize);

function groundY() {
  return canvas.height - 90;
}

function makeQueen(x, baseY) {
  return {
    x,
    baseY,
    w: DRAW_W * 0.9,
    h: DRAW_H,
    anim: 0,
  };
}

function buildLevel(index) {
  const g = groundY();
  if (index === 0) {
    const queens = [320, 760, 1180, 1600].map((x) => makeQueen(x, g));
    return { ground: g, platforms: [], queens, length: 2000 };
  }

  const platformDefs = [
    { x: 520, width: 240, offset: -180 },
    { x: 1220, width: 260, offset: -230 },
    { x: 1820, width: 220, offset: -200 },
  ];

  const platforms = platformDefs.map((p) => ({
    x: p.x,
    width: p.width,
    y: g + p.offset,
  }));

  const queens = [
    makeQueen(280, g),
    makeQueen(340, g), // early double-queen gap
    makeQueen(860, g),
    makeQueen(1260, g),
    makeQueen(1720, g),
    makeQueen(2060, g),
  ];

  // perched queens for platform hops, but kept light
  queens.push(makeQueen(platforms[0].x + 140, platforms[0].y));
  queens.push(makeQueen(platforms[1].x + 80, platforms[1].y));

  const length = 2450;
  return { ground: g, platforms, queens, length };
}

function setupLevel(levelIndex) {
  state.levelIndex = levelIndex;
  state.level = buildLevel(levelIndex);
  player.worldX = 140;
  player.y = state.level.ground;
  player.vy = 0;
  player.grounded = true;
  player.coyote = 0;
  state.status = "running";
  state.failTimer = 0;
  showToast(`Level ${levelIndex + 1}: run and jump past the queens!`);
}

function showToast(text, duration = 2000) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), duration);
}

let keys = {};
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    keys.space = true;
    handleJump();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    keys.space = false;
  }
});

function handleJump() {
  if (state.status === "crashed") {
    setupLevel(state.levelIndex);
    return;
  }
  if (state.status === "won") {
    setupLevel(state.levelIndex + 1);
    return;
  }
  if (player.grounded || player.coyote > 0) {
    player.vy = state.jumpVelocity;
    player.grounded = false;
    player.coyote = 0;
  }
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function update(dt) {
  if (state.status === "waiting") return;

  if (state.status === "crashed") {
    state.failTimer -= dt;
    if (state.failTimer <= 0 && keys.space) {
      setupLevel(state.levelIndex);
    }
    return;
  }

  player.anim += dt;
  state.level.queens.forEach((q) => (q.anim += dt));

  const frameScale = dt * 60; // normalize physics to ~60fps
  let gravity = state.gravity;
  const nearApex =
    player.vy > -state.topHoldWindow && player.vy < state.topHoldWindow;
  if (keys.space && player.vy < 0) {
    gravity = state.jumpHoldGravity;
    if (nearApex) gravity = state.topHoldGravity; // gentle float at the top
  }
  if (!keys.space && player.vy < 0) gravity += state.jumpReleaseBoost;

  player.vy += gravity * frameScale;
  if (player.vy > state.maxFall) player.vy = state.maxFall;
  const nextY = player.y + player.vy * frameScale;

  const camX = player.worldX - 160;
  const level = state.level;

  // find the current surface under the player (ground or platform)
  let supportY = level.ground;
  for (const plat of level.platforms) {
    const pStart = plat.x;
    const pEnd = plat.x + plat.width;
    const px = player.worldX;
    const onPlatform = px > pStart - player.w / 2 && px < pEnd + player.w / 2;
    if (onPlatform && nextY >= plat.y && player.y <= plat.y) {
      supportY = Math.min(supportY, plat.y);
    }
  }

  player.grounded = false;
  if (nextY >= supportY) {
    player.y = supportY;
    player.vy = 0;
    player.grounded = true;
    player.coyote = 0.12;
  } else {
    player.y = nextY;
    if (player.coyote > 0) player.coyote = Math.max(0, player.coyote - dt);
  }

  player.worldX += state.speed * frameScale;

  // remove queens that are far behind camera
  level.queens = level.queens.filter((q) => q.x > camX - 120);

  // collision check
  const playerRect = {
    x: player.worldX - player.w / 2,
    y: player.y - player.h,
    w: player.w,
    h: player.h,
  };
  for (const q of level.queens) {
    const qRect = {
      x: q.x - q.w / 2,
      y: q.baseY - q.h,
      w: q.w,
      h: q.h,
    };
    if (rectsOverlap(playerRect, qRect)) {
      state.status = "crashed";
      state.failTimer = 1.2;
      showToast("Caught! Space to retry", 1500);
      return;
    }
  }

  if (player.worldX > level.length) {
    state.status = "won";
    showToast("Nice! Space for the next stretch", 2000);
  }
}

function drawBackground(camX, ground) {
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#ffeef8");
  sky.addColorStop(1, "#f4ddff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // distant hills
  ctx.fillStyle = "#d0b3ff";
  for (let i = -1; i < 6; i++) {
    const x = ((i * 260 - (camX * 0.3)) % (canvas.width + 260)) - 260;
    ctx.beginPath();
    ctx.ellipse(x, ground + 50, 220, 70, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ground
  ctx.fillStyle = "#473365";
  ctx.fillRect(0, ground, canvas.width, canvas.height - ground);
  ctx.fillStyle = "#63468c";
  for (let i = 0; i < canvas.width; i += 36) {
    ctx.fillRect(i, ground - 6, 26, 8);
  }
}

function drawPlatforms(camX, platforms) {
  ctx.fillStyle = "#7e5bb8";
  platforms.forEach((plat) => {
    const x = plat.x - camX;
    ctx.fillRect(x, plat.y, plat.width, 10);
    ctx.fillStyle = "#d9c7ff";
    ctx.fillRect(x, plat.y - 4, plat.width, 4);
    ctx.fillStyle = "#7e5bb8";
  });
}

function drawQueens(camX, queens) {
  const frames = 4;
  queens.forEach((q) => {
    const screenX = q.x - camX;
    const frame = Math.floor(q.anim * 10) % frames;
    ctx.drawImage(
      queenImg,
      frame * FRAME_W,
      0,
      FRAME_W,
      FRAME_H,
      screenX - DRAW_W / 2,
      q.baseY - DRAW_H,
      DRAW_W,
      DRAW_H
    );
  });
}

function drawPlayer(camX) {
  const isJumping = !player.grounded && player.vy < -2;
  const frame = isJumping ? 3 : Math.floor(player.anim * 10) % 3;
  const screenX = player.worldX - camX;
  ctx.drawImage(
    princessImg,
    frame * FRAME_W,
    0,
    FRAME_W,
    FRAME_H,
    screenX - DRAW_W / 2,
    player.y - DRAW_H,
    DRAW_W,
    DRAW_H
  );
}

let last = 0;
function loop(ts) {
  if (!last) last = ts;
  const dt = (ts - last) / 1000;
  last = ts;
  const camX = player.worldX - 160;
  const levelGround = state.level ? state.level.ground : groundY();
  drawBackground(camX, levelGround);
  if (state.level) {
    drawPlatforms(camX, state.level.platforms);
    drawQueens(camX, state.level.queens);
  }
  drawPlayer(camX);
  drawHud();
  update(dt);
  requestAnimationFrame(loop);
}

function drawHud() {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#fff";
  ctx.fillRect(12, 52, 180, 46);
  ctx.restore();
  ctx.fillStyle = "#3a2350";
  ctx.font = "16px 'Trebuchet MS', Arial, sans-serif";
  ctx.fillText(`Level ${state.levelIndex + 1}`, 22, 78);
  ctx.fillStyle = "#5e3a86";
  const statusText =
    state.status === "crashed"
      ? "Caught! Space to retry"
      : state.status === "won"
      ? "Finished! Space -> next"
      : "Jump over every queen";
  ctx.fillText(statusText, 22, 98);
}

function startIfReady() {
  if (princessImg.complete && queenImg.complete) {
    resize();
    setupLevel(0);
    state.status = "running";
    requestAnimationFrame(loop);
  }
}
princessImg.onload = startIfReady;
queenImg.onload = startIfReady;

// in case the browser caches fast enough to mark complete immediately
startIfReady();
