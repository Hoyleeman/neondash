const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Game State
let gameState = 'START'; // START, LEVEL_SELECT, PLAYING, GAMEOVER, WIN, CUSTOMIZE
let score = 0;
let frameCount = 0;
let gameSpeed = 9;
let slowMotionFactor = 1; // 1 = normal, < 1 = slow
let distanceTraveled = 0;
let currentLevel = 1;
let unlockedLevels = 1;

// Level configurations
const LEVELS = {
    1: { name: 'Beginner', length: 8000, speed: 7, spawnRate: 0.03, minDistance: 500, difficulty: 1 },
    2: { name: 'Easy', length: 11000, speed: 8, spawnRate: 0.04, minDistance: 450, difficulty: 2 },
    3: { name: 'Medium', length: 14000, speed: 9, spawnRate: 0.05, minDistance: 400, difficulty: 3 },
    4: { name: 'Hard', length: 17000, speed: 10, spawnRate: 0.06, minDistance: 350, difficulty: 4 },
    5: { name: 'Expert', length: 20000, speed: 11, spawnRate: 0.07, minDistance: 300, difficulty: 5 },
    6: { name: 'Insane', length: 23000, speed: 12, spawnRate: 0.08, minDistance: 280, difficulty: 6 },
    7: { name: 'Demon', length: 27000, speed: 13, spawnRate: 0.09, minDistance: 260, difficulty: 7 },
    8: { name: 'Void', length: 30000, speed: 14, spawnRate: 0.10, minDistance: 240, difficulty: 8 },
    9: { name: 'Omega', length: 38000, speed: 15, spawnRate: 0.11, minDistance: 220, difficulty: 9 },
    10: { name: 'Infinity', length: 45000, speed: 16, spawnRate: 0.12, minDistance: 200, difficulty: 10 }
};

// Physics Constants
const GRAVITY = 1.8;
const JUMP_FORCE = -18;
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
let bgOffset = 0;

// Customization
let playerColor = '#00f3ff';
let playerShape = 'square';
let previewCanvas;
let previewCtx;
let previewRotation = 0;

// Audio
class SoundManager {
    constructor() {
        this.ctx = null;
        this.isPlaying = false;
        this.nextNoteTime = 0;
        this.tempo = 128;
        this.beatCount = 0;
        this.initialized = false;
        this.enabled = true;
    }

    init() {
        if (!this.enabled || this.initialized) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                console.warn('AudioContext not supported');
                this.enabled = false;
                return;
            }
            this.ctx = new AudioContext();
            this.initialized = true;
        } catch (e) {
            console.error('Failed to init audio:', e);
            this.enabled = false;
        }
    }

    start() {
        if (!this.enabled) return;
        try {
            if (!this.initialized) this.init();
            if (!this.initialized) return;

            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(e => console.error('Audio resume failed:', e));
            }
            if (!this.isPlaying) {
                this.isPlaying = true;
                this.nextNoteTime = this.ctx.currentTime;
                this.scheduler();
            }
        } catch (e) {
            console.error('Audio start failed:', e);
        }
    }

    stop() {
        this.isPlaying = false;
    }

    scheduler() {
        if (!this.isPlaying || !this.enabled) return;
        try {
            while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
                this.playBeat(this.nextNoteTime);
                this.scheduleNextBeat();
            }
            requestAnimationFrame(() => this.scheduler());
        } catch (e) {
            console.error('Scheduler error:', e);
            this.stop();
        }
    }

    scheduleNextBeat() {
        const secondsPerBeat = 60.0 / this.tempo;
        this.nextNoteTime += secondsPerBeat / 4; // 16th notes
        this.beatCount++;
    }

    playBeat(time) {
        try {
            const step = this.beatCount % 16;

            // Kick
            if (step % 4 === 0) {
                this.playKick(time);
            }

            // Hi-hat
            if (step % 2 === 0) {
                this.playHiHat(time);
            }

            // Bass
            if (step === 0 || step === 3 || step === 6 || step === 10) {
                this.playBass(time, 150);
            } else if (step === 2 || step === 8) {
                this.playBass(time, 100);
            }
        } catch (e) {
            // Ignore audio errors during playback
        }
    }

    playKick(time) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);
        gain.gain.setValueAtTime(0.8, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
        osc.start(time);
        osc.stop(time + 0.5);
    }

    playHiHat(time) {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 0.1;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1000;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.2, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start(time);
    }

    playBass(time, freq) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq * 2, time);
        filter.frequency.exponentialRampToValueAtTime(freq, time + 0.2);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0.15, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
        osc.start(time);
        osc.stop(time + 0.3);
    }
}

const soundManager = new SoundManager();

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
            const rand = Math.random();
            let type = 'BLOCK';

            // Difficulty scaling for obstacles
            if (levelConfig.difficulty >= 3 && rand > 0.7) type = 'SPIKE';
            if (levelConfig.difficulty >= 5 && rand > 0.85) type = 'SAW';
            if (levelConfig.difficulty >= 7 && rand > 0.9) type = 'TRIPLE_SPIKE';

            // Basic random fallback
            if (type === 'BLOCK' && Math.random() > 0.5) type = 'SPIKE';

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
        this.color = playerColor;
    }

    jump() {
        if (this.isGrounded) {
            this.dy = JUMP_FORCE;
            this.isGrounded = false;
            createParticles(this.x + this.size / 2, this.y + this.size, 5, '#fff');
            soundManager.start(); // Ensure audio starts on interaction
        }
    }

    update() {
        this.dy += GRAVITY * slowMotionFactor;
        this.y += this.dy * slowMotionFactor;

        if (!this.isGrounded) {
            this.rotation += 8 * slowMotionFactor; // Faster rotation
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

        drawShape(ctx, playerShape, this.size, this.color);

        ctx.restore();
    }
}

class Obstacle {
    constructor(type, x) {
        this.type = type;
        this.x = x;
        this.markedForDeletion = false;
        this.rotation = 0;

        this.w = 30;
        this.h = 40;
        this.y = canvas.height - GROUND_HEIGHT - this.h;
        this.color = '#ffcc00';

        if (type === 'SPIKE') {
            this.color = '#ff0055';
        } else if (type === 'TRIPLE_SPIKE') {
            this.w = 120; // 3 spikes width
            this.color = '#ff0055';
        } else if (type === 'SAW') {
            this.w = 60;
            this.h = 60;
            this.y = canvas.height - GROUND_HEIGHT - 30; // Float slightly? No, saws usually on ground or air. Let's put on ground.
            this.y = canvas.height - GROUND_HEIGHT - this.h / 2; // Center on ground line
            this.color = '#ff3300';
        }
    }

    update() {
        this.x -= gameSpeed * slowMotionFactor;
        if (this.type === 'SAW') {
            this.rotation -= 10 * slowMotionFactor;
        }
        if (this.x + this.w < 0) {
            this.markedForDeletion = true;
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
        } else if (this.type === 'TRIPLE_SPIKE') {
            // Draw 3 spikes
            for (let i = 0; i < 3; i++) {
                let sx = this.x + i * 40;
                ctx.beginPath();
                ctx.moveTo(sx, this.y + this.h);
                ctx.lineTo(sx + 20, this.y);
                ctx.lineTo(sx + 40, this.y + this.h);
                ctx.closePath();
                ctx.fill();
            }
        } else if (this.type === 'SAW') {
            ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
            ctx.rotate(this.rotation * Math.PI / 180);
            ctx.beginPath();
            // Draw saw teeth
            const radius = this.w / 2;
            for (let i = 0; i < 8; i++) {
                ctx.rotate(Math.PI / 4);
                ctx.moveTo(0, -radius);
                ctx.lineTo(10, -radius - 10);
                ctx.lineTo(-10, -radius - 10);
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, radius / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // BLOCK
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
    gameStartTime = Date.now(); // Reset timer
    timeSurvived = 0;

    const levelConfig = LEVELS[currentLevel] || LEVELS[1];
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

        if (obs.type === 'SAW') {
            // Circle collision for saw
            const dx = (player.x + player.size / 2) - (obs.x + obs.w / 2);
            const dy = (player.y + player.size / 2) - (obs.y + obs.h / 2);
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < (player.size / 2 + obs.w / 2 - 10)) {
                gameOver();
            }
        } else {
            // AABB for blocks/spikes
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
}

// Economy & Unlocks
let coins = 0;
let highScore = 0;
let unlockedColors = ['#00f3ff'];
let unlockedShapes = ['square'];
let unlockedBackgrounds = ['default'];
let currentBackground = 'default';
let gameStartTime = 0;
let timeSurvived = 0;

const SHOP_ITEMS = {
    colors: {
        '#00f3ff': 0,
        '#ff0055': 50,
        '#00ff00': 100,
        '#ffcc00': 200,
        '#ff6600': 300,
        '#9933ff': 500,
        '#ffffff': 1000,
        '#ff1744': 2000
    },
    shapes: {
        'square': 0,
        'circle': 5,
        'triangle': 10,
        'diamond': 15,
        'hexagon': 25,
        'star': 50
    },
    backgrounds: {
        'default': 0,
        'sunset': 3,
        'ocean': 5,
        'forest': 7,
        'space': 10,
        'neon': 15,
        'matrix': 20
    }
};


function gameOver() {
    if (gameState === 'GAMEOVER') return;
    gameState = 'GAMEOVER';

    slowMotionFactor = 0.1;
    canRestart = false;
    deathTime = Date.now();
    soundManager.stop();

    // Economy Update
    coins += score;
    if (score > highScore) {
        highScore = score;
    }
    saveProgress();
    updateUI();

    // Update Game Over Stats
    document.getElementById('go-score').innerText = score;
    document.getElementById('go-high-score').innerText = highScore;
    document.getElementById('go-coins').innerText = score;

    document.getElementById('game-canvas').classList.add('wasted-effect');
    document.getElementById('wasted-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
    document.getElementById('current-level-display').classList.remove('visible');

    explodeCube(player.x, player.y, player.size, player.color);
    playerExploded = true;

    createParticles(player.x + player.size / 2, player.y + player.size / 2, 50, player.color);

    // Allow restart after 1.5 seconds
    setTimeout(() => {
        canRestart = true;
        document.getElementById('wasted-screen').classList.remove('active');
        document.getElementById('game-over-screen').classList.add('active');
    }, 1500);
}

function levelComplete() {
    gameState = 'WIN';
    soundManager.stop();

    // Economy Update
    coins += score;
    if (score > highScore) {
        highScore = score;
    }
    saveProgress();
    updateUI();

    createParticles(player.x + player.size / 2, player.y + player.size / 2, 100, '#00ff00');
    document.getElementById('current-level-display').classList.remove('visible');

    if (currentLevel < 10 && currentLevel >= unlockedLevels) {
        unlockedLevels = currentLevel + 1;
        document.getElementById('level-complete-message').innerText = `Level ${unlockedLevels} Unlocked!`;
    } else if (currentLevel === 10) {
        document.getElementById('level-complete-message').innerText = 'All Levels Complete!';
    } else {
        document.getElementById('level-complete-message').innerText = 'Level Complete!';
    }
    saveProgress();

    document.getElementById('level-complete-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
}

function update() {
    if (gameState !== 'PLAYING') return;

    // Calculate time-based score
    timeSurvived = Math.floor((Date.now() - gameStartTime) / 1000);
    score = timeSurvived;
    document.getElementById('score').innerText = score;

    player.update();
    distanceTraveled += gameSpeed * slowMotionFactor;
    bgOffset -= gameSpeed * 0.2 * slowMotionFactor; // Parallax background

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


function drawBackground() {
    // Different backgrounds based on currentBackground
    switch (currentBackground) {
        case 'sunset':
            // Sunset gradient
            const sunsetGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            sunsetGradient.addColorStop(0, '#FF6B6B');
            sunsetGradient.addColorStop(0.5, '#FFD93D');
            sunsetGradient.addColorStop(1, '#6C5CE7');
            ctx.fillStyle = sunsetGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Sun
            ctx.fillStyle = '#FFE66D';
            ctx.shadowBlur = 40;
            ctx.shadowColor = '#FFE66D';
            ctx.beginPath();
            ctx.arc(canvas.width * 0.8, canvas.height * 0.3, 60, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            break;

        case 'ocean':
            // Ocean gradient
            const oceanGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            oceanGradient.addColorStop(0, '#0077BE');
            oceanGradient.addColorStop(0.7, '#00B4D8');
            oceanGradient.addColorStop(1, '#90E0EF');
            ctx.fillStyle = oceanGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Waves
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.moveTo(0, canvas.height * 0.6 + i * 30);
                for (let x = 0; x <= canvas.width; x += 50) {
                    const y = canvas.height * 0.6 + i * 30 + Math.sin((x + bgOffset * (1 + i * 0.5)) * 0.02) * 20;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.lineTo(0, canvas.height);
                ctx.fill();
            }
            break;

        case 'forest':
            // Forest gradient
            const forestGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            forestGradient.addColorStop(0, '#1B4332');
            forestGradient.addColorStop(0.6, '#2D6A4F');
            forestGradient.addColorStop(1, '#40916C');
            ctx.fillStyle = forestGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Trees silhouette
            ctx.fillStyle = '#081C15';
            for (let i = 0; i < canvas.width; i += 80) {
                const treeX = i + (bgOffset * 0.3) % 80;
                const treeHeight = 150 + Math.sin(i * 0.1) * 50;
                ctx.beginPath();
                ctx.moveTo(treeX, canvas.height);
                ctx.lineTo(treeX - 20, canvas.height - treeHeight);
                ctx.lineTo(treeX + 20, canvas.height - treeHeight);
                ctx.fill();
            }
            break;

        case 'space':
            // Space background
            ctx.fillStyle = '#0B0C10';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Stars
            ctx.fillStyle = '#FFFFFF';
            for (let i = 0; i < 100; i++) {
                const x = (i * 137.5 + bgOffset * 0.1) % canvas.width;
                const y = (i * 73.3) % canvas.height;
                const size = (i % 3) + 1;
                ctx.fillRect(x, y, size, size);
            }

            // Nebula effect
            const nebulaGradient = ctx.createRadialGradient(
                canvas.width * 0.7, canvas.height * 0.4, 0,
                canvas.width * 0.7, canvas.height * 0.4, 300
            );
            nebulaGradient.addColorStop(0, 'rgba(138, 43, 226, 0.3)');
            nebulaGradient.addColorStop(1, 'rgba(138, 43, 226, 0)');
            ctx.fillStyle = nebulaGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            break;

        case 'neon':
            // Neon city
            const neonGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            neonGradient.addColorStop(0, '#1a0033');
            neonGradient.addColorStop(1, '#330066');
            ctx.fillStyle = neonGradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Grid lines
            ctx.strokeStyle = 'rgba(0, 243, 255, 0.3)';
            ctx.lineWidth = 2;
            for (let i = 0; i < canvas.width; i += 50) {
                ctx.beginPath();
                ctx.moveTo(i + (bgOffset % 50), 0);
                ctx.lineTo(i + (bgOffset % 50), canvas.height);
                ctx.stroke();
            }
            for (let i = 0; i < canvas.height; i += 50) {
                ctx.beginPath();
                ctx.moveTo(0, i);
                ctx.lineTo(canvas.width, i);
                ctx.stroke();
            }
            break;

        case 'matrix':
            // Matrix code rain
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
            ctx.font = '20px monospace';
            for (let i = 0; i < 20; i++) {
                const x = i * 50;
                const y = ((bgOffset * 2 + i * 100) % (canvas.height + 200)) - 200;
                const chars = '01';
                const char = chars[Math.floor((bgOffset + i) % 2)];
                ctx.fillText(char, x, y);
            }
            break;

        default: // 'default'
            // Original gradient
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#0f0c29');
            gradient.addColorStop(1, '#24243e');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Parallax Mountains
            ctx.save();
            ctx.fillStyle = '#1a1a2e';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 100) {
                const h = 200 + Math.sin((i + Math.abs(bgOffset)) * 0.01) * 50;
                ctx.lineTo(i, canvas.height - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            ctx.restore();
            break;
    }
}


function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();

    // Floor
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

    if (player && !playerExploded) {
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
        if (player && !playerExploded) {
            player.update();
        }
        obstacles.forEach(obs => obs.update());
        obstacles = obstacles.filter(obs => !obs.markedForDeletion);

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
    updateUI();
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
    gameStartTime = Date.now(); // Start timer
    document.getElementById('level-select-screen').classList.remove('active');
    document.querySelector('.game-title').style.opacity = '0.2';
    document.getElementById('current-level-display').classList.add('visible');
    soundManager.start();
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
            soundManager.start();
        } else if (gameState === 'WIN') {
            if (currentLevel < 10) {
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
        } else if (gameState === 'CUSTOMIZE') {
            showLevelSelect();
            document.getElementById('customize-screen').classList.remove('active');
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
        soundManager.start();
    } else if (gameState === 'WIN') {
        if (currentLevel < 10) {
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
    renderShopUI();
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

function renderShopUI() {
    // Colors
    const colorContainer = document.querySelector('.color-presets');
    colorContainer.innerHTML = '';

    Object.entries(SHOP_ITEMS.colors).forEach(([color, price]) => {
        const btn = document.createElement('button');
        btn.className = 'color-preset';
        btn.dataset.color = color;
        btn.style.background = color;

        const isUnlocked = unlockedColors.includes(color);
        if (!isUnlocked) {
            btn.classList.add('locked-item');
            const priceTag = document.createElement('div');
            priceTag.className = 'item-price';
            priceTag.innerText = price;
            btn.appendChild(priceTag);
        }

        if (playerColor === color) btn.classList.add('active');

        btn.addEventListener('click', () => trySelectColor(color, price));
        colorContainer.appendChild(btn);
    });

    // Shapes
    const shapeContainer = document.querySelector('.shape-grid');
    shapeContainer.innerHTML = '';

    Object.entries(SHOP_ITEMS.shapes).forEach(([shape, price]) => {
        const btn = document.createElement('button');
        btn.className = 'shape-btn';
        btn.dataset.shape = shape;

        const isUnlocked = unlockedShapes.includes(shape);
        if (!isUnlocked) {
            btn.classList.add('locked-item');
            const priceTag = document.createElement('div');
            priceTag.className = 'item-price';
            priceTag.innerText = price;
            btn.appendChild(priceTag);
        }

        if (playerShape === shape) btn.classList.add('active');

        const label = document.createElement('div');
        label.className = 'shape-label';
        let icon = '■';
        if (shape === 'circle') icon = '●';
        if (shape === 'triangle') icon = '▲';
        if (shape === 'diamond') icon = '◆';
        if (shape === 'hexagon') icon = '⬡';
        if (shape === 'star') icon = '★';
        label.innerText = `${icon} ${shape}`;

        btn.appendChild(label);
        btn.addEventListener('click', () => trySelectShape(shape, price));
        shapeContainer.appendChild(btn);
    });

    // Backgrounds
    const backgroundContainer = document.querySelector('.background-grid');
    if (backgroundContainer) {
        backgroundContainer.innerHTML = '';
        backgroundContainer.style.display = 'grid';
        backgroundContainer.style.gridTemplateColumns = 'repeat(2, 1fr)';
        backgroundContainer.style.gap = '0.8rem';

        Object.entries(SHOP_ITEMS.backgrounds).forEach(([bg, price]) => {
            const btn = document.createElement('button');
            btn.className = 'shape-btn';
            btn.dataset.background = bg;

            const isUnlocked = unlockedBackgrounds.includes(bg);
            if (!isUnlocked) {
                btn.classList.add('locked-item');
                const priceTag = document.createElement('div');
                priceTag.className = 'item-price';
                priceTag.innerText = price;
                btn.appendChild(priceTag);
            }

            if (currentBackground === bg) btn.classList.add('active');

            const label = document.createElement('div');
            label.className = 'shape-label';
            label.innerText = bg.charAt(0).toUpperCase() + bg.slice(1);

            btn.appendChild(label);
            btn.addEventListener('click', () => trySelectBackground(bg, price));
            backgroundContainer.appendChild(btn);
        });
    }
}


function trySelectColor(color, price) {
    if (unlockedColors.includes(color)) {
        setPlayerColor(color);
    } else {
        if (coins >= price) {
            if (confirm(`Unlock this color for ${price} coins?`)) {
                coins -= price;
                unlockedColors.push(color);
                setPlayerColor(color);
                saveProgress();
                updateUI();
                renderShopUI();
            }
        } else {
            alert(`Not enough coins! You need ${price} coins.`);
        }
    }
}

function trySelectShape(shape, price) {
    if (unlockedShapes.includes(shape)) {
        setPlayerShape(shape);
    } else {
        if (coins >= price) {
            if (confirm(`Unlock this shape for ${price} coins?`)) {
                coins -= price;
                unlockedShapes.push(shape);
                setPlayerShape(shape);
                saveProgress();
                updateUI();
                renderShopUI();
            }
        } else {
            alert(`Not enough coins! You need ${price} coins.`);
        }
    }
}

function setPlayerColor(color) {
    playerColor = color;
    localStorage.setItem('neonDashColor', color);
    renderShopUI(); // Refresh active state
    // Update color input
    document.getElementById('color-input').value = color;
}

function setPlayerShape(shape) {
    playerShape = shape;
    localStorage.setItem('neonDashShape', shape);
    renderShopUI(); // Refresh active state
}

function trySelectBackground(bg, price) {
    if (unlockedBackgrounds.includes(bg)) {
        setBackground(bg);
    } else {
        if (coins >= price) {
            if (confirm(`Unlock ${bg} background for ${price} coins?`)) {
                coins -= price;
                unlockedBackgrounds.push(bg);
                setBackground(bg);
                saveProgress();
                updateUI();
                renderShopUI();
            }
        } else {
            alert(`Not enough coins! You need ${price} coins.`);
        }
    }
}

function setBackground(bg) {
    currentBackground = bg;
    localStorage.setItem('neonDashBackground', bg);
    renderShopUI(); // Refresh active state
}

function saveProgress() {
    localStorage.setItem('neonDashProgress', unlockedLevels.toString());
    localStorage.setItem('neonDashCoins', coins.toString());
    localStorage.setItem('neonDashHighScore', highScore.toString());
    localStorage.setItem('neonDashUnlockedColors', JSON.stringify(unlockedColors));
    localStorage.setItem('neonDashUnlockedShapes', JSON.stringify(unlockedShapes));
    localStorage.setItem('neonDashUnlockedBackgrounds', JSON.stringify(unlockedBackgrounds));
}

function loadProgress() {
    const savedLevels = localStorage.getItem('neonDashProgress');
    if (savedLevels) unlockedLevels = parseInt(savedLevels);

    const savedCoins = localStorage.getItem('neonDashCoins');
    if (savedCoins) coins = parseInt(savedCoins);

    const savedHighScore = localStorage.getItem('neonDashHighScore');
    if (savedHighScore) highScore = parseInt(savedHighScore);

    const savedColors = localStorage.getItem('neonDashUnlockedColors');
    if (savedColors) unlockedColors = JSON.parse(savedColors);

    const savedShapes = localStorage.getItem('neonDashUnlockedShapes');
    if (savedShapes) unlockedShapes = JSON.parse(savedShapes);

    const savedBackgrounds = localStorage.getItem('neonDashUnlockedBackgrounds');
    if (savedBackgrounds) unlockedBackgrounds = JSON.parse(savedBackgrounds);

    // Load saved customization
    const savedColor = localStorage.getItem('neonDashColor');
    if (savedColor) playerColor = savedColor;

    const savedShape = localStorage.getItem('neonDashShape');
    if (savedShape) playerShape = savedShape;

    const savedBackground = localStorage.getItem('neonDashBackground');
    if (savedBackground) currentBackground = savedBackground;

    updateUI();
}


function updateUI() {
    document.getElementById('coin-count').innerText = coins;
    document.getElementById('high-score').innerText = highScore;
    document.getElementById('high-score-display').innerText = highScore;
    const customizeCoinCount = document.getElementById('customize-coin-count');
    if (customizeCoinCount) {
        customizeCoinCount.innerText = coins;
    }
}

// Custom color input
document.getElementById('color-input').addEventListener('input', (e) => {
    setPlayerColor(e.target.value);
});

// Customize button
document.getElementById('customize-btn').addEventListener('click', () => {
    showCustomizeScreen();
});

// Start
loadProgress();
init();
loop();





