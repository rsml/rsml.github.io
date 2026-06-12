const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const livesEl = document.getElementById("lives");
const levelEl = document.getElementById("level");
const statusEl = document.getElementById("status");
const storyText = document.getElementById("story-text");
const unicornTrophy = document.getElementById("unicorn-trophy");
const dragonTrophy = document.getElementById("dragon-trophy");
const phoenixTrophy = document.getElementById("phoenix-trophy");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayBtn = document.getElementById("overlay-btn");
const btnRun = document.getElementById("btn-run");
const btnAttack = document.getElementById("btn-attack");
const avatarSelect = document.getElementById("avatar-select");
const hairSelect = document.getElementById("hair-select");

const TILE = 32;
const ROWS = 15;
const COLS = 20;

const COLORS = {
  wall: "#1c2c48",
  floor: "#0c1326",
  player: "#52a5ff",
  hair: "#ffd166",
  animal: "#e45858",
  soul: "#8a5cf6",
  exit: "#37d67a",
};

const levels = [
  {
    name: "Easy",
    map: [
      "####################",
      "#..A...............#",
      "#.######.######.##.#",
      "#.#....#.#....#.#..#",
      "#.#.##.#.#.##.#.#.##",
      "#.#.#..#.#.#..#.#..#",
      "#.#.##.#.#.##.#.##.#",
      "#.#....#.#....#.#..#",
      "#.######.######.##.#",
      "#..................#",
      "#######.############",
      "#..................#",
      "#.##################",
      "#...............E..#",
      "####################",
    ],
  },
  {
    name: "Medium",
    map: [
      "####################",
      "#..A.....#....#....#",
      "####.###.#.##.#.##.#",
      "#....#...#....#..#.#",
      "#.##.#.####.###.#..#",
      "#.#..#....#....#.###",
      "#.#.####.#.##.#...#",
      "#.#....#.#....#.A.#",
      "#.####.#.#.######.#",
      "#......#.#........#",
      "######.#.##########",
      "#......#.......E..#",
      "#.#################",
      "#.................#",
      "####################",
    ],
  },
  {
    name: "Boss",
    map: [
      "####################",
      "#A...#.......#....E#",
      "#.###.#.###.#.####.#",
      "#.#...#.#...#....#.#",
      "#.#.###.#.#####.#..#",
      "#.#.....#.....#.#.##",
      "#.#######.###.#.#..#",
      "#.........#...#.#..#",
      "#####.#####.###.#..#",
      "#...#.....#.....#..#",
      "#.#.#####.#####.####",
      "#.#.....#.....#....#",
      "#.#####.#.###.###..#",
      "#.......#A..#......#",
      "####################",
    ],
  },
];

const state = {
  levelIndex: 0,
  lives: 5,
  player: { x: 1, y: 1 },
  animals: [],
  souls: [],
  exit: { x: 0, y: 0 },
  hasTrophy: false,
  defeated: [],
};

function resetLevel() {
  const level = levels[state.levelIndex];
  state.player = { x: 1, y: 1 };
  state.animals = [];
  state.souls = [];
  state.exit = { x: 0, y: 0 };
  parseMap(level.map);
  updateHUD("Explore the maze");
  draw();
}

function parseMap(map) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tile = map[y][x];
      if (tile === "A") state.animals.push({ x, y, soulFound: false, alive: true });
      if (tile === "E") state.exit = { x, y };
    }
  }
}

function isWall(x, y) {
  const level = levels[state.levelIndex];
  return level.map[y][x] === "#";
}

function movePlayer(dx, dy) {
  const nx = state.player.x + dx;
  const ny = state.player.y + dy;
  if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;
  if (isWall(nx, ny)) {
    loseLife("Bumped a wall!");
    return;
  }
  state.player = { x: nx, y: ny };
  interact();
  draw();
}

function interact() {
  // Touch animal to gain its soul, then allow actions.
  for (const animal of state.animals) {
    if (!animal.alive) continue;
    if (animal.x === state.player.x && animal.y === state.player.y) {
      animal.soulFound = true;
      updateHUD("You found the animal's soul. Run or attack!");
      return;
    }
  }
  // Check souls placement for visuals.
  for (const animal of state.animals) {
    if (animal.soulFound && animal.alive) {
      state.souls.push({ x: animal.x, y: animal.y });
    }
  }
  // Exit check
  if (state.player.x === state.exit.x && state.player.y === state.exit.y) {
    if (state.levelIndex === levels.length - 1) {
      winGame();
    } else {
      state.levelIndex++;
      levelEl.textContent = `Level: ${state.levelIndex + 1}/3`;
      updateHUD("Level up! Maze gets tougher.");
      resetLevel();
    }
  }
}

function attack() {
  for (const animal of state.animals) {
    if (!animal.alive || !animal.soulFound) continue;
    if (touching(animal)) {
      const survive = Math.random() > 0.35; // simple risk
      if (survive) {
        animal.alive = false;
        state.defeated.push(levels[state.levelIndex].name);
        updateHUD("You defeated the animal!");
        draw();
      } else {
        loseLife("The animal struck back!");
      }
      return;
    }
  }
  updateHUD("Touch an animal first to fight.");
}

function runAway() {
  for (const animal of state.animals) {
    if (!animal.alive || !animal.soulFound) continue;
    if (touching(animal)) {
      const dx = Math.sign(state.player.x - animal.x) || 1;
      const dy = Math.sign(state.player.y - animal.y);
      movePlayer(dx, dy);
      updateHUD("You ran away!");
      return;
    }
  }
  updateHUD("Touch an animal first to run.");
}

function touching(animal) {
  return Math.abs(animal.x - state.player.x) + Math.abs(animal.y - state.player.y) === 0;
}

function loseLife(reason) {
  state.lives -= 1;
  livesEl.textContent = `Lives: ${state.lives}`;
  statusEl.textContent = `${reason} Lives left: ${state.lives}`;
  if (state.lives <= 0) {
    gameOver();
  }
}

function gameOver() {
  overlay.classList.remove("hidden");
  overlayTitle.textContent = "Game Over";
  overlayText.textContent = "You lost all lives. Try again!";
}

function winGame() {
  overlay.classList.remove("hidden");
  overlayTitle.textContent = "Victory!";
  overlayText.textContent = "You beat all levels and earned the unicorn trophy!";
  state.hasTrophy = true;
  unicornTrophy.classList.add("active");
  storyText.textContent = "Take the unicorn trophy to the house shelf to finish the run.";
}

function resetGame() {
  state.levelIndex = 0;
  state.lives = 5;
  state.hasTrophy = false;
  state.defeated = [];
  unicornTrophy.classList.remove("active");
  dragonTrophy.classList.remove("active");
  phoenixTrophy.classList.remove("active");
  livesEl.textContent = "Lives: 5";
  levelEl.textContent = "Level: 1/3";
  overlay.classList.add("hidden");
  resetLevel();
}

function updateHUD(text) {
  statusEl.textContent = text;
}

function draw() {
  const level = levels[state.levelIndex];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tile = level.map[y][x];
      if (tile === "#") {
        ctx.fillStyle = COLORS.wall;
      } else if (tile === "E") {
        ctx.fillStyle = COLORS.exit;
      } else {
        ctx.fillStyle = COLORS.floor;
      }
      ctx.fillRect(x * TILE, y * TILE, TILE - 1, TILE - 1);
    }
  }

  for (const animal of state.animals) {
    if (!animal.alive) continue;
    ctx.fillStyle = COLORS.animal;
    ctx.beginPath();
    ctx.arc(animal.x * TILE + TILE / 2, animal.y * TILE + TILE / 2, TILE / 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (animal.soulFound) {
      ctx.strokeStyle = COLORS.soul;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.fillStyle = COLORS.player;
  ctx.fillRect(state.player.x * TILE + 6, state.player.y * TILE + 6, TILE - 12, TILE - 12);
  ctx.fillStyle = hairSelect.value;
  ctx.fillRect(state.player.x * TILE + 10, state.player.y * TILE + 2, TILE - 20, 6);
  ctx.fillStyle = avatarSelect.value;
  ctx.fillRect(state.player.x * TILE + 6, state.player.y * TILE + 6, TILE - 12, TILE - 12);
}

function handleKey(e) {
  const key = e.key.toLowerCase();
  if (key === "w" || key === "arrowup") movePlayer(0, -1);
  if (key === "s" || key === "arrowdown") movePlayer(0, 1);
  if (key === "a" || key === "arrowleft") movePlayer(-1, 0);
  if (key === "d" || key === "arrowright") movePlayer(1, 0);
}

btnAttack.addEventListener("click", attack);
btnRun.addEventListener("click", runAway);
overlayBtn.addEventListener("click", resetGame);
avatarSelect.addEventListener("change", draw);
hairSelect.addEventListener("change", draw);
window.addEventListener("keydown", handleKey);

resetLevel();
