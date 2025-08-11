(() => {
  "use strict";

  // Game constants
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayText = document.getElementById("overlayText");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const pauseBtn = document.getElementById("pauseBtn");
  const restartBtn = document.getElementById("restartBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsDialog = document.getElementById("settingsDialog");
  const difficultySelect = document.getElementById("difficulty");
  const wallsSelect = document.getElementById("walls");
  const soundSelect = document.getElementById("sound");
  const applySettingsBtn = document.getElementById("applySettings");

  const boardSizePx = 600;
  const cellSizePx = 24; // results in a 25x25 grid
  const gridWidth = Math.floor(boardSizePx / cellSizePx);
  const gridHeight = Math.floor(boardSizePx / cellSizePx);

  // Derived visual constants
  const colors = {
    backgroundDark: "#0e1730",
    snakeHead: "#7fbf6a",
    snakeBody: "#4f9a52",
    apple: "#d94d4d",
    gridLine: "rgba(255,255,255,0.05)",
  };

  // Sound effects (very small inline beeps using WebAudio)
  const audioCtx = typeof window.AudioContext !== "undefined" ? new AudioContext() : null;
  let soundEnabled = true;

  function beep(frequency, durationMs, type = "sine", volume = 0.03) {
    if (!audioCtx || !soundEnabled) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = frequency;
    g.gain.value = volume;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      o.disconnect();
      g.disconnect();
    }, durationMs);
  }

  // Game state
  let snake = [];
  let direction = { x: 1, y: 0 }; // moving right initially
  let pendingDirection = { x: 1, y: 0 };
  let apples = [];
  let bomb = null; // { x, y }
  let magnet = null; // { x, y }
  let magnetActive = false;
  let magnetUntil = 0; // timestamp in ms
  const magnetRadiusCells = 3; // how far we auto-eat
  let rocket = null; // { x, y } pickup
  let rocketActive = null; // { xPx, yPx, vx, vy, untilMs, dropsLeft, nextDropAt, lastMs }
  let score = 0;
  let best = Number(localStorage.getItem("snake_best") || 0);
  let running = false;
  let paused = false;
  let walls = "solid"; // or 'wrap'
  let speedMs = 130; // base speed; will adjust via difficulty
  let lastTick = 0;
  const lightDir = { x: -0.6, y: -0.8 }; // top-left light

  // Offscreen assets for realism
  let groundPattern = null;
  let scalePattern = null;
  let noiseOverlayPattern = null;

  bestEl.textContent = String(best);

  // Helpers
  const coordEq = (a, b) => a.x === b.x && a.y === b.y;
  function randomEmptyCell() {
    while (true) {
      const candidate = {
        x: Math.floor(Math.random() * gridWidth),
        y: Math.floor(Math.random() * gridHeight),
      };
      if (!snake.some((s) => coordEq(s, candidate))) {
        return candidate;
      }
    }
  }

  function isCellOccupiedBySnake(pos) {
    return snake.some((s) => coordEq(s, pos));
  }

  function isCellOccupied(pos) {
    if (isCellOccupiedBySnake(pos)) return true;
    if (bomb && coordEq(bomb, pos)) return true;
    if (magnet && coordEq(magnet, pos)) return true;
    if (rocket && coordEq(rocket, pos)) return true;
    if (apples.some((a) => coordEq(a, pos))) return true;
    return false;
  }

  function randomEmptyCellTotal() {
    while (true) {
      const candidate = {
        x: Math.floor(Math.random() * gridWidth),
        y: Math.floor(Math.random() * gridHeight),
      };
      if (!isCellOccupied(candidate)) return candidate;
    }
  }

  function initGame() {
    const startX = Math.floor(gridWidth / 3);
    const startY = Math.floor(gridHeight / 2);
    snake = [
      { x: startX + 2, y: startY },
      { x: startX + 1, y: startY },
      { x: startX, y: startY },
    ];
    direction = { x: 1, y: 0 };
    pendingDirection = { x: 1, y: 0 };
    apples = [randomEmptyCellTotal()];
    bomb = null;
    rocket = null;
    rocketActive = null;
    magnet = null;
    magnetActive = false;
    magnetUntil = 0;
    score = 0;
    scoreEl.textContent = "0";
    running = false;
    paused = false;
    overlay.classList.remove("hidden");
    overlayText.textContent = "Tap or press Space to start";
    lastTick = 0;
  }

  function applySettingsFromUI() {
    const diff = difficultySelect.value;
    walls = wallsSelect.value;
    soundEnabled = soundSelect.value === "on";
    const speeds = { easy: 260, normal: 210, hard: 160 };
    speedMs = speeds[diff] || 210;
  }

  function startGame() {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    running = true;
    paused = false;
    overlay.classList.add("hidden");
  }

  function gameOver() {
    running = false;
    overlay.classList.remove("hidden");
    overlayText.textContent = "Game Over — press R to restart";
    beep(150, 200, "sawtooth", 0.05);
    if (score > best) {
      best = score;
      localStorage.setItem("snake_best", String(best));
      bestEl.textContent = String(best);
    }
  }

  function maybeSpawnBomb() {
    // low probability each tick if none present
    if (bomb) return;
    if (Math.random() < 0.02 && apples.length >= 1) {
      const pos = randomEmptyCellTotal();
      // avoid spawning too close to head
      const head = snake[0];
      if (Math.hypot(pos.x - head.x, pos.y - head.y) > 4) {
        bomb = pos;
      }
    }
  }

  function spawnAppleExplosion(origin, count, radius) {
    const candidates = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 2 + Math.floor(Math.random() * radius);
      const pos = {
        x: origin.x + Math.round(Math.cos(angle) * dist),
        y: origin.y + Math.round(Math.sin(angle) * dist),
      };
      let wrapped = pos;
      if (walls === "wrap") {
        wrapped = { x: (pos.x + gridWidth) % gridWidth, y: (pos.y + gridHeight) % gridHeight };
      }
      if (wrapped.x < 0 || wrapped.y < 0 || wrapped.x >= gridWidth || wrapped.y >= gridHeight) continue;
      if (!isCellOccupied(wrapped)) candidates.push(wrapped);
    }
    // add candidates to apples
    for (const p of candidates) {
      apples.push(p);
    }
  }
  function startRocket(cell, nowMs) {
    const cx = cell.x * cellSizePx + cellSizePx / 2;
    const cy = cell.y * cellSizePx + cellSizePx / 2;
    const speed = 240; // px/s
    const angle = Math.random() * Math.PI * 2;
    rocketActive = {
      xPx: cx,
      yPx: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      untilMs: nowMs + 10000,
      dropsLeft: 40,
      nextDropAt: nowMs + 250,
      lastMs: nowMs,
    };
  }

  function updateRocket(nowMs) {
    if (!rocketActive) return;
    const dt = (nowMs - rocketActive.lastMs) / 1000;
    rocketActive.lastMs = nowMs;
    rocketActive.xPx += rocketActive.vx * dt;
    rocketActive.yPx += rocketActive.vy * dt;
    const margin = cellSizePx * 0.4;
    if (rocketActive.xPx < margin) {
      rocketActive.xPx = margin;
      rocketActive.vx *= -1;
    }
    if (rocketActive.xPx > boardSizePx - margin) {
      rocketActive.xPx = boardSizePx - margin;
      rocketActive.vx *= -1;
    }
    if (rocketActive.yPx < margin) {
      rocketActive.yPx = margin;
      rocketActive.vy *= -1;
    }
    if (rocketActive.yPx > boardSizePx - margin) {
      rocketActive.yPx = boardSizePx - margin;
      rocketActive.vy *= -1;
    }
    // random steering
    if (Math.random() < 0.1) {
      const a = (Math.random() - 0.5) * 0.4;
      const s = Math.hypot(rocketActive.vx, rocketActive.vy);
      const ang = Math.atan2(rocketActive.vy, rocketActive.vx) + a;
      rocketActive.vx = Math.cos(ang) * s;
      rocketActive.vy = Math.sin(ang) * s;
    }
    while (rocketActive.dropsLeft > 0 && nowMs >= rocketActive.nextDropAt) {
      const cell = pixelToNearestCell(rocketActive.xPx, rocketActive.yPx);
      const drop = jitterCell(cell, 1);
      if (drop && !isCellOccupied(drop)) apples.push(drop);
      rocketActive.dropsLeft -= 1;
      rocketActive.nextDropAt += 250; // every 0.25s → 40 over 10s
    }
    if (nowMs >= rocketActive.untilMs) rocketActive = null;
  }

  function pixelToNearestCell(px, py) {
    return {
      x: Math.max(0, Math.min(gridWidth - 1, Math.round((px - cellSizePx / 2) / cellSizePx))),
      y: Math.max(0, Math.min(gridHeight - 1, Math.round((py - cellSizePx / 2) / cellSizePx))),
    };
  }

  function jitterCell(cell, maxOffset) {
    const nx = cell.x + (Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset);
    const ny = cell.y + (Math.floor(Math.random() * (2 * maxOffset + 1)) - maxOffset);
    const pos = { x: nx, y: ny };
    if (walls === "wrap") {
      pos.x = (pos.x + gridWidth) % gridWidth;
      pos.y = (pos.y + gridHeight) % gridHeight;
    }
    if (pos.x < 0 || pos.y < 0 || pos.x >= gridWidth || pos.y >= gridHeight) return null;
    return pos;
  }

  function maybeSpawnRocket() {
    if (rocket || rocketActive) return;
    if (Math.random() < 0.012) {
      const pos = randomEmptyCellTotal();
      const head = snake[0];
      if (Math.hypot(pos.x - head.x, pos.y - head.y) > 4) rocket = pos;
    }
  }

  function drawRocketPickup() {
    if (!rocket) return;
    const x = rocket.x * cellSizePx,
      y = rocket.y * cellSizePx;
    const cx = x + cellSizePx / 2,
      cy = y + cellSizePx / 2;
    const r = (cellSizePx - 6) / 2;
    // shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.filter = "blur(3px)";
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + r, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // body
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    drawRocketShape(r);
    ctx.restore();
  }

  function drawRocketActive() {
    if (!rocketActive) return;
    const cx = rocketActive.xPx,
      cy = rocketActive.yPx;
    const dir = Math.atan2(rocketActive.vy, rocketActive.vx);
    const r = (cellSizePx - 6) / 2;
    // flame glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.8);
    g.addColorStop(0, "rgba(255,150,60,0.25)");
    g.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.filter = "blur(3px)";
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + r, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = "none";
    // body
    ctx.translate(cx, cy);
    ctx.rotate(dir);
    drawRocketShape(r);
    // flame
    ctx.fillStyle = "#ffa94d";
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, 0);
    ctx.quadraticCurveTo(-r * 1.6, r * 0.4, -r * 1.8, 0);
    ctx.quadraticCurveTo(-r * 1.6, -r * 0.4, -r * 0.9, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawRocketShape(r) {
    // fuselage
    ctx.fillStyle = "#cbd5e1";
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.45);
    ctx.lineTo(r * 0.6, -r * 0.45);
    ctx.quadraticCurveTo(r * 0.95, 0, r * 0.6, r * 0.45);
    ctx.lineTo(-r * 0.8, r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // window
    ctx.fillStyle = "#60a5fa";
    ctx.beginPath();
    ctx.arc(r * 0.1, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // fins
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.45);
    ctx.lineTo(-r * 0.55, -r * 0.9);
    ctx.lineTo(r * 0.05, -r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.45);
    ctx.lineTo(-r * 0.55, r * 0.9);
    ctx.lineTo(r * 0.05, r * 0.45);
    ctx.closePath();
    ctx.fill();
  }
  function maybeSpawnMagnet() {
    if (magnet || magnetActive) return;
    if (Math.random() < 0.015) {
      const pos = randomEmptyCellTotal();
      const head = snake[0];
      if (Math.hypot(pos.x - head.x, pos.y - head.y) > 4) {
        magnet = pos;
      }
    }
  }

  function drawMagnet() {
    if (!magnet) return;
    const x = magnet.x * cellSizePx;
    const y = magnet.y * cellSizePx;
    const cx = x + cellSizePx / 2;
    const cy = y + cellSizePx / 2;
    const r = (cellSizePx - 6) / 2;
    // shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.filter = "blur(3px)";
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + r, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // body (U magnet)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0);
    const w = r * 1.7;
    const h = r * 1.6;
    const thickness = r * 0.55;
    // U shape path
    ctx.beginPath();
    ctx.lineWidth = thickness;
    ctx.strokeStyle = "#d13a3a";
    ctx.lineCap = "round";
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(-w / 2, h / 4);
    ctx.arc(0, h / 4, w / 2, Math.PI, 0);
    ctx.lineTo(w / 2, -h / 2);
    ctx.stroke();
    // metallic tips
    ctx.lineWidth = thickness;
    ctx.strokeStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(-w / 2, -h / 2 + thickness * 0.65);
    ctx.moveTo(w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2 + thickness * 0.65);
    ctx.stroke();
    // glow
    const g = ctx.createRadialGradient(0, 0, thickness * 0.2, 0, 0, w);
    g.addColorStop(0, "rgba(255,80,80,0.35)");
    g.addColorStop(1, "rgba(255,80,80,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMagnetAura() {
    const head = snake[0];
    const center = gridToCenter(head);
    const radius = magnetRadiusCells * cellSizePx + 4;
    const t = (Date.now() % 1000) / 1000;
    ctx.save();
    const rg = ctx.createRadialGradient(center.x, center.y, radius * 0.2, center.x, center.y, radius);
    rg.addColorStop(0, `rgba(86,190,255,${0.08 + 0.04 * Math.sin(t * Math.PI * 2)})`);
    rg.addColorStop(1, "rgba(86,190,255,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Movement input
  function setDirectionFromInput(nx, ny) {
    // prevent reversing directly
    if (nx === -direction.x && ny === -direction.y) return;
    pendingDirection = { x: nx, y: ny };
  }

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (!running && (key === " " || key === "enter")) startGame();
    if (key === "p") {
      togglePause();
      return;
    }
    if (key === "r") {
      initGame();
      startGame();
      return;
    }
    if (key === "arrowup" || key === "w") setDirectionFromInput(0, -1);
    else if (key === "arrowdown" || key === "s") setDirectionFromInput(0, 1);
    else if (key === "arrowleft" || key === "a") setDirectionFromInput(-1, 0);
    else if (key === "arrowright" || key === "d") setDirectionFromInput(1, 0);
  });

  // On-screen dpad
  document.querySelectorAll(".dpad-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = btn.getAttribute("data-dir");
      if (dir === "up") setDirectionFromInput(0, -1);
      if (dir === "down") setDirectionFromInput(0, 1);
      if (dir === "left") setDirectionFromInput(-1, 0);
      if (dir === "right") setDirectionFromInput(1, 0);
    });
  });

  // Touch swipe support
  let touchStart = null;
  canvas.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - (touchStart?.x ?? t.clientX);
      const dy = t.clientY - (touchStart?.y ?? t.clientY);
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 10) setDirectionFromInput(1, 0);
        else if (dx < -10) setDirectionFromInput(-1, 0);
      } else {
        if (dy > 10) setDirectionFromInput(0, 1);
        else if (dy < -10) setDirectionFromInput(0, -1);
      }
    },
    { passive: true }
  );

  // Controls
  function togglePause() {
    if (!running) return;
    paused = !paused;
    overlay.classList.toggle("hidden", !paused);
    overlayText.textContent = paused ? "Paused — press P to resume" : "";
  }
  pauseBtn.addEventListener("click", togglePause);
  restartBtn.addEventListener("click", () => {
    initGame();
    startGame();
  });
  settingsBtn.addEventListener("click", () => settingsDialog.showModal());
  applySettingsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    applySettingsFromUI();
    settingsDialog.close();
  });

  // Game loop
  function tick(nowMs) {
    requestAnimationFrame(tick);
    if (!running || paused) {
      draw();
      return;
    }
    if (!lastTick) lastTick = nowMs;
    const elapsed = nowMs - lastTick;
    if (elapsed < speedMs) return;
    lastTick = nowMs;

    // apply pending direction once per tick
    direction = pendingDirection;

    const newHead = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    // walls behavior
    if (walls === "wrap") {
      newHead.x = (newHead.x + gridWidth) % gridWidth;
      newHead.y = (newHead.y + gridHeight) % gridHeight;
    }

    // collision detection
    const outOfBounds = newHead.x < 0 || newHead.y < 0 || newHead.x >= gridWidth || newHead.y >= gridHeight;
    const hitsSelf = snake.some((s) => coordEq(s, newHead));
    if ((walls === "solid" && outOfBounds) || hitsSelf) {
      gameOver();
      return;
    }

    snake.unshift(newHead);

    // power-ups: bomb
    let grewThisTick = false;
    if (bomb && coordEq(newHead, bomb)) {
      // collect bomb → explode into apples
      beep(140, 120, "square", 0.06);
      beep(320, 120, "sine", 0.05);
      spawnAppleExplosion(newHead, 14, 4);
      bomb = null;
      // grow slightly for picking bomb
      // do not pop tail on this tick
      grewThisTick = true;
    } else {
      // apples
      const idx = apples.findIndex((a) => coordEq(a, newHead));
      if (idx !== -1) {
        beep(800, 80, "triangle", 0.05);
        apples.splice(idx, 1);
        score += 10;
        scoreEl.textContent = String(score);
        // do not pop tail if ate
        grewThisTick = true;
      } else {
        // normal tail removal handled after magnet/rocket
      }
    }

    // Magnet pickup if stepped on it
    if (magnet && coordEq(newHead, magnet)) {
      magnetActive = true;
      magnetUntil = nowMs + 15000; // 15 seconds
      magnet = null;
      beep(900, 90, "sine", 0.05);
      beep(600, 120, "triangle", 0.04);
      grewThisTick = true; // bonus growth on pickup
    }

    // Rocket pickup
    if (rocket && coordEq(newHead, rocket)) {
      startRocket(rocket, nowMs);
      rocket = null;
      // bonus sound
      beep(700, 90, "square", 0.05);
      beep(500, 140, "triangle", 0.04);
      grewThisTick = true;
    }

    // Magnet effect: auto-consume nearby apples
    if (magnetActive) {
      if (nowMs >= magnetUntil) {
        magnetActive = false;
      } else {
        const head = snake[0];
        let taken = 0;
        apples = apples.filter((a) => {
          const dx = a.x - head.x;
          const dy = a.y - head.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= magnetRadiusCells) {
            taken += 1;
            return false; // remove apple
          }
          return true;
        });
        if (taken > 0) {
          score += 10 * taken;
          scoreEl.textContent = String(score);
          grewThisTick = true;
          beep(820, 60, "triangle", 0.035);
        }
      }
    }

    // finalize movement: pop tail only if not grown this tick
    if (!grewThisTick) {
      snake.pop();
    }

    // ensure at least one apple present
    if (apples.length === 0) {
      apples.push(randomEmptyCellTotal());
    }

    // maybe spawn a bomb occasionally
    maybeSpawnBomb();
    // maybe spawn a magnet occasionally
    maybeSpawnMagnet();
    // maybe spawn a rocket occasionally
    maybeSpawnRocket();

    // update rocket motion and drops
    updateRocket(nowMs);

    draw();
  }

  // Rendering
  function drawGround() {
    if (!groundPattern) {
      groundPattern = createGroundPattern(boardSizePx, boardSizePx);
    }
    if (!noiseOverlayPattern) {
      noiseOverlayPattern = createNoiseOverlayPattern(128);
    }
    ctx.save();
    ctx.fillStyle = groundPattern;
    ctx.fillRect(0, 0, boardSizePx, boardSizePx);
    // subtle vignette
    const g = ctx.createRadialGradient(
      boardSizePx * 0.5,
      boardSizePx * 0.5,
      boardSizePx * 0.2,
      boardSizePx * 0.5,
      boardSizePx * 0.5,
      boardSizePx * 0.7
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, boardSizePx, boardSizePx);
    // film grain
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = noiseOverlayPattern;
    ctx.fillRect(0, 0, boardSizePx, boardSizePx);
    ctx.restore();
  }

  function drawSnake() {
    if (!scalePattern) scalePattern = createScalePattern(64);
    // soft contact shadows under segments
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      const center = gridToCenter(seg);
      const angle = segmentAngle(i);
      drawSegmentShadow(center.x, center.y, angle, i === 0);
    }
    // snake body with scales and shading
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      const center = gridToCenter(seg);
      const angle = segmentAngle(i);
      const isHead = i === 0;
      drawSegment(center.x, center.y, angle, isHead);
      if (isHead) drawHeadDetails(center.x, center.y, angle);
    }
  }

  function drawApples() {
    for (const a of apples) drawAppleAt(a);
  }

  function drawAppleAt(cell) {
    const x = cell.x * cellSizePx;
    const y = cell.y * cellSizePx;
    const r = (cellSizePx - 6) / 2;
    const cx = x + cellSizePx / 2;
    const cy = y + cellSizePx / 2;
    // shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.filter = "blur(3px)";
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + r, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // body with shading
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.5, r * 0.2, cx, cy, r);
    grad.addColorStop(0, "#ff6a5c");
    grad.addColorStop(0.6, colors.apple);
    grad.addColorStop(1, "#7a1f1f");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // specular highlight
    const spec = ctx.createRadialGradient(cx - r * 0.45, cy - r * 0.6, 0, cx - r * 0.45, cy - r * 0.6, r * 0.5);
    spec.addColorStop(0, "rgba(255,255,255,0.65)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // stem
    ctx.save();
    ctx.strokeStyle = "#5d3b2e";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.1, cy - r * 0.6);
    ctx.lineTo(cx - r * 0.1, cy - r * 1.2);
    ctx.stroke();
    // leaf
    const lg = ctx.createLinearGradient(cx - r * 0.3, cy - r * 1.05, cx - r * 0.9, cy - r * 1.25);
    lg.addColorStop(0, "#3dbb6a");
    lg.addColorStop(1, "#1c7f3c");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.5, cy - r * 1.1, r * 0.35, r * 0.18, -Math.PI / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBomb() {
    if (!bomb) return;
    const x = bomb.x * cellSizePx;
    const y = bomb.y * cellSizePx;
    const r = (cellSizePx - 6) / 2;
    const cx = x + cellSizePx / 2;
    const cy = y + cellSizePx / 2;
    // shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.filter = "blur(3px)";
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + r, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // body
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.2, cx, cy, r);
    grad.addColorStop(0, "#676b76");
    grad.addColorStop(0.6, "#2b2d34");
    grad.addColorStop(1, "#0e1014");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // cap
    ctx.fillStyle = "#1b1d22";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.2, cy - r * 0.9, r * 0.45, r * 0.25, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // fuse
    ctx.strokeStyle = "#c8a15e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.2, cy - r * 0.9);
    ctx.quadraticCurveTo(cx - r * 0.4, cy - r * 1.2, cx - r * 0.6, cy - r * 1.2);
    ctx.stroke();
    // spark
    const t = Date.now() / 120;
    const sx = cx - r * 0.6 + Math.cos(t) * 1.5;
    const sy = cy - r * 1.2 + Math.sin(t) * 1.5;
    ctx.fillStyle = "#ffdd66";
    ctx.beginPath();
    ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, boardSizePx, boardSizePx);
    drawGround();
    drawApples();
    drawBomb();
    drawMagnet();
    if (magnetActive) drawMagnetAura();
    drawRocketPickup();
    drawRocketActive();
    drawSnake();
  }

  // Boot
  applySettingsFromUI();
  initGame();
  requestAnimationFrame(tick);
  // Generate graphics assets lazily on first draw

  // ===== Realism Helpers =====
  function gridToCenter(seg) {
    return {
      x: seg.x * cellSizePx + cellSizePx / 2,
      y: seg.y * cellSizePx + cellSizePx / 2,
    };
  }

  function segmentAngle(i) {
    const prev = snake[i - 1] || snake[i];
    const next = snake[i + 1] || snake[i];
    const dirX = (prev.x - next.x) * -1; // average direction forward
    const dirY = (prev.y - next.y) * -1;
    const len = Math.hypot(dirX, dirY) || 1;
    return Math.atan2(dirY / len, dirX / len);
  }

  function drawSegmentShadow(cx, cy, angle, isHead) {
    const segLength = cellSizePx * 0.88;
    const segWidth = cellSizePx * 0.76 * (isHead ? 1.05 : 1);
    ctx.save();
    ctx.translate(cx, cy + 2);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.filter = "blur(4px)";
    drawCapsulePath(-segLength / 2, -segWidth / 2, segLength, segWidth);
    ctx.fill();
    ctx.restore();
  }

  function drawSegment(cx, cy, angle, isHead) {
    const segLength = cellSizePx * 0.9;
    const segWidth = cellSizePx * (isHead ? 0.85 : 0.78);
    const baseColor = isHead ? colors.snakeHead : colors.snakeBody;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Base fill
    ctx.fillStyle = baseColor;
    drawCapsulePath(-segLength / 2, -segWidth / 2, segLength, segWidth);
    ctx.fill();

    // Scales pattern overlay (multiply)
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = scalePattern;
    drawCapsulePath(-segLength / 2, -segWidth / 2, segLength, segWidth);
    ctx.fill();
    ctx.restore();

    // Directional shading
    const lg = ctx.createLinearGradient(-segLength / 2, 0, segLength / 2, 0);
    const dot = Math.cos(angle) * lightDir.x + Math.sin(angle) * lightDir.y;
    const shade = Math.max(0, -dot);
    lg.addColorStop(0, `rgba(0,0,0,${0.22 + shade * 0.25})`);
    lg.addColorStop(0.5, "rgba(0,0,0,0)");
    lg.addColorStop(1, `rgba(255,255,255,${0.08 + (1 - shade) * 0.12})`);
    ctx.fillStyle = lg;
    drawCapsulePath(-segLength / 2, -segWidth / 2, segLength, segWidth);
    ctx.fill();

    // Specular highlight
    const spec = ctx.createRadialGradient(
      -segLength * 0.15,
      -segWidth * 0.25,
      0,
      -segLength * 0.15,
      -segWidth * 0.25,
      segWidth
    );
    spec.addColorStop(0, "rgba(255,255,255,0.25)");
    spec.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = spec;
    drawCapsulePath(-segLength / 2, -segWidth / 2, segLength, segWidth);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    ctx.restore();
  }

  function drawHeadDetails(cx, cy, angle) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const segWidth = cellSizePx * 0.85;
    const eyeY = -segWidth * 0.18;
    const eyeX = cellSizePx * 0.18;
    // Eyes
    drawEye(-eyeX, eyeY);
    drawEye(eyeX, eyeY);
    // Nostrils
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(-eyeX * 0.5, -segWidth * 0.05, 1.4, 0, Math.PI * 2);
    ctx.arc(eyeX * 0.5, -segWidth * 0.05, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // Tongue occasionally
    if (Math.random() < 0.05) {
      ctx.strokeStyle = "#e43e3e";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cellSizePx * 0.45, 0);
      ctx.lineTo(cellSizePx * 0.6, -2);
      ctx.moveTo(cellSizePx * 0.6, -2);
      ctx.lineTo(cellSizePx * 0.68, -5);
      ctx.moveTo(cellSizePx * 0.6, -2);
      ctx.lineTo(cellSizePx * 0.68, 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEye(x, y) {
    ctx.save();
    ctx.translate(x, y);
    // sclera
    const rg = ctx.createRadialGradient(-1, -1, 0.5, 0, 0, 5);
    rg.addColorStop(0, "#ffffff");
    rg.addColorStop(1, "#cbd5e1");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // iris
    const ig = ctx.createRadialGradient(-1, -1, 0, 0, 0, 3);
    ig.addColorStop(0, "#2a7f45");
    ig.addColorStop(1, "#0f3d24");
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    // pupil
    ctx.fillStyle = "#0b1220";
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // specular
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.arc(-1.5, -1.8, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCapsulePath(x, y, w, h) {
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
  }

  function createScalePattern(size) {
    const off = document.createElement("canvas");
    off.width = off.height = size;
    const c = off.getContext("2d");
    c.fillStyle = "#3a6b3f";
    c.fillRect(0, 0, size, size);
    // draw hex/rounded scales
    c.fillStyle = "#4c8f54";
    c.strokeStyle = "#2b4d33";
    c.lineWidth = 1;
    const scaleR = size / 8;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const ox = (col + (row % 2 ? 0.5 : 0)) * (size / 8);
        const oy = row * (size / 8);
        c.beginPath();
        c.ellipse(ox, oy, scaleR, scaleR * 0.75, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    }
    // subtle top-left highlight
    const g = c.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(0,0,0,0.08)");
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    return c.createPattern(off, "repeat");
  }

  function createGroundPattern(w, h) {
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const c = off.getContext("2d");
    // base dirt
    c.fillStyle = "#1b2a1a";
    c.fillRect(0, 0, w, h);
    // value noise
    const img = c.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = fractalNoise(x, y, 0.02, 4); // 4 octaves
        const g = Math.floor(30 + n * 90);
        const idx = (y * w + x) * 4;
        img.data[idx + 0] = 20 + g * 0.4; // r
        img.data[idx + 1] = 35 + g * 0.9; // g
        img.data[idx + 2] = 20 + g * 0.3; // b
        img.data[idx + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    // soft lighting from top-left
    const lg = c.createLinearGradient(0, 0, w, h);
    lg.addColorStop(0, "rgba(255,255,255,0.05)");
    lg.addColorStop(1, "rgba(0,0,0,0.25)");
    c.fillStyle = lg;
    c.fillRect(0, 0, w, h);
    return c.createPattern(off, "no-repeat");
  }

  function fractalNoise(x, y, baseFreq, octaves) {
    let amp = 1;
    let freq = baseFreq;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * pseudoNoise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // Simple hash-based noise for speed
  function pseudoNoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const n00 = hash2(xi, yi);
    const n10 = hash2(xi + 1, yi);
    const n01 = hash2(xi, yi + 1);
    const n11 = hash2(xi + 1, yi + 1);
    const u = fade(xf);
    const v = fade(yf);
    const nx0 = lerp(n00, n10, u);
    const nx1 = lerp(n01, n11, u);
    return lerp(nx0, nx1, v);
  }

  function hash2(x, y) {
    let n = x * 374761393 + y * 668265263; // large primes
    n = (n ^ (n >> 13)) * 1274126177;
    n = (n ^ (n >> 16)) >>> 0;
    return (n % 1000) / 1000; // 0..1
  }

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function createNoiseOverlayPattern(size) {
    const off = document.createElement("canvas");
    off.width = off.height = size;
    const c = off.getContext("2d");
    const img = c.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return c.createPattern(off, "repeat");
  }
})();
