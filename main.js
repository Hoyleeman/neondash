const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Game State
let gameState = 'START'; // START, LEVEL_SELECT, PLAYING, GAMEOVER, WIN
let score = 0;
let frameCount = 0;
let gameSpeed = 9;
const BASE_SPEED = 9;
let slowMotionFactor = 1; // 1 = normal, < 1 = slow
let distanceTraveled = 0;
let currentLevel = 1;
let unlockedLevels = 1;

// Level configurations
const LEVELS = {
    1: { name: 'Beginner', length: 5000, speed: 7, spawnRate: 0.03, minDistance: 500 },
    2: { name: 'Easy', length: 7000, speed: 8, spawnRate: 0.04, minDistance: 450 },
    3: { name: 'Medium', length: 9000, speed: 9, spawnRate: 0.05, minDistance: 400 },
    4: { name: 'Hard', length: 11000, speed: 10, spawnRate: 0.06, minDistance: 350 },
    5: { name: 'Expert', length: 13000, speed: 11, spawnRate: 0.07, minDistance: 300 },
    6: { name: 'Insane', length: 15000, speed: 12, spawnRate: 0.08, minDistance: 250 }
};

// Physics Constants
const GRAVITY = 0.9;
const JUMP_FORCE = -14;
const GROUND_HEIGHT = 100;

// Input
let keys = {};

// Entities
let player;
let obstacles = [];
let particles = [];
let cubeFragments = [];
let floorPatternOffset = 0;
let finishLine = null;
let playerExploded = false;
let deathTime = 0;
let canRestart = true;

// Customization
let playerColor = '#00f3ff';
let playerShape = 'square';
let previewCanvas;
let previewCtx;
let previewRotation = 0;

function spawnObstacle() {
    const levelConfig = LEVELS[currentLevel];

    if (distanceTraveled > levelConfig.length) {
        if (!finishLine) {
            finishLine = new FinishLine(canvas.width + 500);
        }
        return;
    }

    if (distanceTraveled < 800) return;

    const minDistance = levelConfig.minDistance;
    let lastObstacleX = obstacles.length > 0 ? obstacles[obstacles.length - 1].x : -1000;

    if (canvas.width - lastObstacleX > minDistance) {
        if (Math.random() < levelConfig.spawnRate) {
            const type = Math.random() > 0.3 ? 'SPIKE' : 'BLOCK';
            obstacles.push(new Obstacle(type, canvas.width + 100));
        }
    }
}

class Player {
    constructor() {
        this.size = 40;
        this.x = 100;
        this.y = canvas.height - GROUND_HEIGHT - this.size;
        this.dy = 0;
        this.jumpTimer = 0;
        this.isGrounded = true;
        this.rotation = 0;
        this.color = playerColor; // Use custom color
    }

    jump() {
        if (this.isGrounded) {
            this.dy = JUMP_FORCE;
            this.isGrounded = false;
            createParticles(this.x + this.size / 2, this.y + this.size, 5, '#fff');
        }
    }

    update() {
        this.dy += GRAVITY * slowMotionFactor;
        this.y += this.dy * slowMotionFactor;

        if (!this.isGrounded) {
            this.rotation += 5;
        } else {
            const snap = Math.round(this.rotation / 90) * 90;
            this.rotation = snap;
        }

        if (this.y + this.size > canvas.height - GROUND_HEIGHT) {
            this.y = canvas.height - GROUND_HEIGHT - this.size;
            this.dy = 0;
            this.isGrounded = true;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
        ctx.rotate((this.rotation * Math.PI) / 180);

        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;

        // Draw based on shape
        drawShape(ctx, playerShape, this.size, this.color);

        ctx.restore();
    }
}

class Obstacle {
    constructor(type, x) {
        this.type = type;
        this.x = x;
        this.markedForDeletion = false;

        if (type === 'SPIKE') {
            this.w = 40;
            this.h = 40;
            this.y = canvas.height - GROUND_HEIGHT - this.h;
            this.color = '#ff0055';
        } else if (type === 'BLOCK') {
            this.w = 40;
            this.h = 40;
            this.y = canvas.height - GROUND_HEIGHT - this.h;
            this.color = '#ffcc00';
        }
    }

    update() {
        this.x -= gameSpeed * slowMotionFactor;
        if (this.x + this.w < 0) {
            this.markedForDeletion = true;
            score++;
            document.getElementById('score').innerText = score;
        }
    }

    draw() {
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;

        if (this.type === 'SPIKE') {
            ctx.beginPath();
            ctx.moveTo(this.x, this.y + this.h);
            ctx.lineTo(this.x + this.w / 2, this.y);
            ctx.lineTo(this.x + this.w, this.y + this.h);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x, this.y, this.w, this.h);
        }
        ctx.restore();
    }
}

class FinishLine {
    constructor(x) {
        this.x = x;
        this.w = 20;
        this.h = canvas.height - GROUND_HEIGHT;
        this.y = 0;
        this.color = '#00ff00';
    }

    update() {
        this.x -= gameSpeed * slowMotionFactor;
    }

    draw() {
        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = this.color;

        const gradient = ctx.createLinearGradient(this.x, 0, this.x + this.w, 0);
        gradient.addColorStop(0, 'rgba(0, 255, 0, 0)');
        gradient.addColorStop(0.5, 'rgba(0, 255, 0, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 255, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(this.x - 50, 0, 120, canvas.height - GROUND_HEIGHT);

        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, 0, this.w, canvas.height - GROUND_HEIGHT);

        ctx.fillStyle = '#000';
        for (let i = 0; i < (canvas.height - GROUND_HEIGHT); i += 40) {
            ctx.fillRect(this.x, i, this.w, 20);
        }

        ctx.restore();
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 4 - 2;
        this.speedY = Math.random() * 4 - 2;
        this.color = color;
        this.life = 1.0;
    }
    update() {
        this.x += this.speedX * slowMotionFactor;
        this.y += this.speedY * slowMotionFactor;
        this.life -= 0.02 * slowMotionFactor;
    }
    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.globalAlpha = 1.0;
    }
}

class CubeFragment {
    constructor(x, y, size, color, offsetX, offsetY) {
        this.x = x + offsetX;
        this.y = y + offsetY;
        this.size = size;
        this.color = color;
        this.speedX = (Math.random() - 0.5) * 8 + offsetX * 0.3;
        this.speedY = (Math.random() - 0.5) * 8 + offsetY * 0.3 - 5;
        this.rotation = Math.random() * 360;
        this.rotationSpeed = (Math.random() - 0.5) * 15;
        this.life = 1.0;
        this.gravity = 0.5;
    }
    update() {
        this.speedY += this.gravity * slowMotionFactor;
        this.x += this.speedX * slowMotionFactor;
        this.y += this.speedY * slowMotionFactor;
        this.rotation += this.rotationSpeed * slowMotionFactor;
        this.life -= 0.008 * slowMotionFactor;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
        ctx.rotate((this.rotation * Math.PI) / 180);

        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;

        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);

        ctx.restore();
    }
}

function createParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color));
    }
}

function explodeCube(x, y, size, color) {
    const fragmentSize = size / 3;
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const offsetX = (col - 1) * fragmentSize;
            const offsetY = (row - 1) * fragmentSize;
            cubeFragments.push(new CubeFragment(x, y, fragmentSize, color, offsetX, offsetY));
        }
    }
}

function init() {
    resize();
    player = new Player();
    obstacles = [];
    particles = [];
    cubeFragments = [];
    score = 0;
    distanceTraveled = 0;

    const levelConfig = LEVELS[currentLevel];
    gameSpeed = levelConfig.speed;

    slowMotionFactor = 1;
    finishLine = null;
    playerExploded = false;
    document.getElementById('score').innerText = score;
    document.getElementById('current-level-num').innerText = currentLevel;
    document.getElementById('game-canvas').classList.remove('wasted-effect');
    document.getElementById('wasted-screen').classList.remove('active');

    const saved = localStorage.getItem('neonDashProgress');
    if (saved) {
        unlockedLevels = parseInt(saved);
    }

    // Load saved customization
    const savedColor = localStorage.getItem('neonDashColor');
    if (savedColor) {
        playerColor = savedColor;
    }
    const savedShape = localStorage.getItem('neonDashShape');
    if (savedShape) {
        playerShape = savedShape;
    }
}

// Shape drawing function
function drawShape(context, shape, size, color) {
    context.fillStyle = color;

    switch (shape) {
        case 'square':
            context.fillRect(-size / 2, -size / 2, size, size);
            context.fillStyle = '#000';
            context.fillRect(-size / 4, -size / 4, size / 2, size / 2);
            context.fillStyle = '#fff';
            context.fillRect(-size / 6, -size / 6, size / 8, size / 8);
            break;

        case 'circle':
            context.beginPath();
            context.arc(0, 0, size / 2, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#000';
            context.beginPath();
            context.arc(0, 0, size / 4, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#fff';
            context.beginPath();
            context.arc(0, 0, size / 8, 0, Math.PI * 2);
            context.fill();
            break;

        case 'triangle':
            context.beginPath();
            context.moveTo(0, -size / 2);
            context.lineTo(size / 2, size / 2);
            context.lineTo(-size / 2, size / 2);
            context.closePath();
            context.fill();
            context.fillStyle = '#000';
            context.beginPath();
            context.moveTo(0, -size / 6);
            context.lineTo(size / 4, size / 4);
            context.lineTo(-size / 4, size / 4);
            context.closePath();
            context.fill();
            break;

        case 'diamond':
            context.beginPath();
            context.moveTo(0, -size / 2);
            context.lineTo(size / 2, 0);
            context.lineTo(0, size / 2);
            context.lineTo(-size / 2, 0);
            context.closePath();
            context.fill();
            context.fillStyle = '#000';
            context.beginPath();
            context.moveTo(0, -size / 4);
            context.lineTo(size / 4, 0);
            context.lineTo(0, size / 4);
            context.lineTo(-size / 4, 0);
            context.closePath();
            context.fill();
            break;

        case 'hexagon':
            const angle = Math.PI / 3;
            context.beginPath();
            for (let i = 0; i < 6; i++) {
                const x = (size / 2) * Math.cos(angle * i);
                const y = (size / 2) * Math.sin(angle * i);
                if (i === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.closePath();
            context.fill();
            context.fillStyle = '#000';
            context.beginPath();
            for (let i = 0; i < 6; i++) {
                const x = (size / 4) * Math.cos(angle * i);
                const y = (size / 4) * Math.sin(angle * i);
                if (i === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.closePath();
            context.fill();
            break;

        case 'star':
            context.beginPath();
            for (let i = 0; i < 5; i++) {
                const outerAngle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
                const innerAngle = outerAngle + Math.PI / 5;
                const outerX = (size / 2) * Math.cos(outerAngle);
                const outerY = (size / 2) * Math.sin(outerAngle);
                const innerX = (size / 4) * Math.cos(innerAngle);
                const innerY = (size / 4) * Math.sin(innerAngle);

                if (i === 0) context.moveTo(outerX, outerY);
                else context.lineTo(outerX, outerY);
                context.lineTo(innerX, innerY);
            }
            context.closePath();
            context.fill();
            context.fillStyle = '#000';
            context.beginPath();
            context.arc(0, 0, size / 8, 0, Math.PI * 2);
            context.fill();
            break;
    }
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (player) {
        player.y = canvas.height - GROUND_HEIGHT - player.size;
    }
}

function checkCollisions() {
    const pRect = {
        x: player.x + 5,
        y: player.y + 5,
        w: player.size - 10,
        h: player.size - 10
    };

    if (finishLine) {
        if (pRect.x + pRect.w > finishLine.x) {
            levelComplete();
            return;
        }
    }

    for (let obs of obstacles) {
        let obsRect = {
            x: obs.x + 5,
            y: obs.y + 5,
            w: obs.w - 10,
            h: obs.h - 10
        };

        if (
            pRect.x < obsRect.x + obsRect.w &&
            pRect.x + pRect.w > obsRect.x &&
            pRect.y < obsRect.y + obsRect.h &&
            pRect.y + pRect.h > obsRect.y
        ) {
            gameOver();
        }
    }
}

function gameOver() {
    if (gameState === 'GAMEOVER') return;
    gameState = 'GAMEOVER';

    slowMotionFactor = 0.1;
    canRestart = false;
    deathTime = Date.now();

    document.getElementById('game-canvas').classList.add('wasted-effect');
    document.getElementById('wasted-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
    document.getElementById('current-level-display').classList.remove('visible');

    explodeCube(player.x, player.y, player.size, player.color);
    playerExploded = true;

    createParticles(player.x + player.size / 2, player.y + player.size / 2, 50, player.color);

    // Allow restart after 1.5 seconds (let wasted animation play)
    setTimeout(() => {
        canRestart = true;
        document.getElementById('game-over-screen').classList.add('active');
    }, 1500);
}

function levelComplete() {
    gameState = 'WIN';
    createParticles(player.x + player.size / 2, player.y + player.size / 2, 100, '#00ff00');
    document.getElementById('current-level-display').classList.remove('visible');

    if (currentLevel < 6 && currentLevel >= unlockedLevels) {
        unlockedLevels = currentLevel + 1;
        localStorage.setItem('neonDashProgress', unlockedLevels.toString());
        document.getElementById('level-complete-message').innerText = `Level ${unlockedLevels} Unlocked!`;
    } else if (currentLevel === 6) {
        document.getElementById('level-complete-message').innerText = 'All Levels Complete!';
    } else {
        document.getElementById('level-complete-message').innerText = 'Level Complete!';
    }

    document.getElementById('level-complete-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
}

function update() {
    if (gameState !== 'PLAYING') return;

    player.update();
    distanceTraveled += gameSpeed * slowMotionFactor;

    spawnObstacle();
    obstacles.forEach(obs => obs.update());
    obstacles = obstacles.filter(obs => !obs.markedForDeletion);

    if (finishLine) {
        finishLine.update();
    }

    particles.forEach(p => p.update());
    particles = particles.filter(p => p.life > 0);

    floorPatternOffset -= gameSpeed * slowMotionFactor;
    if (floorPatternOffset <= -40) floorPatternOffset = 0;

    checkCollisions();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, canvas.height - GROUND_HEIGHT, canvas.width, GROUND_HEIGHT);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - GROUND_HEIGHT);
    ctx.lineTo(canvas.width, canvas.height - GROUND_HEIGHT);
    ctx.stroke();

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = floorPatternOffset; i < canvas.width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, canvas.height - GROUND_HEIGHT);
        ctx.lineTo(i - 20, canvas.height);
        ctx.stroke();
    }

    if (finishLine) finishLine.draw();

    if (!playerExploded) {
        player.draw();
    }

    obstacles.forEach(obs => obs.draw());
    particles.forEach(p => p.draw());
    cubeFragments.forEach(f => f.draw());
}

function loop() {
    if (gameState === 'PLAYING') {
        update();
    } else if (gameState === 'GAMEOVER') {
        if (!playerExploded) {
            player.update();
        }
        obstacles.forEach(obs => obs.update());

        particles.forEach(p => p.update());
        particles = particles.filter(p => p.life > 0);

        cubeFragments.forEach(f => f.update());
        cubeFragments = cubeFragments.filter(f => f.life > 0);

    } else if (gameState === 'WIN') {
        particles.forEach(p => p.update());
        particles = particles.filter(p => p.life > 0);
    }

    draw();
    requestAnimationFrame(loop);
}

// Level selection UI
function showLevelSelect() {
    gameState = 'LEVEL_SELECT';
    document.getElementById('start-screen').classList.remove('active');
    document.getElementById('game-over-screen').classList.remove('active');
    document.getElementById('level-complete-screen').classList.remove('active');
    document.getElementById('level-select-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
    document.getElementById('current-level-display').classList.remove('visible');
    updateLevelButtons();
}

function updateLevelButtons() {
    const buttons = document.querySelectorAll('.level-btn');
    buttons.forEach(btn => {
        const level = parseInt(btn.dataset.level);
        if (level <= unlockedLevels) {
            btn.classList.remove('locked');
            btn.classList.add('unlocked');
        } else {
            btn.classList.add('locked');
            btn.classList.remove('unlocked');
        }
    });
}

function startLevel(level) {
    currentLevel = level;
    init();
    gameState = 'PLAYING';
    document.getElementById('level-select-screen').classList.remove('active');
    document.querySelector('.game-title').style.opacity = '0.2';
    document.getElementById('current-level-display').classList.add('visible');
}

// Event Listeners
window.addEventListener('resize', resize);

document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const level = parseInt(btn.dataset.level);
        if (level <= unlockedLevels) {
            startLevel(level);
        }
    });
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        if (gameState === 'START') {
            showLevelSelect();
        } else if (gameState === 'PLAYING') {
            player.jump();
        } else if (gameState === 'GAMEOVER') {
            if (!canRestart) return; // Prevent restart during wasted animation
            init();
            gameState = 'PLAYING';
            canRestart = true;
            document.getElementById('game-over-screen').classList.remove('active');
            document.getElementById('wasted-screen').classList.remove('active');
            document.querySelector('.game-title').style.opacity = '0.2';
            document.getElementById('current-level-display').classList.add('visible');
        } else if (gameState === 'WIN') {
            if (currentLevel < 6) {
                currentLevel++;
                startLevel(currentLevel);
            } else {
                showLevelSelect();
            }
            document.getElementById('level-complete-screen').classList.remove('active');
        }
    } else if (e.code === 'Escape') {
        if (gameState === 'LEVEL_SELECT') {
            gameState = 'START';
            document.getElementById('level-select-screen').classList.remove('active');
            document.getElementById('start-screen').classList.add('active');
        } else if (gameState === 'GAMEOVER' || gameState === 'WIN') {
            showLevelSelect();
            document.getElementById('game-over-screen').classList.remove('active');
            document.getElementById('wasted-screen').classList.remove('active');
            document.getElementById('level-complete-screen').classList.remove('active');
        }
    }
});

window.addEventListener('mousedown', () => {
    if (gameState === 'START') {
        showLevelSelect();
    } else if (gameState === 'PLAYING') {
        player.jump();
    } else if (gameState === 'GAMEOVER') {
        if (!canRestart) return; // Prevent restart during wasted animation
        init();
        gameState = 'PLAYING';
        canRestart = true;
        document.getElementById('game-over-screen').classList.remove('active');
        document.getElementById('wasted-screen').classList.remove('active');
        document.querySelector('.game-title').style.opacity = '0.2';
        document.getElementById('current-level-display').classList.add('visible');
    } else if (gameState === 'WIN') {
        if (currentLevel < 6) {
            currentLevel++;
            startLevel(currentLevel);
        } else {
            showLevelSelect();
        }
        document.getElementById('level-complete-screen').classList.remove('active');
    }
});

// Customization Functions
function showCustomizeScreen() {
    gameState = 'CUSTOMIZE';
    document.getElementById('level-select-screen').classList.remove('active');
    document.getElementById('customize-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
    initPreviewCanvas();
    updatePreview();
}

function initPreviewCanvas() {
    if (!previewCanvas) {
        previewCanvas = document.getElementById('preview-canvas');
        previewCtx = previewCanvas.getContext('2d');
    }
}

function updatePreview() {
    if (!previewCtx) return;

    // Clear canvas
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    // Draw rotating cube
    previewRotation += 2;
    const centerX = previewCanvas.width / 2;
    const centerY = previewCanvas.height / 2;
    const size = 60;

    previewCtx.save();
    previewCtx.translate(centerX, centerY);
    previewCtx.rotate((previewRotation * Math.PI) / 180);

    // Glow
    previewCtx.shadowBlur = 20;
    previewCtx.shadowColor = playerColor;

    // Draw shape
    drawShape(previewCtx, playerShape, size, playerColor);

    previewCtx.restore();

    // Continue animation if on customize screen
    if (gameState === 'CUSTOMIZE') {
        requestAnimationFrame(updatePreview);
    }
}

function setPlayerColor(color) {
    playerColor = color;
    localStorage.setItem('neonDashColor', color);

    // Update active state on presets
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.color === color) {
            btn.classList.add('active');
        }
    });

    // Update color input
    document.getElementById('color-input').value = color;
}

// Load saved color
const savedColor = localStorage.getItem('neonDashColor');
if (savedColor) {
    playerColor = savedColor;
}

// Customize button
document.getElementById('customize-btn').addEventListener('click', () => {
    showCustomizeScreen();
});

// Color preset buttons
document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
        setPlayerColor(btn.dataset.color);
    });
});

// Custom color input
document.getElementById('color-input').addEventListener('input', (e) => {
    setPlayerColor(e.target.value);
    // Remove active from all presets when using custom color
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.classList.remove('active');
    });
});

// Shape selection
function setPlayerShape(shape) {
    playerShape = shape;
    localStorage.setItem('neonDashShape', shape);

    // Update active state on shape buttons
    document.querySelectorAll('.shape-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.shape === shape) {
            btn.classList.add('active');
        }
    });
}

// Shape button clicks
document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setPlayerShape(btn.dataset.shape);
    });
});

// ESC key handler update for customize screen
const originalKeyHandler = window.onkeydown;
window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && gameState === 'CUSTOMIZE') {
        gameState = 'LEVEL_SELECT';
        document.getElementById('customize-screen').classList.remove('active');
        document.getElementById('level-select-screen').classList.add('active');
    }
});

init();
loop();
