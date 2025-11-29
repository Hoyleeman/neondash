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
let jumpKey = 'Space';
let isMusicEnabled = true;
let isBindingKey = false;
let landingGracePeriod = 0;
let previousGameState = 'START';
let userId = 'guest';
let coinsCollectedThisRun = 0; // Track coins earned in current game

// Level configurations
const LEVELS = {
    1: { name: 'Beginner', length: 10000, startSpeed: 6, maxSpeed: 9, spawnRate: 0.03, minDistance: 500, difficulty: 1 },
    2: { name: 'Easy', length: 14000, startSpeed: 7, maxSpeed: 10, spawnRate: 0.04, minDistance: 450, difficulty: 2 },
    3: { name: 'Medium', length: 18000, startSpeed: 8, maxSpeed: 11, spawnRate: 0.05, minDistance: 400, difficulty: 3 },
    4: { name: 'Hard', length: 22000, startSpeed: 9, maxSpeed: 12, spawnRate: 0.06, minDistance: 350, difficulty: 4 },
    5: { name: 'Expert', length: 26000, startSpeed: 10, maxSpeed: 13, spawnRate: 0.07, minDistance: 300, difficulty: 5 },
    6: { name: 'Insane', length: 30000, startSpeed: 11, maxSpeed: 14, spawnRate: 0.08, minDistance: 280, difficulty: 6 },
    7: { name: 'Demon', length: 35000, startSpeed: 12, maxSpeed: 15, spawnRate: 0.09, minDistance: 260, difficulty: 7 },
    8: { name: 'Void', length: 40000, startSpeed: 13, maxSpeed: 16, spawnRate: 0.12, minDistance: 220, difficulty: 8 },
    9: { name: 'Omega', length: 50000, startSpeed: 14, maxSpeed: 17, spawnRate: 0.14, minDistance: 200, difficulty: 9 },
    10: { name: 'Infinity', length: 60000, startSpeed: 15, maxSpeed: 18, spawnRate: 0.16, minDistance: 180, difficulty: 10 }
};

// Physics Constants
// Physics Constants
const GRAVITY = 2.9;
const JUMP_FORCE = -27;
const GROUND_HEIGHT = 110;

// Input
let keys = {};

// Entities
let player;
let obstacles = [];
let particles = [];
let powerUps = []; // New: PowerUps array
let cubeFragments = [];
let floorPatternOffset = 0;
let finishLine = null;
let playerExploded = false;
let deathTime = 0;
let canRestart = true;
let bgOffset = 0;
let bgTime = 0; // For animated backgrounds

// Delta Time & Smooth Movement
let lastTime = 0;
let deltaTime = 0;
let targetGameSpeed = 9;
let smoothGameSpeed = 9;
const SPEED_LERP_FACTOR = 0.02; // How smoothly speed changes (lower = smoother)
const TARGET_FPS = 60;
const TARGET_FRAME_TIME = 1000 / TARGET_FPS;

// Power-up States
let shieldCount = 0;
let isBoosting = false;
let boostTimer = 0;
let safeModeTimer = 0; // Grace period after boosting

// Customization
let playerColor = '#00f3ff';
let playerShape = 'square';
let previewCanvas;
let previewCtx;
let previewRotation = 0;

// Shop selection state
let selectedItem = null; // { type: 'color'|'shape'|'background', value: string, price: number }
let previewingBackground = null; // For background preview before purchase
let previewingShape = null; // For shape preview before purchase
let previewingColor = null; // For color preview before purchase

// Audio
let musicVolume = 0.5;
let sfxVolume = 0.7;

class SoundManager {
    constructor() {
        this.audio = null;
        this.isPlaying = false;
        this.initialized = false;
        this.enabled = true;
        this.ctx = null;
        this.masterGain = null;
        this.isMuted = false;
        
        // Playlist of all music tracks
        this.playlist = [
            'neondashmusic.mp3',
            'neondashmusic1.mp3',
            'neondashmusic2.mp3',
            'neondashmusic3.mp3',
            'neondashmusic4.mp3',
            'neondashmusic5.mp3',
            'neondashmusic6.mp3',
            'neondashmusic7.mp3',
            'neondashmusic8.mp3'
        ];
        this.currentTrackIndex = 0;
    }

    init() {
        if (!this.enabled || this.initialized) return;
        try {
            // Shuffle playlist for variety
            this.shufflePlaylist();
            
            // Initialize audio element for music
            this.audio = new Audio(this.playlist[this.currentTrackIndex]);
            this.audio.volume = musicVolume;
            
            // When song ends, play next one
            this.audio.addEventListener('ended', () => {
                this.playNextTrack();
            });

            // Initialize AudioContext for sound effects
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = sfxVolume;
                this.masterGain.connect(this.ctx.destination);
            }

            this.initialized = true;
            console.log('🎵 Playlist loaded with', this.playlist.length, 'tracks');
        } catch (e) {
            console.error('Failed to init audio:', e);
            this.enabled = false;
        }
    }
    
    shufflePlaylist() {
        // Fisher-Yates shuffle
        for (let i = this.playlist.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }
    }
    
    playNextTrack() {
        if (!this.audio || !isMusicEnabled) return;
        
        this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
        this.audio.src = this.playlist[this.currentTrackIndex];
        this.audio.volume = musicVolume;
        
        if (this.isPlaying) {
            this.audio.play().catch(() => {});
        }
        
        console.log('🎵 Now playing:', this.playlist[this.currentTrackIndex]);
    }
    
    skipTrack() {
        // Allow skipping to next song
        this.playNextTrack();
    }

    setMusicVolume(vol) {
        musicVolume = vol;
        if (this.audio && !this.isMuted) {
            this.audio.volume = vol;
        }
        localStorage.setItem('neonDashMusicVolume', vol);
    }

    setSfxVolume(vol) {
        sfxVolume = vol;
        if (this.masterGain) {
            this.masterGain.gain.value = vol;
        }
        localStorage.setItem('neonDashSfxVolume', vol);
    }

    // Start music (only call once, keeps playing forever)
    startMusic() {
        if (!this.enabled || !isMusicEnabled) return;
        try {
            if (!this.initialized) this.init();
            if (!this.initialized || !this.audio) return;

            if (!this.isPlaying) {
                this.audio.volume = musicVolume;
                this.audio.play().catch(e => {
                    console.log('Audio play failed (user interaction required):', e);
                });
                this.isPlaying = true;
            }
            this.isMuted = false;
        } catch (e) {
            console.error('Audio start failed:', e);
        }
    }

    // Pause music (for death screen)
    pause() {
        if (this.audio && this.isPlaying) {
            this.audio.pause();
        }
    }

    // Unpause music (resume from where it left off)
    unpause() {
        if (this.audio && isMusicEnabled) {
            this.audio.volume = musicVolume;
            this.audio.play().catch(() => {});
        }
    }

    // Ensure music is playing (call on user interaction)
    ensurePlaying() {
        if (!this.enabled || !isMusicEnabled) return;
        if (!this.initialized) this.init();
        if (this.audio && !this.isPlaying) {
            this.audio.play().catch(() => {});
            this.isPlaying = true;
        }
        if (!this.isMuted) {
            this.audio.volume = musicVolume;
        }
    }

    // Full stop (only for toggling music off in settings)
    stop() {
        if (this.audio) {
            this.audio.pause();
            this.audio.currentTime = 0;
        }
        this.isPlaying = false;
    }

    // Resume from full stop
    resume() {
        if (!this.enabled || !isMusicEnabled || !this.audio) return;
        this.audio.volume = musicVolume;
        this.audio.play().catch(() => {});
        this.isPlaying = true;
        this.isMuted = false;
    }

    // JUMP sound - short punchy whoosh
    playJump() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.15);
        } catch (e) {}
    }

    // COIN sound - bright ding
    playCoin() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            const osc = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1800, this.ctx.currentTime);
            
            gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
            
            osc.connect(gain);
            osc2.connect(gain);
            gain.connect(this.masterGain);
            
            osc.start();
            osc2.start();
            osc.stop(this.ctx.currentTime + 0.2);
            osc2.stop(this.ctx.currentTime + 0.2);
        } catch (e) {}
    }

    // ROCKET/BOOST sound - continuous whoosh (call repeatedly)
    playRocket() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            const bufferSize = this.ctx.sampleRate * 0.1;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 800;
            filter.Q.value = 2;
            
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
            
            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            noise.start();
        } catch (e) {}
    }

    // BOMB/EXPLOSION sound - deep boom
    playBomb() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            // Low frequency boom
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(150, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.5);
            gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.5);

            // Noise burst for crackle
            const bufferSize = this.ctx.sampleRate * 0.3;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;
            const noiseGain = this.ctx.createGain();
            noiseGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
            noise.connect(noiseGain);
            noiseGain.connect(this.masterGain);
            noise.start();
        } catch (e) {}
    }

    // POWERUP/HEART sound - magical ascending chime
    playPowerup() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
            notes.forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.08);
                gain.gain.linearRampToValueAtTime(0.2, this.ctx.currentTime + i * 0.08 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.08 + 0.2);
                osc.connect(gain);
                gain.connect(this.masterGain);
                osc.start(this.ctx.currentTime + i * 0.08);
                osc.stop(this.ctx.currentTime + i * 0.08 + 0.25);
            });
        } catch (e) {}
    }

    // DEATH sound - descending sad tone
    playDeath() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.5);
            gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.5);
        } catch (e) {}
    }

    // WIN/LEVEL COMPLETE sound - triumphant fanfare
    playWin() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            const notes = [523, 659, 784, 1047, 1319]; // C, E, G, C, E
            notes.forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.12);
                gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + i * 0.12 + 0.02);
                gain.gain.setValueAtTime(0.15, this.ctx.currentTime + i * 0.12 + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.12 + 0.3);
                osc.connect(gain);
                gain.connect(this.masterGain);
                osc.start(this.ctx.currentTime + i * 0.12);
                osc.stop(this.ctx.currentTime + i * 0.12 + 0.35);
            });
        } catch (e) {}
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

    // Grace period check
    if (safeModeTimer > 0 || landingGracePeriod > 0) return;

    if (distanceTraveled < 800) return;

    const minDistance = levelConfig.minDistance;
    let lastObstacleX = obstacles.length > 0 ? obstacles[obstacles.length - 1].x : -1000;

    if (canvas.width - lastObstacleX > minDistance) {
        // Chance to spawn PowerUp instead of Obstacle (spawn safely)
        if (Math.random() < 0.06) {
            spawnPowerUpSafely(canvas.width + 100);
            return;
        }

        if (Math.random() < levelConfig.spawnRate) {
            const rand = Math.random();
            let type = 'BLOCK';

            // Difficulty scaling for obstacles - more variety!
            if (levelConfig.difficulty >= 2 && rand > 0.8) type = 'SPIKE';
            if (levelConfig.difficulty >= 3 && rand > 0.85) type = 'DOUBLE_SPIKE';
            if (levelConfig.difficulty >= 4 && rand > 0.88) type = 'PILLAR';
            if (levelConfig.difficulty >= 5 && rand > 0.9) type = 'SAW';
            if (levelConfig.difficulty >= 6 && rand > 0.92) type = 'LASER';
            if (levelConfig.difficulty >= 7 && rand > 0.94) type = 'TRIPLE_SPIKE';
            if (levelConfig.difficulty >= 8 && rand > 0.96) type = 'MOVING_SAW';

            // Basic random fallback
            if (type === 'BLOCK' && Math.random() > 0.5) type = 'SPIKE';

            obstacles.push(new Obstacle(type, canvas.width + 100));
        }
    }
}

function spawnPowerUp(x, y) {
    const rand = Math.random();
    let type = 'COIN';
    if (rand > 0.95) type = 'BOMB'; // 5% chance for bomb (was jump pad)
    else if (rand > 0.9) type = 'BOOST';
    else if (rand > 0.8) type = 'HEART';

    // Default spawn heights if not specified
    if (y === undefined) {
        y = canvas.height - GROUND_HEIGHT - 150;
        if (type === 'COIN') y = canvas.height - GROUND_HEIGHT - 50 - Math.random() * 100;
        if (type === 'BOMB') y = canvas.height - GROUND_HEIGHT - 30;
    }

    powerUps.push(new PowerUp(type, x, y));
}

// Spawn power-ups safely away from obstacles
function spawnPowerUpSafely(x) {
    const rand = Math.random();
    let type = 'COIN';
    if (rand > 0.95) type = 'BOMB';
    else if (rand > 0.9) type = 'BOOST';
    else if (rand > 0.8) type = 'HEART';

    // Calculate safe Y position
    let y;
    const groundY = canvas.height - GROUND_HEIGHT;
    
    if (type === 'BOMB') {
        y = groundY - 30;
    } else if (type === 'COIN') {
        // Coins can be at various heights - find safe spot
        const possibleHeights = [groundY - 60, groundY - 100, groundY - 140, groundY - 180];
        y = possibleHeights[Math.floor(Math.random() * possibleHeights.length)];
    } else {
        y = groundY - 120 - Math.random() * 60;
    }

    // Check if position overlaps with any obstacle
    const size = 30;
    let isSafe = true;
    for (let obs of obstacles) {
        // Check horizontal overlap
        if (x + size > obs.x - 50 && x < obs.x + obs.w + 50) {
            // Check vertical overlap
            if (y + size > obs.y - 20 && y < obs.y + obs.h + 20) {
                isSafe = false;
                break;
            }
        }
    }

    if (isSafe) {
        powerUps.push(new PowerUp(type, x, y));
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
        this.canDoubleJump = true; // Double jump available
    }

    jump() {
        if (this.isGrounded) {
            // First jump from ground
            this.dy = JUMP_FORCE;
            this.isGrounded = false;
            this.canDoubleJump = true; // Reset double jump when jumping from ground
            createParticles(this.x + this.size / 2, this.y + this.size, 5, '#fff');
            soundManager.ensurePlaying(); // Ensure music starts on first interaction
            soundManager.playJump();
        } else if (this.canDoubleJump) {
            // Double jump in mid-air!
            this.dy = JUMP_FORCE * 0.85; // Slightly weaker second jump
            this.canDoubleJump = false;
            // Special double jump particles
            createParticles(this.x + this.size / 2, this.y + this.size, 8, '#00f3ff');
            createParticles(this.x + this.size / 2, this.y + this.size, 5, '#ff00ff');
            soundManager.playJump();
        }
    }

    update(dt = 1) {
        if (isBoosting) {
            // Fly even higher!
            const targetY = canvas.height - GROUND_HEIGHT - 350;
            this.y += (targetY - this.y) * 0.12 * dt;

            // THRUSTER EFFECTS - flames shooting downward!
            const thrusterX = this.x + this.size / 2;
            const thrusterY = this.y + this.size;
            
            // Main thruster flames (shooting down)
            if (Math.random() < 0.6 * dt) {
                for (let i = 0; i < 3; i++) {
                    const p = new Particle(
                        thrusterX + (Math.random() - 0.5) * 15,
                        thrusterY,
                        '#ff5500'
                    );
                    p.speedX = (Math.random() - 0.5) * 2;
                    p.speedY = 8 + Math.random() * 6; // Shooting DOWN
                    p.size = 6 + Math.random() * 6;
                    particles.push(p);
                }
            }
            
            // Yellow/white hot center flames
            if (Math.random() < 0.4 * dt) {
                const p = new Particle(thrusterX, thrusterY, '#ffff00');
                p.speedX = (Math.random() - 0.5) * 1;
                p.speedY = 6 + Math.random() * 4;
                p.size = 4 + Math.random() * 4;
                particles.push(p);
                
                const p2 = new Particle(thrusterX, thrusterY, '#ffffff');
                p2.speedX = (Math.random() - 0.5) * 0.5;
                p2.speedY = 5 + Math.random() * 3;
                p2.size = 3 + Math.random() * 2;
                particles.push(p2);
            }
            
            // Smoke trail
            if (Math.random() < 0.3 * dt) {
                const p = new Particle(
                    thrusterX + (Math.random() - 0.5) * 20,
                    thrusterY + 20,
                    '#666666'
                );
                p.speedX = (Math.random() - 0.5) * 3;
                p.speedY = 2 + Math.random() * 2;
                p.size = 8 + Math.random() * 8;
                p.life = 0.8;
                particles.push(p);
            }
            
            this.dy = 0;
            this.rotation += 12 * dt;
            
            // Rocket sound effect
            if (Math.random() < 0.2 * dt) {
                soundManager.playRocket();
            }
            return;
        }

        this.dy += GRAVITY * slowMotionFactor * dt;
        this.y += this.dy * slowMotionFactor * dt;

        if (!this.isGrounded) {
            this.rotation += 8 * slowMotionFactor * dt;
        } else {
            const snap = Math.round(this.rotation / 90) * 90;
            this.rotation = snap;
        }

        if (this.y + this.size > canvas.height - GROUND_HEIGHT) {
            this.y = canvas.height - GROUND_HEIGHT - this.size;
            this.dy = 0;
            this.isGrounded = true;
            this.canDoubleJump = true; // Reset double jump on landing
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

        // Draw Shield
        if (shieldCount > 0) {
            ctx.save();
            ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
            ctx.beginPath();
            ctx.arc(0, 0, this.size * 0.8 + (shieldCount * 5), 0, Math.PI * 2); // Bigger shield for more hearts
            ctx.strokeStyle = '#ff0055'; // Heart color
            ctx.lineWidth = 3;
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff0055';
            ctx.stroke();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = '#ff0055';
            ctx.fill();
            ctx.restore();
        }
    }
}

class Obstacle {
    constructor(type, x) {
        this.type = type;
        this.x = x;
        this.markedForDeletion = false;
        this.rotation = 0;
        this.animTimer = 0;
        this.moveDirection = 1;
        this.startY = 0;

        this.w = 20;
        this.h = 40;
        this.y = canvas.height - GROUND_HEIGHT - this.h;
        this.color = '#ffcc00';

        if (type === 'SPIKE') {
            this.color = '#ff0055';
        } else if (type === 'DOUBLE_SPIKE') {
            this.w = 50;
            this.color = '#ff0055';
        } else if (type === 'TRIPLE_SPIKE') {
            this.w = 120;
            this.color = '#ff0055';
        } else if (type === 'SAW') {
            this.w = 60;
            this.h = 60;
            this.y = canvas.height - GROUND_HEIGHT - this.h / 2;
            this.color = '#ff3300';
        } else if (type === 'MOVING_SAW') {
            this.w = 50;
            this.h = 50;
            this.y = canvas.height - GROUND_HEIGHT - 100;
            this.startY = this.y;
            this.color = '#ff6600';
        } else if (type === 'PILLAR') {
            this.w = 30;
            this.h = 120;
            this.y = canvas.height - GROUND_HEIGHT - this.h;
            this.color = '#8844ff';
        } else if (type === 'LASER') {
            this.w = 8;
            this.h = 100; // Reduced height - can be jumped over with double jump
            this.y = canvas.height - GROUND_HEIGHT - this.h;
            this.color = '#ff0000';
            this.laserOn = true;
            this.laserTimer = 0;
        }
    }

    update(dt = 1) {
        this.x -= gameSpeed * slowMotionFactor * dt;
        this.animTimer += dt;
        
        if (this.type === 'SAW' || this.type === 'MOVING_SAW') {
            this.rotation -= 12 * slowMotionFactor * dt;
        }
        
        if (this.type === 'MOVING_SAW') {
            // Move up and down
            this.y = this.startY + Math.sin(this.animTimer * 0.08) * 80;
        }
        
        if (this.type === 'LASER') {
            // Pulse on/off - more time when OFF to run through
            this.laserTimer += dt;
            const cycleTime = this.laserOn ? 50 : 70; // ON for 50, OFF for 70
            if (this.laserTimer > cycleTime) {
                this.laserOn = !this.laserOn;
                this.laserTimer = 0;
            }
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
        } else if (this.type === 'DOUBLE_SPIKE') {
            for (let i = 0; i < 2; i++) {
                let sx = this.x + i * 25;
                ctx.beginPath();
                ctx.moveTo(sx, this.y + this.h);
                ctx.lineTo(sx + 12.5, this.y);
                ctx.lineTo(sx + 25, this.y + this.h);
                ctx.closePath();
                ctx.fill();
            }
        } else if (this.type === 'TRIPLE_SPIKE') {
            for (let i = 0; i < 3; i++) {
                let sx = this.x + i * 40;
                ctx.beginPath();
                ctx.moveTo(sx, this.y + this.h);
                ctx.lineTo(sx + 20, this.y);
                ctx.lineTo(sx + 40, this.y + this.h);
                ctx.closePath();
                ctx.fill();
            }
        } else if (this.type === 'SAW' || this.type === 'MOVING_SAW') {
            ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
            ctx.rotate(this.rotation * Math.PI / 180);
            const radius = this.w / 2;
            // Teeth
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const outerR = radius + 8;
                ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
                ctx.lineTo(Math.cos(angle + 0.2) * outerR, Math.sin(angle + 0.2) * outerR);
                ctx.lineTo(Math.cos(angle + 0.4) * radius, Math.sin(angle + 0.4) * radius);
            }
            ctx.fill();
            // Body
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            // Center
            ctx.fillStyle = '#222';
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.15, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'PILLAR') {
            // Tall pillar with glow
            const grad = ctx.createLinearGradient(this.x, this.y, this.x + this.w, this.y);
            grad.addColorStop(0, '#6633cc');
            grad.addColorStop(0.5, '#aa66ff');
            grad.addColorStop(1, '#6633cc');
            ctx.fillStyle = grad;
            ctx.fillRect(this.x, this.y, this.w, this.h);
            // Top crystal
            ctx.fillStyle = '#cc99ff';
            ctx.beginPath();
            ctx.moveTo(this.x - 5, this.y);
            ctx.lineTo(this.x + this.w / 2, this.y - 20);
            ctx.lineTo(this.x + this.w + 5, this.y);
            ctx.closePath();
            ctx.fill();
        } else if (this.type === 'LASER') {
            // Emitter at top
            ctx.fillStyle = '#333';
            ctx.fillRect(this.x - 10, this.y - 20, 28, 25);
            ctx.fillStyle = this.laserOn ? '#ff0000' : '#440000';
            ctx.beginPath();
            ctx.arc(this.x + 4, this.y - 8, 8, 0, Math.PI * 2);
            ctx.fill();
            
            // Laser beam
            if (this.laserOn) {
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#ff0000';
                ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.fillRect(this.x, this.y, this.w, this.h);
                // Core
                ctx.fillStyle = '#fff';
                ctx.fillRect(this.x + 2, this.y, 4, this.h);
            }
            // Warning when off
            if (!this.laserOn && this.laserTimer > 30) {
                ctx.globalAlpha = 0.3 + Math.sin(this.animTimer * 0.5) * 0.3;
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(this.x, this.y, this.w, this.h);
                ctx.globalAlpha = 1;
            }
        } else {
            // BLOCK
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x, this.y, this.w, this.h);
        }
        ctx.restore();
    }
    
    // Check if laser should damage player
    isActive() {
        if (this.type === 'LASER') return this.laserOn;
        return true;
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

    update(dt = 1) {
        this.x -= gameSpeed * slowMotionFactor * dt;
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

class PowerUp {
    constructor(type, x, y) {
        this.type = type; // HEART, BOOST, COIN, BOMB
        this.x = x;
        this.y = y;
        this.size = 30;
        this.markedForDeletion = false;
        this.bobOffset = Math.random() * Math.PI * 2;
        this.fuseTimer = 0;
    }

    update(dt = 1) {
        this.x -= gameSpeed * slowMotionFactor * dt;
        this.bobOffset += 0.1 * dt;
        this.fuseTimer += dt * 0.2;
        
        if (this.type !== 'BOMB') {
            this.y += Math.sin(this.bobOffset) * 0.5 * dt;
        }

        if (this.x + this.size < 0) {
            this.markedForDeletion = true;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x + this.size / 2, this.y + this.size / 2);

        if (this.type === 'HEART') {
            ctx.fillStyle = '#ff0055';
            ctx.shadowColor = '#ff0055';
            ctx.shadowBlur = 15;
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❤️', 0, 0);
        } else if (this.type === 'BOOST') {
            ctx.fillStyle = '#00f3ff';
            ctx.shadowColor = '#00f3ff';
            ctx.shadowBlur = 15;
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🚀', 0, 0);
        } else if (this.type === 'COIN') {
            ctx.fillStyle = '#ffd700';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 15;
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🪙', 0, 0);
        } else if (this.type === 'BOMB') {
            // Draw bomb body
            ctx.shadowColor = '#ff4400';
            ctx.shadowBlur = 15 + Math.sin(this.fuseTimer * 3) * 5;
            
            // Bomb body (dark sphere)
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.arc(0, 2, this.size / 2 - 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Highlight
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.arc(-4, -2, 6, 0, Math.PI * 2);
            ctx.fill();
            
            // Fuse
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, -this.size / 2 + 5);
            ctx.quadraticCurveTo(8, -this.size / 2 - 5, 4, -this.size / 2 - 10);
            ctx.stroke();
            
            // Fuse spark
            const sparkSize = 4 + Math.sin(this.fuseTimer * 5) * 2;
            ctx.fillStyle = '#ff6600';
            ctx.shadowColor = '#ffff00';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(4, -this.size / 2 - 10, sparkSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(4, -this.size / 2 - 10, sparkSize * 0.5, 0, Math.PI * 2);
            ctx.fill();
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
    update(dt = 1) {
        this.x += this.speedX * slowMotionFactor * dt;
        this.y += this.speedY * slowMotionFactor * dt;
        this.life -= 0.02 * slowMotionFactor * dt;
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
    update(dt = 1) {
        this.speedY += this.gravity * slowMotionFactor * dt;
        this.x += this.speedX * slowMotionFactor * dt;
        this.y += this.speedY * slowMotionFactor * dt;
        this.rotation += this.rotationSpeed * slowMotionFactor * dt;
        this.life -= 0.008 * slowMotionFactor * dt;
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

// Epic explosion effect for bomb
function createExplosion(x, y) {
    // Core explosion particles
    for (let i = 0; i < 30; i++) {
        const angle = (i / 30) * Math.PI * 2;
        const speed = 5 + Math.random() * 10;
        const p = new Particle(x, y, '#ff6600');
        p.speedX = Math.cos(angle) * speed;
        p.speedY = Math.sin(angle) * speed;
        p.size = 8 + Math.random() * 8;
        particles.push(p);
    }
    // Yellow inner particles
    for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 6;
        const p = new Particle(x, y, '#ffff00');
        p.speedX = Math.cos(angle) * speed;
        p.speedY = Math.sin(angle) * speed;
        p.size = 4 + Math.random() * 6;
        particles.push(p);
    }
    // White hot center
    for (let i = 0; i < 10; i++) {
        const p = new Particle(x, y, '#ffffff');
        p.speedX = (Math.random() - 0.5) * 8;
        p.speedY = (Math.random() - 0.5) * 8;
        p.size = 6 + Math.random() * 4;
        particles.push(p);
    }
    // Smoke particles
    for (let i = 0; i < 15; i++) {
        const p = new Particle(x, y, '#333333');
        p.speedX = (Math.random() - 0.5) * 4;
        p.speedY = -2 - Math.random() * 4;
        p.size = 10 + Math.random() * 10;
        p.life = 1.5;
        particles.push(p);
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
    powerUps = [];
    cubeFragments = [];
    score = 0;
    distanceTraveled = 0;
    gameStartTime = Date.now(); // Reset timer
    timeSurvived = 0;
    coinsCollectedThisRun = 0; // Reset coins for this run

    const levelConfig = LEVELS[currentLevel] || LEVELS[1];
    gameSpeed = levelConfig.startSpeed;
    smoothGameSpeed = levelConfig.startSpeed;
    targetGameSpeed = levelConfig.startSpeed;
    lastTime = 0; // Reset delta time tracking

    slowMotionFactor = 1;
    finishLine = null;
    playerExploded = false;
    shieldCount = 0;
    isBoosting = false;
    boostTimer = 0;
    safeModeTimer = 0;

    document.getElementById('score').innerText = score;
    document.getElementById('current-level-num').innerText = currentLevel;
    document.getElementById('game-canvas').classList.remove('wasted-effect');
    document.getElementById('wasted-screen').classList.remove('active');
    updateShieldUI();

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
        // Keep player on ground if grounded, or adjust relative position
        if (player.isGrounded) {
            player.y = canvas.height - GROUND_HEIGHT - player.size;
        } else {
            if (player.y > canvas.height - GROUND_HEIGHT - player.size) {
                player.y = canvas.height - GROUND_HEIGHT - player.size;
            }
        }
    }
    // Fix obstacle positions
    if (obstacles) {
        obstacles.forEach(obs => {
            // Recalculate Y based on type
            if (obs.type === 'SAW') {
                obs.y = canvas.height - GROUND_HEIGHT - obs.h / 2;
            } else {
                obs.y = canvas.height - GROUND_HEIGHT - obs.h;
            }
        });
    }
    // Fix finish line
    if (finishLine) {
        finishLine.h = canvas.height - GROUND_HEIGHT;
    }
}

function checkCollisions() {
    const pRect = {
        x: player.x + 5,
        y: player.y + 5,
        w: player.size - 10,
        h: player.size - 10
    };

    // Power-up Collisions
    for (let p of powerUps) {
        if (p.markedForDeletion) continue;
        const dx = (player.x + player.size / 2) - (p.x + p.size / 2);
        const dy = (player.y + player.size / 2) - (p.y + p.size / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < player.size / 2 + p.size / 2) {
            p.markedForDeletion = true;
            if (p.type === 'HEART') {
                if (shieldCount < 3) {
                    shieldCount++;
                    updateShieldUI();
                    createParticles(player.x, player.y, 10, '#ff0055');
                    soundManager.playPowerup();
                }
            } else if (p.type === 'BOOST') {
                isBoosting = true;
                boostTimer = 300; // 5 seconds at 60fps
                createParticles(player.x, player.y, 20, '#00f3ff');
                soundManager.playPowerup();
            } else if (p.type === 'COIN') {
                coins += 10;
                coinsCollectedThisRun += 10; // Track for this run
                createParticles(player.x, player.y, 5, '#ffd700');
                saveProgress(); // Save immediately
                updateUI();
                soundManager.playCoin();
            } else if (p.type === 'BOMB') {
                // BOOM! Launch player high into air
                player.dy = -50;
                player.isGrounded = false;
                player.canDoubleJump = true; // Give them double jump after bomb

                // Only clear obstacles currently on screen (not future ones)
                obstacles.forEach(obs => {
                    if (obs.x < canvas.width) {
                        obs.markedForDeletion = true;
                        createParticles(obs.x + obs.w / 2, obs.y + obs.h / 2, 5, '#ff6600');
                    }
                });

                // EXPLOSION EFFECT!
                createExplosion(p.x + p.size / 2, p.y + p.size / 2);
                soundManager.playBomb();
            }
        }
    }

    if (finishLine) {
        if (pRect.x + pRect.w > finishLine.x) {
            levelComplete();
            return;
        }
    }

    if (isBoosting) return; // Invincible while boosting

    for (let obs of obstacles) {
        // Skip laser if it's off
        if (obs.type === 'LASER' && !obs.isActive()) {
            continue;
        }
        
        let obsRect = {
            x: obs.x + 5,
            y: obs.y + 5,
            w: obs.w - 10,
            h: obs.h - 10
        };

        let collision = false;

        if (obs.type === 'SAW' || obs.type === 'MOVING_SAW') {
            // Circle collision for saws
            const dx = (player.x + player.size / 2) - (obs.x + obs.w / 2);
            const dy = (player.y + player.size / 2) - (obs.y + obs.h / 2);
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < (player.size / 2 + obs.w / 2 - 10)) {
                collision = true;
            }
        } else if (obs.type === 'LASER') {
            // Thin hitbox for laser
            if (
                pRect.x < obs.x + obs.w + 5 &&
                pRect.x + pRect.w > obs.x - 5 &&
                pRect.y < obs.y + obs.h &&
                pRect.y + pRect.h > obs.y
            ) {
                collision = true;
            }
        } else {
            // AABB for blocks/spikes/pillars
            if (
                pRect.x < obsRect.x + obsRect.w &&
                pRect.x + pRect.w > obsRect.x &&
                pRect.y < obsRect.y + obsRect.h &&
                pRect.y + pRect.h > obsRect.y
            ) {
                collision = true;
            }
        }

        if (collision) {
            // Platform Logic for BLOCKS
            if (obs.type === 'BLOCK') {
                // Check if landing on top
                // Player bottom is close to Obstacle Top
                // Player must be falling (dy >= 0)
                // Player must be above the obstacle center roughly
                const playerBottom = player.y + player.size;
                const obsTop = obs.y;

                // Allow landing if we are falling and our bottom is near the top
                // and we are not too deep inside
                if (player.dy >= 0 && playerBottom <= obsTop + 20) {
                    player.y = obsTop - player.size;
                    player.dy = 0;
                    player.isGrounded = true;
                    player.canDoubleJump = true; // Reset double jump on landing
                    // Snap rotation
                    const snap = Math.round(player.rotation / 90) * 90;
                    player.rotation = snap;
                    return; // Safe landing
                }
            }

            // If we are here, it's a deadly collision
            if (shieldCount > 0) {
                shieldCount--;
                updateShieldUI();
                obs.markedForDeletion = true; // Destroy obstacle
                createParticles(obs.x, obs.y, 10, '#fff');
                slowMotionFactor = 0.5; // Brief slowmo impact
                setTimeout(() => slowMotionFactor = 1, 500);
            } else {
                if (landingGracePeriod > 0) {
                    // Safe landing logic
                    obs.markedForDeletion = true;
                    createParticles(obs.x, obs.y, 10, '#fff');
                } else {
                    gameOver();
                }
            }
        }
    }
}

// Economy & Unlocks
let coins = 0;
let highScore = 0;
let unlockedColors = ['#00f3ff'];
let unlockedShapes = ['square'];
let unlockedBackgrounds = ['default', 'space'];
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
        'circle': 1,
        'triangle': 1,
        'diamond': 1,
        'hexagon': 2,
        'star': 5
    },
    backgrounds: {
        'default': 0,
        'space': 0,
        'midnight': 100,
        'forest': 150,
        'ocean': 200,
        'desert': 250,
        'arctic': 300,
        'twilight': 350,
        'mountain': 400,
        'cherry': 500,
        'underwater': 600,
        'cosmos': 750,
        'aurora': 850,
        'volcanic': 1000,
        'crystal': 1200,
        'storm': 1400,
        'synthwave': 1600,
        'ethereal': 2000,
        'firefly': 2500,
        'northern': 3000
    }
};


function gameOver() {
    if (gameState === 'GAMEOVER') return;
    gameState = 'GAMEOVER';

    slowMotionFactor = 0.1;
    canRestart = false;
    deathTime = Date.now();
    soundManager.pause(); // Pause music on death
    soundManager.playDeath();

    // Economy Update
    // coins += score; // Removed
    if (score > highScore) {
        highScore = score;
    }
    saveProgress();
    updateUI();

    // Update Game Over Stats
    document.getElementById('go-score').innerText = score;
    document.getElementById('go-high-score').innerText = highScore;
    document.getElementById('go-coins').innerText = coinsCollectedThisRun; // Show coins from THIS run

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
    // Don't stop music on level complete - keep it playing!
    soundManager.playWin();

    // Economy Update
    if (score > highScore) {
        highScore = score;
    }

    // Unlock next level IMMEDIATELY when crossing finish line
    if (currentLevel < 10 && currentLevel >= unlockedLevels) {
        unlockedLevels = currentLevel + 1;
        document.getElementById('level-complete-message').innerText = `Level ${unlockedLevels} Unlocked!`;
    } else if (currentLevel === 10) {
        document.getElementById('level-complete-message').innerText = 'All Levels Complete!';
    } else {
        document.getElementById('level-complete-message').innerText = 'Level Complete!';
    }
    
    // Save progress RIGHT AWAY so it persists
    saveProgress();
    updateUI();

    createParticles(player.x + player.size / 2, player.y + player.size / 2, 100, '#00ff00');
    document.getElementById('current-level-display').classList.remove('visible');
    document.getElementById('level-complete-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
}

function update(dt = 1) {
    if (gameState !== 'PLAYING') return;

    // Calculate distance-based score
    score = Math.floor(distanceTraveled / 100);
    document.getElementById('score').innerText = score;

    player.update(dt);

    // Speed Progression - Calculate target speed
    const levelConfig = LEVELS[currentLevel];
    const progress = Math.min(distanceTraveled / levelConfig.length, 1);
    // Use easeOutQuad for smoother speed curve
    const easedProgress = 1 - (1 - progress) * (1 - progress);
    targetGameSpeed = levelConfig.startSpeed + (levelConfig.maxSpeed - levelConfig.startSpeed) * easedProgress;
    
    // Smoothly interpolate to target speed (prevents jerky speed changes)
    smoothGameSpeed += (targetGameSpeed - smoothGameSpeed) * SPEED_LERP_FACTOR * dt;
    gameSpeed = smoothGameSpeed;

    distanceTraveled += gameSpeed * slowMotionFactor * dt;
    bgOffset -= gameSpeed * 0.2 * slowMotionFactor * dt; // Parallax background
    bgTime += 0.01 * dt;

    // Power-up Timers (adjusted for delta time)
    if (isBoosting) {
        boostTimer -= dt;
        if (boostTimer <= 0) {
            isBoosting = false;
            player.canDoubleJump = true; // Give double jump when boost ends

            // Only clear obstacles currently visible on screen
            obstacles.forEach(obs => {
                if (obs.x < canvas.width) {
                    createParticles(obs.x + obs.w / 2, obs.y + obs.h / 2, 5, '#fff');
                    obs.markedForDeletion = true;
                }
            });
        }
    }
    if (safeModeTimer > 0) safeModeTimer -= dt;
    if (landingGracePeriod > 0) landingGracePeriod -= dt;

    spawnObstacle();
    obstacles.forEach(obs => obs.update(dt));
    obstacles = obstacles.filter(obs => !obs.markedForDeletion);

    powerUps.forEach(p => p.update(dt));
    powerUps = powerUps.filter(p => !p.markedForDeletion);

    if (finishLine) {
        finishLine.update(dt);
    }

    // Limit particles for performance
    if (particles.length > 200) {
        particles = particles.slice(-150);
    }
    particles.forEach(p => p.update(dt));
    particles = particles.filter(p => p.life > 0);

    floorPatternOffset -= gameSpeed * slowMotionFactor * dt;
    if (floorPatternOffset <= -40) floorPatternOffset = 0;

    checkCollisions();
}


function drawBackground() {
    // Different backgrounds based on currentBackground
    switch (currentBackground) {
        case 'aurora':
            // Northern Lights - Magical aurora borealis
            const auroraGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            auroraGrad.addColorStop(0, '#0a0a20');
            auroraGrad.addColorStop(0.4, '#0f1a30');
            auroraGrad.addColorStop(1, '#1a2040');
            ctx.fillStyle = auroraGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Stars
            ctx.fillStyle = '#fff';
            for (let i = 0; i < 100; i++) {
                const x = (i * 73) % canvas.width;
                const y = (i * 47) % (canvas.height * 0.6);
                ctx.globalAlpha = 0.3 + Math.sin(bgTime * 2 + i) * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, Math.random() * 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Aurora waves
            for (let wave = 0; wave < 3; wave++) {
                ctx.save();
                ctx.globalAlpha = 0.3 - wave * 0.08;
                const hue = (bgTime * 20 + wave * 40) % 360;
                ctx.strokeStyle = `hsl(${hue}, 80%, 60%)`;
                ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
                ctx.shadowBlur = 30;
                ctx.lineWidth = 40 - wave * 10;
                ctx.beginPath();
                for (let x = 0; x <= canvas.width; x += 20) {
                    const y = canvas.height * 0.3 + 
                        Math.sin((x + bgOffset) * 0.01 + wave) * 50 +
                        Math.sin((x + bgOffset) * 0.02 + bgTime + wave) * 30;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.restore();
            }

            // Snowy mountains
            ctx.fillStyle = '#1a2a40';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width + 100; i += 80) {
                const x = (i + bgOffset * 0.3) % (canvas.width + 200) - 100;
                const h = 150 + Math.sin(i * 0.02) * 80;
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
                ctx.lineTo(x + 40, canvas.height - GROUND_HEIGHT - h + 30);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();

            // Snow caps
            ctx.fillStyle = '#ddeeff';
            ctx.beginPath();
            for (let i = 0; i <= canvas.width + 100; i += 80) {
                const x = (i + bgOffset * 0.3) % (canvas.width + 200) - 100;
                const h = 150 + Math.sin(i * 0.02) * 80;
                ctx.moveTo(x - 10, canvas.height - GROUND_HEIGHT - h + 20);
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
                ctx.lineTo(x + 10, canvas.height - GROUND_HEIGHT - h + 15);
            }
            ctx.fill();
            break;

        case 'volcanic':
            // Volcanic hellscape
            const volcanicGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            volcanicGrad.addColorStop(0, '#1a0505');
            volcanicGrad.addColorStop(0.5, '#2a0a0a');
            volcanicGrad.addColorStop(1, '#4a1010');
            ctx.fillStyle = volcanicGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Lava glow from below
            const lavaGlow = ctx.createRadialGradient(
                canvas.width / 2, canvas.height + 100, 0,
                canvas.width / 2, canvas.height, canvas.width
            );
            lavaGlow.addColorStop(0, 'rgba(255, 100, 0, 0.4)');
            lavaGlow.addColorStop(1, 'rgba(255, 50, 0, 0)');
            ctx.fillStyle = lavaGlow;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Floating ash particles
            ctx.fillStyle = '#555';
            for (let i = 0; i < 40; i++) {
                const x = (i * 67 + bgOffset * 0.5) % canvas.width;
                const baseY = (i * 89) % canvas.height;
                const y = (baseY + bgTime * 30) % (canvas.height + 50) - 50;
                ctx.globalAlpha = 0.3 + Math.random() * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, 1 + Math.random() * 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Ember particles rising
            for (let i = 0; i < 20; i++) {
                const x = (i * 97 + Math.sin(bgTime + i) * 30) % canvas.width;
                const y = canvas.height - ((bgTime * 40 + i * 50) % (canvas.height * 0.8));
                ctx.fillStyle = `hsl(${20 + Math.random() * 20}, 100%, ${50 + Math.random() * 30}%)`;
                ctx.shadowColor = '#ff4400';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(x, y, 2 + Math.random() * 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;

            // Dark volcanic mountains
            ctx.fillStyle = '#0a0505';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 60) {
                const x = (i + bgOffset * 0.2) % (canvas.width + 120) - 60;
                const h = 100 + Math.abs(Math.sin(i * 0.015)) * 150;
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();

            // Lava rivers
            ctx.strokeStyle = '#ff4400';
            ctx.shadowColor = '#ff6600';
            ctx.shadowBlur = 15;
            ctx.lineWidth = 3;
            for (let river = 0; river < 2; river++) {
                ctx.beginPath();
                const startX = (river * 400 + bgOffset * 0.3) % (canvas.width + 200) - 100;
                ctx.moveTo(startX, canvas.height - GROUND_HEIGHT - 180);
                ctx.quadraticCurveTo(
                    startX + 50, canvas.height - GROUND_HEIGHT - 100,
                    startX + 30, canvas.height - GROUND_HEIGHT
                );
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
            break;

        case 'cyberpunk':
            // Cyberpunk city
            const cyberGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            cyberGrad.addColorStop(0, '#0a0015');
            cyberGrad.addColorStop(0.6, '#150025');
            cyberGrad.addColorStop(1, '#200030');
            ctx.fillStyle = cyberGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Distant city buildings
            for (let layer = 0; layer < 3; layer++) {
                const alpha = 0.2 + layer * 0.15;
                ctx.globalAlpha = alpha;
                for (let i = 0; i < canvas.width + 200; i += 40 + layer * 20) {
                    const x = (i + bgOffset * (0.1 + layer * 0.1)) % (canvas.width + 200) - 100;
                    const h = 100 + Math.random() * 200 + layer * 50;
                    const w = 20 + Math.random() * 30;
                    
                    ctx.fillStyle = `rgb(${20 + layer * 10}, ${10 + layer * 5}, ${30 + layer * 10})`;
                    ctx.fillRect(x, canvas.height - GROUND_HEIGHT - h, w, h);
                    
                    // Windows
                    if (layer === 2) {
                        for (let wy = canvas.height - GROUND_HEIGHT - h + 10; wy < canvas.height - GROUND_HEIGHT - 10; wy += 15) {
                            for (let wx = x + 3; wx < x + w - 5; wx += 8) {
                                if (Math.random() > 0.3) {
                                    ctx.fillStyle = Math.random() > 0.5 ? '#00f3ff' : '#ff00ff';
                                    ctx.fillRect(wx, wy, 4, 6);
                                }
                            }
                        }
                    }
                }
            }
            ctx.globalAlpha = 1;

            // Neon signs
            ctx.shadowBlur = 20;
            const signs = [
                { x: (200 + bgOffset * 0.4) % (canvas.width + 300) - 150, y: canvas.height * 0.4, color: '#ff0066', text: 'ネオン' },
                { x: (600 + bgOffset * 0.3) % (canvas.width + 300) - 150, y: canvas.height * 0.3, color: '#00ffff', text: '未来' }
            ];
            ctx.font = 'bold 24px sans-serif';
            ctx.textAlign = 'center';
            for (let sign of signs) {
                ctx.shadowColor = sign.color;
                ctx.fillStyle = sign.color;
                ctx.fillText(sign.text, sign.x, sign.y);
            }
            ctx.shadowBlur = 0;

            // Flying vehicles
            for (let i = 0; i < 5; i++) {
                const x = (i * 300 + bgOffset * 2) % (canvas.width + 200) - 100;
                const y = 100 + i * 60 + Math.sin(bgTime + i) * 20;
                ctx.fillStyle = '#00f3ff';
                ctx.shadowColor = '#00f3ff';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.ellipse(x, y, 15, 5, 0, 0, Math.PI * 2);
                ctx.fill();
                // Trail
                ctx.strokeStyle = 'rgba(0, 243, 255, 0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x - 15, y);
                ctx.lineTo(x - 50, y);
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
            break;

        case 'crystal':
            // Crystal cave
            const crystalGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            crystalGrad.addColorStop(0, '#0a0520');
            crystalGrad.addColorStop(0.5, '#0f0830');
            crystalGrad.addColorStop(1, '#150a40');
            ctx.fillStyle = crystalGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Stalactites from ceiling
            for (let i = 0; i < canvas.width; i += 60) {
                const x = (i + bgOffset * 0.2) % (canvas.width + 120) - 60;
                const h = 50 + Math.sin(i * 0.1) * 40;
                const hue = (i * 2 + bgTime * 10) % 360;
                
                ctx.fillStyle = `hsla(${hue}, 70%, 30%, 0.8)`;
                ctx.beginPath();
                ctx.moveTo(x - 15, 0);
                ctx.lineTo(x, h);
                ctx.lineTo(x + 15, 0);
                ctx.fill();
            }

            // Glowing crystals
            const crystals = [
                { x: 0.2, y: 0.5, size: 80, hue: 280 },
                { x: 0.5, y: 0.4, size: 60, hue: 200 },
                { x: 0.8, y: 0.55, size: 70, hue: 320 },
                { x: 0.35, y: 0.6, size: 50, hue: 180 }
            ];
            
            for (let c of crystals) {
                const cx = (c.x * canvas.width + bgOffset * 0.3) % (canvas.width + 200) - 100;
                const cy = canvas.height * c.y;
                const hue = (c.hue + bgTime * 5) % 360;
                
                ctx.save();
                ctx.translate(cx, cy);
                ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
                ctx.shadowBlur = 30;
                
                // Crystal shape
                ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.6)`;
                ctx.beginPath();
                ctx.moveTo(0, -c.size);
                ctx.lineTo(c.size * 0.3, -c.size * 0.3);
                ctx.lineTo(c.size * 0.2, c.size * 0.5);
                ctx.lineTo(-c.size * 0.2, c.size * 0.5);
                ctx.lineTo(-c.size * 0.3, -c.size * 0.3);
                ctx.closePath();
                ctx.fill();
                
                // Inner glow
                ctx.fillStyle = `hsla(${hue}, 100%, 80%, 0.4)`;
                ctx.beginPath();
                ctx.moveTo(0, -c.size * 0.7);
                ctx.lineTo(c.size * 0.15, -c.size * 0.2);
                ctx.lineTo(-c.size * 0.15, -c.size * 0.2);
                ctx.closePath();
                ctx.fill();
                
                ctx.restore();
            }

            // Sparkles
            for (let i = 0; i < 30; i++) {
                const x = (i * 97 + bgOffset * 0.1) % canvas.width;
                const y = (i * 67) % canvas.height;
                ctx.globalAlpha = 0.3 + Math.sin(bgTime * 3 + i * 2) * 0.3;
                ctx.fillStyle = `hsl(${(i * 30 + bgTime * 20) % 360}, 100%, 80%)`;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            break;

        case 'storm':
            // Dark storm
            const stormGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            stormGrad.addColorStop(0, '#0a0a15');
            stormGrad.addColorStop(0.5, '#151520');
            stormGrad.addColorStop(1, '#202030');
            ctx.fillStyle = stormGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Dark clouds
            for (let layer = 0; layer < 2; layer++) {
                ctx.fillStyle = `rgba(30, 30, 40, ${0.6 - layer * 0.2})`;
                for (let i = 0; i < canvas.width + 300; i += 100) {
                    const x = (i + bgOffset * (0.3 + layer * 0.2)) % (canvas.width + 300) - 150;
                    const y = 50 + layer * 80 + Math.sin(i * 0.01) * 20;
                    ctx.beginPath();
                    ctx.arc(x, y, 60, 0, Math.PI * 2);
                    ctx.arc(x + 50, y + 10, 50, 0, Math.PI * 2);
                    ctx.arc(x + 100, y, 55, 0, Math.PI * 2);
                    ctx.arc(x + 50, y - 20, 45, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Lightning flash
            if (Math.sin(bgTime * 0.5) > 0.98) {
                ctx.fillStyle = 'rgba(200, 200, 255, 0.3)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            // Lightning bolt (occasional)
            if (Math.sin(bgTime * 0.3) > 0.95) {
                ctx.strokeStyle = '#aaccff';
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 30;
                ctx.lineWidth = 3;
                ctx.beginPath();
                const lx = (bgTime * 100) % canvas.width;
                ctx.moveTo(lx, 0);
                let ly = 0;
                while (ly < canvas.height * 0.6) {
                    ly += 30 + Math.random() * 20;
                    ctx.lineTo(lx + (Math.random() - 0.5) * 50, ly);
                }
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            // Rain
            ctx.strokeStyle = 'rgba(150, 180, 255, 0.3)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 100; i++) {
                const x = (i * 37 + bgTime * 200) % canvas.width;
                const y = (i * 23 + bgTime * 500) % canvas.height;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x - 5, y + 20);
                ctx.stroke();
            }
            break;

        case 'synthwave':
            // 80s Synthwave
            const synthGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            synthGrad.addColorStop(0, '#0f0030');
            synthGrad.addColorStop(0.4, '#2a0050');
            synthGrad.addColorStop(0.6, '#ff0080');
            synthGrad.addColorStop(0.8, '#ff8000');
            synthGrad.addColorStop(1, '#ffff00');
            ctx.fillStyle = synthGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Sun
            ctx.save();
            const sunY = canvas.height * 0.55;
            const sunGrad = ctx.createLinearGradient(0, sunY - 100, 0, sunY + 100);
            sunGrad.addColorStop(0, '#ff0080');
            sunGrad.addColorStop(1, '#ff8000');
            ctx.fillStyle = sunGrad;
            ctx.beginPath();
            ctx.arc(canvas.width / 2, sunY, 100, 0, Math.PI * 2);
            ctx.fill();
            
            // Sun lines
            ctx.fillStyle = '#0f0030';
            for (let i = 0; i < 8; i++) {
                const lineY = sunY - 80 + i * 20;
                if (lineY > sunY - 100 && lineY < sunY + 100) {
                    ctx.fillRect(0, lineY, canvas.width, 3 + i * 0.5);
                }
            }
            ctx.restore();

            // Grid floor
            ctx.strokeStyle = '#ff00ff';
            ctx.shadowColor = '#ff00ff';
            ctx.shadowBlur = 5;
            ctx.lineWidth = 1;
            
            // Horizontal lines with perspective
            const horizon = canvas.height * 0.65;
            for (let i = 0; i < 20; i++) {
                const y = horizon + Math.pow(i, 1.5) * 8;
                if (y < canvas.height) {
                    ctx.globalAlpha = 1 - (y - horizon) / (canvas.height - horizon);
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(canvas.width, y);
                    ctx.stroke();
                }
            }
            
            // Vertical lines with perspective
            ctx.globalAlpha = 1;
            for (let i = -10; i < 20; i++) {
                const baseX = canvas.width / 2 + (i * 80 + bgOffset) % (canvas.width + 400) - 200;
                ctx.beginPath();
                ctx.moveTo(baseX, horizon);
                const endX = canvas.width / 2 + (baseX - canvas.width / 2) * 3;
                ctx.lineTo(endX, canvas.height);
                ctx.stroke();
            }
            ctx.shadowBlur = 0;

            // Palm tree silhouettes
            ctx.fillStyle = '#000020';
            for (let i = 0; i < 3; i++) {
                const px = (i * 400 + bgOffset * 0.5) % (canvas.width + 400) - 200;
                const py = canvas.height * 0.6;
                
                // Trunk
                ctx.fillRect(px - 5, py, 10, canvas.height - py);
                
                // Leaves
                ctx.save();
                ctx.translate(px, py);
                for (let leaf = 0; leaf < 7; leaf++) {
                    ctx.rotate(Math.PI / 3.5);
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.quadraticCurveTo(40, -20, 80, 10);
                    ctx.quadraticCurveTo(40, 0, 0, 0);
                    ctx.fill();
                }
                ctx.restore();
            }
            break;

        case 'space':
            // Enhanced Space (kept as requested)
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Distant Stars
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 150; i++) {
                const x = (i * 79 + bgOffset * 0.05) % canvas.width;
                const y = (i * 123) % canvas.height;
                const size = Math.random() * 1.5;
                const alpha = Math.random();
                ctx.globalAlpha = alpha;
                ctx.fillRect(x, y, size, size);
            }

            // Nebula
            ctx.globalAlpha = 0.15;
            const nebulaGrad = ctx.createRadialGradient(
                canvas.width * 0.3, canvas.height * 0.4, 0,
                canvas.width * 0.3, canvas.height * 0.4, 300
            );
            nebulaGrad.addColorStop(0, '#ff0088');
            nebulaGrad.addColorStop(0.5, '#8800ff');
            nebulaGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = nebulaGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Planets
            ctx.globalAlpha = 1;
            const px = (canvas.width * 0.8 + bgOffset * 0.1) % (canvas.width + 200) - 100;
            const py = canvas.height * 0.3;

            // Planet Ring
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(-0.5);
            ctx.beginPath();
            ctx.ellipse(0, 0, 90, 20, 0, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(100, 100, 255, 0.5)';
            ctx.lineWidth = 10;
            ctx.stroke();
            ctx.restore();

            // Planet Body
            ctx.beginPath();
            ctx.arc(px, py, 50, 0, Math.PI * 2);
            const planetGrad = ctx.createRadialGradient(px - 10, py - 10, 0, px, py, 50);
            planetGrad.addColorStop(0, '#ff0055');
            planetGrad.addColorStop(1, '#550022');
            ctx.fillStyle = planetGrad;
            ctx.fill();

            // Shooting star
            if (Math.sin(bgTime * 0.2) > 0.9) {
                ctx.strokeStyle = '#fff';
                ctx.shadowColor = '#fff';
                ctx.shadowBlur = 10;
                ctx.lineWidth = 2;
                const starX = (bgTime * 300) % (canvas.width + 200);
                ctx.beginPath();
                ctx.moveTo(starX, 100);
                ctx.lineTo(starX - 80, 150);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
            break;

        case 'midnight':
            // Deep midnight sky with moon and stars
            const midnightGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            midnightGrad.addColorStop(0, '#0a0a1a');
            midnightGrad.addColorStop(0.5, '#0f1525');
            midnightGrad.addColorStop(1, '#1a2035');
            ctx.fillStyle = midnightGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Soft stars
            for (let i = 0; i < 80; i++) {
                const x = (i * 71) % canvas.width;
                const y = (i * 53) % (canvas.height * 0.7);
                ctx.globalAlpha = 0.2 + Math.sin(bgTime * 1.5 + i) * 0.2;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x, y, 0.5 + (i % 3) * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Moon with glow
            const moonX = canvas.width * 0.8;
            const moonY = canvas.height * 0.2;
            ctx.save();
            ctx.shadowColor = '#aabbff';
            ctx.shadowBlur = 50;
            ctx.fillStyle = '#e8e8f0';
            ctx.beginPath();
            ctx.arc(moonX, moonY, 40, 0, Math.PI * 2);
            ctx.fill();
            // Moon craters
            ctx.fillStyle = '#d0d0e0';
            ctx.beginPath();
            ctx.arc(moonX - 10, moonY - 5, 8, 0, Math.PI * 2);
            ctx.arc(moonX + 15, moonY + 10, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            
            // Gentle hills
            ctx.fillStyle = '#0d1020';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 50) {
                const h = 80 + Math.sin((i + bgOffset * 0.2) * 0.008) * 40;
                ctx.lineTo(i, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            break;
            
        case 'forest':
            // Peaceful dark forest
            const forestGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            forestGrad.addColorStop(0, '#0a1510');
            forestGrad.addColorStop(0.6, '#0f1f18');
            forestGrad.addColorStop(1, '#152820');
            ctx.fillStyle = forestGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Background trees
            ctx.fillStyle = '#081510';
            for (let i = 0; i < canvas.width + 100; i += 70) {
                const x = (i + bgOffset * 0.15) % (canvas.width + 140) - 70;
                const h = 150 + Math.sin(i * 0.05) * 50;
                ctx.beginPath();
                ctx.moveTo(x, canvas.height - GROUND_HEIGHT);
                ctx.lineTo(x + 25, canvas.height - GROUND_HEIGHT - h);
                ctx.lineTo(x + 50, canvas.height - GROUND_HEIGHT);
                ctx.fill();
            }
            
            // Foreground trees
            ctx.fillStyle = '#0a1a12';
            for (let i = 0; i < canvas.width + 80; i += 90) {
                const x = (i + bgOffset * 0.25) % (canvas.width + 160) - 80;
                const h = 180 + Math.sin(i * 0.03) * 60;
                ctx.beginPath();
                ctx.moveTo(x, canvas.height - GROUND_HEIGHT);
                ctx.lineTo(x + 30, canvas.height - GROUND_HEIGHT - h);
                ctx.lineTo(x + 60, canvas.height - GROUND_HEIGHT);
                ctx.fill();
            }
            
            // Fireflies
            for (let i = 0; i < 15; i++) {
                const x = (i * 97 + Math.sin(bgTime * 0.5 + i) * 20) % canvas.width;
                const y = canvas.height * 0.4 + (i * 37) % (canvas.height * 0.4);
                ctx.globalAlpha = 0.3 + Math.sin(bgTime * 2 + i * 3) * 0.3;
                ctx.fillStyle = '#aaffaa';
                ctx.shadowColor = '#aaffaa';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            break;
            
        case 'ocean':
            // Deep calm ocean
            const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            oceanGrad.addColorStop(0, '#0a1525');
            oceanGrad.addColorStop(0.4, '#0f2035');
            oceanGrad.addColorStop(1, '#1a3550');
            ctx.fillStyle = oceanGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Distant waves
            ctx.globalAlpha = 0.15;
            for (let wave = 0; wave < 5; wave++) {
                ctx.strokeStyle = '#4080a0';
                ctx.lineWidth = 2;
                ctx.beginPath();
                for (let x = 0; x <= canvas.width; x += 10) {
                    const y = canvas.height * (0.3 + wave * 0.1) + 
                        Math.sin((x + bgOffset * 0.5 + wave * 100) * 0.02) * 15;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            
            // Fish silhouettes
            ctx.fillStyle = 'rgba(20, 50, 70, 0.6)';
            for (let i = 0; i < 8; i++) {
                const x = (i * 180 + bgOffset * 0.8) % (canvas.width + 100) - 50;
                const y = canvas.height * 0.5 + (i * 50) % 150;
                ctx.save();
                ctx.translate(x, y);
                ctx.beginPath();
                ctx.ellipse(0, 0, 15, 8, 0, 0, Math.PI * 2);
                ctx.moveTo(15, 0);
                ctx.lineTo(25, -8);
                ctx.lineTo(25, 8);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            
            // Light rays from surface
            ctx.globalAlpha = 0.05;
            for (let i = 0; i < 6; i++) {
                const x = (i * 200 + bgOffset * 0.1) % (canvas.width + 200) - 100;
                ctx.fillStyle = '#6090b0';
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x + 30, 0);
                ctx.lineTo(x + 80, canvas.height);
                ctx.lineTo(x + 20, canvas.height);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'desert':
            // Warm desert night
            const desertGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            desertGrad.addColorStop(0, '#1a1520');
            desertGrad.addColorStop(0.4, '#2a2030');
            desertGrad.addColorStop(0.7, '#3a2a35');
            desertGrad.addColorStop(1, '#4a3540');
            ctx.fillStyle = desertGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Stars
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 60; i++) {
                const x = (i * 67) % canvas.width;
                const y = (i * 41) % (canvas.height * 0.5);
                ctx.globalAlpha = 0.3 + Math.random() * 0.3;
                ctx.beginPath();
                ctx.arc(x, y, 0.5 + Math.random(), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Sand dunes - back
            ctx.fillStyle = '#2a2025';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 30) {
                const h = 100 + Math.sin((i + bgOffset * 0.1) * 0.01) * 60;
                ctx.lineTo(i, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            
            // Sand dunes - front
            ctx.fillStyle = '#352530';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 40) {
                const h = 60 + Math.sin((i + bgOffset * 0.2) * 0.015) * 40;
                ctx.lineTo(i, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            break;
            
        case 'arctic':
            // Calm arctic landscape
            const arcticGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            arcticGrad.addColorStop(0, '#101525');
            arcticGrad.addColorStop(0.5, '#152030');
            arcticGrad.addColorStop(1, '#1a2a40');
            ctx.fillStyle = arcticGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Subtle aurora
            ctx.globalAlpha = 0.15;
            ctx.strokeStyle = '#40ff80';
            ctx.lineWidth = 60;
            ctx.beginPath();
            for (let x = 0; x <= canvas.width; x += 20) {
                const y = canvas.height * 0.25 + Math.sin((x + bgOffset * 0.3) * 0.01 + bgTime * 0.3) * 30;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
            
            // Snow/ice mountains
            ctx.fillStyle = '#1a2535';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width + 100; i += 80) {
                const x = (i + bgOffset * 0.15) % (canvas.width + 160) - 80;
                const h = 120 + Math.sin(i * 0.02) * 60;
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
                ctx.lineTo(x + 40, canvas.height - GROUND_HEIGHT - h + 40);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            
            // Snow caps
            ctx.fillStyle = '#3a4a60';
            for (let i = 0; i <= canvas.width + 100; i += 80) {
                const x = (i + bgOffset * 0.15) % (canvas.width + 160) - 80;
                const h = 120 + Math.sin(i * 0.02) * 60;
                ctx.beginPath();
                ctx.moveTo(x - 10, canvas.height - GROUND_HEIGHT - h + 25);
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
                ctx.lineTo(x + 10, canvas.height - GROUND_HEIGHT - h + 20);
                ctx.fill();
            }
            break;
            
        case 'twilight':
            // Purple/pink twilight
            const twilightGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            twilightGrad.addColorStop(0, '#1a1025');
            twilightGrad.addColorStop(0.3, '#2a1535');
            twilightGrad.addColorStop(0.6, '#3a2040');
            twilightGrad.addColorStop(1, '#2a1530');
            ctx.fillStyle = twilightGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Soft clouds
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = '#4a3050';
            for (let i = 0; i < canvas.width + 200; i += 150) {
                const x = (i + bgOffset * 0.2) % (canvas.width + 400) - 200;
                const y = canvas.height * 0.3 + Math.sin(i * 0.01) * 30;
                ctx.beginPath();
                ctx.arc(x, y, 50, 0, Math.PI * 2);
                ctx.arc(x + 40, y + 10, 40, 0, Math.PI * 2);
                ctx.arc(x + 80, y, 45, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Distant hills
            ctx.fillStyle = '#1a1020';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 40) {
                const h = 100 + Math.sin((i + bgOffset * 0.1) * 0.01) * 50;
                ctx.lineTo(i, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            
            // First star of evening
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.arc(canvas.width * 0.7, canvas.height * 0.15, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
            
        case 'mountain':
            // Mountain mist silhouettes
            const mountainGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            mountainGrad.addColorStop(0, '#101520');
            mountainGrad.addColorStop(0.5, '#1a2030');
            mountainGrad.addColorStop(1, '#252a35');
            ctx.fillStyle = mountainGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Distant mountains (lightest)
            ctx.fillStyle = '#2a3040';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width + 100; i += 120) {
                const x = (i + bgOffset * 0.08) % (canvas.width + 200) - 100;
                const h = 200 + Math.sin(i * 0.01) * 80;
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
                ctx.lineTo(x + 60, canvas.height - GROUND_HEIGHT - h + 60);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            
            // Mid mountains
            ctx.fillStyle = '#202530';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width + 80; i += 100) {
                const x = (i + bgOffset * 0.12) % (canvas.width + 160) - 80;
                const h = 150 + Math.sin(i * 0.015) * 60;
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            
            // Mist layer
            ctx.globalAlpha = 0.3;
            const mistGrad = ctx.createLinearGradient(0, canvas.height * 0.6, 0, canvas.height * 0.8);
            mistGrad.addColorStop(0, 'transparent');
            mistGrad.addColorStop(0.5, '#3a4050');
            mistGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = mistGrad;
            ctx.fillRect(0, canvas.height * 0.5, canvas.width, canvas.height * 0.4);
            ctx.globalAlpha = 1;
            
            // Foreground mountains
            ctx.fillStyle = '#151a25';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width + 60; i += 80) {
                const x = (i + bgOffset * 0.18) % (canvas.width + 120) - 60;
                const h = 100 + Math.sin(i * 0.02) * 40;
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            break;
            
        case 'cherry':
            // Cherry blossom evening
            const cherryGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            cherryGrad.addColorStop(0, '#1a1020');
            cherryGrad.addColorStop(0.4, '#251525');
            cherryGrad.addColorStop(1, '#2a1a28');
            ctx.fillStyle = cherryGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Tree branches
            ctx.strokeStyle = '#1a1015';
            ctx.lineWidth = 8;
            for (let i = 0; i < 3; i++) {
                const startX = (i * 400 + bgOffset * 0.15) % (canvas.width + 300) - 150;
                ctx.beginPath();
                ctx.moveTo(startX, canvas.height - GROUND_HEIGHT);
                ctx.quadraticCurveTo(startX + 50, canvas.height * 0.5, startX + 100, canvas.height * 0.3);
                ctx.stroke();
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(startX + 60, canvas.height * 0.45);
                ctx.quadraticCurveTo(startX + 90, canvas.height * 0.35, startX + 130, canvas.height * 0.25);
                ctx.stroke();
            }
            ctx.lineWidth = 1;
            
            // Falling petals
            for (let i = 0; i < 25; i++) {
                const x = (i * 73 + bgOffset * 0.4 + Math.sin(bgTime + i) * 20) % canvas.width;
                const y = ((i * 47 + bgTime * 30) % (canvas.height + 50)) - 25;
                ctx.globalAlpha = 0.5 + Math.sin(bgTime + i) * 0.2;
                ctx.fillStyle = '#ffaacc';
                ctx.beginPath();
                ctx.ellipse(x, y, 4, 2, (bgTime + i) * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'underwater':
            // Deep underwater
            const underwaterGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            underwaterGrad.addColorStop(0, '#051525');
            underwaterGrad.addColorStop(0.5, '#0a2035');
            underwaterGrad.addColorStop(1, '#0f2540');
            ctx.fillStyle = underwaterGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Light rays
            ctx.globalAlpha = 0.08;
            for (let i = 0; i < 8; i++) {
                const x = (i * 150 + bgOffset * 0.05) % (canvas.width + 150) - 75;
                ctx.fillStyle = '#4080a0';
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x + 20, 0);
                ctx.lineTo(x + 60, canvas.height);
                ctx.lineTo(x + 10, canvas.height);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Bubbles
            for (let i = 0; i < 20; i++) {
                const x = (i * 83) % canvas.width;
                const y = canvas.height - ((bgTime * 25 + i * 60) % (canvas.height + 100));
                ctx.globalAlpha = 0.3;
                ctx.strokeStyle = '#5090b0';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(x, y, 3 + (i % 4) * 2, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            
            // Seaweed
            ctx.fillStyle = '#0a2025';
            for (let i = 0; i < canvas.width; i += 80) {
                const x = (i + bgOffset * 0.1) % (canvas.width + 80) - 40;
                ctx.beginPath();
                ctx.moveTo(x, canvas.height - GROUND_HEIGHT);
                for (let h = 0; h < 80; h += 10) {
                    ctx.lineTo(x + Math.sin((h + bgTime * 2) * 0.1) * 10, canvas.height - GROUND_HEIGHT - h);
                }
                ctx.lineTo(x, canvas.height - GROUND_HEIGHT);
                ctx.fill();
            }
            break;
            
        case 'cosmos':
            // Cosmic dust and galaxies
            const cosmosGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            cosmosGrad.addColorStop(0, '#050510');
            cosmosGrad.addColorStop(0.5, '#0a0815');
            cosmosGrad.addColorStop(1, '#080512');
            ctx.fillStyle = cosmosGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Cosmic dust clouds
            ctx.globalAlpha = 0.08;
            for (let i = 0; i < 5; i++) {
                const x = (i * 300 + bgOffset * 0.1) % (canvas.width + 400) - 200;
                const y = canvas.height * (0.2 + i * 0.15);
                const hue = (i * 60 + bgTime * 2) % 360;
                ctx.fillStyle = `hsl(${hue}, 50%, 40%)`;
                ctx.beginPath();
                ctx.arc(x, y, 100 + i * 20, 0, Math.PI * 2);
                ctx.arc(x + 80, y + 30, 80, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Stars
            for (let i = 0; i < 100; i++) {
                const x = (i * 71) % canvas.width;
                const y = (i * 53) % canvas.height;
                ctx.globalAlpha = 0.3 + Math.sin(bgTime + i * 0.5) * 0.2;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x, y, 0.5 + (i % 3) * 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Distant galaxy
            ctx.save();
            const galaxyX = (canvas.width * 0.6 + bgOffset * 0.05) % (canvas.width + 200) - 100;
            ctx.translate(galaxyX, canvas.height * 0.35);
            ctx.rotate(0.3);
            ctx.globalAlpha = 0.25;
            const galaxyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
            galaxyGrad.addColorStop(0, '#ffffff');
            galaxyGrad.addColorStop(0.3, '#aabbff');
            galaxyGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = galaxyGrad;
            ctx.beginPath();
            ctx.ellipse(0, 0, 80, 30, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            break;
            
        case 'ethereal':
            // Ethereal dreamscape
            const etherealGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            etherealGrad.addColorStop(0, '#0a0a18');
            etherealGrad.addColorStop(0.5, '#101025');
            etherealGrad.addColorStop(1, '#151530');
            ctx.fillStyle = etherealGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Floating orbs
            for (let i = 0; i < 8; i++) {
                const x = (i * 180 + bgOffset * 0.2 + Math.sin(bgTime * 0.5 + i) * 30) % (canvas.width + 100) - 50;
                const y = canvas.height * 0.3 + Math.sin(bgTime * 0.3 + i * 2) * 50 + (i * 40) % 200;
                const hue = (200 + i * 20 + bgTime * 5) % 360;
                
                ctx.globalAlpha = 0.2;
                ctx.fillStyle = `hsl(${hue}, 60%, 50%)`;
                ctx.shadowColor = `hsl(${hue}, 80%, 60%)`;
                ctx.shadowBlur = 30;
                ctx.beginPath();
                ctx.arc(x, y, 15 + (i % 3) * 5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            
            // Floating particles
            for (let i = 0; i < 40; i++) {
                const x = (i * 61 + bgOffset * 0.3) % canvas.width;
                const y = (i * 43 + bgTime * 15) % canvas.height;
                ctx.globalAlpha = 0.2 + Math.sin(bgTime * 2 + i) * 0.15;
                ctx.fillStyle = '#8888ff';
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'firefly':
            // Firefly meadow night
            const fireflyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            fireflyGrad.addColorStop(0, '#0a0a15');
            fireflyGrad.addColorStop(0.5, '#0f1520');
            fireflyGrad.addColorStop(1, '#151a25');
            ctx.fillStyle = fireflyGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Stars
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 50; i++) {
                const x = (i * 79) % canvas.width;
                const y = (i * 47) % (canvas.height * 0.4);
                ctx.globalAlpha = 0.2 + Math.random() * 0.2;
                ctx.beginPath();
                ctx.arc(x, y, 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Grass silhouettes
            ctx.fillStyle = '#0a1015';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 5) {
                const h = 30 + Math.sin(i * 0.1 + bgTime) * 10 + Math.random() * 20;
                ctx.lineTo(i, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
            
            // Many fireflies
            for (let i = 0; i < 30; i++) {
                const x = (i * 67 + Math.sin(bgTime * 0.8 + i * 0.5) * 30) % canvas.width;
                const y = canvas.height * 0.4 + (i * 31) % (canvas.height * 0.4) + Math.sin(bgTime + i) * 20;
                const brightness = 0.5 + Math.sin(bgTime * 3 + i * 2) * 0.5;
                
                if (brightness > 0.3) {
                    ctx.globalAlpha = brightness * 0.8;
                    ctx.fillStyle = '#ccff88';
                    ctx.shadowColor = '#88ff44';
                    ctx.shadowBlur = 15;
                    ctx.beginPath();
                    ctx.arc(x, y, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            break;
            
        case 'northern':
            // Northern lights over tundra
            const northernGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            northernGrad.addColorStop(0, '#050812');
            northernGrad.addColorStop(0.6, '#0a1020');
            northernGrad.addColorStop(1, '#101825');
            ctx.fillStyle = northernGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Stars
            for (let i = 0; i < 80; i++) {
                const x = (i * 73) % canvas.width;
                const y = (i * 51) % (canvas.height * 0.5);
                ctx.globalAlpha = 0.3 + Math.sin(bgTime + i) * 0.2;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(x, y, 0.5 + (i % 2) * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Northern lights - multiple curtains
            for (let curtain = 0; curtain < 3; curtain++) {
                ctx.save();
                ctx.globalAlpha = 0.15 - curtain * 0.03;
                const hue = (120 + curtain * 30 + bgTime * 10) % 360;
                ctx.strokeStyle = `hsl(${hue}, 80%, 50%)`;
                ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
                ctx.shadowBlur = 40;
                ctx.lineWidth = 50 - curtain * 10;
                ctx.beginPath();
                for (let x = 0; x <= canvas.width; x += 15) {
                    const y = canvas.height * 0.2 + curtain * 30 +
                        Math.sin((x + bgOffset * 0.2) * 0.008 + curtain + bgTime * 0.4) * 40 +
                        Math.sin((x + bgOffset * 0.3) * 0.015 + bgTime * 0.2) * 20;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.restore();
            }
            
            // Snowy ground
            ctx.fillStyle = '#151a25';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let i = 0; i <= canvas.width; i += 60) {
                const h = 40 + Math.sin(i * 0.02) * 20;
                ctx.lineTo(i, canvas.height - GROUND_HEIGHT - h);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.fill();
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
        drawPlayerHearts();
    }

    obstacles.forEach(obs => obs.draw());
    powerUps.forEach(p => p.draw());
    particles.forEach(p => p.draw());
    cubeFragments.forEach(f => f.draw());
}

// Draw hearts below the player
function drawPlayerHearts() {
    if (shieldCount <= 0 || !player) return;
    
    const heartSize = 16;
    const spacing = 20;
    const totalWidth = shieldCount * spacing;
    const startX = player.x + player.size / 2 - totalWidth / 2 + spacing / 2;
    const y = player.y + player.size + 15;
    
    ctx.save();
    ctx.font = `${heartSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Glow effect
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff0055';
    
    for (let i = 0; i < shieldCount; i++) {
        const x = startX + i * spacing;
        ctx.fillText('❤️', x, y);
    }
    
    ctx.restore();
}

function loop(currentTime) {
    // Calculate delta time
    if (lastTime === 0) lastTime = currentTime;
    deltaTime = (currentTime - lastTime) / TARGET_FRAME_TIME; // Normalize to target FPS
    deltaTime = Math.min(deltaTime, 3); // Cap delta to prevent huge jumps after tab switch
    lastTime = currentTime;

    if (gameState === 'PLAYING') {
        update(deltaTime);
    } else if (gameState === 'GAMEOVER') {
        if (player && !playerExploded) {
            player.update(deltaTime);
        }
        obstacles.forEach(obs => obs.update(deltaTime));
        obstacles = obstacles.filter(obs => !obs.markedForDeletion);

        particles.forEach(p => p.update(deltaTime));
        particles = particles.filter(p => p.life > 0);

        cubeFragments.forEach(f => f.update(deltaTime));
        cubeFragments = cubeFragments.filter(f => f.life > 0);

    } else if (gameState === 'WIN') {
        particles.forEach(p => p.update(deltaTime));
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
    soundManager.unpause(); // Resume music when going to menu
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
    coinsCollectedThisRun = 0; // Reset coins for this run
    document.getElementById('level-select-screen').classList.remove('active');
    document.querySelector('.game-title').style.opacity = '0.2';
    document.getElementById('current-level-display').classList.add('visible');

    // Reset powerups
    powerUps = [];
    shieldCount = 0;
    isBoosting = false;
    boostTimer = 0;
    boostTimer = 0;
    safeModeTimer = 0;
    landingGracePeriod = 0;
    updateShieldUI();

    soundManager.unpause(); // Resume music when starting level
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
    // Prevent scrolling with Space/Arrow keys
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) > -1) {
        e.preventDefault();
    }

    if (isBindingKey) {
        if (e.code === 'Escape') {
            isBindingKey = false;
            document.getElementById('bind-jump-btn').innerText = jumpKey;
            document.getElementById('bind-jump-btn').classList.remove('active');
            return;
        }
        jumpKey = e.code;
        localStorage.setItem('neonDashJumpKey', jumpKey);
        document.getElementById('bind-jump-btn').innerText = jumpKey === 'Space' ? 'SPACE' : jumpKey;
        document.getElementById('bind-jump-btn').classList.remove('active');
        isBindingKey = false;
        return;
    }

    if (e.code === jumpKey) {
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
            soundManager.unpause();
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
        } else if (gameState === 'SETTINGS') {
            closeSettings();
        }
    }
});

window.addEventListener('mousedown', (e) => {
    // Prevent game interaction if clicking on UI buttons or inside active screens (except game over/win which are overlays)
    if (e.target.closest('button') || e.target.closest('.setting-item') || e.target.closest('.level-grid')) return;

    // Also check if we are in a modal state where clicks shouldn't start the game
    if (gameState === 'SETTINGS' || gameState === 'CUSTOMIZE' || gameState === 'LEVEL_SELECT') return;

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
        soundManager.unpause();
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
    
    // Draw background preview if one is selected
    const bgToShow = previewingBackground || currentBackground;
    drawPreviewBackground(previewCtx, previewCanvas.width, previewCanvas.height, bgToShow);

    // Use preview values or actual values
    const shapeToShow = previewingShape || playerShape;
    const colorToShow = previewingColor || playerColor;

    // Draw rotating cube
    previewRotation += 1.5;
    const centerX = previewCanvas.width / 2;
    const centerY = previewCanvas.height / 2;
    const size = 50;

    previewCtx.save();
    previewCtx.translate(centerX, centerY);
    previewCtx.rotate((previewRotation * Math.PI) / 180);

    // Glow
    previewCtx.shadowBlur = 25;
    previewCtx.shadowColor = colorToShow;

    // Draw shape
    drawShape(previewCtx, shapeToShow, size, colorToShow);

    previewCtx.restore();

    // Continue animation if on customize screen
    if (gameState === 'CUSTOMIZE') {
        requestAnimationFrame(updatePreview);
    }
}

// Draw a mini version of the background in the preview canvas
function drawPreviewBackground(ctx, w, h, bgName) {
    ctx.save();
    
    switch(bgName) {
        case 'space':
            const spaceGrad = ctx.createLinearGradient(0, 0, 0, h);
            spaceGrad.addColorStop(0, '#0a0a20');
            spaceGrad.addColorStop(1, '#1a0a30');
            ctx.fillStyle = spaceGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#fff';
            for (let i = 0; i < 15; i++) {
                ctx.globalAlpha = 0.4 + (i % 4) * 0.15;
                ctx.beginPath();
                ctx.arc((i * 37) % w, (i * 23) % h, (i % 3) + 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'midnight':
            const midGrad = ctx.createLinearGradient(0, 0, 0, h);
            midGrad.addColorStop(0, '#0a0a1a');
            midGrad.addColorStop(1, '#1a2035');
            ctx.fillStyle = midGrad;
            ctx.fillRect(0, 0, w, h);
            // Moon
            ctx.fillStyle = '#e8e8f0';
            ctx.shadowColor = '#aabbff';
            ctx.shadowBlur = 20;
            ctx.beginPath();
            ctx.arc(w * 0.75, h * 0.25, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
            
        case 'forest':
            const forGrad = ctx.createLinearGradient(0, 0, 0, h);
            forGrad.addColorStop(0, '#0a1510');
            forGrad.addColorStop(1, '#152820');
            ctx.fillStyle = forGrad;
            ctx.fillRect(0, 0, w, h);
            // Trees
            ctx.fillStyle = '#081510';
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                ctx.moveTo(i * 60 + 20, h);
                ctx.lineTo(i * 60 + 35, h * 0.3);
                ctx.lineTo(i * 60 + 50, h);
                ctx.fill();
            }
            break;
            
        case 'ocean':
            const oceGrad = ctx.createLinearGradient(0, 0, 0, h);
            oceGrad.addColorStop(0, '#0a1525');
            oceGrad.addColorStop(1, '#1a3550');
            ctx.fillStyle = oceGrad;
            ctx.fillRect(0, 0, w, h);
            // Waves
            ctx.globalAlpha = 0.2;
            ctx.strokeStyle = '#4080a0';
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                ctx.moveTo(0, h * (0.3 + i * 0.15));
                ctx.quadraticCurveTo(w/2, h * (0.25 + i * 0.15), w, h * (0.3 + i * 0.15));
                ctx.stroke();
            }
            break;
            
        case 'desert':
            const desGrad = ctx.createLinearGradient(0, 0, 0, h);
            desGrad.addColorStop(0, '#1a1520');
            desGrad.addColorStop(1, '#4a3540');
            ctx.fillStyle = desGrad;
            ctx.fillRect(0, 0, w, h);
            // Dunes
            ctx.fillStyle = '#352530';
            ctx.beginPath();
            ctx.moveTo(0, h);
            ctx.quadraticCurveTo(w*0.3, h*0.5, w*0.6, h*0.7);
            ctx.quadraticCurveTo(w*0.8, h*0.6, w, h*0.8);
            ctx.lineTo(w, h);
            ctx.fill();
            break;
            
        case 'arctic':
            const arcGrad = ctx.createLinearGradient(0, 0, 0, h);
            arcGrad.addColorStop(0, '#101525');
            arcGrad.addColorStop(1, '#1a2a40');
            ctx.fillStyle = arcGrad;
            ctx.fillRect(0, 0, w, h);
            // Aurora hint
            ctx.globalAlpha = 0.2;
            ctx.strokeStyle = '#40ff80';
            ctx.lineWidth = 20;
            ctx.beginPath();
            ctx.moveTo(0, h*0.3);
            ctx.quadraticCurveTo(w/2, h*0.2, w, h*0.35);
            ctx.stroke();
            break;
            
        case 'twilight':
            const twiGrad = ctx.createLinearGradient(0, 0, 0, h);
            twiGrad.addColorStop(0, '#1a1025');
            twiGrad.addColorStop(0.5, '#3a2040');
            twiGrad.addColorStop(1, '#2a1530');
            ctx.fillStyle = twiGrad;
            ctx.fillRect(0, 0, w, h);
            // Star
            ctx.fillStyle = '#fff';
            ctx.shadowColor = '#fff';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(w * 0.7, h * 0.2, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
            
        case 'mountain':
            const mntGrad = ctx.createLinearGradient(0, 0, 0, h);
            mntGrad.addColorStop(0, '#101520');
            mntGrad.addColorStop(1, '#252a35');
            ctx.fillStyle = mntGrad;
            ctx.fillRect(0, 0, w, h);
            // Mountains
            ctx.fillStyle = '#1a2030';
            ctx.beginPath();
            ctx.moveTo(0, h);
            ctx.lineTo(w*0.3, h*0.3);
            ctx.lineTo(w*0.5, h*0.5);
            ctx.lineTo(w*0.7, h*0.25);
            ctx.lineTo(w, h*0.6);
            ctx.lineTo(w, h);
            ctx.fill();
            break;
            
        case 'cherry':
            const cheGrad = ctx.createLinearGradient(0, 0, 0, h);
            cheGrad.addColorStop(0, '#1a1020');
            cheGrad.addColorStop(1, '#2a1a28');
            ctx.fillStyle = cheGrad;
            ctx.fillRect(0, 0, w, h);
            // Petals
            ctx.fillStyle = '#ffaacc';
            ctx.globalAlpha = 0.6;
            for (let i = 0; i < 8; i++) {
                ctx.beginPath();
                ctx.ellipse((i * 30) % w, (i * 25) % h, 3, 1.5, i * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'underwater':
            const undGrad = ctx.createLinearGradient(0, 0, 0, h);
            undGrad.addColorStop(0, '#051525');
            undGrad.addColorStop(1, '#0f2540');
            ctx.fillStyle = undGrad;
            ctx.fillRect(0, 0, w, h);
            // Light rays
            ctx.globalAlpha = 0.1;
            ctx.fillStyle = '#4080a0';
            ctx.beginPath();
            ctx.moveTo(w*0.3, 0);
            ctx.lineTo(w*0.35, 0);
            ctx.lineTo(w*0.5, h);
            ctx.lineTo(w*0.4, h);
            ctx.fill();
            // Bubbles
            ctx.globalAlpha = 0.4;
            ctx.strokeStyle = '#5090b0';
            for (let i = 0; i < 5; i++) {
                ctx.beginPath();
                ctx.arc((i * 40 + 20) % w, h - i * 30, 3, 0, Math.PI * 2);
                ctx.stroke();
            }
            break;
            
        case 'cosmos':
            const cosGrad = ctx.createLinearGradient(0, 0, w, h);
            cosGrad.addColorStop(0, '#050510');
            cosGrad.addColorStop(1, '#080512');
            ctx.fillStyle = cosGrad;
            ctx.fillRect(0, 0, w, h);
            // Dust cloud
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = '#6644aa';
            ctx.beginPath();
            ctx.arc(w*0.6, h*0.4, 40, 0, Math.PI * 2);
            ctx.fill();
            // Stars
            ctx.fillStyle = '#fff';
            ctx.globalAlpha = 0.5;
            for (let i = 0; i < 12; i++) {
                ctx.beginPath();
                ctx.arc((i * 23) % w, (i * 17) % h, 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'aurora':
            const auroraGrad = ctx.createLinearGradient(0, 0, 0, h);
            auroraGrad.addColorStop(0, '#0a1628');
            auroraGrad.addColorStop(1, '#0a2040');
            ctx.fillStyle = auroraGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 0.3;
            const aurora = ctx.createLinearGradient(0, h*0.2, 0, h*0.6);
            aurora.addColorStop(0, 'transparent');
            aurora.addColorStop(0.5, '#00ff88');
            aurora.addColorStop(1, 'transparent');
            ctx.fillStyle = aurora;
            ctx.fillRect(0, 0, w, h);
            break;
            
        case 'volcanic':
            const volcGrad = ctx.createLinearGradient(0, 0, 0, h);
            volcGrad.addColorStop(0, '#1a0a0a');
            volcGrad.addColorStop(1, '#401505');
            ctx.fillStyle = volcGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 0.4;
            const lavaGrad = ctx.createRadialGradient(w/2, h, 10, w/2, h, h);
            lavaGrad.addColorStop(0, '#ff4400');
            lavaGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = lavaGrad;
            ctx.fillRect(0, 0, w, h);
            break;
            
        case 'cyberpunk':
            const cyberGrad = ctx.createLinearGradient(0, 0, 0, h);
            cyberGrad.addColorStop(0, '#1a0a2e');
            cyberGrad.addColorStop(1, '#16213e');
            ctx.fillStyle = cyberGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#ff00ff';
            ctx.globalAlpha = 0.3;
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                ctx.moveTo(0, h - i * 15);
                ctx.lineTo(w, h - i * 18);
                ctx.stroke();
            }
            break;
            
        case 'crystal':
            const crystGrad = ctx.createLinearGradient(0, 0, w, h);
            crystGrad.addColorStop(0, '#1a2a4a');
            crystGrad.addColorStop(1, '#1a2a4a');
            ctx.fillStyle = crystGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = '#88ccff';
            ctx.beginPath();
            ctx.moveTo(w*0.3, 0);
            ctx.lineTo(w*0.5, h*0.5);
            ctx.lineTo(w*0.2, h);
            ctx.fill();
            break;
            
        case 'storm':
            const stormGrad = ctx.createLinearGradient(0, 0, 0, h);
            stormGrad.addColorStop(0, '#1a1a2e');
            stormGrad.addColorStop(1, '#1a1a2e');
            ctx.fillStyle = stormGrad;
            ctx.fillRect(0, 0, w, h);
            // Clouds
            ctx.fillStyle = '#252540';
            ctx.beginPath();
            ctx.arc(w*0.3, h*0.3, 30, 0, Math.PI * 2);
            ctx.arc(w*0.5, h*0.25, 25, 0, Math.PI * 2);
            ctx.arc(w*0.7, h*0.3, 28, 0, Math.PI * 2);
            ctx.fill();
            break;
            
        case 'synthwave':
            const synthGrad = ctx.createLinearGradient(0, 0, 0, h);
            synthGrad.addColorStop(0, '#2d1b4e');
            synthGrad.addColorStop(0.6, '#1a1a2e');
            synthGrad.addColorStop(1, '#ff6b9d');
            ctx.fillStyle = synthGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 0.8;
            const sunGrad = ctx.createRadialGradient(w/2, h*0.65, 5, w/2, h*0.65, 30);
            sunGrad.addColorStop(0, '#ff9966');
            sunGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = sunGrad;
            ctx.fillRect(0, 0, w, h);
            break;
            
        case 'ethereal':
            const ethGrad = ctx.createLinearGradient(0, 0, 0, h);
            ethGrad.addColorStop(0, '#0a0a18');
            ethGrad.addColorStop(1, '#151530');
            ctx.fillStyle = ethGrad;
            ctx.fillRect(0, 0, w, h);
            // Orbs
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = '#6688ff';
            ctx.shadowColor = '#6688ff';
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.arc(w*0.3, h*0.4, 12, 0, Math.PI * 2);
            ctx.arc(w*0.7, h*0.6, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
            
        case 'firefly':
            const fireGrad = ctx.createLinearGradient(0, 0, 0, h);
            fireGrad.addColorStop(0, '#0a0a15');
            fireGrad.addColorStop(1, '#151a25');
            ctx.fillStyle = fireGrad;
            ctx.fillRect(0, 0, w, h);
            // Fireflies
            ctx.fillStyle = '#ccff88';
            ctx.shadowColor = '#88ff44';
            ctx.shadowBlur = 8;
            for (let i = 0; i < 6; i++) {
                ctx.globalAlpha = 0.4 + (i % 3) * 0.2;
                ctx.beginPath();
                ctx.arc((i * 35 + 15) % w, h * 0.4 + (i * 20) % 60, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            break;
            
        case 'northern':
            const norGrad = ctx.createLinearGradient(0, 0, 0, h);
            norGrad.addColorStop(0, '#050812');
            norGrad.addColorStop(1, '#101825');
            ctx.fillStyle = norGrad;
            ctx.fillRect(0, 0, w, h);
            // Northern lights
            ctx.globalAlpha = 0.2;
            ctx.strokeStyle = '#44ff88';
            ctx.shadowColor = '#44ff88';
            ctx.shadowBlur = 20;
            ctx.lineWidth = 25;
            ctx.beginPath();
            ctx.moveTo(0, h*0.3);
            ctx.quadraticCurveTo(w*0.5, h*0.15, w, h*0.35);
            ctx.stroke();
            ctx.shadowBlur = 0;
            break;
            
        default:
            const defGrad = ctx.createLinearGradient(0, 0, 0, h);
            defGrad.addColorStop(0, '#0a0a1a');
            defGrad.addColorStop(1, '#1a1a3a');
            ctx.fillStyle = defGrad;
            ctx.fillRect(0, 0, w, h);
    }
    
    ctx.globalAlpha = 1;
    ctx.restore();
}

function renderShopUI() {
    // Reset selection state
    selectedItem = null;
    updateUnlockButton();
    
    // Colors
    const colorContainer = document.querySelector('.color-presets');
    colorContainer.innerHTML = '';

    Object.entries(SHOP_ITEMS.colors).forEach(([color, price]) => {
        const btn = document.createElement('button');
        btn.className = 'color-preset';
        btn.dataset.color = color;
        btn.style.background = `linear-gradient(135deg, ${color}, ${adjustBrightness(color, -30)})`;

        const isUnlocked = unlockedColors.includes(color);
        if (!isUnlocked && price > 0) {
            btn.classList.add('locked-item');
            const priceTag = document.createElement('div');
            priceTag.className = 'item-price';
            priceTag.innerText = price;
            btn.appendChild(priceTag);
        }

        if (playerColor === color) btn.classList.add('active');

        btn.addEventListener('click', () => handleColorClick(color, price, isUnlocked));
        colorContainer.appendChild(btn);
    });

    // Shapes
    const shapeContainer = document.querySelector('.shape-grid');
    shapeContainer.innerHTML = '';

    const shapeIcons = {
        'square': '■',
        'circle': '●',
        'triangle': '▲',
        'diamond': '◆',
        'hexagon': '⬡',
        'star': '★'
    };

    Object.entries(SHOP_ITEMS.shapes).forEach(([shape, price]) => {
        const btn = document.createElement('button');
        btn.className = 'shape-btn';
        btn.dataset.shape = shape;

        const isUnlocked = unlockedShapes.includes(shape);
        if (!isUnlocked && price > 0) {
            btn.classList.add('locked-item');
            const priceTag = document.createElement('div');
            priceTag.className = 'item-price';
            priceTag.innerText = price;
            btn.appendChild(priceTag);
        }

        if (playerShape === shape) btn.classList.add('active');

        const label = document.createElement('div');
        label.className = 'shape-label';
        const icon = shapeIcons[shape] || '■';
        label.innerHTML = `<span style="font-size: 1.1rem;">${icon}</span><br>${shape.toUpperCase()}`;

        btn.appendChild(label);
        btn.addEventListener('click', () => handleShapeClick(shape, price, isUnlocked));
        shapeContainer.appendChild(btn);
    });

    // Backgrounds
    const backgroundContainer = document.querySelector('.background-grid');
    if (backgroundContainer) {
        backgroundContainer.innerHTML = '';

        const bgIcons = {
            'default': '🌙',
            'space': '🚀',
            'midnight': '🌑',
            'forest': '🌲',
            'ocean': '🌊',
            'desert': '🏜️',
            'arctic': '❄️',
            'twilight': '🌆',
            'mountain': '⛰️',
            'cherry': '🌸',
            'underwater': '🐠',
            'cosmos': '🌌',
            'aurora': '✨',
            'volcanic': '🌋',
            'crystal': '💎',
            'storm': '⛈️',
            'synthwave': '🎵',
            'ethereal': '💫',
            'firefly': '🪲',
            'northern': '🏔️'
        };

        Object.entries(SHOP_ITEMS.backgrounds).forEach(([bg, price]) => {
            const btn = document.createElement('button');
            btn.className = 'shape-btn bg-btn';
            btn.dataset.background = bg;

            const isUnlocked = unlockedBackgrounds.includes(bg);
            if (!isUnlocked && price > 0) {
                btn.classList.add('locked-item');
                const priceTag = document.createElement('div');
                priceTag.className = 'item-price';
                priceTag.innerText = price;
                btn.appendChild(priceTag);
            }

            if (currentBackground === bg && !previewingBackground) btn.classList.add('active');
            if (previewingBackground === bg) btn.classList.add('previewing');

            const label = document.createElement('div');
            label.className = 'shape-label';
            const bgIcon = bgIcons[bg] || '🎨';
            label.innerHTML = `<span style="font-size: 1rem;">${bgIcon}</span><br>${bg.toUpperCase()}`;

            btn.appendChild(label);
            btn.addEventListener('click', () => handleBackgroundClick(bg, price, isUnlocked));
            backgroundContainer.appendChild(btn);
        });
    }
}

// Handle color click - select if unlocked, or select for purchase
function handleColorClick(color, price, isUnlocked) {
    clearSelection();
    if (isUnlocked) {
        previewingColor = null;
        setPlayerColor(color);
        renderShopUI();
    } else {
        // Preview the color before purchase
        previewingColor = color;
        selectedItem = { type: 'color', value: color, price: price };
        highlightSelected('color', color);
        updateUnlockButton();
    }
}

// Handle shape click - select if unlocked, or select for purchase
function handleShapeClick(shape, price, isUnlocked) {
    clearSelection();
    if (isUnlocked) {
        previewingShape = null;
        setPlayerShape(shape);
        renderShopUI();
    } else {
        // Preview the shape before purchase
        previewingShape = shape;
        selectedItem = { type: 'shape', value: shape, price: price };
        highlightSelected('shape', shape);
        updateUnlockButton();
    }
}

// Handle background click - preview if locked, select if unlocked
function handleBackgroundClick(bg, price, isUnlocked) {
    clearSelection();
    if (isUnlocked) {
        previewingBackground = null;
        setBackground(bg);
        renderShopUI();
    } else {
        // Preview the background
        previewingBackground = bg;
        selectedItem = { type: 'background', value: bg, price: price };
        highlightSelected('background', bg);
        updateUnlockButton();
        // Draw the preview background behind the game
        drawBackgroundPreview(bg);
    }
}

// Highlight the selected locked item
function highlightSelected(type, value) {
    // Remove previous selection highlights
    document.querySelectorAll('.selected-for-purchase').forEach(el => {
        el.classList.remove('selected-for-purchase');
    });
    
    if (type === 'color') {
        const btn = document.querySelector(`.color-preset[data-color="${value}"]`);
        if (btn) btn.classList.add('selected-for-purchase');
    } else if (type === 'shape') {
        const btn = document.querySelector(`.shape-btn[data-shape="${value}"]`);
        if (btn) btn.classList.add('selected-for-purchase');
    } else if (type === 'background') {
        const btn = document.querySelector(`.shape-btn[data-background="${value}"]`);
        if (btn) btn.classList.add('selected-for-purchase');
    }
}

// Clear selection state
function clearSelection() {
    previewingShape = null;
    previewingColor = null;
    previewingBackground = null;
    document.querySelectorAll('.selected-for-purchase').forEach(el => {
        el.classList.remove('selected-for-purchase');
    });
    document.querySelectorAll('.previewing').forEach(el => {
        el.classList.remove('previewing');
    });
}

// Update unlock button visibility and text
function updateUnlockButton() {
    const unlockBtn = document.getElementById('cust-unlock-btn');
    const priceSpan = document.getElementById('unlock-price');
    
    if (!unlockBtn) return;
    
    if (selectedItem && selectedItem.price > 0) {
        unlockBtn.style.display = 'flex';
        priceSpan.textContent = selectedItem.price;
        
        // Disable if not enough coins
        if (coins < selectedItem.price) {
            unlockBtn.disabled = true;
        } else {
            unlockBtn.disabled = false;
        }
    } else {
        unlockBtn.style.display = 'none';
    }
}

// Draw background preview on the canvas behind the customize screen
function drawBackgroundPreview(bg) {
    // This will update the background preview in the game canvas
    // For now, we'll just show it when they go back to playing
    // The preview panel shows the shape/color, game canvas shows the bg preview
}

// Helper function to adjust color brightness
function adjustBrightness(color, amount) {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}



function setPlayerColor(color) {
    playerColor = color;
    saveProgress(); // Save to account
    renderShopUI(); // Refresh active state
    // Update color input
    document.getElementById('color-input').value = color;
}

function setPlayerShape(shape) {
    playerShape = shape;
    saveProgress(); // Save to account
    renderShopUI(); // Refresh active state
}

function setBackground(bg) {
    currentBackground = bg;
    saveProgress(); // Save to account
    renderShopUI(); // Refresh active state
}

function saveProgress() {
    const prefix = `neonDash_${userId}_`;
    localStorage.setItem(prefix + 'progress', unlockedLevels.toString());
    localStorage.setItem(prefix + 'coins', coins.toString());
    localStorage.setItem(prefix + 'highScore', highScore.toString());
    localStorage.setItem(prefix + 'unlockedColors', JSON.stringify(unlockedColors));
    localStorage.setItem(prefix + 'unlockedShapes', JSON.stringify(unlockedShapes));
    localStorage.setItem(prefix + 'unlockedBackgrounds', JSON.stringify(unlockedBackgrounds));

    // Save current customization (per user)
    localStorage.setItem(prefix + 'color', playerColor);
    localStorage.setItem(prefix + 'shape', playerShape);
    localStorage.setItem(prefix + 'background', currentBackground);

    // Global settings (not per user)
    localStorage.setItem('neonDashJumpKey', jumpKey);
    localStorage.setItem('neonDashMusic', isMusicEnabled);
    localStorage.setItem('neonDashLastUser', userId);
}

function loadProgress() {
    // Load last user
    const lastUser = localStorage.getItem('neonDashLastUser');
    if (lastUser) userId = lastUser;
    else {
        userId = generateUserId();
        localStorage.setItem('neonDashLastUser', userId);
    }

    const prefix = `neonDash_${userId}_`;

    const savedLevels = localStorage.getItem(prefix + 'progress');
    if (savedLevels) unlockedLevels = parseInt(savedLevels);
    else unlockedLevels = 1; // Default

    const savedCoins = localStorage.getItem(prefix + 'coins');
    if (savedCoins) coins = parseInt(savedCoins);
    else coins = 0;

    const savedHighScore = localStorage.getItem(prefix + 'highScore');
    if (savedHighScore) highScore = parseInt(savedHighScore);
    else highScore = 0;

    const savedColors = localStorage.getItem(prefix + 'unlockedColors');
    if (savedColors) unlockedColors = JSON.parse(savedColors);
    else unlockedColors = ['#00f3ff'];

    const savedShapes = localStorage.getItem(prefix + 'unlockedShapes');
    if (savedShapes) unlockedShapes = JSON.parse(savedShapes);
    else unlockedShapes = ['square'];

    const savedBackgrounds = localStorage.getItem(prefix + 'unlockedBackgrounds');
    if (savedBackgrounds) unlockedBackgrounds = JSON.parse(savedBackgrounds);
    else unlockedBackgrounds = ['default', 'space'];

    // Load saved customization (per user)
    const savedColor = localStorage.getItem(prefix + 'color');
    if (savedColor) playerColor = savedColor;
    else playerColor = '#00f3ff';

    const savedShape = localStorage.getItem(prefix + 'shape');
    if (savedShape) playerShape = savedShape;
    else playerShape = 'square';

    const savedBackground = localStorage.getItem(prefix + 'background');
    if (savedBackground) currentBackground = savedBackground;
    else currentBackground = 'default';

    // Load Global Settings
    const savedJumpKey = localStorage.getItem('neonDashJumpKey');
    if (savedJumpKey) jumpKey = savedJumpKey;

    const savedMusic = localStorage.getItem('neonDashMusic');
    if (savedMusic !== null) isMusicEnabled = JSON.parse(savedMusic);

    // Load volume settings
    const savedMusicVol = localStorage.getItem('neonDashMusicVolume');
    if (savedMusicVol !== null) {
        musicVolume = parseFloat(savedMusicVol);
    }
    const savedSfxVol = localStorage.getItem('neonDashSfxVolume');
    if (savedSfxVol !== null) {
        sfxVolume = parseFloat(savedSfxVol);
    }

    updateUI();
    updateSettingsUI();
}

function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

function switchAccount(newId) {
    if (!newId || newId.trim() === '') return;
    userId = newId.trim();
    loadProgress(); // Reloads data for new ID
    alert(`Switched to account: ${userId}`);
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

function updateShieldUI() {
    const container = document.getElementById('heart-container');
    if (container) {
        let hearts = '';
        for (let i = 0; i < shieldCount; i++) {
            hearts += '❤️';
        }
        container.innerText = hearts;
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

// Settings UI
function showSettings() {
    if (gameState === 'SETTINGS') return;
    previousGameState = gameState;
    gameState = 'SETTINGS';
    document.getElementById('settings-modal').classList.add('active');
    updateSettingsUI();
}

function closeSettings() {
    gameState = previousGameState;
    document.getElementById('settings-modal').classList.remove('active');
    // If we were playing, ensure loop continues (it does automatically via RAF)
    if (gameState === 'PLAYING') {
        gameStartTime = Date.now() - (score * 1000); // Adjust start time to match score/time? No, score is distance now.
        // Actually, for distance score, we don't need to adjust time.
    }
}

function updateSettingsUI() {
    document.getElementById('toggle-music-btn').innerText = isMusicEnabled ? 'ON' : 'OFF';
    document.getElementById('bind-jump-btn').innerText = jumpKey === 'Space' ? 'SPACE' : jumpKey;
    document.getElementById('account-id-display').innerText = userId;
    
    // Update volume sliders
    const musicSlider = document.getElementById('music-volume');
    const sfxSlider = document.getElementById('sfx-volume');
    if (musicSlider) {
        musicSlider.value = Math.round(musicVolume * 100);
        document.getElementById('music-volume-display').textContent = Math.round(musicVolume * 100) + '%';
    }
    if (sfxSlider) {
        sfxSlider.value = Math.round(sfxVolume * 100);
        document.getElementById('sfx-volume-display').textContent = Math.round(sfxVolume * 100) + '%';
    }
}

document.getElementById('settings-btn').addEventListener('click', showSettings);
document.getElementById('close-settings-btn').addEventListener('click', closeSettings);

document.getElementById('toggle-music-btn').addEventListener('click', () => {
    isMusicEnabled = !isMusicEnabled;
    localStorage.setItem('neonDashMusic', isMusicEnabled);
    updateSettingsUI();
    if (!isMusicEnabled) soundManager.stop();
    else soundManager.resume();
});

// Volume sliders
document.getElementById('music-volume').addEventListener('input', (e) => {
    const vol = parseInt(e.target.value) / 100;
    soundManager.setMusicVolume(vol);
    document.getElementById('music-volume-display').textContent = e.target.value + '%';
});

document.getElementById('sfx-volume').addEventListener('input', (e) => {
    const vol = parseInt(e.target.value) / 100;
    soundManager.setSfxVolume(vol);
    document.getElementById('sfx-volume-display').textContent = e.target.value + '%';
});

// Test SFX button - play a sound when adjusting
document.getElementById('sfx-volume').addEventListener('change', () => {
    soundManager.playCoin();
});

document.getElementById('bind-jump-btn').addEventListener('click', function () {
    isBindingKey = true;
    this.innerText = 'PRESS KEY...';
    this.classList.add('active');
});

document.getElementById('load-account-btn').addEventListener('click', () => {
    const input = prompt('Enter Account ID to load:');
    if (input) switchAccount(input);
});

document.getElementById('copy-account-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(userId).then(() => {
        alert('Account ID copied to clipboard!');
    });
});

// Navigation Buttons
document.getElementById('go-retry-btn').addEventListener('click', () => {
    init();
    gameState = 'PLAYING';
    canRestart = true;
    document.getElementById('game-over-screen').classList.remove('active');
    document.getElementById('wasted-screen').classList.remove('active');
    document.querySelector('.game-title').style.opacity = '0.2';
    document.getElementById('current-level-display').classList.add('visible');
    soundManager.unpause();
});

document.getElementById('go-menu-btn').addEventListener('click', () => {
    showLevelSelect();
    document.getElementById('game-over-screen').classList.remove('active');
    document.getElementById('wasted-screen').classList.remove('active');
});

document.getElementById('win-next-btn').addEventListener('click', () => {
    if (currentLevel < 10) {
        currentLevel++;
        startLevel(currentLevel);
    } else {
        showLevelSelect();
    }
    document.getElementById('level-complete-screen').classList.remove('active');
});

document.getElementById('win-menu-btn').addEventListener('click', () => {
    showLevelSelect();
    document.getElementById('level-complete-screen').classList.remove('active');
});

document.getElementById('cust-back-btn').addEventListener('click', () => {
    previewingBackground = null;
    previewingShape = null;
    previewingColor = null;
    selectedItem = null;
    showLevelSelect();
    document.getElementById('customize-screen').classList.remove('active');
});

// Unlock button
document.getElementById('cust-unlock-btn').addEventListener('click', () => {
    if (!selectedItem) return;
    
    const { type, value, price } = selectedItem;
    
    if (coins < price) {
        alert('Not enough coins!');
        return;
    }
    
    // Deduct coins
    coins -= price;
    document.getElementById('customize-coin-count').textContent = coins;
    
    // Unlock the item
    if (type === 'color') {
        unlockedColors.push(value);
        previewingColor = null;
        setPlayerColor(value);
    } else if (type === 'shape') {
        unlockedShapes.push(value);
        previewingShape = null;
        setPlayerShape(value);
    } else if (type === 'background') {
        unlockedBackgrounds.push(value);
        previewingBackground = null;
        setBackground(value);
    }
    
    // Save progress
    saveProgress();
    
    // Clear selection and re-render
    selectedItem = null;
    previewingColor = null;
    previewingShape = null;
    previewingBackground = null;
    renderShopUI();
    
    // Play sound
    if (soundManager.ctx) {
        soundManager.playPowerup();
    }
});


// Start
loadProgress();
init();
loop();

