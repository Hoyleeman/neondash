const canvas = document.getElementById('game-canvas');
// Optimized canvas context - alpha:false for better perf, desynchronized reduces input lag/tearing
const ctx = canvas.getContext('2d', { 
    alpha: false,           // No transparency needed for game canvas - big perf win
    desynchronized: true,   // Reduces latency and screen tearing
    willReadFrequently: false  // We don't read pixels back
});

// ═══════════════════════════════════════════════════════════
// PERFORMANCE OPTIMIZATION SYSTEM
// ═══════════════════════════════════════════════════════════

// Gradient cache - avoid recreating gradients every frame
const gradientCache = new Map();
let gradientCacheKey = ''; // Invalidate on resize

function getCachedGradient(type, ...params) {
    const key = `${type}_${params.join('_')}_${gradientCacheKey}`;
    if (!gradientCache.has(key)) {
        let gradient;
        switch(type) {
            case 'linear':
                gradient = ctx.createLinearGradient(...params.slice(0, 4));
                break;
            case 'radial':
                gradient = ctx.createRadialGradient(...params.slice(0, 6));
                break;
        }
        gradientCache.set(key, gradient);
    }
    return gradientCache.get(key);
}

function clearGradientCache() {
    gradientCache.clear();
    gradientCacheKey = `${canvas.width}_${canvas.height}_${Date.now()}`;
}

// Object Pool for Particles - reduces garbage collection
class ObjectPool {
    constructor(factory, reset, initialSize = 100) {
        this.factory = factory;
        this.reset = reset;
        this.pool = [];
        this.active = [];
        // Pre-allocate objects
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(factory());
        }
    }
    
    get() {
        let obj = this.pool.pop() || this.factory();
        this.active.push(obj);
        return obj;
    }
    
    release(obj) {
        const idx = this.active.indexOf(obj);
        if (idx > -1) {
            this.active.splice(idx, 1);
            this.reset(obj);
            this.pool.push(obj);
        }
    }
    
    releaseAll() {
        while (this.active.length > 0) {
            const obj = this.active.pop();
            this.reset(obj);
            this.pool.push(obj);
        }
    }
    
    getActive() {
        return this.active;
    }
}

// Performance settings - adjust based on device capability
const perfSettings = {
    maxParticles: 120,           // Optimized particle limit
    maxCubeFragments: 40,
    shadowsEnabled: true,        // Can be toggled in settings
    particlesEnabled: true,      // Can be toggled in settings
    reducedShadowBlur: 6,        // Lower shadow blur for performance
    skipBackgroundDetails: false, // Skip expensive background elements
    frameSkipThreshold: 2.5,     // Skip frames if delta > this (falling behind)
    useObjectPooling: true,      // Reuse objects instead of creating new ones
    batchRendering: true,        // Batch similar draw calls
};


// Object pools for recycling
const particlePool = [];
const MAX_POOL_SIZE = 200;

function getPooledParticle(x, y, color) {
    let p;
    if (particlePool.length > 0) {
        p = particlePool.pop();
        p.reset(x, y, color);
    } else {
        p = new Particle(x, y, color);
    }
    return p;
}

function returnToPool(particle) {
    if (particlePool.length < MAX_POOL_SIZE) {
        particlePool.push(particle);
    }
}

// Frame timestamp cache - avoid multiple Date.now() calls
let frameTimestamp = 0;

// Cached DOM elements
const cachedElements = {};
function getCachedElement(id) {
    if (!cachedElements[id]) {
        cachedElements[id] = document.getElementById(id);
    }
    return cachedElements[id];
}

// Pre-calculated constants
const PI2 = Math.PI * 2;
const PI_HALF = Math.PI / 2;

// Detect low-end devices and adjust settings
function detectPerformanceLevel() {
    // Check for low-end indicators
    const isLowEnd = navigator.hardwareConcurrency <= 2 || 
                     /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isLowEnd) {
        perfSettings.maxParticles = 60;
        perfSettings.maxCubeFragments = 20;
        perfSettings.reducedShadowBlur = 4;
        perfSettings.skipBackgroundDetails = true;
        perfSettings.shadowsEnabled = false;
        console.log('🔧 Low-end device detected - using reduced graphics');
    }
    
    // Check for high refresh rate displays
    if (window.screen && window.screen.availWidth > 1920) {
        perfSettings.maxParticles = 150;
        console.log('🔧 High-res display detected - increased particle limit');
    }
}
detectPerformanceLevel();

// Frame timing for smooth animations
let frameTimes = [];
const FRAME_TIME_SAMPLES = 30;
let avgFrameTime = 16.67; // Default to 60fps frame time (1000/60)

function updateFrameStats(frameTime) {
    frameTimes.push(frameTime);
    if (frameTimes.length > FRAME_TIME_SAMPLES) {
        frameTimes.shift();
    }
    avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
}

// Game State
let gameState = 'LEVEL_SELECT'; // LEVEL_SELECT, PLAYING, GAMEOVER, WIN, CUSTOMIZE
let score = 0;
let frameCount = 0;
let gameSpeed = 9;
let slowMotionFactor = 1; // 1 = normal, < 1 = slow
let distanceTraveled = 0;
let currentLevel = 1;
let unlockedLevels = 1;
let jumpKey = 'Space';
let isMusicEnabled = true;
let showProgressBar = true;
let isBindingKey = false;
let isBindingAbilityKey = false;
let landingGracePeriod = 0;
let previousGameState = 'LEVEL_SELECT';
let userId = 'guest';
let coinsCollectedThisRun = 0; // Track coins earned in current game

// Level configurations
const LEVELS = {
    // Quest Levels 1-10 (Original)
    1: { name: 'Beginner', length: 10000, startSpeed: 6, maxSpeed: 9, spawnRate: 0.03, minDistance: 500, difficulty: 1 },
    2: { name: 'Easy', length: 14000, startSpeed: 7, maxSpeed: 10, spawnRate: 0.04, minDistance: 450, difficulty: 2 },
    3: { name: 'Medium', length: 18000, startSpeed: 8, maxSpeed: 11, spawnRate: 0.05, minDistance: 400, difficulty: 3 },
    4: { name: 'Hard', length: 22000, startSpeed: 9, maxSpeed: 12, spawnRate: 0.06, minDistance: 350, difficulty: 4 },
    5: { name: 'Expert', length: 26000, startSpeed: 10, maxSpeed: 13, spawnRate: 0.07, minDistance: 300, difficulty: 5 },
    6: { name: 'Insane', length: 30000, startSpeed: 11, maxSpeed: 14, spawnRate: 0.08, minDistance: 280, difficulty: 6 },
    7: { name: 'Demon', length: 35000, startSpeed: 12, maxSpeed: 15, spawnRate: 0.09, minDistance: 260, difficulty: 7 },
    8: { name: 'Void', length: 40000, startSpeed: 13, maxSpeed: 16, spawnRate: 0.12, minDistance: 220, difficulty: 8 },
    9: { name: 'Omega', length: 50000, startSpeed: 14, maxSpeed: 17, spawnRate: 0.14, minDistance: 200, difficulty: 9 },
    10: { name: 'Infinity', length: 60000, startSpeed: 15, maxSpeed: 18, spawnRate: 0.16, minDistance: 180, difficulty: 10 },
    // Quest Levels 11-20 (New)
    11: { name: 'Abyss', length: 65000, startSpeed: 15, maxSpeed: 19, spawnRate: 0.17, minDistance: 170, difficulty: 11 },
    12: { name: 'Chaos', length: 70000, startSpeed: 16, maxSpeed: 20, spawnRate: 0.18, minDistance: 160, difficulty: 12 },
    13: { name: 'Nightmare', length: 75000, startSpeed: 16, maxSpeed: 21, spawnRate: 0.19, minDistance: 150, difficulty: 13 },
    14: { name: 'Oblivion', length: 80000, startSpeed: 17, maxSpeed: 22, spawnRate: 0.20, minDistance: 145, difficulty: 14 },
    15: { name: 'Cataclysm', length: 85000, startSpeed: 17, maxSpeed: 23, spawnRate: 0.21, minDistance: 140, difficulty: 15 },
    16: { name: 'Apocalypse', length: 90000, startSpeed: 18, maxSpeed: 24, spawnRate: 0.22, minDistance: 135, difficulty: 16 },
    17: { name: 'Armageddon', length: 95000, startSpeed: 18, maxSpeed: 25, spawnRate: 0.23, minDistance: 130, difficulty: 17 },
    18: { name: 'Extinction', length: 100000, startSpeed: 19, maxSpeed: 26, spawnRate: 0.24, minDistance: 125, difficulty: 18 },
    19: { name: 'Annihilation', length: 110000, startSpeed: 19, maxSpeed: 27, spawnRate: 0.25, minDistance: 120, difficulty: 19 },
    20: { name: 'Transcendence', length: 120000, startSpeed: 20, maxSpeed: 28, spawnRate: 0.26, minDistance: 115, difficulty: 20 },
    // Quest Levels 21-30 (Ultimate Challenge)
    21: { name: 'Singularity', length: 130000, startSpeed: 20, maxSpeed: 29, spawnRate: 0.27, minDistance: 112, difficulty: 21 },
    22: { name: 'Paradox', length: 140000, startSpeed: 21, maxSpeed: 30, spawnRate: 0.28, minDistance: 110, difficulty: 22 },
    23: { name: 'Vortex', length: 150000, startSpeed: 21, maxSpeed: 31, spawnRate: 0.29, minDistance: 108, difficulty: 23 },
    24: { name: 'Eclipse', length: 160000, startSpeed: 22, maxSpeed: 32, spawnRate: 0.30, minDistance: 105, difficulty: 24 },
    25: { name: 'Supernova', length: 175000, startSpeed: 22, maxSpeed: 33, spawnRate: 0.31, minDistance: 102, difficulty: 25 },
    26: { name: 'Quantum', length: 190000, startSpeed: 23, maxSpeed: 34, spawnRate: 0.32, minDistance: 100, difficulty: 26 },
    27: { name: 'Eternity', length: 210000, startSpeed: 23, maxSpeed: 35, spawnRate: 0.33, minDistance: 98, difficulty: 27 },
    28: { name: 'Ragnarok', length: 230000, startSpeed: 24, maxSpeed: 36, spawnRate: 0.34, minDistance: 95, difficulty: 28 },
    29: { name: 'Godslayer', length: 250000, startSpeed: 24, maxSpeed: 37, spawnRate: 0.35, minDistance: 92, difficulty: 29 },
    30: { name: 'Ascension', length: 280000, startSpeed: 25, maxSpeed: 38, spawnRate: 0.36, minDistance: 90, difficulty: 30 }
};

// Unlimited Mode Configuration
const UNLIMITED_MODE = {
    name: 'Unlimited',
    startSpeed: 8,
    maxSpeed: 22,           // Capped max speed for unlimited (still very fast)
    hardcoreMaxSpeed: 30,   // Hardcore keeps the higher max
    scaleDistance: 150000,  // Slower scaling - takes longer to reach max
    spawnRate: 0.05,
    minDistance: 400,
    difficulty: 1, // Starts easy but ramps up
    speedRampRate: 0.0003 // How fast difficulty increases over time
};

let isUnlimitedMode = false;
let isHardcoreMode = false; // Hardcore: No powerups, no coins

// Physics Constants
const GRAVITY = 2.9;
const JUMP_FORCE = -27;
const GROUND_HEIGHT = 110;

// Reference width for spawn calculations (prevents cheating with ultra-wide screens)
const REFERENCE_WIDTH = 1920; // Standard HD width
let spawnWidth = REFERENCE_WIDTH; // Used for spawn distance calculations

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
let isBulldozing = false;
let bulldozerTimer = 0;
let isGhosting = false;
let ghostTimer = 0;
let isMagnet = false;
let magnetTimer = 0;
let safeModeTimer = 0; // Grace period after boosting

// Gold God Ability
let abilityKey = 'KeyE'; // Default ability key
let goldGodCooldown = 0; // Cooldown timer in frames
const GOLD_GOD_COOLDOWN_MAX = 600; // 10 seconds at 60fps
let abilityCoins = []; // Physical coins spawned by ability

// Customization
let playerColor = '#00f3ff';
let playerShape = 'square';
let previewCanvas;
let previewCtx;
let previewRotation = 0;

// Shop selection state
let selectedItem = null; // { type: 'color'|'shape'|'background'|'skin', value: string, price: number }
let previewingBackground = null; // For background preview before purchase
let previewingShape = null; // For shape preview before purchase
let previewingColor = null; // For color preview before purchase
let previewingSkin = null; // For skin preview before purchase

// Audio - Default volumes (lower for new players)
let musicVolume = 0.01;  // 1% default
let sfxVolume = 0.25;    // 25% default

// ═══════════════════════════════════════════════════════════
// SUPABASE CLOUD DATABASE CONFIGURATION
// ═══════════════════════════════════════════════════════════
// To enable cloud saves:
// 1. Create a free Supabase account at https://supabase.com
// 2. Create a new project
// 3. Go to SQL Editor and run the table creation query below
// 4. Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values
// 5. Find these in Project Settings > API

const SUPABASE_URL = 'https://ylsvmezndotsuzbqvwio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlsc3ZtZXpuZG90c3V6YnF2d2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0ODE4MTEsImV4cCI6MjA4MDA1NzgxMX0.2rsRy-6C03VtCw-7llteBrSabHuzP9_7ImQHaqhqG74';

/*
SQL to create the players table (run in Supabase SQL Editor):

CREATE TABLE players (
    id TEXT PRIMARY KEY,
    password_hash TEXT DEFAULT NULL,
    security_pin TEXT DEFAULT NULL,
    unlocked_levels INTEGER DEFAULT 1,
    coins INTEGER DEFAULT 0,
    high_score INTEGER DEFAULT 0,
    unlocked_colors JSONB DEFAULT '["#00f3ff"]',
    unlocked_shapes JSONB DEFAULT '["square"]',
    unlocked_backgrounds JSONB DEFAULT '["default", "space"]',
    player_color TEXT DEFAULT '#00f3ff',
    player_shape TEXT DEFAULT 'square',
    current_background TEXT DEFAULT 'default',
    all_time_coins INTEGER DEFAULT 0,
    all_time_powerups INTEGER DEFAULT 0,
    all_time_obstacles_cleared INTEGER DEFAULT 0,
    all_time_deaths INTEGER DEFAULT 0,
    time_played_seconds INTEGER DEFAULT 0,
    total_distance_meters REAL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (allows anyone to read/write their own row)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations" ON players FOR ALL USING (true);

-- To add password/security columns to existing table, run:
ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT DEFAULT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS security_pin TEXT DEFAULT NULL;
*/

let supabase = null;
let cloudSyncEnabled = false;
let currentAccountHasPassword = false;
let pendingLoginAccountId = null;

// ═══════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════
function showToast(title, message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon based on type
    let icon = '💬';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else if (type === 'warning') icon = '⚠️';
    else if (type === 'info') icon = 'ℹ️';
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            ${message ? `<div class="toast-message">${message}</div>` : ''}
        </div>
    `;
    
    container.appendChild(toast);
    
    // Auto remove after duration
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
    
    return toast;
}

// Simple hash function for passwords (client-side - for basic protection)
// Note: For production, use proper server-side hashing with bcrypt
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'jumpHop_salt_2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check if an account has a password/PIN set
async function checkAccountPassword(accountId) {
    if (!cloudSyncEnabled || !supabase) return { hasPassword: false, hasPin: false };
    
    try {
        const { data, error } = await supabase
            .from('players')
            .select('password_hash, security_pin')
            .eq('id', accountId)
            .single();
        
        if (error || !data) return { hasPassword: false, hasPin: false };
        
        return {
            hasPassword: data.password_hash !== null && data.password_hash !== '',
            hasPin: data.security_pin !== null && data.security_pin !== ''
        };
    } catch (error) {
        console.error('Error checking password:', error);
        return { hasPassword: false, hasPin: false };
    }
}

// Check if account has a recovery PIN set
let currentAccountHasPin = false;

function updatePinUI() {
    const statusEl = document.getElementById('pin-status');
    if (statusEl) {
        if (currentAccountHasPin) {
            statusEl.innerHTML = '🔐 PIN is set';
            statusEl.style.color = '#00ff88';
        } else {
            statusEl.innerHTML = '🔓 No PIN set';
            statusEl.style.color = '#ff5555';
        }
    }
}

// Verify password for an account
async function verifyPassword(accountId, password) {
    if (!cloudSyncEnabled || !supabase) return false;
    
    try {
        const hash = await hashPassword(password);
        const { data, error } = await supabase
            .from('players')
            .select('password_hash')
            .eq('id', accountId)
            .single();
        
        if (error || !data) return false;
        return data.password_hash === hash;
    } catch (error) {
        console.error('Error verifying password:', error);
        return false;
    }
}

// Set password for current account
async function setAccountPassword(password) {
    if (!cloudSyncEnabled || !supabase) {
        showToast('Connection Required', 'Cloud sync needed for password protection', 'error');
        return false;
    }
    
    try {
        const hash = await hashPassword(password);
        const { error } = await supabase
            .from('players')
            .update({ password_hash: hash, updated_at: new Date().toISOString() })
            .eq('id', userId);
        
        if (error) {
            console.error('Error setting password:', error);
            return false;
        }
        
        currentAccountHasPassword = true;
        updatePasswordUI();
        return true;
    } catch (error) {
        console.error('Error setting password:', error);
        return false;
    }
}

// Save security PIN
async function saveSecurityPin(pin) {
    if (!cloudSyncEnabled || !supabase) {
        showToast('Connection Required', 'Cloud sync needed for security PIN', 'error');
        return false;
    }
    
    try {
        // Hash the PIN for security
        const hashedPin = await hashPassword(pin);
        const { error } = await supabase
            .from('players')
            .update({ security_pin: hashedPin, updated_at: new Date().toISOString() })
            .eq('id', userId);
        
        if (error) {
            console.error('Error saving PIN:', error);
            return false;
        }
        
        currentAccountHasPin = true;
        updatePinUI();
        return true;
    } catch (error) {
        console.error('Error saving PIN:', error);
        return false;
    }
}

// Verify security PIN for account recovery
async function verifySecurityPin(accountId, pin) {
    if (!cloudSyncEnabled || !supabase) return false;
    
    try {
        const hashedPin = await hashPassword(pin);
        const { data, error } = await supabase
            .from('players')
            .select('security_pin')
            .eq('id', accountId)
            .single();
        
        if (error || !data) return false;
        return data.security_pin === hashedPin;
    } catch (error) {
        console.error('Error verifying PIN:', error);
        return false;
    }
}

// Reset password after PIN verification
async function resetAccountPassword(accountId, newPassword) {
    if (!cloudSyncEnabled || !supabase) return false;
    
    try {
        const hash = await hashPassword(newPassword);
        const { error } = await supabase
            .from('players')
            .update({ password_hash: hash, updated_at: new Date().toISOString() })
            .eq('id', accountId);
        
        if (error) {
            console.error('Error resetting password:', error);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error resetting password:', error);
        return false;
    }
}

// Update password status UI
function updatePasswordUI() {
    const statusEl = document.getElementById('password-status');
    const btnEl = document.getElementById('set-password-btn');
    
    if (statusEl && btnEl) {
        if (currentAccountHasPassword) {
            statusEl.innerHTML = '🔒 Password protected';
            statusEl.style.color = '#00ff88';
            btnEl.textContent = 'Change Password';
        } else {
            statusEl.innerHTML = '🔓 No password set';
            statusEl.style.color = '#ff5555';
            btnEl.textContent = 'Set Password';
        }
    }
}

// Show password modal
function showPasswordModal() {
    document.getElementById('password-modal').classList.add('active');
    document.getElementById('password-input').value = '';
    document.getElementById('password-confirm').value = '';
    document.getElementById('password-error').style.display = 'none';
    document.getElementById('password-modal-title').textContent = currentAccountHasPassword ? 'Change Password' : 'Set Password';
}

// Hide password modal
function hidePasswordModal() {
    document.getElementById('password-modal').classList.remove('active');
}

// Show login modal
function showLoginModal(accountId) {
    pendingLoginAccountId = accountId;
    document.getElementById('login-modal').classList.add('active');
    document.getElementById('login-account-id').textContent = accountId;
    document.getElementById('login-password-input').value = '';
    document.getElementById('login-error').style.display = 'none';
}

// Hide login modal
function hideLoginModal() {
    document.getElementById('login-modal').classList.remove('active');
    pendingLoginAccountId = null;
}

// Initialize Supabase client
function initSupabase() {
    if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
        console.log('☁️ Cloud sync disabled - Configure SUPABASE_URL and SUPABASE_ANON_KEY to enable');
        updateSyncStatus(false, 'Local Only');
        return;
    }
    
    try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        cloudSyncEnabled = true;
        console.log('☁️ Cloud sync enabled!');
        updateSyncStatus(true, 'Cloud Connected');
    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        cloudSyncEnabled = false;
        updateSyncStatus(false, 'Connection Failed');
    }
}

function updateSyncStatus(connected, text) {
    const indicator = document.getElementById('sync-indicator');
    const statusText = document.getElementById('sync-text');
    if (indicator && statusText) {
        indicator.textContent = connected ? '☁️✓' : '💾';
        statusText.textContent = text;
        indicator.style.color = connected ? '#00ff88' : '#ffd700';
    }
}

// ═══════════════════════════════════════════════════════════
// LIFETIME STATISTICS TRACKING
// ═══════════════════════════════════════════════════════════
let allTimeCoins = 0;
let allTimePowerups = 0;
let allTimeObstaclesCleared = 0;
let allTimeDeaths = 0;
let timePlayedSeconds = 0;
let totalDistanceMeters = 0;

// Session tracking
let sessionStartTime = Date.now();
let lastDistanceUpdate = 0;
let obstaclesClearedThisRun = 0;
let powerupsCollectedThisRun = 0;

// Update stats UI in settings
function updateStatsUI() {
    const deaths = document.getElementById('stat-deaths');
    const coins = document.getElementById('stat-coins');
    const powerups = document.getElementById('stat-powerups');
    const obstacles = document.getElementById('stat-obstacles');
    const time = document.getElementById('stat-time');
    const distance = document.getElementById('stat-distance');
    
    if (deaths) deaths.textContent = allTimeDeaths.toLocaleString();
    if (coins) coins.textContent = allTimeCoins.toLocaleString();
    if (powerups) powerups.textContent = allTimePowerups.toLocaleString();
    if (obstacles) obstacles.textContent = allTimeObstaclesCleared.toLocaleString();
    if (time) {
        const hours = Math.floor(timePlayedSeconds / 3600);
        const minutes = Math.floor((timePlayedSeconds % 3600) / 60);
        time.textContent = `${hours}h ${minutes}m`;
    }
    if (distance) distance.textContent = Math.floor(totalDistanceMeters).toLocaleString();
}

// Save to cloud database
async function saveToCloud() {
    if (!cloudSyncEnabled || !supabase) return;
    
    try {
        const playerData = {
            id: userId,
            unlocked_levels: unlockedLevels,
            coins: coins,
            hops: hops,
            high_score: highScore,
            unlocked_colors: unlockedColors,
            unlocked_shapes: unlockedShapes,
            unlocked_backgrounds: unlockedBackgrounds,
            unlocked_skins: unlockedSkins,
            player_color: playerColor,
            player_shape: playerShape,
            player_skin: playerSkin,
            current_background: currentBackground,
            all_time_coins: allTimeCoins,
            all_time_powerups: allTimePowerups,
            all_time_obstacles_cleared: allTimeObstaclesCleared,
            all_time_deaths: allTimeDeaths,
            time_played_seconds: timePlayedSeconds,
            total_distance_meters: totalDistanceMeters,
            season_pass_level: seasonPassLevel,
            season_pass_xp: seasonPassXP,
            season_pass_premium: seasonPassPremium,
            claimed_rewards: claimedRewards,
            custom_color_unlocked: customColorUnlocked,
            updated_at: new Date().toISOString()
        };
        
        const { error } = await supabase
            .from('players')
            .upsert(playerData, { onConflict: 'id' });
        
        if (error) {
            console.error('Cloud save error:', error);
            updateSyncStatus(false, 'Sync Error');
        } else {
            console.log('☁️ Saved to cloud');
            updateSyncStatus(true, 'Synced');
        }
    } catch (error) {
        console.error('Cloud save failed:', error);
    }
}

// Load from cloud database
async function loadFromCloud() {
    if (!cloudSyncEnabled || !supabase) return false;
    
    try {
        const { data, error } = await supabase
            .from('players')
            .select('*')
            .eq('id', userId)
            .single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                // No record found - this is a new player
                console.log('☁️ New player - creating cloud record');
                await saveToCloud();
                return false;
            }
            console.error('Cloud load error:', error);
            return false;
        }
        
        if (data) {
            // Load all data from cloud
            unlockedLevels = data.unlocked_levels || 1;
            coins = data.coins || 0;
            hops = data.hops || 0;
            highScore = data.high_score || 0;
            unlockedColors = data.unlocked_colors || ['#00f3ff'];
            unlockedShapes = data.unlocked_shapes || ['square'];
            unlockedBackgrounds = data.unlocked_backgrounds || ['default', 'space'];
            unlockedSkins = data.unlocked_skins || ['none'];
            playerColor = data.player_color || '#00f3ff';
            playerShape = data.player_shape || 'square';
            playerSkin = data.player_skin || 'none';
            currentBackground = data.current_background || 'default';
            allTimeCoins = data.all_time_coins || 0;
            allTimePowerups = data.all_time_powerups || 0;
            allTimeObstaclesCleared = data.all_time_obstacles_cleared || 0;
            allTimeDeaths = data.all_time_deaths || 0;
            timePlayedSeconds = data.time_played_seconds || 0;
            totalDistanceMeters = data.total_distance_meters || 0;
            seasonPassLevel = data.season_pass_level || 1;
            seasonPassXP = data.season_pass_xp || 0;
            seasonPassPremium = data.season_pass_premium || false;
            claimedRewards = data.claimed_rewards || [];
            customColorUnlocked = data.custom_color_unlocked || false;
            
            console.log('☁️ Loaded from cloud');
            updateSyncStatus(true, 'Cloud Synced');
            updateStatsUI();
            updateHopsDisplay();
            return true;
        }
    } catch (error) {
        console.error('Cloud load failed:', error);
    }
    return false;
}

// Periodic time tracking (call this every minute while playing)
let timeTrackingInterval = null;

function startTimeTracking() {
    if (timeTrackingInterval) clearInterval(timeTrackingInterval);
    sessionStartTime = Date.now();
    
    timeTrackingInterval = setInterval(() => {
        if (gameState === 'PLAYING') {
            timePlayedSeconds += 1;
            // Save every minute
            saveProgress();
            if (cloudSyncEnabled) saveToCloud();
        }
    }, 1000); // Every second for accuracy
}

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
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431749/neondashmusic_apwnjb.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431731/neondashmusic1_hlczfa.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431723/neondashmusic2_fsqfaf.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431746/neondashmusic3_f9hzdb.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431731/neondashmusic4_oq2npz.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431752/neondashmusic5_dmsupr.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431741/neondashmusic6_a1v54z.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431747/neondashmusic7_cdda3m.mp3',
            'https://res.cloudinary.com/do61mfyhn/video/upload/v1764431738/neondashmusic8_rdsru0.mp3'
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
        localStorage.setItem('jumpHopMusicVolume', vol);
    }

    setSfxVolume(vol) {
        sfxVolume = vol;
        if (this.masterGain) {
            this.masterGain.gain.value = vol;
        }
        localStorage.setItem('jumpHopSfxVolume', vol);
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

    // BULLDOZER sound - heavy rumble
    playBulldozer() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            // Low rumble
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(80, this.ctx.currentTime);
            osc.frequency.setValueAtTime(100, this.ctx.currentTime + 0.1);
            osc.frequency.setValueAtTime(60, this.ctx.currentTime + 0.2);
            gain.gain.setValueAtTime(0.3 * sfxVolume, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(this.ctx.currentTime);
            osc.stop(this.ctx.currentTime + 0.3);
        } catch (e) {}
    }
    
    // GHOST sound - ethereal whoosh
    playGhost() {
        if (!this.ctx || !isMusicEnabled) return;
        try {
            // Ethereal high-pitched sound
            const osc = this.ctx.createOscillator();
            const osc2 = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.2);
            osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.4);
            
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1200, this.ctx.currentTime);
            osc2.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.4);
            
            gain.gain.setValueAtTime(0.15 * sfxVolume, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
            
            osc.connect(gain);
            osc2.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(this.ctx.currentTime);
            osc2.start(this.ctx.currentTime);
            osc.stop(this.ctx.currentTime + 0.4);
            osc2.stop(this.ctx.currentTime + 0.4);
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

// Define which obstacles require double jump (tall/difficult)
const HARD_OBSTACLES = ['PILLAR', 'LASER', 'MOVING_SAW'];
const MEDIUM_OBSTACLES = ['SAW', 'TRIPLE_SPIKE'];

// Get required safe landing distance based on obstacle type and game speed
function getSafeLandingDistance(obstacleType) {
    // Base distances for landing safely after each obstacle type
    // These account for jump arc and landing time
    const baseDistances = {
        'PILLAR': 250,      // Tall - needs lots of room to land
        'LASER': 220,       // Tall - needs room to land after double jump
        'MOVING_SAW': 200,  // Unpredictable movement - needs safe zone
        'SAW': 150,         // Medium height
        'TRIPLE_SPIKE': 180, // Wide obstacle - needs clearance
        'DOUBLE_SPIKE': 120,
        'SPIKE': 100,
        'BLOCK': 80
    };
    
    // Scale landing distance with game speed (faster = need more room)
    const speedMultiplier = 1 + (gameSpeed - 8) * 0.05; // Increases at higher speeds
    return (baseDistances[obstacleType] || 100) * speedMultiplier;
}

// Check if an obstacle type is safe to spawn after the previous one
function isSafeObstacleCombo(lastType, newType) {
    // Prevent impossible combos - no hard obstacle right after another hard obstacle
    if (HARD_OBSTACLES.includes(lastType) && HARD_OBSTACLES.includes(newType)) {
        return false;
    }
    
    // Don't put a hard obstacle right after a medium one at high speeds
    if (gameSpeed > 15 && MEDIUM_OBSTACLES.includes(lastType) && HARD_OBSTACLES.includes(newType)) {
        return false;
    }
    
    // At very high speeds, space out difficult obstacles more
    if (gameSpeed > 20 && (HARD_OBSTACLES.includes(lastType) || MEDIUM_OBSTACLES.includes(lastType))) {
        if (HARD_OBSTACLES.includes(newType) || MEDIUM_OBSTACLES.includes(newType)) {
            return false;
        }
    }
    
    return true;
}

function spawnObstacle() {
    let levelConfig;
    let difficulty;
    let minDistance;
    let spawnRate;
    
    if (isUnlimitedMode) {
        // Unlimited mode - gradual difficulty scaling based on distance
        const unlimitedProgress = Math.min(distanceTraveled / 100000, 1); // Max out at 100k distance
        difficulty = Math.floor(1 + unlimitedProgress * 19); // Scale from 1-20
        minDistance = Math.max(115, UNLIMITED_MODE.minDistance - unlimitedProgress * 285); // 400 -> 115
        spawnRate = UNLIMITED_MODE.spawnRate + unlimitedProgress * 0.21; // 0.05 -> 0.26
        levelConfig = { difficulty, minDistance, spawnRate, length: Infinity };
    } else {
        levelConfig = LEVELS[currentLevel];
        difficulty = levelConfig.difficulty;
        minDistance = levelConfig.minDistance;
        spawnRate = levelConfig.spawnRate;
        
        // Check for finish line in quest modes
        if (distanceTraveled > levelConfig.length) {
            if (!finishLine) {
                finishLine = new FinishLine(canvas.width + 500);
            }
            return;
        }
    }

    // Grace period check
    if (safeModeTimer > 0 || landingGracePeriod > 0) return;

    if (distanceTraveled < 800) return;

    // Get last obstacle info for safe spawning
    let lastObstacle = obstacles.length > 0 ? obstacles[obstacles.length - 1] : null;
    let lastObstacleType = lastObstacle ? lastObstacle.type : null;
    
    // Calculate required distance based on last obstacle type
    let requiredDistance = minDistance;
    if (lastObstacleType) {
        const safeLandingDist = getSafeLandingDistance(lastObstacleType);
        requiredDistance = Math.max(minDistance, safeLandingDist);
    }

    // Use distance traveled for spawn timing (prevents ultra-wide screen cheating)
    const distanceSinceLastSpawn = distanceTraveled - lastObstacleSpawnDistance;
    if (distanceSinceLastSpawn > requiredDistance) {
        // Chance to spawn PowerUp instead of Obstacle (spawn safely)
        // Skip powerups entirely in hardcore mode
        if (!isHardcoreMode && Math.random() < 0.05) { // Reduced from 0.06 (18% less)
            spawnPowerUpSafely(canvas.width + 100);
            lastObstacleSpawnDistance = distanceTraveled;
            return;
        }

        if (Math.random() < spawnRate) {
            const rand = Math.random();
            let type = 'BLOCK';

            // Difficulty scaling for obstacles - more variety!
            if (difficulty >= 2 && rand > 0.8) type = 'SPIKE';
            if (difficulty >= 3 && rand > 0.85) type = 'DOUBLE_SPIKE';
            if (difficulty >= 4 && rand > 0.88) type = 'PILLAR';
            if (difficulty >= 5 && rand > 0.9) type = 'SAW';
            if (difficulty >= 6 && rand > 0.92) type = 'LASER';
            if (difficulty >= 7 && rand > 0.94) type = 'TRIPLE_SPIKE';
            if (difficulty >= 8 && rand > 0.96) type = 'MOVING_SAW';

            // Basic random fallback
            if (type === 'BLOCK' && Math.random() > 0.5) type = 'SPIKE';
            
            // Safety check: ensure this obstacle combo is possible
            // If not safe, downgrade to an easier obstacle
            if (lastObstacleType && !isSafeObstacleCombo(lastObstacleType, type)) {
                // Downgrade to a safer obstacle type
                if (HARD_OBSTACLES.includes(type)) {
                    // Replace hard obstacle with medium or easy
                    const safeTypes = ['SPIKE', 'DOUBLE_SPIKE', 'BLOCK'];
                    type = safeTypes[Math.floor(Math.random() * safeTypes.length)];
                } else if (MEDIUM_OBSTACLES.includes(type)) {
                    // Replace medium with easy
                    type = Math.random() > 0.5 ? 'SPIKE' : 'BLOCK';
                }
            }

            obstacles.push(new Obstacle(type, canvas.width + 100));
            lastObstacleSpawnDistance = distanceTraveled;
        }
    }
}

function spawnPowerUp(x, y) {
    const rand = Math.random();
    let type = 'COIN';
    if (rand > 0.998) type = 'HOPS'; // 0.2% chance for hops (VERY rare!)
    else if (rand > 0.97) type = 'GHOST';
    else if (rand > 0.94) type = 'BULLDOZER';
    else if (rand > 0.91) type = 'BOMB';
    else if (rand > 0.86) type = 'BOOST';
    else if (rand > 0.76) type = 'HEART';

    // Use safe spawning for all powerups
    spawnPowerUpSafely(x, type);
}

// Separate coin spawning for more frequent coins
let lastCoinSpawnX = 0;
const COIN_SPAWN_DISTANCE = 350; // Spawn coins every 350 pixels of travel

// Track obstacle spawning by distance traveled (prevents ultra-wide screen cheating)
let lastObstacleSpawnDistance = 0;

function spawnCoinsSafely() {
    // Only spawn coins during active gameplay
    if (gameState !== 'PLAYING') return;
    if (safeModeTimer > 0 || landingGracePeriod > 0) return;
    if (distanceTraveled < 500) return; // Grace period at start
    
    // Spawn coins based on distance traveled
    const currentDistance = distanceTraveled;
    if (currentDistance - lastCoinSpawnX >= COIN_SPAWN_DISTANCE) {
        lastCoinSpawnX = currentDistance;
        
        // Random chance to spawn coin group
        if (Math.random() < 0.53) { // 53% chance for coins (reduced 18%)
            const rand = Math.random();
            if (rand > 0.995) {
                // SUPER RARE: Spawn a Hops crystal! (0.5% of coin spawns)
                spawnPowerUpSafely(canvas.width + 50, 'HOPS');
            } else {
                // Spawn 1-3 coins in a row
                const coinCount = 1 + Math.floor(Math.random() * 3);
                for (let i = 0; i < coinCount; i++) {
                    spawnPowerUpSafely(canvas.width + 50 + i * 45, 'COIN');
                }
            }
        }
    }
}

// Spawn power-ups safely away from obstacles - ALWAYS reachable
function spawnPowerUpSafely(x, forcedType = null) {
    const rand = Math.random();
    let type = forcedType;
    
    if (!type) {
        type = 'COIN';
        if (rand > 0.998) type = 'HOPS'; // 0.2% chance for hops (VERY rare!)
        else if (rand > 0.97) type = 'GHOST';
        else if (rand > 0.945) type = 'MAGNET';
        else if (rand > 0.92) type = 'BULLDOZER';
        else if (rand > 0.89) type = 'BOMB';
        else if (rand > 0.84) type = 'BOOST';
        else if (rand > 0.74) type = 'HEART';
        else if (rand > 0.60) type = 'SUPER_COIN'; // ~14% chance - rarer than regular coins
        // else stays as COIN (~60% chance)
    }

    const groundY = canvas.height - GROUND_HEIGHT;
    const size = 30;
    
    // Define safe, REACHABLE heights for each type (all within jump range)
    // Max jump height is roughly 200px from ground, so stay within that
    let possibleHeights;
    
    if (type === 'BOMB' || type === 'BULLDOZER') {
        // Ground-level powerups - easy to grab
        possibleHeights = [groundY - 40, groundY - 50, groundY - 60];
    } else if (type === 'GHOST' || type === 'MAGNET') {
        // Mid-height powerups
        possibleHeights = [groundY - 60, groundY - 80, groundY - 100];
    } else if (type === 'COIN' || type === 'SUPER_COIN' || type === 'HOPS') {
        // Coins/Hops at various reachable heights (never too high)
        possibleHeights = [groundY - 50, groundY - 70, groundY - 90, groundY - 120];
    } else {
        // Other powerups (HEART, BOOST)
        possibleHeights = [groundY - 60, groundY - 80, groundY - 100, groundY - 120];
    }
    
    // Find a safe X position that's not inside any obstacle
    let safeX = x;
    let foundSafeX = false;
    
    // Try the original X first, then try offsets
    const xOffsets = [0, 50, -50, 100, -100, 150];
    for (let xOffset of xOffsets) {
        const testX = x + xOffset;
        let xIsSafe = true;
        
        // Check if this X position is clear of all obstacles
        for (let obs of obstacles) {
            const padding = 50; // Large padding to ensure clear space
            if (testX + size + padding > obs.x && testX - padding < obs.x + obs.w) {
                xIsSafe = false;
                break;
            }
        }
        
        if (xIsSafe) {
            safeX = testX;
            foundSafeX = true;
            break;
        }
    }
    
    // If no safe X found, don't spawn
    if (!foundSafeX) return;
    
    // Try each height until we find a safe spot
    let y = null;
    let attempts = 0;
    const maxAttempts = possibleHeights.length * 5;
    
    while (y === null && attempts < maxAttempts) {
        const testY = possibleHeights[Math.floor(Math.random() * possibleHeights.length)];
        let isSafe = true;
        
        // Check against ALL obstacles - thorough collision check
        for (let obs of obstacles) {
            // Very generous padding to ensure powerup is clearly separate from obstacles
            const padding = 60;
            
            // Full box collision check
            const powerupLeft = safeX - padding;
            const powerupRight = safeX + size + padding;
            const powerupTop = testY - padding;
            const powerupBottom = testY + size + padding;
            
            const obsLeft = obs.x;
            const obsRight = obs.x + obs.w;
            const obsTop = obs.y;
            const obsBottom = obs.y + obs.h;
            
            // Check for any overlap
            if (powerupRight > obsLeft && powerupLeft < obsRight &&
                powerupBottom > obsTop && powerupTop < obsBottom) {
                isSafe = false;
                break;
            }
        }
        
        if (isSafe) {
            y = testY;
        }
        attempts++;
    }
    
    // Only spawn if we found a completely safe position
    if (y !== null) {
        powerUps.push(new PowerUp(type, safeX, y));
    }
}

class Player {
    constructor() {
        this.size = 48;
        this.x = 100;
        this.y = canvas.height - GROUND_HEIGHT - this.size;
        this.dy = 0;
        this.jumpTimer = 0;
        this.isGrounded = true;
        this.rotation = 0;
        this.color = playerColor;
        this.canDoubleJump = true; // Double jump available
        this.usedDoubleJump = false; // Track if double jump was used (for faster fall)
        this.flashTimer = 0; // For damage flash effect
    }

    jump() {
        // Skins get a slight jump boost (10% higher)
        const hasSkin = playerSkin && playerSkin !== 'none' && SKINS[playerSkin];
        const jumpMultiplier = hasSkin ? 1.10 : 1.0;
        
        if (this.isGrounded) {
            // First jump from ground
            this.dy = JUMP_FORCE * jumpMultiplier;
            this.isGrounded = false;
            this.canDoubleJump = true; // Reset double jump when jumping from ground
            this.usedDoubleJump = false; // Reset double jump usage
            createParticles(this.x + this.size / 2, this.y + this.size, 5, '#fff');
            soundManager.ensurePlaying(); // Ensure music starts on first interaction
            soundManager.playJump();
        } else if (this.canDoubleJump) {
            // Double jump in mid-air! (skins also get boosted double jump)
            this.dy = JUMP_FORCE * 0.85 * jumpMultiplier;
            this.canDoubleJump = false;
            this.usedDoubleJump = true; // Mark that double jump was used
            // Special double jump particles
            createParticles(this.x + this.size / 2, this.y + this.size, 8, '#00f3ff');
            createParticles(this.x + this.size / 2, this.y + this.size, 5, '#ff00ff');
            soundManager.playJump();
        }
    }

    update(dt = 1) {
        // Update flash timer
        if (this.flashTimer > 0) {
            this.flashTimer -= dt * 0.016; // Decrement based on delta time (assuming 60fps base)
        }
        
        if (isBoosting) {
            // Fly even higher!
            const targetY = canvas.height - GROUND_HEIGHT - 350;
            this.y += (targetY - this.y) * 0.12 * dt;

            // THRUSTER EFFECTS - flames shooting from player
            // For Superdude flying horizontally, flames come from feet (left side, centered on body)
            const isSuperdudeFlying = playerSkin === 'superdude';
            const superdudespriteSize = this.size * 2;
            // Superdude's feet are on the left, body is centered at (x + size/2, y + size - spriteSize/2)
            const thrusterX = isSuperdudeFlying ? this.x + this.size / 2 - superdudespriteSize / 2 : this.x + this.size / 2;
            const thrusterY = isSuperdudeFlying ? this.y + this.size - superdudespriteSize / 2 : this.y + this.size;
            
            // Main thruster flames (using object pooling, respects particle setting)
            if (perfSettings.particlesEnabled && Math.random() < 0.5 * dt && particles.length < perfSettings.maxParticles) {
                for (let i = 0; i < 2; i++) { // Reduced from 3
                    const p = getPooledParticle(
                        isSuperdudeFlying ? thrusterX : thrusterX + (Math.random() - 0.5) * 15,
                        isSuperdudeFlying ? thrusterY + (Math.random() - 0.5) * 15 : thrusterY,
                        '#ff5500'
                    );
                    p.speedX = isSuperdudeFlying ? -(8 + Math.random() * 6) : (Math.random() - 0.5) * 2;
                    p.speedY = isSuperdudeFlying ? (Math.random() - 0.5) * 2 : 8 + Math.random() * 6;
                    p.size = 6 + Math.random() * 6;
                    particles.push(p);
                }
            }
            
            // Yellow/white hot center flames
            if (perfSettings.particlesEnabled && Math.random() < 0.3 * dt && particles.length < perfSettings.maxParticles - 5) {
                const p = getPooledParticle(thrusterX, thrusterY, '#ffff00');
                p.speedX = isSuperdudeFlying ? -(6 + Math.random() * 4) : (Math.random() - 0.5) * 1;
                p.speedY = isSuperdudeFlying ? (Math.random() - 0.5) * 1 : 6 + Math.random() * 4;
                p.size = 4 + Math.random() * 4;
                particles.push(p);
                
                const p2 = getPooledParticle(thrusterX, thrusterY, '#ffffff');
                p2.speedX = isSuperdudeFlying ? -(5 + Math.random() * 3) : (Math.random() - 0.5) * 0.5;
                p2.speedY = isSuperdudeFlying ? (Math.random() - 0.5) * 0.5 : 5 + Math.random() * 3;
                p2.size = 3 + Math.random() * 2;
                particles.push(p2);
            }
            
            // Smoke trail (reduced frequency)
            if (perfSettings.particlesEnabled && Math.random() < 0.2 * dt && particles.length < perfSettings.maxParticles - 5) {
                const p = getPooledParticle(
                    isSuperdudeFlying ? thrusterX - 20 : thrusterX + (Math.random() - 0.5) * 20,
                    isSuperdudeFlying ? thrusterY + (Math.random() - 0.5) * 20 : thrusterY + 20,
                    '#666666'
                );
                p.speedX = isSuperdudeFlying ? -(2 + Math.random() * 2) : (Math.random() - 0.5) * 3;
                p.speedY = isSuperdudeFlying ? (Math.random() - 0.5) * 3 : 2 + Math.random() * 2;
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

        // Apply gravity - scales with game speed to ensure landing in time for next jump
        let gravityMultiplier = 1;
        
        // Speed-based gravity scaling: faster speeds = stronger gravity
        // At speed 8 (base), multiplier is 1.0
        // At speed 20, multiplier is ~1.5
        // At speed 30, multiplier is ~2.0
        const speedGravityScale = 1 + (gameSpeed - 8) * 0.045;
        gravityMultiplier *= Math.max(1, speedGravityScale);
        
        // Additional boost when falling after double jump
        if (this.usedDoubleJump && this.dy > 0) {
            gravityMultiplier *= 1.35;
        }
        
        // When falling (dy > 0), apply extra gravity for snappier landings at high speeds
        if (this.dy > 0 && gameSpeed > 15) {
            const fallBoost = 1 + (gameSpeed - 15) * 0.03;
            gravityMultiplier *= fallBoost;
        }
        
        this.dy += GRAVITY * gravityMultiplier * slowMotionFactor * dt;
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
            this.usedDoubleJump = false; // Reset double jump gravity
        }
    }

    draw() {
        ctx.save();
        
        // Check if using a sprite skin (image-based or pixel-based)
        const hasSkin = playerSkin !== 'none' && (SKINS[playerSkin]?.imageUrl || SKINS[playerSkin]?.pixels);
        
        if (hasSkin) {
            // For sprites: anchor at feet (bottom center), no rotation
            ctx.translate((this.x + this.size / 2) | 0, (this.y + this.size) | 0);
            // No rotation for sprites - they stay upright
        } else {
            // For shapes: rotate around center
            ctx.translate((this.x + this.size / 2) | 0, (this.y + this.size / 2) | 0);
            ctx.rotate((this.rotation * Math.PI) / 180);
        }

        // Only apply shadows if enabled
        if (perfSettings.shadowsEnabled) {
            // Ghost mode - make player semi-transparent
            if (isGhosting) {
                ctx.globalAlpha = 0.4 + Math.sin(Date.now() * 0.015) * 0.15;
                ctx.shadowBlur = perfSettings.reducedShadowBlur * 2;
                ctx.shadowColor = '#88ddff';
            } else {
                ctx.shadowBlur = perfSettings.reducedShadowBlur;
                ctx.shadowColor = this.color;
            }
        } else if (isGhosting) {
            ctx.globalAlpha = 0.4 + Math.sin(Date.now() * 0.015) * 0.15;
        }

        // Determine sprite size (larger for image skins)
        const spriteSize = hasSkin ? this.size * 2 : this.size;
        
        // Calculate draw offset based on anchor point
        // For sprites: anchor is at feet (bottom center), so draw upward from feet
        // For shapes: anchor is at center, so draw centered
        const drawOffsetX = hasSkin ? -spriteSize / 2 : -this.size / 2;
        const drawOffsetY = hasSkin ? -spriteSize : -this.size / 2; // Align feet exactly with hitbox bottom
        
        // Flash effect when damaged - simple blink (no expensive filters)
        if (this.flashTimer > 0) {
            // Simple blink: alternate visibility
            const flashPhase = Math.floor(this.flashTimer * 20) % 2;
            if (flashPhase === 0) {
                // Skip drawing on alternate frames (blink effect)
                ctx.restore();
                return;
            }
            // Draw with red tint glow
            if (perfSettings.shadowsEnabled) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#ff0055';
            }
            ctx.globalAlpha = 0.9;
        }
        
        // Blinking warning when ANY powerup is about to expire (last 90 frames)
        // Check boost, bulldozer, ghost, and magnet timers
        let powerupTimer = 0;
        if (isBoosting && boostTimer <= 90) powerupTimer = boostTimer;
        else if (isBulldozing && bulldozerTimer <= 90) powerupTimer = bulldozerTimer;
        else if (isGhosting && ghostTimer <= 90) powerupTimer = ghostTimer;
        else if (isMagnet && magnetTimer <= 90) powerupTimer = magnetTimer;
        
        if (powerupTimer > 0) {
            // Blink speed increases as timer decreases: slow -> medium -> fast
            const blinkSpeed = powerupTimer <= 30 ? 0.35 : (powerupTimer <= 60 ? 0.18 : 0.1);
            const shouldHide = Math.sin(frameTimestamp * blinkSpeed) > 0;
            if (shouldHide) {
                ctx.restore();
                return; // Skip drawing entire player when blinking "off"
            }
        }
        
        // Normal draw - skin sprite or shape
        // Check for special flying sprite (Superdude + Boosting)
        const useFlying = isBoosting && playerSkin === 'superdude' && skinImages['superdude_flying'];
        const skinKeyToUse = useFlying ? 'superdude_flying' : playerSkin;
        
        const skinCanvas = playerSkin !== 'none' ? getSkinCanvas(playerSkin, spriteSize) : null;
        const skinImg = playerSkin !== 'none' ? skinImages[skinKeyToUse] : null;
        if (useFlying && skinImg) {
            // Draw flying Superdude - flying horizontally like Superman
            // Head pointing RIGHT, feet pointing LEFT, face looking DOWN
            ctx.save();
            ctx.translate(0, -spriteSize / 2); // Move up to center of sprite
            ctx.scale(-1, -1); // Invert both axes
            ctx.rotate(Math.PI + Math.PI / 2); // Rotate 180 + 90 = 270 degrees
            ctx.drawImage(skinImg, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize);
            ctx.restore();
        } else if (skinCanvas) {
            ctx.drawImage(skinCanvas, drawOffsetX, drawOffsetY);
        } else if (skinImg) {
            ctx.drawImage(skinImg, drawOffsetX, drawOffsetY, spriteSize, spriteSize);
        } else {
            drawShape(ctx, playerShape, this.size, this.color);
        }

        ctx.restore();

        // Draw Shield - adjust size for sprites
        if (shieldCount > 0) {
            ctx.save();
            // For sprites, center the shield on the character (accounting for larger sprite)
            const shieldCenterY = hasSkin ? this.y + this.size - spriteSize / 2 : this.y + this.size / 2;
            ctx.translate((this.x + this.size / 2) | 0, shieldCenterY | 0);
            ctx.beginPath();
            // Make shield bigger to cover full sprite
            const shieldRadius = hasSkin ? spriteSize * 0.55 + (shieldCount * 5) : this.size * 0.8 + (shieldCount * 5);
            ctx.arc(0, 0, shieldRadius, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff0055'; // Heart color
            ctx.lineWidth = 2;
            if (perfSettings.shadowsEnabled) {
                ctx.shadowBlur = perfSettings.reducedShadowBlur;
                ctx.shadowColor = '#ff0055';
            }
            ctx.stroke();
            ctx.globalAlpha = 0.15; // More transparent
            ctx.fillStyle = '#ff0055';
            ctx.fill();
            ctx.restore();
        }
        
        // Draw Bulldozer effect - adjusted for sprite size
        if (isBulldozing) {
            ctx.save();
            // Center on the sprite (accounting for larger sprite size)
            const effectCenterY = hasSkin ? this.y + this.size - spriteSize / 2 : this.y + this.size / 2;
            const effectRadius = hasSkin ? spriteSize * 0.6 : this.size * 0.9;
            ctx.translate((this.x + this.size / 2) | 0, effectCenterY | 0);
            
            // Pulsing orange aura
            const pulse = Math.sin(Date.now() * 0.01) * 0.3 + 0.7;
            if (perfSettings.shadowsEnabled) {
                ctx.shadowBlur = perfSettings.reducedShadowBlur * 2 * pulse;
                ctx.shadowColor = '#ff6600';
            }
            
            // Outer glow ring
            ctx.beginPath();
            ctx.arc(0, 0, effectRadius + 10, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 102, 0, ${0.5 * pulse})`;
            ctx.lineWidth = 4;
            ctx.stroke();
            
            // Inner glow
            ctx.globalAlpha = 0.2 * pulse;
            ctx.fillStyle = '#ff8800';
            ctx.fill();
            
            ctx.restore();
        }
        
        // Draw Ghost effect - adjusted for sprite size
        if (isGhosting) {
            ctx.save();
            // Center on the sprite (accounting for larger sprite size)
            const ghostCenterY = hasSkin ? this.y + this.size - spriteSize / 2 : this.y + this.size / 2;
            const ghostRadius = hasSkin ? spriteSize * 0.55 : this.size * 0.9;
            ctx.translate((this.x + this.size / 2) | 0, ghostCenterY | 0);
            
            // Ethereal pulsing glow
            const ghostPulse = Math.sin(Date.now() * 0.008) * 0.3 + 0.7;
            if (perfSettings.shadowsEnabled) {
                ctx.shadowBlur = perfSettings.reducedShadowBlur * 2 * ghostPulse;
                ctx.shadowColor = '#88ddff';
            }
            
            // Outer ethereal ring
            ctx.beginPath();
            ctx.arc(0, 0, ghostRadius + 12, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(136, 221, 255, ${0.4 * ghostPulse})`;
            ctx.lineWidth = 3;
            ctx.stroke();
            
            // Second ring (phasing effect)
            const phase = Math.sin(Date.now() * 0.012) * 5;
            ctx.beginPath();
            ctx.arc(0, 0, ghostRadius * 0.8 + phase, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(170, 238, 255, ${0.3 * ghostPulse})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Inner ethereal glow
            ctx.globalAlpha = 0.1 * ghostPulse;
            ctx.fillStyle = '#aaeeff';
            ctx.beginPath();
            ctx.arc(0, 0, ghostRadius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
        }
        
        // Draw Magnet effect - magnetic field around player
        if (isMagnet) {
            ctx.save();
            const magnetCenterY = hasSkin ? this.y + this.size - spriteSize / 2 : this.y + this.size / 2;
            const magnetRadius = hasSkin ? spriteSize * 0.6 : this.size * 0.9;
            ctx.translate((this.x + this.size / 2) | 0, magnetCenterY | 0);
            
            // Pulsing magenta aura
            const magnetPulse = Math.sin(Date.now() * 0.012) * 0.3 + 0.7;
            if (perfSettings.shadowsEnabled) {
                ctx.shadowBlur = perfSettings.reducedShadowBlur * 2 * magnetPulse;
                ctx.shadowColor = '#ff00ff';
            }
            
            // Rotating magnetic field lines
            const rotation = Date.now() * 0.003;
            for (let i = 0; i < 4; i++) {
                const angle = rotation + (i * Math.PI / 2);
                ctx.strokeStyle = `rgba(255, 0, 255, ${0.5 * magnetPulse})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, magnetRadius + 8, angle, angle + Math.PI / 4);
                ctx.stroke();
            }
            
            // Inner glow
            ctx.globalAlpha = 0.15 * magnetPulse;
            ctx.fillStyle = '#ff66ff';
            ctx.beginPath();
            ctx.arc(0, 0, magnetRadius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
        }
    }
    
    // Get player opacity for ghost effect
    getOpacity() {
        if (isGhosting) {
            // Flicker between semi-transparent states
            return 0.3 + Math.sin(Date.now() * 0.015) * 0.15;
        }
        return 1;
    }
    
    // Trigger damage flash
    triggerFlash() {
        this.flashTimer = 0.5; // Flash for 0.5 seconds
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
            this.h = 105;
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
            this.clearedByPlayer = true; // Player successfully passed this obstacle
        }
    }

    draw() {
        ctx.save();
        // Only apply shadow if enabled for performance
        if (perfSettings.shadowsEnabled) {
            ctx.shadowBlur = perfSettings.reducedShadowBlur;
            ctx.shadowColor = this.color;
        }
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
                if (perfSettings.shadowsEnabled) {
                    ctx.shadowBlur = perfSettings.reducedShadowBlur * 1.5;
                    ctx.shadowColor = '#ff0000';
                }
                ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.fillRect(this.x | 0, this.y | 0, this.w, this.h);
                // Core
                ctx.fillStyle = '#fff';
                ctx.fillRect((this.x + 2) | 0, this.y | 0, 4, this.h);
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
        if (perfSettings.shadowsEnabled) {
            ctx.shadowBlur = perfSettings.reducedShadowBlur * 1.5;
            ctx.shadowColor = this.color;
        }

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
        // Use integer coordinates for better performance
        ctx.translate((this.x + this.size / 2) | 0, (this.y + this.size / 2) | 0);
        
        // Apply shadow only if enabled
        const useShadow = perfSettings.shadowsEnabled;
        const shadowBlur = perfSettings.reducedShadowBlur;

        if (this.type === 'HEART') {
            ctx.fillStyle = '#ff0055';
            if (useShadow) {
                ctx.shadowColor = '#ff0055';
                ctx.shadowBlur = shadowBlur;
            }
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❤️', 0, 0);
        } else if (this.type === 'BOOST') {
            ctx.fillStyle = '#00f3ff';
            if (useShadow) {
                ctx.shadowColor = '#00f3ff';
                ctx.shadowBlur = shadowBlur;
            }
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🚀', 0, 0);
        } else if (this.type === 'COIN') {
            ctx.fillStyle = '#ffd700';
            if (useShadow) {
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = shadowBlur;
            }
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🪙', 0, 0);
        } else if (this.type === 'SUPER_COIN') {
            // Super Coin - larger, shinier, worth 5x
            const pulse = Math.sin(this.fuseTimer * 4) * 0.1 + 1;
            ctx.scale(pulse, pulse);
            
            if (useShadow) {
                ctx.shadowColor = '#ffff00';
                ctx.shadowBlur = shadowBlur * 2;
            }
            
            // Draw glowing ring behind
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, 20, 0, Math.PI * 2);
            ctx.stroke();
            
            // Draw the coin emoji larger
            ctx.fillStyle = '#ffd700';
            ctx.font = '38px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🪙', 0, 0);
            
            // Draw "5x" indicator
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.fillText('5x', 0, 18);
        } else if (this.type === 'HOPS') {
            // Draw beautiful crystal/gem for Hops currency
            const pulse = Math.sin(this.fuseTimer * 3) * 0.15 + 1;
            const shimmer = Math.sin(this.fuseTimer * 5) * 0.3;
            
            if (useShadow) {
                ctx.shadowColor = '#00ffff';
                ctx.shadowBlur = shadowBlur * 2 * pulse;
            }
            
            // Crystal main body - hexagonal gem shape
            ctx.save();
            ctx.scale(pulse, pulse);
            
            // Outer glow ring
            ctx.strokeStyle = `rgba(0, 255, 255, ${0.3 + shimmer})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.stroke();
            
            // Crystal body - diamond/gem shape
            const crystalGrad = ctx.createLinearGradient(-10, -15, 10, 15);
            crystalGrad.addColorStop(0, '#00ffff');
            crystalGrad.addColorStop(0.3, '#00ccff');
            crystalGrad.addColorStop(0.5, '#0099ff');
            crystalGrad.addColorStop(0.7, '#00ccff');
            crystalGrad.addColorStop(1, '#00ffff');
            
            ctx.fillStyle = crystalGrad;
            ctx.beginPath();
            // Diamond/crystal shape
            ctx.moveTo(0, -14);      // Top point
            ctx.lineTo(10, -5);      // Upper right
            ctx.lineTo(10, 5);       // Lower right
            ctx.lineTo(0, 14);       // Bottom point
            ctx.lineTo(-10, 5);      // Lower left
            ctx.lineTo(-10, -5);     // Upper left
            ctx.closePath();
            ctx.fill();
            
            // Crystal highlight/facets
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.beginPath();
            ctx.moveTo(0, -14);
            ctx.lineTo(10, -5);
            ctx.lineTo(0, 0);
            ctx.lineTo(-10, -5);
            ctx.closePath();
            ctx.fill();
            
            // Inner shine
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(-3, -6, 3, 0, Math.PI * 2);
            ctx.fill();
            
            // Sparkle effects
            if (Math.random() < 0.6) {
                ctx.fillStyle = '#ffffff';
                const sparkX = (Math.random() - 0.5) * 20;
                const sparkY = (Math.random() - 0.5) * 20;
                ctx.beginPath();
                // Star sparkle
                ctx.moveTo(sparkX, sparkY - 3);
                ctx.lineTo(sparkX + 1, sparkY - 1);
                ctx.lineTo(sparkX + 3, sparkY);
                ctx.lineTo(sparkX + 1, sparkY + 1);
                ctx.lineTo(sparkX, sparkY + 3);
                ctx.lineTo(sparkX - 1, sparkY + 1);
                ctx.lineTo(sparkX - 3, sparkY);
                ctx.lineTo(sparkX - 1, sparkY - 1);
                ctx.closePath();
                ctx.fill();
            }
            
            ctx.restore();
        } else if (this.type === 'BOMB') {
            // Draw bomb body
            if (useShadow) {
                ctx.shadowColor = '#ff4400';
                ctx.shadowBlur = shadowBlur + Math.sin(this.fuseTimer * 3) * 3;
            }
            
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
            if (useShadow) {
                ctx.shadowColor = '#ffff00';
                ctx.shadowBlur = shadowBlur * 1.5;
            }
            ctx.beginPath();
            ctx.arc(4, -this.size / 2 - 10, sparkSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(4, -this.size / 2 - 10, sparkSize * 0.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'BULLDOZER') {
            // Draw bulldozer powerup - tank/plow shape
            const pulse = Math.sin(this.fuseTimer * 4) * 0.2 + 1;
            
            if (useShadow) {
                ctx.shadowColor = '#ff8800';
                ctx.shadowBlur = shadowBlur * pulse;
            }
            
            // Main body (orange rectangle)
            ctx.fillStyle = '#ff6600';
            ctx.fillRect(-12, -6, 24, 16);
            
            // Plow blade (front)
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath();
            ctx.moveTo(14, -10);
            ctx.lineTo(18, -10);
            ctx.lineTo(20, 12);
            ctx.lineTo(14, 12);
            ctx.closePath();
            ctx.fill();
            
            // Tracks
            ctx.fillStyle = '#333';
            ctx.fillRect(-14, 8, 28, 5);
            
            // Cabin
            ctx.fillStyle = '#cc5500';
            ctx.fillRect(-8, -12, 12, 8);
            
            // Window
            ctx.fillStyle = '#88ccff';
            ctx.fillRect(-6, -10, 8, 5);
            
            // Exhaust smoke particle effect
            if (Math.random() < 0.3) {
                ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
                ctx.beginPath();
                ctx.arc(-10 + Math.random() * 4, -14 - Math.random() * 6, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (this.type === 'GHOST') {
            // Draw ghost powerup - spooky ghost shape
            const float = Math.sin(this.fuseTimer * 3) * 3;
            const pulse = Math.sin(this.fuseTimer * 5) * 0.2 + 0.8;
            
            ctx.translate(0, float);
            
            if (useShadow) {
                ctx.shadowColor = '#88ddff';
                ctx.shadowBlur = shadowBlur * 1.5 * pulse;
            }
            
            // Ghost body (semi-transparent)
            ctx.globalAlpha = 0.7 + Math.sin(this.fuseTimer * 4) * 0.2;
            ctx.fillStyle = '#aaeeff';
            
            // Main body
            ctx.beginPath();
            ctx.arc(0, -5, 12, Math.PI, 0, false);
            ctx.lineTo(12, 8);
            // Wavy bottom
            ctx.quadraticCurveTo(8, 5, 4, 10);
            ctx.quadraticCurveTo(0, 5, -4, 10);
            ctx.quadraticCurveTo(-8, 5, -12, 8);
            ctx.lineTo(-12, -5);
            ctx.closePath();
            ctx.fill();
            
            // Eyes
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.ellipse(-4, -4, 3, 4, 0, 0, Math.PI * 2);
            ctx.ellipse(4, -4, 3, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Eye highlights
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(-5, -5, 1.5, 0, Math.PI * 2);
            ctx.arc(3, -5, 1.5, 0, Math.PI * 2);
            ctx.fill();
            
            // Spooky glow particles
            if (Math.random() < 0.4) {
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = '#aaeeff';
                const px = (Math.random() - 0.5) * 30;
                const py = (Math.random() - 0.5) * 30;
                ctx.beginPath();
                ctx.arc(px, py, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (this.type === 'MAGNET') {
            // Draw magnet powerup - horseshoe magnet shape
            const pulse = Math.sin(this.fuseTimer * 4) * 0.2 + 1;
            const rotation = Math.sin(this.fuseTimer * 2) * 0.1;
            
            ctx.rotate(rotation);
            
            if (useShadow) {
                ctx.shadowColor = '#ff00ff';
                ctx.shadowBlur = shadowBlur * 1.5 * pulse;
            }
            
            // Horseshoe shape
            ctx.strokeStyle = '#cc0066';
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(0, 0, 10, Math.PI, 0, false);
            ctx.stroke();
            
            // Red pole
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(-13, -2, 6, 14);
            
            // Blue pole
            ctx.fillStyle = '#0066ff';
            ctx.fillRect(7, -2, 6, 14);
            
            // Magnetic field lines (animated)
            ctx.strokeStyle = `rgba(255, 0, 255, ${0.5 * pulse})`;
            ctx.lineWidth = 1.5;
            const fieldOffset = this.fuseTimer * 3;
            for (let i = 0; i < 3; i++) {
                const r = 16 + i * 5 + Math.sin(fieldOffset + i) * 2;
                ctx.beginPath();
                ctx.arc(0, 5, r, Math.PI * 1.2, Math.PI * 1.8);
                ctx.stroke();
            }
            
            // Sparkle effect
            if (Math.random() < 0.5) {
                ctx.fillStyle = '#ff66ff';
                const sx = (Math.random() - 0.5) * 40;
                const sy = (Math.random() - 0.5) * 30 + 10;
                ctx.beginPath();
                ctx.arc(sx, sy, 2 + Math.random() * 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }
}

// Gold God Ability Coin - physical coins that fly forward
class AbilityCoin {
    constructor(x, y, index) {
        // Spawn at player position, blast forward with power
        this.x = x + 50;
        this.y = y;
        this.size = 25;
        // Tighter spread - blast forward with slight vertical spread
        const spreadY = (index - 2) * 2; // -4, -2, 0, 2, 4 tighter vertical spread
        this.speedX = 12 + (index * 2.5) + Math.random() * 1.5; // 20% less power
        this.speedY = -5 + spreadY; // Slight upward arc
        this.rotation = 0;
        this.collected = false;
        this.life = 1.0;
        this.sparkleTimer = 0;
        this.groundY = canvas.height - GROUND_HEIGHT - this.size; // Floor level
    }
    
    update(dt = 1) {
        if (this.collected) return;
        
        // Move with world scrolling
        this.x += (this.speedX - gameSpeed) * slowMotionFactor * dt;
        this.speedY += 0.4 * dt; // Gravity pulls down
        this.y += this.speedY * slowMotionFactor * dt;
        this.rotation += 15 * dt;
        this.sparkleTimer += dt;
        
        // Reduce forward speed faster so player can catch up
        this.speedX *= 0.94;
        
        // FLOOR COLLISION - bounce off ground, don't fall through
        if (this.y >= this.groundY) {
            this.y = this.groundY;
            this.speedY = -this.speedY * 0.5; // Bounce with dampening
            if (Math.abs(this.speedY) < 1) {
                this.speedY = 0; // Stop bouncing when slow enough
            }
        }
        
        // Check if off screen left (scrolled away)
        if (this.x < -50) {
            this.life = 0;
        }
        
        // Check collision with player - generous hitbox
        if (player && !this.collected) {
            const dx = (player.x + player.size / 2) - this.x;
            const dy = (player.y + player.size / 2) - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            // More generous collection radius
            const collectionRadius = player.size * 0.7 + this.size * 0.7;
            if (dist < collectionRadius) {
                this.collected = true;
                this.life = 0;
                // Award 1 coin per ability coin (5 coins = 5 coin balance)
                coins += 1;
                coinsCollectedThisRun += 1;
                awardSeasonXP(2); // 2 XP per ability coin
                createParticles(this.x, this.y, 3, '#ffd700');
                soundManager.playCoin();
                saveProgress();
                updateUI();
            }
        }
    }
    
    draw() {
        if (this.life <= 0) return;
        
        ctx.save();
        ctx.translate(this.x | 0, this.y | 0);
        
        // Bob up and down like regular coins
        const bobOffset = Math.sin(this.sparkleTimer * 0.1) * 3;
        ctx.translate(0, bobOffset);
        
        // Golden glow - same as regular coins
        ctx.fillStyle = '#ffd700';
        if (perfSettings.shadowsEnabled) {
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = perfSettings.reducedShadowBlur || 10;
        }
        
        // Draw the same coin emoji as regular game coins
        ctx.font = '30px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🪙', 0, 0);
        
        ctx.restore();
    }
}

// Activate Gold God ability - blast coins forward
function activateGoldGodAbility() {
    if (gameState !== 'PLAYING') return;
    if (playerSkin !== 'gold-god') return;
    if (goldGodCooldown > 0) return;
    
    // Start cooldown
    goldGodCooldown = GOLD_GOD_COOLDOWN_MAX;
    
    // Spawn 5 coins in a spread pattern
    const startX = player.x + player.size;
    const startY = player.y + player.size / 2;
    
    for (let i = 0; i < 5; i++) {
        abilityCoins.push(new AbilityCoin(startX, startY, i));
    }
    
    // Visual effect - golden burst
    createParticles(startX, startY, 15, '#ffd700');
    createParticles(startX, startY, 10, '#ffff00');
    
    // Sound effect
    soundManager.playPowerup();
}

// Draw Gold God cooldown timer (circular) - positioned at top left near hops
function drawGoldGodCooldown() {
    if (playerSkin !== 'gold-god') return;
    if (gameState !== 'PLAYING') return;
    
    // Position at top left, next to the Hops balance
    const centerX = 310;
    const centerY = 52;
    const radius = 22;
    
    ctx.save();
    
    // Background circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    if (goldGodCooldown > 0) {
        // Cooldown arc (clockwise fill)
        const progress = 1 - (goldGodCooldown / GOLD_GOD_COOLDOWN_MAX);
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        // Start from top (-PI/2), go clockwise
        ctx.arc(centerX, centerY, radius - 2, -Math.PI / 2, -Math.PI / 2 + (progress * Math.PI * 2));
        ctx.closePath();
        ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
        ctx.fill();
        
        // Cooldown text
        const secondsLeft = Math.ceil(goldGodCooldown / 60);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(secondsLeft + 's', centerX, centerY);
    } else {
        // Ready indicator
        ctx.fillStyle = '#ffd700';
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👑', centerX, centerY);
        
        // Pulsing ready effect
        const pulse = Math.sin(Date.now() * 0.005) * 0.3 + 0.7;
        ctx.strokeStyle = `rgba(255, 215, 0, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    // Key hint below the circle
    const keyDisplay = abilityKey === 'Space' ? 'SPACE' : abilityKey.replace('Key', '');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = 'bold 9px Arial';
    ctx.fillText('[' + keyDisplay + ']', centerX, centerY + radius + 10);
    
    ctx.restore();
}

class Particle {
    constructor(x, y, color) {
        this.reset(x, y, color);
    }
    
    // Reset method for object pooling - reuses existing particle
    reset(x, y, color) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 4 - 2;
        this.speedY = Math.random() * 4 - 2;
        this.color = color;
        this.life = 1.0;
        this.active = true;
        return this;
    }
    
    update(dt = 1) {
        if (!this.active) return;
        this.x += this.speedX * slowMotionFactor * dt;
        this.y += this.speedY * slowMotionFactor * dt;
        this.life -= 0.02 * slowMotionFactor * dt;
        if (this.life <= 0) this.active = false;
    }
    
    draw() {
        if (!this.active || this.life <= 0) return;
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        // Use integer coordinates for faster rendering (bitwise OR)
        ctx.fillRect(this.x | 0, this.y | 0, this.size | 0, this.size | 0);
        ctx.globalAlpha = 1;
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
        if (this.life <= 0) return; // Skip dead fragments
        ctx.save();
        ctx.globalAlpha = this.life;
        // Use integer coordinates for faster rendering
        ctx.translate((this.x + this.size / 2) | 0, (this.y + this.size / 2) | 0);
        ctx.rotate((this.rotation * Math.PI) / 180);

        // Only use shadow on high-end devices
        if (perfSettings.shadowsEnabled) {
            ctx.shadowBlur = perfSettings.reducedShadowBlur;
            ctx.shadowColor = this.color;
        }

        ctx.fillStyle = this.color;
        const halfSize = (this.size / 2) | 0;
        ctx.fillRect(-halfSize, -halfSize, this.size | 0, this.size | 0);

        ctx.restore();
    }
}

function createParticles(x, y, count, color) {
    // Skip if particles are disabled
    if (!perfSettings.particlesEnabled) return;
    
    // Limit total particles for performance
    const availableSlots = perfSettings.maxParticles - particles.length;
    const actualCount = Math.min(count, availableSlots);
    
    if (actualCount <= 0) return;
    
    for (let i = 0; i < actualCount; i++) {
        // Use object pooling for better performance
        particles.push(getPooledParticle(x, y, color));
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
    abilityCoins = []; // Clear ability coins
    goldGodCooldown = 0; // Reset ability cooldown
    score = 0;
    distanceTraveled = 0;
    gameStartTime = Date.now(); // Reset timer
    timeSurvived = 0;
    coinsCollectedThisRun = 0; // Reset coins for this run
    obstaclesClearedThisRun = 0; // Reset obstacles cleared
    powerupsCollectedThisRun = 0; // Reset powerups collected
    lastCoinSpawnX = 0; // Reset coin spawn tracker
    lastObstacleSpawnDistance = 0; // Reset obstacle spawn tracker

    // Set starting speed based on mode
    let startSpeed;
    if (isUnlimitedMode) {
        startSpeed = UNLIMITED_MODE.startSpeed;
    } else {
        const levelConfig = LEVELS[currentLevel] || LEVELS[1];
        startSpeed = levelConfig.startSpeed;
    }
    gameSpeed = startSpeed;
    smoothGameSpeed = startSpeed;
    targetGameSpeed = startSpeed;
    lastTime = 0; // Reset delta time tracking

    slowMotionFactor = 1;
    finishLine = null;
    playerExploded = false;
    shieldCount = 0;
    isBoosting = false;
    boostTimer = 0;
    isBulldozing = false;
    bulldozerTimer = 0;
    isGhosting = false;
    ghostTimer = 0;
    isMagnet = false;
    magnetTimer = 0;
    safeModeTimer = 0;
    canvas.style.transform = ''; // Reset any screen shake

    document.getElementById('score').innerText = score;
    document.getElementById('current-level-num').innerText = isHardcoreMode ? '💀' : (isUnlimitedMode ? '∞' : currentLevel);
    document.getElementById('game-canvas').classList.remove('wasted-effect');
    document.getElementById('wasted-screen').classList.remove('active');
    updateShieldUI();

    // Note: Don't load progress here - loadProgress() handles it on page load
    // Loading here would overwrite progress saved during the current session
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
    
    // Cap spawn width to prevent cheating with ultra-wide screens
    // Use reference width or actual width, whichever is smaller
    spawnWidth = Math.min(canvas.width, REFERENCE_WIDTH);
    
    // Clear gradient cache on resize (gradients are canvas-size dependent)
    clearGradientCache();
    
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

    // Power-up Collisions - generous hitbox for better feel
    for (let p of powerUps) {
        if (p.markedForDeletion) continue;
        const dx = (player.x + player.size / 2) - (p.x + p.size / 2);
        const dy = (player.y + player.size / 2) - (p.y + p.size / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);

        // More generous collection radius - collect if any part touches
        const collectionRadius = player.size * 0.7 + p.size * 0.7;
        if (dist < collectionRadius) {
            p.markedForDeletion = true;
            if (p.type === 'HEART') {
                if (shieldCount < 3) {
                    shieldCount++;
                    updateShieldUI();
                    createParticles(player.x, player.y, 10, '#ff0055');
                    soundManager.playPowerup();
                    powerupsCollectedThisRun++; // Track powerup
                    awardSeasonXP(10); // 10 XP per powerup activation
                }
            } else if (p.type === 'BOOST') {
                isBoosting = true;
                boostTimer = 300; // 5 seconds at 60fps
                createParticles(player.x, player.y, 20, '#00f3ff');
                soundManager.playPowerup();
                powerupsCollectedThisRun++; // Track powerup
                awardSeasonXP(10); // 10 XP per powerup activation
            } else if (p.type === 'COIN') {
                coins += 1;
                coinsCollectedThisRun += 1;
                awardSeasonXP(2); // 2 XP per coin
                createParticles(player.x, player.y, 3, '#ffd700');
                saveProgress();
                updateUI();
                soundManager.playCoin();
            } else if (p.type === 'SUPER_COIN') {
                coins += 5;
                coinsCollectedThisRun += 5;
                awardSeasonXP(10); // 10 XP per super coin
                createParticles(player.x, player.y, 10, '#ffd700');
                createParticles(player.x, player.y, 5, '#ffffff');
                saveProgress();
                updateUI();
                soundManager.playCoin();
            } else if (p.type === 'HOPS') {
                // Rare crystal currency collected!
                const hopsAmount = 1 + Math.floor(Math.random() * 2); // 1-2 hops per crystal
                hops += hopsAmount;
                awardSeasonXP(500); // Big XP bonus for rare hops crystals
                createParticles(player.x, player.y, 15, '#00ffff');
                createParticles(player.x, player.y, 10, '#00ccff');
                createParticles(player.x, player.y, 5, '#ffffff');
                showToast(`+${hopsAmount} 💎 Hops!`, 'success');
                saveProgress();
                updateUI();
                updateHopsDisplay();
                soundManager.playPowerup();
            } else if (p.type === 'BULLDOZER') {
                // Activate bulldozer mode!
                isBulldozing = true;
                bulldozerTimer = 240; // 4 seconds at 60fps
                createParticles(player.x, player.y, 15, '#ff6600');
                createParticles(player.x, player.y, 10, '#ffaa00');
                soundManager.playBulldozer();
                soundManager.playPowerup();
                powerupsCollectedThisRun++; // Track powerup
                awardSeasonXP(10); // 10 XP per powerup activation
            } else if (p.type === 'GHOST') {
                // Activate ghost mode!
                isGhosting = true;
                ghostTimer = 300; // 5 seconds at 60fps
                createParticles(player.x, player.y, 20, '#88ddff');
                createParticles(player.x, player.y, 15, '#aaeeff');
                soundManager.playGhost();
                soundManager.playPowerup();
                powerupsCollectedThisRun++; // Track powerup
                awardSeasonXP(10); // 10 XP per powerup activation
            } else if (p.type === 'MAGNET') {
                // Activate magnet mode - pulls in coins!
                isMagnet = true;
                magnetTimer = 420; // 7 seconds at 60fps (longer than other powerups)
                createParticles(player.x, player.y, 15, '#ff00ff');
                createParticles(player.x, player.y, 10, '#ff66ff');
                soundManager.playPowerup();
                powerupsCollectedThisRun++; // Track powerup
            } else if (p.type === 'BOMB') {
                // BOOM! Launch player high into air
                player.dy = -50;
                player.isGrounded = false;
                player.canDoubleJump = true; // Give them double jump after bomb
                powerupsCollectedThisRun++; // Track powerup

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
    if (isGhosting) return; // Phase through obstacles while ghosting
    
    // Bulldozer mode - plow through obstacles!
    if (isBulldozing) {
        const playerRight = player.x + player.size + 20;
        const playerLeft = player.x - 10;
        for (let i = 0, len = obstacles.length; i < len; i++) {
            const obs = obstacles[i];
            // Check if obstacle is close to player (optimized bounds check)
            if (obs.x < playerRight && obs.x + obs.w > playerLeft && !obs.markedForDeletion) {
                obs.markedForDeletion = true;
                // Debris particles flying off (using pooled particles)
                const cx = obs.x + obs.w * 0.5;
                const cy = obs.y + obs.h * 0.5;
                for (let j = 0; j < 6; j++) { // Reduced particle count
                    const p = getPooledParticle(cx, cy, '#ff6600');
                    p.speedX = 5 + Math.random() * 10;
                    p.speedY = (Math.random() - 0.5) * 15;
                    p.size = 4 + Math.random() * 6;
                    particles.push(p);
                }
                // Play rumble sound occasionally
                if (Math.random() < 0.3) soundManager.playBulldozer();
            }
        }
        return; // Invincible while bulldozing
    }

    // Pre-calculate player center and bounds for collision checks
    const playerCenterX = player.x + player.size * 0.5;
    const playerCenterY = player.y + player.size * 0.5;
    const playerHalfSize = player.size * 0.5;
    const pRectRight = pRect.x + pRect.w;
    const pRectBottom = pRect.y + pRect.h;
    
    for (let i = 0, len = obstacles.length; i < len; i++) {
        const obs = obstacles[i];
        
        // Early culling - skip obstacles that are definitely not near player
        if (obs.x > pRectRight + 50 || obs.x + obs.w < pRect.x - 50) continue;
        
        // Skip laser if it's off
        if (obs.type === 'LASER' && !obs.isActive()) continue;
        
        let collision = false;

        if (obs.type === 'SAW' || obs.type === 'MOVING_SAW') {
            // Circle collision for saws (optimized - avoid sqrt when possible)
            const dx = playerCenterX - (obs.x + obs.w * 0.5);
            const dy = playerCenterY - (obs.y + obs.h * 0.5);
            const distSq = dx * dx + dy * dy;
            const minDist = playerHalfSize + obs.w * 0.5 - 10;
            if (distSq < minDist * minDist) {
                collision = true;
            }
        } else if (obs.type === 'LASER') {
            // Thin hitbox for laser
            if (
                pRect.x < obs.x + obs.w + 5 &&
                pRectRight > obs.x - 5 &&
                pRect.y < obs.y + obs.h &&
                pRectBottom > obs.y
            ) {
                collision = true;
            }
        } else {
            // AABB for blocks/spikes/pillars (inlined bounds)
            const obsLeft = obs.x + 5;
            const obsTop = obs.y + 5;
            const obsRight = obs.x + obs.w - 5;
            const obsBottom = obs.y + obs.h - 5;
            if (
                pRect.x < obsRight &&
                pRectRight > obsLeft &&
                pRect.y < obsBottom &&
                pRectBottom > obsTop
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
                    player.usedDoubleJump = false; // Reset double jump gravity
                    // Snap rotation
                    const snap = Math.round(player.rotation / 90) * 90;
                    player.rotation = snap;
                    return; // Safe landing
                }
            }

            // If we are here, it's a deadly collision
            if (shieldCount > 0 && player.flashTimer <= 0) {
                // Only take damage if not already flashing (invincibility frames)
                shieldCount--;
                updateShieldUI();
                obs.markedForDeletion = true; // Destroy obstacle
                createParticles(obs.x, obs.y, 8, '#fff');
                createParticles(player.x + player.size/2, player.y + player.size/2, 5, '#ff0055'); // Red particles from player
                player.triggerFlash(); // Flash effect with invincibility
            } else if (shieldCount <= 0 && player.flashTimer <= 0) {
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
let hops = 0; // Premium currency (crystals)
let highScore = 0;
let unlockedColors = ['#00f3ff'];
let unlockedShapes = ['square'];
let unlockedBackgrounds = ['default', 'space'];
let unlockedSkins = ['none']; // 'none' means use shape/color instead
let customColorUnlocked = false; // Custom color picker costs 5000 coins

// Season Pass
let seasonPassLevel = 1;
let seasonPassXP = 0;
const SEASON_PASS_XP_PER_LEVEL = 1000;
const SEASON_PASS_MAX_LEVEL = 75;
let seasonPassPremium = false; // Whether user bought premium pass
let claimedRewards = []; // Track which rewards have been claimed
let currentBackground = 'default';
let playerSkin = 'none'; // Currently equipped skin

// Character Skins definitions
// SKINS ARE REWARDS PASS EXCLUSIVE - Cannot be purchased with coins!
// Skins use imageUrl for custom uploaded sprites from Cloudinary
const SKINS = {
    'doom': { 
        name: 'Doom', 
        description: 'Rip and tear',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764493131/south-east_q0xnqy.png'
    },
    'mech-monkey': { 
        name: 'Mech Monkey', 
        description: 'Mechanical primate warrior',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764493131/mechmonkey_avmf2e.png'
    },
    'marlon': { 
        name: 'Marlon', 
        description: 'The legendary Marlon',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764493131/Marlon_efpi9s.png'
    },
    'alien': { 
        name: 'Alien', 
        description: 'Extraterrestrial visitor',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764493131/Alien_ijrpn4.png'
    },
    'dale': { 
        name: 'Dale', 
        description: 'Good ol\' Dale',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764493131/Dale_d68wep.png'
    },
    'derry-devil': { 
        name: 'Derry Devil', 
        description: 'We all float down here',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764493131/Pennywise_syerh5.png'
    },
    'superdude': { 
        name: 'Superdude', 
        description: 'Faster than a speeding bullet',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764490149/south-east_rxxbcf.png',
        flyingImageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764494541/east_lj04zt.png'
    },
    // New skins
    'saiyan': {
        name: 'Saiyan',
        description: 'Power level over 9000!',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764509697/Saiyan_hrzpzg.png'
    },
    'cupid': {
        name: 'Cupid',
        description: 'Spreading love and arrows',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764509697/Cupid_hausfn.png'
    },
    'metalman': {
        name: 'Metalman',
        description: 'Forged in iron, heart of gold',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764509697/Metalman_e28r9s.png'
    },
    'gold-god': {
        name: 'Gold God',
        description: 'The Midas touch',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764509697/Gold_God_cuvjtx.png',
        ability: '[Ability] Blasts 5 coins in front of you every 10 seconds'
    },
    'strange': {
        name: 'Strange',
        description: 'Master of the mystic arts',
        imageUrl: 'https://res.cloudinary.com/do61mfyhn/image/upload/v1764509697/Strange_qovdcm.png'
    }
};

// Draw a pixel art skin on canvas
function drawPixelSkin(ctx, skinId, x, y, size) {
    const skin = SKINS[skinId];
    if (!skin || !skin.pixels) return false;
    
    const gridSize = skin.pixels.length; // Dynamic grid size (20x20)
    const pixelSize = size / gridSize;
    const pixels = skin.pixels;
    const colors = skin.colors;
    
    for (let row = 0; row < pixels.length; row++) {
        for (let col = 0; col < pixels[row].length; col++) {
            const colorKey = parseInt(pixels[row][col]);
            if (colorKey > 0 && colors[colorKey]) {
                ctx.fillStyle = colors[colorKey];
                ctx.fillRect(
                    x + col * pixelSize,
                    y + row * pixelSize,
                    Math.ceil(pixelSize) + 0.5, // Slight overlap to prevent gaps
                    Math.ceil(pixelSize) + 0.5
                );
            }
        }
    }
    return true;
}

// Create a cached canvas for each skin for better performance
const skinCanvasCache = {};
function getSkinCanvas(skinId, size) {
    const cacheKey = `${skinId}_${size}`;
    if (skinCanvasCache[cacheKey]) return skinCanvasCache[cacheKey];
    
    const skin = SKINS[skinId];
    if (!skin || !skin.pixels) return null;
    
    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    const offCtx = offscreen.getContext('2d');
    
    // Enable image smoothing off for crisp pixels
    offCtx.imageSmoothingEnabled = false;
    
    drawPixelSkin(offCtx, skinId, 0, 0, size);
    
    skinCanvasCache[cacheKey] = offscreen;
    return offscreen;
}

// Image-based skins storage
const skinImages = {};

// Load image-based skins
function loadSkinImage(skinId, url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            skinImages[skinId] = img;
            resolve(img);
        };
        img.onerror = reject;
        img.src = url;
    });
}

function preloadSkinSprites() {
    // Clear cache to ensure fresh sprites
    for (const key in skinCanvasCache) {
        delete skinCanvasCache[key];
    }
    
    // Pre-cache common sizes for pixel-based sprites
    for (const skinId of Object.keys(SKINS)) {
        if (skinId !== 'none' && SKINS[skinId].pixels) {
            getSkinCanvas(skinId, 64);  // Game size (2x scale)
            getSkinCanvas(skinId, 80);  // Preview panel size
            getSkinCanvas(skinId, 64);  // Shop icon size
            getSkinCanvas(skinId, 128); // Large preview
        }
        // Load image-based skins
        if (SKINS[skinId].imageUrl) {
            loadSkinImage(skinId, SKINS[skinId].imageUrl);
        }
        // Load flying sprite variants
        if (SKINS[skinId].flyingImageUrl) {
            loadSkinImage(skinId + '_flying', SKINS[skinId].flyingImageUrl);
        }
    }
}
let gameStartTime = 0;
let timeSurvived = 0;

// Season Pass Rewards Definition
// FREE = Odd levels (1, 3, 5, 7...)
// VIP = Even levels (2, 4, 6, 8...)
const SEASON_PASS_REWARDS = {
    free: [
        // Odd levels 1-75 (Free Track) - Includes 4 FREE skins!
        { level: 1, type: 'coins', amount: 50, icon: '🪙', name: '50 Coins' },
        { level: 3, type: 'coins', amount: 75, icon: '🪙', name: '75 Coins' },
        { level: 5, type: 'hops', amount: 5, icon: '💎', name: '5 Hops' },
        { level: 7, type: 'skin', value: 'dale', icon: '🤠', name: 'Dale' },
        { level: 9, type: 'coins', amount: 125, icon: '🪙', name: '125 Coins' },
        { level: 11, type: 'hops', amount: 10, icon: '💎', name: '10 Hops' },
        { level: 13, type: 'coins', amount: 150, icon: '🪙', name: '150 Coins' },
        { level: 15, type: 'background', value: 'vortex', icon: '🌀', name: 'Vortex' },
        { level: 17, type: 'coins', amount: 200, icon: '🪙', name: '200 Coins' },
        { level: 19, type: 'skin', value: 'doom', icon: '💀', name: 'Doom' },
        { level: 21, type: 'coins', amount: 250, icon: '🪙', name: '250 Coins' },
        { level: 23, type: 'hops', amount: 15, icon: '💎', name: '15 Hops' },
        { level: 25, type: 'background', value: 'cybergrid', icon: '📐', name: 'Cyber Grid' },
        { level: 27, type: 'coins', amount: 300, icon: '🪙', name: '300 Coins' },
        { level: 29, type: 'coins', amount: 400, icon: '🪙', name: '400 Coins' },
        { level: 31, type: 'skin', value: 'marlon', icon: '😎', name: 'Marlon' },
        { level: 33, type: 'hops', amount: 25, icon: '💎', name: '25 Hops' },
        { level: 35, type: 'background', value: 'abyss', icon: '🕳️', name: 'The Abyss' },
        { level: 37, type: 'coins', amount: 500, icon: '🪙', name: '500 Coins' },
        { level: 39, type: 'hops', amount: 30, icon: '💎', name: '30 Hops' },
        { level: 41, type: 'coins', amount: 600, icon: '🪙', name: '600 Coins' },
        { level: 43, type: 'skin', value: 'mech-monkey', icon: '🐒', name: 'Mech Monkey' },
        { level: 45, type: 'background', value: 'prismatic', icon: '🌈', name: 'Prismatic' },
        { level: 47, type: 'hops', amount: 40, icon: '💎', name: '40 Hops' },
        { level: 49, type: 'coins', amount: 800, icon: '🪙', name: '800 Coins' },
        { level: 51, type: 'coins', amount: 900, icon: '🪙', name: '900 Coins' },
        { level: 53, type: 'hops', amount: 50, icon: '💎', name: '50 Hops' },
        { level: 55, type: 'coins', amount: 1000, icon: '🪙', name: '1K Coins' },
        { level: 57, type: 'coins', amount: 1200, icon: '🪙', name: '1.2K Coins' },
        { level: 59, type: 'hops', amount: 60, icon: '💎', name: '60 Hops' },
        { level: 61, type: 'coins', amount: 1500, icon: '🪙', name: '1.5K Coins' },
        { level: 63, type: 'coins', amount: 1750, icon: '🪙', name: '1.75K Coins' },
        { level: 65, type: 'hops', amount: 75, icon: '💎', name: '75 Hops' },
        { level: 67, type: 'coins', amount: 2000, icon: '🪙', name: '2K Coins' },
        { level: 69, type: 'coins', amount: 2500, icon: '🪙', name: '2.5K Coins' },
        { level: 71, type: 'hops', amount: 100, icon: '💎', name: '100 Hops' },
        { level: 73, type: 'coins', amount: 3000, icon: '🪙', name: '3K Coins' },
        { level: 75, type: 'hops', amount: 150, icon: '💎', name: '150 Hops' },
    ],
    premium: [
        // Even levels 2-74 (VIP Track) - Premium skins only!
        { level: 2, type: 'hops', amount: 25, icon: '💎', name: '25 Hops' },
        { level: 4, type: 'coins', amount: 200, icon: '🪙', name: '200 Coins' },
        { level: 6, type: 'hops', amount: 35, icon: '💎', name: '35 Hops' },
        { level: 8, type: 'coins', amount: 300, icon: '🪙', name: '300 Coins' },
        { level: 10, type: 'background', value: 'inferno', icon: '🔥', name: 'Inferno' },
        { level: 12, type: 'skin', value: 'alien', icon: '👽', name: 'Alien' },
        { level: 14, type: 'hops', amount: 50, icon: '💎', name: '50 Hops' },
        { level: 16, type: 'coins', amount: 400, icon: '🪙', name: '400 Coins' },
        { level: 18, type: 'coins', amount: 500, icon: '🪙', name: '500 Coins' },
        { level: 20, type: 'background', value: 'throneroom', icon: '⚔️', name: 'Iron Throne' },
        { level: 22, type: 'hops', amount: 65, icon: '💎', name: '65 Hops' },
        { level: 24, type: 'skin', value: 'derry-devil', icon: '🎈', name: 'Derry Devil' },
        { level: 26, type: 'coins', amount: 750, icon: '🪙', name: '750 Coins' },
        { level: 28, type: 'hops', amount: 80, icon: '💎', name: '80 Hops' },
        { level: 30, type: 'background', value: 'nebulacore', icon: '🌟', name: 'Nebula Core' },
        { level: 32, type: 'coins', amount: 1000, icon: '🪙', name: '1K Coins' },
        { level: 34, type: 'skin', value: 'superdude', icon: '🦸', name: 'Superdude' },
        { level: 36, type: 'hops', amount: 100, icon: '💎', name: '100 Hops' },
        { level: 38, type: 'coins', amount: 1200, icon: '🪙', name: '1.2K Coins' },
        { level: 40, type: 'background', value: 'obsidian', icon: '🖤', name: 'Obsidian' },
        { level: 42, type: 'hops', amount: 125, icon: '💎', name: '125 Hops' },
        { level: 44, type: 'skin', value: 'cupid', icon: '💘', name: 'Cupid' },
        { level: 46, type: 'coins', amount: 1500, icon: '🪙', name: '1.5K Coins' },
        { level: 48, type: 'hops', amount: 150, icon: '💎', name: '150 Hops' },
        { level: 50, type: 'skin', value: 'saiyan', icon: '⚡', name: 'Saiyan' },
        { level: 52, type: 'coins', amount: 1750, icon: '🪙', name: '1.75K Coins' },
        { level: 54, type: 'skin', value: 'metalman', icon: '🤖', name: 'Metalman' },
        { level: 56, type: 'hops', amount: 175, icon: '💎', name: '175 Hops' },
        { level: 58, type: 'coins', amount: 2000, icon: '🪙', name: '2K Coins' },
        { level: 60, type: 'skin', value: 'strange', icon: '🔮', name: 'Strange' },
        { level: 62, type: 'hops', amount: 200, icon: '💎', name: '200 Hops' },
        { level: 64, type: 'coins', amount: 2500, icon: '🪙', name: '2.5K Coins' },
        { level: 66, type: 'hops', amount: 250, icon: '💎', name: '250 Hops' },
        { level: 68, type: 'coins', amount: 3000, icon: '🪙', name: '3K Coins' },
        { level: 70, type: 'hops', amount: 300, icon: '💎', name: '300 Hops' },
        { level: 72, type: 'coins', amount: 4000, icon: '🪙', name: '4K Coins' },
        { level: 74, type: 'skin', value: 'gold-god', icon: '👑', name: 'Gold God' },
    ]
};

// Award Season Pass XP
function awardSeasonXP(amount) {
    seasonPassXP += amount;
    while (seasonPassXP >= SEASON_PASS_XP_PER_LEVEL && seasonPassLevel < SEASON_PASS_MAX_LEVEL) {
        seasonPassXP -= SEASON_PASS_XP_PER_LEVEL;
        seasonPassLevel++;
        showToast(`Level Up! Now Level ${seasonPassLevel}!`, 'success');
    }
    if (seasonPassLevel >= SEASON_PASS_MAX_LEVEL) {
        seasonPassXP = Math.min(seasonPassXP, SEASON_PASS_XP_PER_LEVEL);
    }
}

// Claim Season Pass Reward
function claimSeasonReward(track, level) {
    const rewardKey = `${track}_${level}`;
    if (claimedRewards.includes(rewardKey)) {
        showToast('Already claimed!', 'error');
        return false;
    }
    
    if (seasonPassLevel < level) {
        showToast('Level too low!', 'error');
        return false;
    }
    
    if (track === 'premium' && !seasonPassPremium) {
        showToast('VIP required!', 'error');
        return false;
    }
    
    const rewards = track === 'free' ? SEASON_PASS_REWARDS.free : SEASON_PASS_REWARDS.premium;
    const reward = rewards.find(r => r.level === level);
    if (!reward) return false;
    
    // Grant reward based on type
    switch (reward.type) {
        case 'coins':
            coins += reward.amount;
            console.log(`🪙 Granted ${reward.amount} coins. New total: ${coins}`);
            break;
        case 'hops':
            hops += reward.amount;
            console.log(`💎 Granted ${reward.amount} hops. New total: ${hops}`);
            break;
        case 'color':
            if (!unlockedColors.includes(reward.value)) {
                unlockedColors.push(reward.value);
                console.log(`🎨 Unlocked color: ${reward.value}`);
            }
            break;
        case 'shape':
            if (!unlockedShapes.includes(reward.value)) {
                unlockedShapes.push(reward.value);
                console.log(`🔷 Unlocked shape: ${reward.value}`);
            }
            break;
        case 'background':
            if (!unlockedBackgrounds.includes(reward.value)) {
                unlockedBackgrounds.push(reward.value);
                console.log(`🖼️ Unlocked background: ${reward.value}`);
            }
            break;
        case 'skin':
            if (!unlockedSkins.includes(reward.value)) {
                unlockedSkins.push(reward.value);
                console.log(`👤 Unlocked skin: ${reward.value}`);
            }
            break;
        case 'title':
            // Store title (could add a titles array later)
            console.log(`🏆 Granted title: ${reward.value}`);
            break;
    }
    
    claimedRewards.push(rewardKey);
    showToast(`Claimed: ${reward.name}!`, 'success');
    
    // Save progress
    saveProgress();
    saveToCloud();
    
    // Update ALL UI elements
    updateUI(); // Update main UI (coins display)
    updateHopsDisplay(); // Update hops display
    renderRewardsUI(); // Update rewards screen
    
    console.log(`✅ Reward claimed: ${reward.name} (${rewardKey})`);
    return true;
}

// Render Rewards UI
function renderRewardsUI() {
    // Update header info
    const levelEl = document.getElementById('rewards-level');
    const xpTextEl = document.getElementById('rewards-xp-text');
    const coinsEl = document.getElementById('rewards-coins');
    const hopsEl = document.getElementById('rewards-hops');
    const xpFillEl = document.getElementById('rewards-xp-fill');
    
    if (levelEl) levelEl.textContent = seasonPassLevel;
    if (xpTextEl) xpTextEl.textContent = `${seasonPassXP} / ${SEASON_PASS_XP_PER_LEVEL} XP`;
    if (coinsEl) coinsEl.textContent = coins;
    if (hopsEl) hopsEl.textContent = hops;
    
    // XP bar fill
    const xpPercent = (seasonPassXP / SEASON_PASS_XP_PER_LEVEL) * 100;
    if (xpFillEl) xpFillEl.style.width = `${xpPercent}%`;
    
    // VIP buttons
    const vipBtn = document.getElementById('unlock-vip-btn');
    const vipCoinsBtn = document.getElementById('unlock-vip-coins-btn');
    if (vipBtn) {
        if (seasonPassPremium) {
            vipBtn.textContent = '✓ VIP Active';
            vipBtn.classList.add('owned');
        } else {
            vipBtn.textContent = 'Unlock 💎500';
            vipBtn.classList.remove('owned');
        }
    }
    if (vipCoinsBtn) {
        if (seasonPassPremium) {
            vipCoinsBtn.style.display = 'none';
        } else {
            vipCoinsBtn.style.display = '';
            vipCoinsBtn.textContent = 'Unlock 🪙20,000';
        }
    }
    
    // Render free rewards grid
    const freeGrid = document.getElementById('free-rewards-grid');
    if (freeGrid) {
        freeGrid.innerHTML = '';
        
        SEASON_PASS_REWARDS.free.forEach(reward => {
            const claimed = claimedRewards.includes(`free_${reward.level}`);
            const unlocked = seasonPassLevel >= reward.level;
            
            const item = document.createElement('div');
            item.className = `reward-item ${claimed ? 'claimed' : ''} ${unlocked ? 'unlocked' : 'locked'}`;
            
            // Check if reward is a skin - show actual skin image instead of emoji
            let iconHtml = `<div class="reward-icon">${reward.icon}</div>`;
            if (reward.type === 'skin' && SKINS[reward.value] && SKINS[reward.value].imageUrl) {
                iconHtml = `<div class="reward-icon reward-skin-icon"><img src="${SKINS[reward.value].imageUrl}" alt="${reward.name}" /></div>`;
            }
            
            item.innerHTML = `
                <div class="reward-level">Lv.${reward.level}</div>
                ${iconHtml}
                <div class="reward-name">${reward.name}</div>
            `;
            
            if (unlocked && !claimed) {
                item.addEventListener('click', () => claimSeasonReward('free', reward.level));
            }
            
            freeGrid.appendChild(item);
        });
    }
    
    // Render VIP rewards grid
    const vipGrid = document.getElementById('vip-rewards-grid');
    if (vipGrid) {
        vipGrid.innerHTML = '';
        
        SEASON_PASS_REWARDS.premium.forEach(reward => {
            const claimed = claimedRewards.includes(`premium_${reward.level}`);
            const unlocked = seasonPassLevel >= reward.level && seasonPassPremium;
            
            const item = document.createElement('div');
            item.className = `reward-item ${claimed ? 'claimed' : ''} ${unlocked ? 'unlocked' : 'locked'}`;
            
            // Check if reward is a skin - show actual skin image instead of emoji
            let iconHtml = `<div class="reward-icon">${reward.icon}</div>`;
            if (reward.type === 'skin' && SKINS[reward.value] && SKINS[reward.value].imageUrl) {
                iconHtml = `<div class="reward-icon reward-skin-icon"><img src="${SKINS[reward.value].imageUrl}" alt="${reward.name}" /></div>`;
            }
            
            item.innerHTML = `
                <div class="reward-level">Lv.${reward.level}</div>
                ${iconHtml}
                <div class="reward-name">${reward.name}</div>
            `;
            
            if (unlocked && !claimed) {
                item.addEventListener('click', () => claimSeasonReward('premium', reward.level));
            }
            
            vipGrid.appendChild(item);
        });
    }
    
    // Reset scroll positions after DOM update - use multiple methods for reliability
    const resetScrollPositions = () => {
        const freeScroll = document.querySelector('.free-track .track-scroll-container');
        const vipScroll = document.querySelector('.vip-track .track-scroll-container');
        if (freeScroll) {
            freeScroll.scrollLeft = 0;
            freeScroll.scrollTo({ left: 0, behavior: 'instant' });
        }
        if (vipScroll) {
            vipScroll.scrollLeft = 0;
            vipScroll.scrollTo({ left: 0, behavior: 'instant' });
        }
    };
    
    // Call immediately, after animation frame, and after short delay
    resetScrollPositions();
    requestAnimationFrame(resetScrollPositions);
    setTimeout(resetScrollPositions, 50);
    setTimeout(resetScrollPositions, 150);
}

// Hide all UI screens
function hideAllScreens() {
    const screens = [
        'level-select-screen',
        'customize-screen', 
        'rewards-screen',
        'game-over-screen',
        'level-complete-screen',
        'settings-modal'
    ];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
}

// Show Rewards Screen
function showRewards() {
    hideAllScreens();
    const screen = document.getElementById('rewards-screen');
    if (screen) screen.classList.add('active');
    gameState = 'REWARDS';
    renderRewardsUI();
}

// Hide Rewards Screen
function hideRewards() {
    const screen = document.getElementById('rewards-screen');
    if (screen) screen.classList.remove('active');
    showLevelSelect();
}

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
        'circle': 500,
        'triangle': 500,
        'diamond': 500,
        'hexagon': 500,
        'star': 500
    },
    backgrounds: {
        'default': 0,
        'space': 0,
        'midnight': 1000,
        'forest': 1000,
        'ocean': 1000,
        'desert': 1000,
        'arctic': 1000,
        'twilight': 1000,
        'mountain': 1000,
        'cherry': 1000,
        'underwater': 1000,
        'cosmos': 1000,
        'aurora': 1000,
        'volcanic': 1000,
        'crystal': 1000,
        'storm': 1000,
        'synthwave': 1000,
        'ethereal': 1000,
        'firefly': 1000,
        'northern': 1000,
        // Exclusive Reward-Only Backgrounds (-1 = cannot buy with gold)
        'vortex': -1,        // 3D swirling vortex
        'cybergrid': -1,     // 3D perspective flying grid
        'inferno': -1,       // 3D fiery hellscape
        'abyss': -1,         // Deep glowing chasm
        'throneroom': -1,    // Royal palace with 3D pillars
        'nebulacore': -1,    // Heart of a nebula
        'obsidian': -1,      // Dark volcanic glass
        'prismatic': -1      // Rainbow light refraction
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

    // Track lifetime stats
    allTimeDeaths++;
    allTimeCoins += coinsCollectedThisRun;
    allTimePowerups += powerupsCollectedThisRun;
    allTimeObstaclesCleared += obstaclesClearedThisRun;
    totalDistanceMeters += distanceTraveled / 50; // Convert game units to "meters"

    // Score-based XP on game over: 20 XP per 80 score
    const scoreXP = Math.floor(score / 80) * 20;
    if (scoreXP > 0) {
        awardSeasonXP(scoreXP);
    }

    // Economy Update
    // coins += score; // Removed
    if (score > highScore) {
        highScore = score;
    }
    saveProgress();
    updateUI();
    
    // Sync to cloud on death
    if (cloudSyncEnabled) saveToCloud();

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

    // Track lifetime stats on level complete
    allTimeCoins += coinsCollectedThisRun;
    allTimePowerups += powerupsCollectedThisRun;
    allTimeObstaclesCleared += obstaclesClearedThisRun;
    totalDistanceMeters += distanceTraveled / 50; // Convert game units to "meters"
    
    // Award Season Pass XP for completing level
    // Check if this is a NEW level completion or a REPEAT
    const nextLevel = currentLevel + 1;
    const isNewLevelCompletion = nextLevel <= 20 && nextLevel > unlockedLevels;
    
    // XP rewards: 500 for NEW level, 60 for REPEAT
    const levelXP = isNewLevelCompletion ? 500 : 60;
    awardSeasonXP(levelXP);
    
    // Score-based XP: 20 XP per 80 score
    const scoreXP = Math.floor(score / 80) * 20;
    if (scoreXP > 0) {
        awardSeasonXP(scoreXP);
    }
    
    // Award bonus hops for first-time completion (rare drop)
    if (Math.random() < 0.15) { // 15% chance
        const hopsEarned = Math.floor(Math.random() * 5) + 1; // 1-5 hops
        hops += hopsEarned;
        showToast(`+${hopsEarned} 💎 Hops!`, 'success');
    }

    // Economy Update
    if (score > highScore) {
        highScore = score;
    }

    // Unlock next level IMMEDIATELY when crossing finish line
    if (isNewLevelCompletion) {
        unlockedLevels = nextLevel;
        console.log(`Level ${nextLevel} unlocked! unlockedLevels is now: ${unlockedLevels}`);
        document.getElementById('level-complete-message').innerText = `Level ${nextLevel} Unlocked!`;
    } else if (currentLevel === 20) {
        document.getElementById('level-complete-message').innerText = '🎉 All Quest Levels Complete! 🎉';
    } else {
        document.getElementById('level-complete-message').innerText = 'Level Complete!';
    }
    
    // Save progress RIGHT AWAY so it persists
    saveProgress();
    updateUI();
    updateLevelButtons(); // Update the level select UI immediately
    
    // Sync to cloud on level complete
    if (cloudSyncEnabled) saveToCloud();
    
    // Also update level buttons immediately
    updateLevelButtons();

    createParticles(player.x + player.size / 2, player.y + player.size / 2, 100, '#00ff00');
    document.getElementById('current-level-display').classList.remove('visible');
    document.getElementById('level-complete-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
}

function update(dt = 1) {
    if (gameState !== 'PLAYING') return;

    // Calculate distance-based score (update DOM only when score changes)
    const newScore = Math.floor(distanceTraveled / 100);
    if (newScore !== score) {
        score = newScore;
        const scoreEl = getCachedElement('score');
        if (scoreEl) scoreEl.innerText = score;
    }

    player.update(dt);

    // Speed Progression - Calculate target speed
    if (isUnlimitedMode) {
        if (isHardcoreMode) {
            // Hardcore mode - faster scaling, higher max speed (unchanged)
            const hardcoreProgress = Math.min(distanceTraveled / 100000, 1);
            const easedProgress = 1 - (1 - hardcoreProgress) * (1 - hardcoreProgress);
            targetGameSpeed = UNLIMITED_MODE.startSpeed + (UNLIMITED_MODE.hardcoreMaxSpeed - UNLIMITED_MODE.startSpeed) * easedProgress;
        } else {
            // Unlimited mode - slower scaling, capped max speed
            const unlimitedProgress = Math.min(distanceTraveled / UNLIMITED_MODE.scaleDistance, 1);
            const easedProgress = 1 - (1 - unlimitedProgress) * (1 - unlimitedProgress);
            targetGameSpeed = UNLIMITED_MODE.startSpeed + (UNLIMITED_MODE.maxSpeed - UNLIMITED_MODE.startSpeed) * easedProgress;
        }
    } else {
        const levelConfig = LEVELS[currentLevel];
        const progress = Math.min(distanceTraveled / levelConfig.length, 1);
        // Use easeOutQuad for smoother speed curve
        const easedProgress = 1 - (1 - progress) * (1 - progress);
        targetGameSpeed = levelConfig.startSpeed + (levelConfig.maxSpeed - levelConfig.startSpeed) * easedProgress;
    }
    
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
            // No obstacle clear - powerup simply expires
        }
    }
    
    // Bulldozer mode timer and effects
    if (isBulldozing) {
        bulldozerTimer -= dt;
        
        // Spawn dust/debris particles while bulldozing (only if not blinking off)
        if (perfSettings.particlesEnabled && Math.random() < 0.4 * dt) {
            const p = getPooledParticle(player.x - 10, player.y + player.size, '#8B4513');
            p.speedX = -3 - Math.random() * 5;
            p.speedY = -1 - Math.random() * 3;
            p.size = 4 + Math.random() * 4;
            particles.push(p);
        }
        
        // Screen shake effect (subtle) - only when not about to expire
        if (bulldozerTimer > 60 && Math.random() < 0.1 * dt) {
            canvas.style.transform = `translate(${(Math.random() - 0.5) * 4}px, ${(Math.random() - 0.5) * 2}px)`;
        } else if (bulldozerTimer <= 60) {
            canvas.style.transform = '';
        }
        
        if (bulldozerTimer <= 0) {
            isBulldozing = false;
            canvas.style.transform = ''; // Reset any screen shake
            // No obstacle clear - powerup simply expires
        }
    }
    
    // Ghost mode timer and effects
    if (isGhosting) {
        ghostTimer -= dt;
        
        // Spawn ethereal particles while ghosting
        if (perfSettings.particlesEnabled && Math.random() < 0.5 * dt) {
            const p = getPooledParticle(
                player.x + Math.random() * player.size,
                player.y + Math.random() * player.size,
                '#88ddff'
            );
            p.speedX = (Math.random() - 0.5) * 3;
            p.speedY = -2 - Math.random() * 2;
            p.size = 3 + Math.random() * 4;
            p.life = 0.6;
            particles.push(p);
        }
        
        // Occasional wisp particles trailing behind
        if (perfSettings.particlesEnabled && Math.random() < 0.3 * dt) {
            const p = getPooledParticle(
                player.x - 5 - Math.random() * 10,
                player.y + player.size / 2,
                '#aaeeff'
            );
            p.speedX = -2 - Math.random() * 3;
            p.speedY = (Math.random() - 0.5) * 2;
            p.size = 5 + Math.random() * 5;
            p.life = 0.4;
            particles.push(p);
        }
        
        if (ghostTimer <= 0) {
            isGhosting = false;
            // No obstacle clear - powerup simply expires
        }
    }
    
    // Magnet mode - pulls in nearby coins
    if (isMagnet) {
        magnetTimer -= dt;
        
        // Magnet particles around player
        if (perfSettings.particlesEnabled && Math.random() < 0.4 * dt) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 40 + Math.random() * 30;
            const p = getPooledParticle(
                player.x + player.size / 2 + Math.cos(angle) * dist,
                player.y + player.size / 2 + Math.sin(angle) * dist,
                '#ff00ff'
            );
            // Particles move toward player
            p.speedX = -Math.cos(angle) * 3;
            p.speedY = -Math.sin(angle) * 3;
            p.size = 3 + Math.random() * 3;
            p.life = 0.5;
            particles.push(p);
        }
        
        // Pull in nearby powerups (all types, not just coins)
        const magnetRange = 250; // Attraction range in pixels
        const magnetStrength = 8; // How fast powerups are pulled
        const playerCenterX = player.x + player.size / 2;
        const playerCenterY = player.y + player.size / 2;
        
        for (let pu of powerUps) {
            if (!pu.markedForDeletion) {
                const dx = playerCenterX - (pu.x + pu.size / 2);
                const dy = playerCenterY - (pu.y + pu.size / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < magnetRange && dist > 5) {
                    // Pull powerup toward player
                    const pullForce = (magnetStrength * dt) / Math.max(dist * 0.1, 1);
                    pu.x += (dx / dist) * pullForce * 10;
                    pu.y += (dy / dist) * pullForce * 10;
                }
            }
        }
        
        if (magnetTimer <= 0) {
            isMagnet = false;
            // Powerup expires
        }
    }
    
    // Gold God ability cooldown
    if (goldGodCooldown > 0) {
        goldGodCooldown -= dt;
        if (goldGodCooldown < 0) goldGodCooldown = 0;
    }
    
    // Update ability coins
    for (let i = abilityCoins.length - 1; i >= 0; i--) {
        abilityCoins[i].update(dt);
        if (abilityCoins[i].life <= 0) {
            abilityCoins.splice(i, 1);
        }
    }
    
    if (safeModeTimer > 0) safeModeTimer -= dt;
    if (landingGracePeriod > 0) landingGracePeriod -= dt;

    spawnObstacle();
    spawnCoinsSafely(); // Spawn coins separately for more consistent pickups
    
    // Optimized array updates - in-place compaction (no splice calls, reduces GC)
    let writeIdx = 0;
    for (let i = 0, len = obstacles.length; i < len; i++) {
        obstacles[i].update(dt);
        if (!obstacles[i].markedForDeletion) {
            if (writeIdx !== i) obstacles[writeIdx] = obstacles[i];
            writeIdx++;
        } else if (obstacles[i].clearedByPlayer) {
            obstaclesClearedThisRun++;
        }
    }
    obstacles.length = writeIdx;

    // Power-ups compaction
    writeIdx = 0;
    for (let i = 0, len = powerUps.length; i < len; i++) {
        powerUps[i].update(dt);
        if (!powerUps[i].markedForDeletion) {
            if (writeIdx !== i) powerUps[writeIdx] = powerUps[i];
            writeIdx++;
        }
    }
    powerUps.length = writeIdx;

    if (finishLine) {
        finishLine.update(dt);
    }

    // Limit particles for performance
    if (particles.length > perfSettings.maxParticles) {
        // Return excess particles to pool
        for (let i = perfSettings.maxParticles; i < particles.length; i++) {
            returnToPool(particles[i]);
        }
        particles.length = perfSettings.maxParticles;
    }
    
    // Particles compaction with pooling
    writeIdx = 0;
    for (let i = 0, len = particles.length; i < len; i++) {
        particles[i].update(dt);
        if (particles[i].active && particles[i].life > 0) {
            if (writeIdx !== i) particles[writeIdx] = particles[i];
            writeIdx++;
        } else {
            returnToPool(particles[i]);
        }
    }
    particles.length = writeIdx;

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
            // Deep Space - Rich cosmic vista
            const spaceGrad = ctx.createRadialGradient(
                canvas.width * 0.3, canvas.height * 0.5, 0,
                canvas.width * 0.5, canvas.height * 0.5, canvas.width
            );
            spaceGrad.addColorStop(0, '#0a0515');
            spaceGrad.addColorStop(0.4, '#050210');
            spaceGrad.addColorStop(1, '#000005');
            ctx.fillStyle = spaceGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Multiple nebula layers for depth
            const nebulas = [
                { x: 0.25, y: 0.35, r: 250, c1: '#ff0066', c2: '#6600aa' },
                { x: 0.7, y: 0.5, r: 200, c1: '#0066ff', c2: '#00aaff' },
                { x: 0.5, y: 0.2, r: 150, c1: '#aa00ff', c2: '#ff00aa' }
            ];
            for (let neb of nebulas) {
                const nx = (neb.x * canvas.width + bgOffset * 0.03) % (canvas.width + 300) - 150;
                ctx.globalAlpha = 0.12;
                const nebGrad = ctx.createRadialGradient(nx, neb.y * canvas.height, 0, nx, neb.y * canvas.height, neb.r);
                nebGrad.addColorStop(0, neb.c1);
                nebGrad.addColorStop(0.5, neb.c2);
                nebGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = nebGrad;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            ctx.globalAlpha = 1;

            // Star field with varying brightness and colors
            const starColors = ['#ffffff', '#aaccff', '#ffddaa', '#ffaaaa'];
            for (let i = 0; i < 200; i++) {
                const x = (i * 79 + bgOffset * 0.05) % canvas.width;
                const y = (i * 123) % canvas.height;
                const size = 0.3 + (i % 5) * 0.4;
                const twinkle = Math.sin(bgTime * 2 + i * 1.7) * 0.3 + 0.5;
                ctx.globalAlpha = twinkle;
                ctx.fillStyle = starColors[i % starColors.length];
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Cosmic dust clouds
            for (let dust = 0; dust < 5; dust++) {
                const dx = (dust * 250 + bgOffset * 0.08) % (canvas.width + 200) - 100;
                const dy = canvas.height * (0.3 + dust * 0.12);
                ctx.globalAlpha = 0.05;
                ctx.fillStyle = '#8866aa';
                ctx.beginPath();
                ctx.ellipse(dx, dy, 100 + dust * 30, 30 + dust * 10, dust * 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Distant galaxy spiral
            const galaxyX = (canvas.width * 0.15 + bgOffset * 0.02) % (canvas.width + 200) - 100;
            const galaxyY = canvas.height * 0.6;
            ctx.save();
            ctx.translate(galaxyX, galaxyY);
            ctx.rotate(bgTime * 0.05);
            for (let arm = 0; arm < 3; arm++) {
                ctx.rotate(Math.PI * 2 / 3);
                ctx.globalAlpha = 0.15;
                ctx.strokeStyle = '#aabbff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                for (let t = 0; t < 50; t++) {
                    const r = t * 1.5;
                    const angle = t * 0.15;
                    const ax = Math.cos(angle) * r;
                    const ay = Math.sin(angle) * r * 0.4;
                    if (t === 0) ctx.moveTo(ax, ay);
                    else ctx.lineTo(ax, ay);
                }
                ctx.stroke();
            }
            ctx.restore();
            ctx.globalAlpha = 1;

            // Ringed planet
            const px = (canvas.width * 0.8 + bgOffset * 0.1) % (canvas.width + 200) - 100;
            const py = canvas.height * 0.3;

            // Planet glow
            const planetGlow = ctx.createRadialGradient(px, py, 30, px, py, 80);
            planetGlow.addColorStop(0, 'rgba(100, 120, 255, 0.3)');
            planetGlow.addColorStop(1, 'transparent');
            ctx.fillStyle = planetGlow;
            ctx.fillRect(px - 100, py - 100, 200, 200);

            // Planet Ring
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(-0.5);
            ctx.beginPath();
            ctx.ellipse(0, 0, 90, 20, 0, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(150, 140, 200, 0.6)';
            ctx.lineWidth = 12;
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
            // Enchanted midnight - rich blues with magical atmosphere
            const midnightGrad = ctx.createLinearGradient(0, 0, canvas.width * 0.3, canvas.height);
            midnightGrad.addColorStop(0, '#050815');
            midnightGrad.addColorStop(0.3, '#0a1225');
            midnightGrad.addColorStop(0.6, '#101830');
            midnightGrad.addColorStop(1, '#0a1020');
            ctx.fillStyle = midnightGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Atmospheric haze layers
            for (let haze = 0; haze < 3; haze++) {
                const hazeGrad = ctx.createLinearGradient(0, canvas.height * (0.4 + haze * 0.15), 0, canvas.height * (0.6 + haze * 0.15));
                hazeGrad.addColorStop(0, 'transparent');
                hazeGrad.addColorStop(0.5, `rgba(30, 50, 80, ${0.05 - haze * 0.01})`);
                hazeGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = hazeGrad;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            
            // Layered stars with depth
            for (let layer = 0; layer < 3; layer++) {
                for (let i = 0; i < 30 + layer * 15; i++) {
                    const x = (i * (71 + layer * 23)) % canvas.width;
                    const y = (i * (53 + layer * 17)) % (canvas.height * 0.65);
                    const twinkle = Math.sin(bgTime * (1.5 + layer * 0.3) + i * 2) * 0.25;
                    ctx.globalAlpha = 0.15 + layer * 0.1 + twinkle;
                    ctx.fillStyle = layer === 2 ? '#ffffff' : '#aabbdd';
                    ctx.beginPath();
                    ctx.arc(x, y, 0.4 + layer * 0.3 + (i % 3) * 0.2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
            
            // Wispy clouds drifting
            for (let cloud = 0; cloud < 4; cloud++) {
                const cx = (cloud * 300 + bgOffset * 0.08) % (canvas.width + 400) - 200;
                const cy = canvas.height * (0.15 + cloud * 0.08);
                ctx.globalAlpha = 0.08;
                ctx.fillStyle = '#3a4a6a';
                ctx.beginPath();
                ctx.ellipse(cx, cy, 80 + cloud * 20, 20 + cloud * 5, 0, 0, Math.PI * 2);
                ctx.ellipse(cx + 50, cy + 5, 60 + cloud * 15, 15 + cloud * 4, 0, 0, Math.PI * 2);
                ctx.ellipse(cx - 40, cy - 3, 50 + cloud * 12, 12 + cloud * 3, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Enhanced moon with dramatic glow
            const moonX = canvas.width * 0.8;
            const moonY = canvas.height * 0.18;
            
            // Outer glow rings
            for (let ring = 3; ring >= 0; ring--) {
                const ringGrad = ctx.createRadialGradient(moonX, moonY, 35 + ring * 15, moonX, moonY, 50 + ring * 25);
                ringGrad.addColorStop(0, `rgba(180, 200, 255, ${0.1 - ring * 0.02})`);
                ringGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = ringGrad;
                ctx.fillRect(moonX - 150, moonY - 150, 300, 300);
            }
            
            ctx.save();
            ctx.shadowColor = '#aaccff';
            ctx.shadowBlur = 40;
            // Moon body with subtle gradient
            const moonBodyGrad = ctx.createRadialGradient(moonX - 10, moonY - 10, 0, moonX, moonY, 42);
            moonBodyGrad.addColorStop(0, '#f5f5ff');
            moonBodyGrad.addColorStop(0.7, '#d8dce8');
            moonBodyGrad.addColorStop(1, '#b8c0d0');
            ctx.fillStyle = moonBodyGrad;
            ctx.beginPath();
            ctx.arc(moonX, moonY, 42, 0, Math.PI * 2);
            ctx.fill();
            // Moon craters with depth
            ctx.fillStyle = 'rgba(150, 155, 170, 0.5)';
            ctx.beginPath();
            ctx.arc(moonX - 12, moonY - 8, 10, 0, Math.PI * 2);
            ctx.arc(moonX + 18, moonY + 12, 7, 0, Math.PI * 2);
            ctx.arc(moonX + 5, moonY - 15, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            
            // Moonlight beam effect
            ctx.globalAlpha = 0.03;
            ctx.fillStyle = '#aabbff';
            ctx.beginPath();
            ctx.moveTo(moonX - 30, moonY + 40);
            ctx.lineTo(moonX + 30, moonY + 40);
            ctx.lineTo(moonX + 150, canvas.height);
            ctx.lineTo(moonX - 150, canvas.height);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
            
            // Rolling hills with depth
            for (let hill = 0; hill < 3; hill++) {
                const hillColor = 10 + hill * 4;
                ctx.fillStyle = `rgb(${hillColor}, ${hillColor + 8}, ${hillColor + 20})`;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                for (let i = 0; i <= canvas.width; i += 50 + hill * 20) {
                    const h = (60 + hill * 25) + Math.sin((i + bgOffset * (0.15 + hill * 0.05)) * 0.01) * (30 + hill * 10);
                    ctx.lineTo(i, canvas.height - GROUND_HEIGHT - h);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.fill();
            }
            break;
            
        case 'forest':
            // Enchanted mystical forest
            const forestGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            forestGrad.addColorStop(0, '#051208');
            forestGrad.addColorStop(0.3, '#0a1a10');
            forestGrad.addColorStop(0.6, '#0d2015');
            forestGrad.addColorStop(1, '#102518');
            ctx.fillStyle = forestGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Mystical fog layers
            for (let fog = 0; fog < 4; fog++) {
                const fogY = canvas.height * (0.4 + fog * 0.12);
                const fogGrad = ctx.createLinearGradient(0, fogY - 40, 0, fogY + 40);
                fogGrad.addColorStop(0, 'transparent');
                fogGrad.addColorStop(0.5, `rgba(80, 120, 90, ${0.08 - fog * 0.015})`);
                fogGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = fogGrad;
                ctx.fillRect(0, fogY - 50, canvas.width, 100);
            }
            
            // Distant tree silhouettes (multiple layers)
            for (let layer = 0; layer < 4; layer++) {
                const treeColor = 5 + layer * 3;
                const treeAlpha = 0.7 + layer * 0.08;
                ctx.fillStyle = `rgba(${treeColor + 5}, ${treeColor + 15}, ${treeColor + 8}, ${treeAlpha})`;
                
                const spacing = 50 + layer * 15;
                const speed = 0.1 + layer * 0.04;
                const baseHeight = 180 - layer * 25;
                
                for (let i = 0; i < canvas.width + spacing * 2; i += spacing) {
                    const x = (i + bgOffset * speed) % (canvas.width + spacing * 2) - spacing;
                    const h = baseHeight + Math.sin(i * 0.04 + layer) * (30 + layer * 10);
                    const w = 20 + layer * 8;
                    
                    // Tree with multiple triangle layers for pine look
                    ctx.beginPath();
                    ctx.moveTo(x + w, canvas.height - GROUND_HEIGHT);
                    for (let t = 0; t < 4; t++) {
                        const ty = canvas.height - GROUND_HEIGHT - h * (t + 1) / 4;
                        const tw = w * (1 - t * 0.15);
                        ctx.lineTo(x + w - tw * 0.3, ty + h * 0.08);
                        ctx.lineTo(x + w / 2, ty);
                        ctx.lineTo(x + w + tw * 0.3, ty + h * 0.08);
                    }
                    ctx.lineTo(x, canvas.height - GROUND_HEIGHT);
                    ctx.fill();
                }
            }
            
            // Glowing mushrooms on ground
            for (let mush = 0; mush < 8; mush++) {
                const mx = (mush * 150 + bgOffset * 0.2) % (canvas.width + 100) - 50;
                const my = canvas.height - GROUND_HEIGHT - 5;
                const mushGlow = ctx.createRadialGradient(mx, my - 8, 0, mx, my - 8, 25);
                mushGlow.addColorStop(0, 'rgba(100, 200, 150, 0.4)');
                mushGlow.addColorStop(1, 'transparent');
                ctx.fillStyle = mushGlow;
                ctx.fillRect(mx - 30, my - 35, 60, 40);
                
                // Mushroom cap
                ctx.fillStyle = `rgba(60, 150, 100, ${0.6 + Math.sin(bgTime + mush) * 0.2})`;
                ctx.beginPath();
                ctx.ellipse(mx, my - 10, 8 + mush % 3, 5, 0, Math.PI, 0);
                ctx.fill();
                // Stem
                ctx.fillStyle = 'rgba(80, 120, 90, 0.8)';
                ctx.fillRect(mx - 2, my - 10, 4, 10);
            }
            
            // Enhanced fireflies with trails
            for (let i = 0; i < 20; i++) {
                const baseX = (i * 97 + bgOffset * 0.05) % canvas.width;
                const baseY = canvas.height * 0.3 + (i * 37) % (canvas.height * 0.45);
                const floatX = baseX + Math.sin(bgTime * 0.8 + i * 2) * 25;
                const floatY = baseY + Math.cos(bgTime * 0.6 + i * 1.5) * 15;
                const pulse = Math.sin(bgTime * 3 + i * 4) * 0.4 + 0.5;
                
                // Glow
                const fireflyGlow = ctx.createRadialGradient(floatX, floatY, 0, floatX, floatY, 15);
                fireflyGlow.addColorStop(0, `rgba(180, 255, 150, ${pulse * 0.5})`);
                fireflyGlow.addColorStop(1, 'transparent');
                ctx.fillStyle = fireflyGlow;
                ctx.fillRect(floatX - 20, floatY - 20, 40, 40);
                
                // Core
                ctx.globalAlpha = pulse;
                ctx.fillStyle = '#ccffaa';
                ctx.beginPath();
                ctx.arc(floatX, floatY, 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            break;
            
        case 'ocean':
            // Deep bioluminescent ocean
            const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            oceanGrad.addColorStop(0, '#051525');
            oceanGrad.addColorStop(0.3, '#082035');
            oceanGrad.addColorStop(0.6, '#0a2840');
            oceanGrad.addColorStop(1, '#0d3050');
            ctx.fillStyle = oceanGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Light rays from surface
            for (let ray = 0; ray < 6; ray++) {
                const rayX = (ray * 180 + bgOffset * 0.1) % (canvas.width + 200) - 100;
                ctx.globalAlpha = 0.04;
                ctx.fillStyle = '#60a0c0';
                ctx.beginPath();
                ctx.moveTo(rayX, 0);
                ctx.lineTo(rayX + 30, 0);
                ctx.lineTo(rayX + 100, canvas.height);
                ctx.lineTo(rayX + 40, canvas.height);
                ctx.closePath();
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Animated wave layers with depth
            for (let wave = 0; wave < 6; wave++) {
                const waveAlpha = 0.08 + wave * 0.02;
                const waveY = canvas.height * (0.25 + wave * 0.1);
                const waveSpeed = 0.3 + wave * 0.1;
                const waveAmp = 12 - wave * 1.5;
                
                ctx.globalAlpha = waveAlpha;
                ctx.strokeStyle = `rgba(80, 150, 180, 1)`;
                ctx.lineWidth = 3 - wave * 0.3;
                ctx.beginPath();
                for (let x = 0; x <= canvas.width; x += 8) {
                    const y = waveY + Math.sin((x + bgOffset * waveSpeed + wave * 80) * 0.015) * waveAmp
                                    + Math.sin((x + bgOffset * waveSpeed * 0.7) * 0.025) * (waveAmp * 0.5);
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            
            // Bioluminescent particles
            for (let bio = 0; bio < 30; bio++) {
                const bx = (bio * 67 + bgOffset * 0.15) % canvas.width;
                const by = canvas.height * 0.3 + (bio * 43) % (canvas.height * 0.55);
                const pulse = Math.sin(bgTime * 2 + bio * 1.7) * 0.4 + 0.5;
                
                const bioGlow = ctx.createRadialGradient(bx, by, 0, bx, by, 12);
                bioGlow.addColorStop(0, `rgba(100, 220, 255, ${pulse * 0.4})`);
                bioGlow.addColorStop(1, 'transparent');
                ctx.fillStyle = bioGlow;
                ctx.fillRect(bx - 15, by - 15, 30, 30);
                
                ctx.globalAlpha = pulse * 0.8;
                ctx.fillStyle = '#80ffff';
                ctx.beginPath();
                ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Jellyfish
            for (let jelly = 0; jelly < 4; jelly++) {
                const jx = (jelly * 280 + bgOffset * 0.3) % (canvas.width + 200) - 100;
                const jy = canvas.height * 0.4 + (jelly * 80) % 150 + Math.sin(bgTime * 0.5 + jelly) * 15;
                const jellyPulse = Math.sin(bgTime * 1.5 + jelly * 2) * 0.15 + 0.85;
                
                // Glow
                const jellyGlow = ctx.createRadialGradient(jx, jy, 0, jx, jy, 40);
                jellyGlow.addColorStop(0, 'rgba(200, 100, 255, 0.2)');
                jellyGlow.addColorStop(1, 'transparent');
                ctx.fillStyle = jellyGlow;
                ctx.fillRect(jx - 50, jy - 50, 100, 100);
                
                // Body
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = `rgba(180, 120, 255, 0.6)`;
                ctx.beginPath();
                ctx.ellipse(jx, jy, 18 * jellyPulse, 12 * jellyPulse, 0, Math.PI, 0);
                ctx.fill();
                
                // Tentacles
                ctx.strokeStyle = 'rgba(200, 150, 255, 0.4)';
                ctx.lineWidth = 1.5;
                for (let t = 0; t < 5; t++) {
                    ctx.beginPath();
                    ctx.moveTo(jx - 12 + t * 6, jy);
                    const tentLen = 25 + Math.sin(bgTime * 2 + t) * 8;
                    ctx.quadraticCurveTo(
                        jx - 15 + t * 7 + Math.sin(bgTime * 3 + t * 2) * 5,
                        jy + tentLen * 0.5,
                        jx - 10 + t * 5 + Math.sin(bgTime * 2.5 + t) * 8,
                        jy + tentLen
                    );
                    ctx.stroke();
                }
            }
            ctx.globalAlpha = 1;
            
            // Enhanced fish with bioluminescence
            for (let i = 0; i < 10; i++) {
                const x = (i * 150 + bgOffset * 0.6) % (canvas.width + 120) - 60;
                const y = canvas.height * 0.45 + (i * 45) % 180;
                const fishGlow = ctx.createRadialGradient(x, y, 0, x, y, 20);
                fishGlow.addColorStop(0, 'rgba(80, 180, 220, 0.15)');
                fishGlow.addColorStop(1, 'transparent');
                ctx.fillStyle = fishGlow;
                ctx.fillRect(x - 25, y - 25, 50, 50);
                
                ctx.fillStyle = `rgba(40, 80, 100, 0.7)`;
                ctx.save();
                ctx.translate(x, y);
                ctx.beginPath();
                ctx.ellipse(0, 0, 12 + i % 4, 6 + i % 3, 0, 0, Math.PI * 2);
                ctx.moveTo(12, 0);
                ctx.lineTo(22, -6);
                ctx.lineTo(22, 6);
                ctx.closePath();
                ctx.fill();
                // Glowing eye
                ctx.fillStyle = 'rgba(150, 255, 255, 0.8)';
                ctx.beginPath();
                ctx.arc(-5, -1, 2, 0, Math.PI * 2);
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
            const cosmoGalaxyX = (canvas.width * 0.6 + bgOffset * 0.05) % (canvas.width + 200) - 100;
            ctx.translate(cosmoGalaxyX, canvas.height * 0.35);
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

        // ========== EXCLUSIVE REWARD-ONLY BACKGROUNDS ==========
        
        case 'vortex':
            // 3D Swirling Vortex - Hypnotic spiral tunnel
            const vortexGrad = ctx.createRadialGradient(
                canvas.width/2, canvas.height/2, 0,
                canvas.width/2, canvas.height/2, canvas.width
            );
            vortexGrad.addColorStop(0, '#000010');
            vortexGrad.addColorStop(0.5, '#0a0030');
            vortexGrad.addColorStop(1, '#000005');
            ctx.fillStyle = vortexGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // 3D Spiral rings receding into depth
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            for (let ring = 0; ring < 20; ring++) {
                const depth = (ring + bgTime * 2) % 20;
                const scale = Math.pow(depth / 20, 2);
                const radius = 50 + scale * 400;
                const rotation = bgTime * 0.5 + ring * 0.3;
                const alpha = 0.8 - scale * 0.7;
                
                ctx.save();
                ctx.translate(centerX, centerY);
                ctx.rotate(rotation);
                ctx.globalAlpha = alpha;
                
                // Gradient ring with 3D effect
                const hue = (ring * 25 + bgTime * 30) % 360;
                ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`;
                ctx.shadowColor = `hsl(${hue}, 100%, 70%)`;
                ctx.shadowBlur = 15 + scale * 10;
                ctx.lineWidth = 3 + scale * 5;
                
                ctx.beginPath();
                for (let a = 0; a < Math.PI * 2; a += 0.1) {
                    const wobble = Math.sin(a * 4 + bgTime * 3) * 10 * scale;
                    const x = Math.cos(a) * (radius + wobble);
                    const y = Math.sin(a) * (radius + wobble) * 0.3; // 3D perspective
                    if (a === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            
            // Central bright core
            const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 60);
            coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            coreGrad.addColorStop(0.3, 'rgba(150, 100, 255, 0.5)');
            coreGrad.addColorStop(1, 'rgba(0, 0, 50, 0)');
            ctx.fillStyle = coreGrad;
            ctx.fillRect(centerX - 100, centerY - 100, 200, 200);
            break;
            
        case 'cybergrid':
            // 3D Perspective Flying Grid - Tron-style
            const cyberBg = ctx.createLinearGradient(0, 0, 0, canvas.height);
            cyberBg.addColorStop(0, '#000020');
            cyberBg.addColorStop(0.5, '#000830');
            cyberBg.addColorStop(1, '#001040');
            ctx.fillStyle = cyberBg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Perspective vanishing point
            const vpX = canvas.width / 2;
            const vpY = canvas.height * 0.35;
            
            // Horizontal grid lines flying towards viewer
            ctx.strokeStyle = '#00ffff';
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 10;
            ctx.lineWidth = 2;
            
            for (let i = 0; i < 25; i++) {
                const z = (i + bgTime * 3) % 25;
                const depth = z / 25;
                const y = vpY + (canvas.height - vpY) * depth;
                const spread = depth * canvas.width * 0.7;
                
                ctx.globalAlpha = depth * 0.8;
                ctx.beginPath();
                ctx.moveTo(vpX - spread, y);
                ctx.lineTo(vpX + spread, y);
                ctx.stroke();
            }
            
            // Vertical grid lines
            for (let i = -12; i <= 12; i++) {
                const angle = i * 0.08;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.moveTo(vpX, vpY);
                ctx.lineTo(vpX + Math.sin(angle) * canvas.width, canvas.height);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            
            // Flying data blocks
            for (let i = 0; i < 8; i++) {
                const z = (i * 3.5 + bgTime * 5) % 25;
                const depth = z / 25;
                const x = vpX + ((i % 5) - 2) * 100 * depth;
                const y = vpY + (canvas.height - vpY) * depth - 20;
                const size = 5 + depth * 20;
                
                ctx.fillStyle = `rgba(0, 255, 255, ${depth * 0.7})`;
                ctx.shadowColor = '#00ffff';
                ctx.shadowBlur = 15;
                ctx.fillRect(x - size/2, y - size/2, size, size);
            }
            ctx.shadowBlur = 0;
            break;
            
        case 'inferno':
            // 3D Fiery Hellscape with depth
            const infernoGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            infernoGrad.addColorStop(0, '#0a0000');
            infernoGrad.addColorStop(0.3, '#200500');
            infernoGrad.addColorStop(0.7, '#401000');
            infernoGrad.addColorStop(1, '#601800');
            ctx.fillStyle = infernoGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Distant mountains of fire
            for (let layer = 0; layer < 4; layer++) {
                const layerAlpha = 0.3 + layer * 0.15;
                ctx.globalAlpha = layerAlpha;
                ctx.fillStyle = `rgb(${40 + layer * 30}, ${10 + layer * 5}, 0)`;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                for (let i = 0; i <= canvas.width; i += 40) {
                    const x = (i + bgOffset * (0.1 + layer * 0.05)) % (canvas.width + 100) - 50;
                    const h = 150 + layer * 40 + Math.sin(i * 0.02 + layer) * 60;
                    ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Lava pools with 3D glow
            for (let pool = 0; pool < 3; pool++) {
                const px = (pool * 400 + bgOffset * 0.3) % (canvas.width + 300) - 150;
                const py = canvas.height - GROUND_HEIGHT - 30 - pool * 20;
                const poolGrad = ctx.createRadialGradient(px, py, 0, px, py, 80);
                poolGrad.addColorStop(0, 'rgba(255, 200, 50, 0.9)');
                poolGrad.addColorStop(0.4, 'rgba(255, 100, 0, 0.7)');
                poolGrad.addColorStop(1, 'rgba(100, 20, 0, 0)');
                ctx.fillStyle = poolGrad;
                ctx.fillRect(px - 100, py - 50, 200, 100);
            }
            
            // Rising fire pillars with 3D perspective
            for (let pillar = 0; pillar < 6; pillar++) {
                const px = (pillar * 200 + bgOffset * 0.4) % (canvas.width + 200) - 100;
                const baseY = canvas.height - GROUND_HEIGHT;
                const height = 200 + Math.sin(bgTime + pillar) * 50;
                
                // Fire pillar with gradient
                const pillarGrad = ctx.createLinearGradient(px, baseY, px, baseY - height);
                pillarGrad.addColorStop(0, 'rgba(255, 100, 0, 0.8)');
                pillarGrad.addColorStop(0.5, 'rgba(255, 200, 50, 0.6)');
                pillarGrad.addColorStop(1, 'rgba(255, 50, 0, 0)');
                ctx.fillStyle = pillarGrad;
                ctx.shadowColor = '#ff4400';
                ctx.shadowBlur = 30;
                ctx.beginPath();
                ctx.moveTo(px - 20, baseY);
                ctx.quadraticCurveTo(px - 30, baseY - height * 0.5, px, baseY - height);
                ctx.quadraticCurveTo(px + 30, baseY - height * 0.5, px + 20, baseY);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            
            // Floating embers with 3D size perspective
            for (let i = 0; i < 40; i++) {
                const x = (i * 47 + bgOffset * 0.5) % canvas.width;
                const baseY = canvas.height - ((bgTime * 50 + i * 30) % (canvas.height * 0.8));
                const size = 2 + (1 - baseY / canvas.height) * 4;
                const hue = 20 + Math.sin(i + bgTime) * 20;
                ctx.fillStyle = `hsl(${hue}, 100%, ${60 + Math.random() * 30}%)`;
                ctx.shadowColor = '#ff6600';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(x, baseY, size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            break;
            
        case 'abyss':
            // Deep Glowing Chasm - Lovecraftian depths
            const abyssGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            abyssGrad.addColorStop(0, '#020208');
            abyssGrad.addColorStop(0.4, '#050515');
            abyssGrad.addColorStop(1, '#000005');
            ctx.fillStyle = abyssGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Deep glow from below
            const abyssGlow = ctx.createRadialGradient(
                canvas.width / 2, canvas.height + 200, 0,
                canvas.width / 2, canvas.height, canvas.width
            );
            abyssGlow.addColorStop(0, 'rgba(80, 0, 150, 0.4)');
            abyssGlow.addColorStop(0.5, 'rgba(40, 0, 80, 0.2)');
            abyssGlow.addColorStop(1, 'rgba(0, 0, 20, 0)');
            ctx.fillStyle = abyssGlow;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Floating rock platforms at different depths
            for (let layer = 0; layer < 4; layer++) {
                const depth = 0.3 + layer * 0.2;
                ctx.globalAlpha = depth;
                ctx.fillStyle = `rgb(${15 + layer * 8}, ${10 + layer * 5}, ${25 + layer * 10})`;
                
                for (let rock = 0; rock < 3; rock++) {
                    const rx = (rock * 350 + layer * 100 + bgOffset * (0.1 + layer * 0.08)) % (canvas.width + 300) - 150;
                    const ry = canvas.height * (0.3 + layer * 0.15);
                    const rw = 80 + layer * 30;
                    const rh = 20 + layer * 10;
                    
                    ctx.beginPath();
                    ctx.ellipse(rx, ry, rw, rh, 0, 0, Math.PI * 2);
                    ctx.fill();
                    
                    // Glow under platforms
                    const platformGlow = ctx.createRadialGradient(rx, ry + 10, 0, rx, ry + 10, rw);
                    platformGlow.addColorStop(0, 'rgba(100, 50, 200, 0.3)');
                    platformGlow.addColorStop(1, 'rgba(50, 0, 100, 0)');
                    ctx.fillStyle = platformGlow;
                    ctx.beginPath();
                    ctx.ellipse(rx, ry + 15, rw * 0.8, rh * 2, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = `rgb(${15 + layer * 8}, ${10 + layer * 5}, ${25 + layer * 10})`;
                }
            }
            ctx.globalAlpha = 1;
            
            // Mysterious glowing runes
            const runeChars = '⍟⌬⎔⏣⏢';
            ctx.font = 'bold 30px monospace';
            ctx.textAlign = 'center';
            for (let i = 0; i < 8; i++) {
                const rx = (i * 150 + bgOffset * 0.2) % (canvas.width + 100) - 50;
                const ry = canvas.height * 0.4 + Math.sin(i + bgTime) * 50;
                const runeHue = (bgTime * 30 + i * 40) % 360;
                ctx.fillStyle = `hsla(${runeHue}, 80%, 60%, ${0.3 + Math.sin(bgTime * 2 + i) * 0.2})`;
                ctx.shadowColor = `hsl(${runeHue}, 100%, 70%)`;
                ctx.shadowBlur = 20;
                ctx.fillText(runeChars[i % runeChars.length], rx, ry);
            }
            ctx.shadowBlur = 0;
            
            // Falling particles into the void
            for (let i = 0; i < 30; i++) {
                const x = (i * 67) % canvas.width;
                const y = (bgTime * 30 + i * 40) % (canvas.height + 50) - 25;
                const size = 1 + (y / canvas.height) * 2;
                ctx.fillStyle = `rgba(150, 100, 255, ${0.5 - y / canvas.height * 0.4})`;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'throneroom':
            // Iron Throne - Inspired by the iconic throne room
            const throneGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            throneGrad.addColorStop(0, '#1a1815');
            throneGrad.addColorStop(0.5, '#151210');
            throneGrad.addColorStop(1, '#0a0908');
            ctx.fillStyle = throneGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Stone walls on sides
            ctx.fillStyle = '#252220';
            ctx.fillRect(0, 0, canvas.width * 0.15, canvas.height);
            ctx.fillRect(canvas.width * 0.85, 0, canvas.width * 0.15, canvas.height);
            
            // Wall texture details
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 2;
            for (let row = 0; row < 15; row++) {
                const y = row * 40;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width * 0.15, y);
                ctx.moveTo(canvas.width * 0.85, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
            
            // THE GREAT ROSE WINDOW - Seven-pointed star design
            const windowCenterX = canvas.width / 2;
            const windowCenterY = canvas.height * 0.22;
            const windowRadius = Math.min(canvas.width * 0.28, 180);
            
            // Window light glow (backlight effect)
            const windowGlow = ctx.createRadialGradient(
                windowCenterX, windowCenterY, 0,
                windowCenterX, windowCenterY, windowRadius * 1.8
            );
            windowGlow.addColorStop(0, 'rgba(255, 250, 230, 0.9)');
            windowGlow.addColorStop(0.3, 'rgba(200, 180, 140, 0.5)');
            windowGlow.addColorStop(0.6, 'rgba(150, 130, 100, 0.2)');
            windowGlow.addColorStop(1, 'transparent');
            ctx.fillStyle = windowGlow;
            ctx.fillRect(0, 0, canvas.width, canvas.height * 0.6);
            
            // Window circle (bright opening)
            ctx.fillStyle = 'rgba(220, 210, 180, 0.85)';
            ctx.beginPath();
            ctx.arc(windowCenterX, windowCenterY, windowRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // Seven-pointed star frame (dark ironwork)
            ctx.strokeStyle = '#1a1510';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(windowCenterX, windowCenterY, windowRadius, 0, Math.PI * 2);
            ctx.stroke();
            
            // Inner circle
            ctx.beginPath();
            ctx.arc(windowCenterX, windowCenterY, windowRadius * 0.4, 0, Math.PI * 2);
            ctx.stroke();
            
            // Seven-pointed star spokes
            ctx.lineWidth = 6;
            for (let spoke = 0; spoke < 7; spoke++) {
                const angle = (spoke / 7) * Math.PI * 2 - Math.PI / 2;
                ctx.beginPath();
                ctx.moveTo(windowCenterX, windowCenterY);
                ctx.lineTo(
                    windowCenterX + Math.cos(angle) * windowRadius,
                    windowCenterY + Math.sin(angle) * windowRadius
                );
                ctx.stroke();
            }
            
            // Star points between spokes
            ctx.lineWidth = 4;
            for (let point = 0; point < 7; point++) {
                const angle1 = (point / 7) * Math.PI * 2 - Math.PI / 2;
                const angle2 = ((point + 1) / 7) * Math.PI * 2 - Math.PI / 2;
                const midAngle = (angle1 + angle2) / 2;
                
                // Outer arc decoration
                const outerX = windowCenterX + Math.cos(midAngle) * (windowRadius * 0.7);
                const outerY = windowCenterY + Math.sin(midAngle) * (windowRadius * 0.7);
                ctx.beginPath();
                ctx.arc(outerX, outerY, windowRadius * 0.25, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            // Center emblem (red/amber glass)
            const centerGlow = ctx.createRadialGradient(
                windowCenterX, windowCenterY, 0,
                windowCenterX, windowCenterY, windowRadius * 0.2
            );
            centerGlow.addColorStop(0, 'rgba(180, 80, 60, 0.9)');
            centerGlow.addColorStop(0.7, 'rgba(120, 50, 40, 0.7)');
            centerGlow.addColorStop(1, 'rgba(80, 30, 20, 0.5)');
            ctx.fillStyle = centerGlow;
            ctx.beginPath();
            ctx.arc(windowCenterX, windowCenterY, windowRadius * 0.18, 0, Math.PI * 2);
            ctx.fill();
            
            // Light rays streaming down
            ctx.globalAlpha = 0.08;
            for (let ray = 0; ray < 12; ray++) {
                const rayAngle = (ray / 12) * Math.PI - Math.PI / 2;
                const rayWidth = 20 + Math.sin(ray * 2) * 10;
                ctx.fillStyle = '#fffde8';
                ctx.beginPath();
                ctx.moveTo(windowCenterX + Math.cos(rayAngle - 0.05) * windowRadius, 
                          windowCenterY + Math.sin(rayAngle - 0.05) * windowRadius);
                ctx.lineTo(windowCenterX + Math.cos(rayAngle + 0.05) * windowRadius, 
                          windowCenterY + Math.sin(rayAngle + 0.05) * windowRadius);
                ctx.lineTo(windowCenterX + Math.cos(rayAngle) * windowRadius * 3 + rayWidth, canvas.height);
                ctx.lineTo(windowCenterX + Math.cos(rayAngle) * windowRadius * 3 - rayWidth, canvas.height);
                ctx.closePath();
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Stone platform/steps
            const platformY = canvas.height * 0.72;
            ctx.fillStyle = '#1a1815';
            ctx.beginPath();
            ctx.moveTo(canvas.width * 0.25, canvas.height);
            ctx.lineTo(canvas.width * 0.75, canvas.height);
            ctx.lineTo(canvas.width * 0.7, platformY);
            ctx.lineTo(canvas.width * 0.3, platformY);
            ctx.closePath();
            ctx.fill();
            
            // Platform steps
            ctx.strokeStyle = 'rgba(40, 35, 30, 0.8)';
            ctx.lineWidth = 2;
            for (let step = 0; step < 4; step++) {
                const stepY = platformY + step * 20;
                const indent = step * 15;
                ctx.beginPath();
                ctx.moveTo(canvas.width * 0.3 - indent, stepY);
                ctx.lineTo(canvas.width * 0.7 + indent, stepY);
                ctx.stroke();
            }
            
            // THE IRON THRONE - Dense mass of swords
            const throneX = canvas.width / 2;
            const throneBaseY = platformY + 10;
            const throneHeight = canvas.height * 0.45;
            
            // Draw the throne as layers of swords
            // Back layer - tall swords reaching up
            for (let layer = 0; layer < 3; layer++) {
                const layerSwords = 25 + layer * 10;
                const layerSpread = 60 + layer * 25;
                const layerHeight = throneHeight * (1 - layer * 0.15);
                const shade = 45 + layer * 15;
                
                for (let i = 0; i < layerSwords; i++) {
                    const progress = i / layerSwords;
                    const xOffset = (progress - 0.5) * layerSpread * 2;
                    const heightVar = Math.sin(progress * Math.PI) * 0.4 + 0.6;
                    const swordHeight = layerHeight * heightVar * (0.8 + Math.random() * 0.4);
                    
                    // Random angle for chaotic look
                    const angleVar = (Math.random() - 0.5) * 0.3;
                    const tipX = throneX + xOffset + Math.sin(angleVar) * swordHeight * 0.2;
                    const tipY = throneBaseY - swordHeight;
                    
                    // Sword blade
                    const swordShade = shade + Math.floor(Math.random() * 30) - 15;
                    ctx.strokeStyle = `rgb(${swordShade}, ${swordShade - 5}, ${swordShade - 10})`;
                    ctx.lineWidth = 2 + Math.random();
                    ctx.beginPath();
                    ctx.moveTo(throneX + xOffset, throneBaseY);
                    ctx.lineTo(tipX, tipY);
                    ctx.stroke();
                    
                    // Occasional glint
                    if (Math.random() > 0.85) {
                        ctx.strokeStyle = `rgba(180, 175, 165, ${0.2 + Math.sin(bgTime * 3 + i) * 0.1})`;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(throneX + xOffset + 1, throneBaseY);
                        ctx.lineTo(tipX + 1, tipY);
                        ctx.stroke();
                    }
                }
            }
            
            // Horizontal swords (crosspieces and armrests)
            for (let h = 0; h < 15; h++) {
                const hY = throneBaseY - 30 - h * 12;
                const hWidth = 70 - h * 3;
                const shade = 50 + Math.floor(Math.random() * 20);
                ctx.strokeStyle = `rgb(${shade}, ${shade - 5}, ${shade - 8})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(throneX - hWidth, hY + (Math.random() - 0.5) * 10);
                ctx.lineTo(throneX + hWidth, hY + (Math.random() - 0.5) * 10);
                ctx.stroke();
            }
            
            // Throne seat area (darker mass)
            ctx.fillStyle = '#151210';
            ctx.beginPath();
            ctx.ellipse(throneX, throneBaseY - 20, 50, 25, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Sword hilts and guards (details)
            for (let hilt = 0; hilt < 20; hilt++) {
                const hx = throneX + (Math.random() - 0.5) * 100;
                const hy = throneBaseY - 20 - Math.random() * 80;
                ctx.fillStyle = `rgb(${60 + Math.random() * 20}, ${55 + Math.random() * 15}, ${50 + Math.random() * 10})`;
                ctx.fillRect(hx - 4, hy, 8, 3);
                ctx.fillRect(hx - 1, hy - 8, 2, 8);
            }
            
            // Dust particles in light beams
            ctx.fillStyle = 'rgba(255, 250, 220, 0.4)';
            for (let dust = 0; dust < 40; dust++) {
                const dx = (dust * 37 + bgTime * 10) % canvas.width;
                const dy = (dust * 53 + bgTime * 15) % (canvas.height * 0.7);
                const dSize = 0.5 + Math.random();
                const dAlpha = Math.sin(bgTime + dust) * 0.3 + 0.4;
                ctx.globalAlpha = dAlpha;
                ctx.beginPath();
                ctx.arc(dx, dy, dSize, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Atmospheric haze
            ctx.globalAlpha = 0.05;
            const hazeGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            hazeGrad.addColorStop(0, '#c0b090');
            hazeGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = hazeGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillRect(canvas.width / 2 - 200, floorVP - 100, 400, 200);
            
            // Floating banners
            for (let banner = 0; banner < 4; banner++) {
                const bx = canvas.width * (0.15 + banner * 0.25);
                const by = 50;
                const bh = 150 + Math.sin(bgTime + banner) * 10;
                
                ctx.fillStyle = '#6a2040';
                ctx.shadowColor = '#ff4488';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.moveTo(bx - 25, by);
                ctx.lineTo(bx + 25, by);
                ctx.lineTo(bx + 20, by + bh);
                ctx.lineTo(bx, by + bh + 20);
                ctx.lineTo(bx - 20, by + bh);
                ctx.closePath();
                ctx.fill();
                
                // Banner emblem
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(bx, by + 60, 15, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            break;
            
        case 'nebulacore':
            // Heart of a Nebula - Cosmic birth
            const nebulaCoreGrad = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, 0,
                canvas.width / 2, canvas.height / 2, canvas.width
            );
            nebulaCoreGrad.addColorStop(0, '#200530');
            nebulaCoreGrad.addColorStop(0.3, '#100320');
            nebulaCoreGrad.addColorStop(1, '#050110');
            ctx.fillStyle = nebulaCoreGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Nebula gas clouds with 3D depth
            for (let cloud = 0; cloud < 12; cloud++) {
                const cx = (cloud * 150 + Math.sin(cloud + bgTime * 0.3) * 50) % (canvas.width + 200) - 100;
                const cy = canvas.height * 0.3 + (cloud * 70) % (canvas.height * 0.6);
                const cloudSize = 60 + cloud * 15;
                const hue = (cloud * 30 + bgTime * 10) % 360;
                
                const cloudGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cloudSize);
                cloudGrad.addColorStop(0, `hsla(${hue}, 70%, 50%, 0.4)`);
                cloudGrad.addColorStop(0.5, `hsla(${hue + 30}, 60%, 40%, 0.2)`);
                cloudGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = cloudGrad;
                ctx.fillRect(cx - cloudSize * 1.5, cy - cloudSize, cloudSize * 3, cloudSize * 2);
            }
            
            // Bright star core with pulsing
            const pulse = 1 + Math.sin(bgTime * 3) * 0.2;
            const starCore = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, 0,
                canvas.width / 2, canvas.height / 2, 80 * pulse
            );
            starCore.addColorStop(0, 'rgba(255, 255, 255, 1)');
            starCore.addColorStop(0.2, 'rgba(200, 150, 255, 0.8)');
            starCore.addColorStop(0.5, 'rgba(100, 50, 200, 0.4)');
            starCore.addColorStop(1, 'rgba(50, 0, 100, 0)');
            ctx.fillStyle = starCore;
            ctx.fillRect(canvas.width / 2 - 150, canvas.height / 2 - 150, 300, 300);
            
            // Light rays emanating outward
            ctx.strokeStyle = 'rgba(200, 150, 255, 0.3)';
            ctx.lineWidth = 3;
            for (let ray = 0; ray < 12; ray++) {
                const angle = ray * (Math.PI / 6) + bgTime * 0.1;
                const length = 150 + Math.sin(bgTime * 2 + ray) * 50;
                ctx.beginPath();
                ctx.moveTo(canvas.width / 2, canvas.height / 2);
                ctx.lineTo(
                    canvas.width / 2 + Math.cos(angle) * length,
                    canvas.height / 2 + Math.sin(angle) * length
                );
                ctx.stroke();
            }
            
            // Stars at varying depths
            for (let i = 0; i < 100; i++) {
                const x = (i * 83) % canvas.width;
                const y = (i * 67) % canvas.height;
                const twinkle = 0.3 + Math.sin(bgTime * 3 + i) * 0.4;
                const size = 0.5 + (i % 3) * 0.5;
                ctx.fillStyle = `rgba(255, 255, 255, ${twinkle})`;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'obsidian':
            // Dark Volcanic Glass - Reflective depths
            const obsidianGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            obsidianGrad.addColorStop(0, '#030308');
            obsidianGrad.addColorStop(0.5, '#080812');
            obsidianGrad.addColorStop(1, '#050508');
            ctx.fillStyle = obsidianGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Glass-like reflective surfaces
            for (let shard = 0; shard < 15; shard++) {
                const sx = (shard * 120 + bgOffset * 0.15) % (canvas.width + 200) - 100;
                const sy = canvas.height * 0.2 + (shard * 80) % (canvas.height * 0.7);
                const angle = shard * 0.5 + bgTime * 0.1;
                const size = 40 + shard * 10;
                
                ctx.save();
                ctx.translate(sx, sy);
                ctx.rotate(angle);
                
                // Glass shard with reflective gradient
                const shardGrad = ctx.createLinearGradient(-size, -size, size, size);
                shardGrad.addColorStop(0, 'rgba(30, 30, 50, 0.8)');
                shardGrad.addColorStop(0.3, 'rgba(60, 60, 100, 0.6)');
                shardGrad.addColorStop(0.5, 'rgba(80, 80, 120, 0.7)');
                shardGrad.addColorStop(1, 'rgba(20, 20, 40, 0.5)');
                ctx.fillStyle = shardGrad;
                
                ctx.beginPath();
                ctx.moveTo(0, -size);
                ctx.lineTo(size * 0.6, -size * 0.2);
                ctx.lineTo(size * 0.4, size * 0.8);
                ctx.lineTo(-size * 0.3, size * 0.5);
                ctx.lineTo(-size * 0.5, 0);
                ctx.closePath();
                ctx.fill();
                
                // Edge highlight
                ctx.strokeStyle = 'rgba(150, 150, 200, 0.4)';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                ctx.restore();
            }
            
            // Molten veins beneath the glass
            ctx.strokeStyle = 'rgba(255, 100, 50, 0.4)';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#ff4400';
            ctx.shadowBlur = 10;
            for (let vein = 0; vein < 5; vein++) {
                ctx.beginPath();
                const startX = (vein * 200 + bgOffset * 0.2) % canvas.width;
                const startY = canvas.height * 0.6 + vein * 30;
                ctx.moveTo(startX, startY);
                for (let seg = 0; seg < 5; seg++) {
                    const nx = startX + (seg + 1) * 40 + Math.sin(bgTime + seg) * 20;
                    const ny = startY + Math.sin(seg * 0.8 + bgTime) * 30;
                    ctx.lineTo(nx, ny);
                }
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
            
            // Subtle smoke rising
            ctx.globalAlpha = 0.1;
            for (let smoke = 0; smoke < 10; smoke++) {
                const sx = (smoke * 130 + bgOffset * 0.1) % canvas.width;
                const sy = canvas.height - ((bgTime * 20 + smoke * 50) % (canvas.height * 0.5));
                const smokeGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 40);
                smokeGrad.addColorStop(0, 'rgba(100, 100, 120, 0.3)');
                smokeGrad.addColorStop(1, 'rgba(50, 50, 60, 0)');
                ctx.fillStyle = smokeGrad;
                ctx.beginPath();
                ctx.arc(sx, sy, 40, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'prismatic':
            // Rainbow Light Refraction - Crystal prism effect
            const prismBg = ctx.createLinearGradient(0, 0, 0, canvas.height);
            prismBg.addColorStop(0, '#050510');
            prismBg.addColorStop(0.5, '#0a0a20');
            prismBg.addColorStop(1, '#050515');
            ctx.fillStyle = prismBg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Main prism crystal
            const prismX = canvas.width * 0.3;
            const prismY = canvas.height * 0.3;
            
            ctx.save();
            ctx.translate(prismX, prismY);
            ctx.rotate(bgTime * 0.05);
            
            // Crystal faces
            const prismGrad = ctx.createLinearGradient(-60, -80, 60, 80);
            prismGrad.addColorStop(0, 'rgba(200, 220, 255, 0.7)');
            prismGrad.addColorStop(0.3, 'rgba(180, 200, 240, 0.5)');
            prismGrad.addColorStop(0.7, 'rgba(150, 180, 220, 0.6)');
            prismGrad.addColorStop(1, 'rgba(100, 150, 200, 0.4)');
            ctx.fillStyle = prismGrad;
            
            ctx.beginPath();
            ctx.moveTo(0, -80);
            ctx.lineTo(60, 50);
            ctx.lineTo(-60, 50);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.restore();
            
            // Light beam entering prism
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(0, prismY - 20);
            ctx.lineTo(prismX - 30, prismY - 20);
            ctx.stroke();
            
            // Rainbow beams exiting prism
            const colors = ['#ff0000', '#ff7700', '#ffff00', '#00ff00', '#00ffff', '#0077ff', '#7700ff'];
            for (let i = 0; i < colors.length; i++) {
                const angle = (i - 3) * 0.12 + bgTime * 0.02;
                const length = 400;
                const startX = prismX + 40;
                const startY = prismY + 20;
                const endX = startX + Math.cos(angle) * length;
                const endY = startY + Math.sin(angle) * length;
                
                ctx.strokeStyle = colors[i];
                ctx.shadowColor = colors[i];
                ctx.shadowBlur = 15;
                ctx.lineWidth = 6;
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            
            // Floating light particles
            for (let i = 0; i < 40; i++) {
                const x = (i * 47 + bgTime * 30) % canvas.width;
                const y = (i * 67 + Math.sin(bgTime + i) * 30) % canvas.height;
                const hue = (i * 50 + bgTime * 100) % 360;
                ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.6)`;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Secondary smaller prisms
            for (let p = 0; p < 3; p++) {
                const px = canvas.width * (0.5 + p * 0.15);
                const py = canvas.height * (0.5 + p * 0.1);
                const psize = 20 + p * 10;
                
                ctx.save();
                ctx.translate(px, py);
                ctx.rotate(bgTime * 0.1 + p);
                ctx.globalAlpha = 0.5;
                
                const miniPrism = ctx.createLinearGradient(-psize, -psize, psize, psize);
                miniPrism.addColorStop(0, 'rgba(255, 200, 255, 0.6)');
                miniPrism.addColorStop(1, 'rgba(200, 255, 255, 0.4)');
                ctx.fillStyle = miniPrism;
                
                ctx.beginPath();
                ctx.moveTo(0, -psize);
                ctx.lineTo(psize * 0.8, psize * 0.6);
                ctx.lineTo(-psize * 0.8, psize * 0.6);
                ctx.closePath();
                ctx.fill();
                
                ctx.restore();
            }
            ctx.globalAlpha = 1;
            break;

        default: // 'default'
            // Enhanced cosmic gradient with depth
            const gradient = ctx.createLinearGradient(0, 0, canvas.width * 0.5, canvas.height);
            gradient.addColorStop(0, '#0a0520');
            gradient.addColorStop(0.3, '#150a35');
            gradient.addColorStop(0.6, '#1a1045');
            gradient.addColorStop(1, '#0d0825');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Subtle nebula clouds
            for (let neb = 0; neb < 3; neb++) {
                const nebX = (neb * 400 + bgOffset * 0.05) % (canvas.width + 300) - 150;
                const nebY = canvas.height * (0.2 + neb * 0.2);
                const nebGrad = ctx.createRadialGradient(nebX, nebY, 0, nebX, nebY, 200);
                nebGrad.addColorStop(0, `rgba(${100 + neb * 40}, 50, ${150 + neb * 30}, 0.15)`);
                nebGrad.addColorStop(0.5, `rgba(${80 + neb * 30}, 30, ${120 + neb * 20}, 0.08)`);
                nebGrad.addColorStop(1, 'transparent');
                ctx.fillStyle = nebGrad;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            
            // Twinkling stars at multiple depths
            for (let layer = 0; layer < 3; layer++) {
                const starCount = 40 + layer * 20;
                const twinkleSpeed = 1.5 + layer * 0.5;
                for (let i = 0; i < starCount; i++) {
                    const x = (i * (73 + layer * 17) + bgOffset * (0.02 + layer * 0.01)) % canvas.width;
                    const y = (i * (47 + layer * 13)) % (canvas.height * 0.75);
                    const baseAlpha = 0.2 + layer * 0.15;
                    const twinkle = Math.sin(bgTime * twinkleSpeed + i * 2) * 0.3;
                    ctx.globalAlpha = Math.max(0, baseAlpha + twinkle);
                    ctx.fillStyle = layer === 2 ? '#ffffff' : `rgba(200, 180, 255, 1)`;
                    const size = 0.5 + layer * 0.5 + (i % 3) * 0.3;
                    ctx.beginPath();
                    ctx.arc(x, y, size, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
            
            // Occasional shooting star
            const shootingStarPhase = (bgTime * 0.3) % 5;
            if (shootingStarPhase < 0.5) {
                const ssX = (bgTime * 200) % (canvas.width + 200);
                const ssY = 50 + Math.sin(bgTime) * 30;
                ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.5 - shootingStarPhase) + ')';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(ssX, ssY);
                ctx.lineTo(ssX - 60, ssY + 30);
                ctx.stroke();
            }

            // Layered parallax mountains with gradient
            for (let mLayer = 0; mLayer < 3; mLayer++) {
                const mAlpha = 0.6 + mLayer * 0.15;
                const mSpeed = 0.1 + mLayer * 0.05;
                const mHeight = 120 - mLayer * 30;
                const mColor = 15 + mLayer * 8;
                
                ctx.fillStyle = `rgb(${mColor}, ${mColor + 5}, ${mColor + 15})`;
                ctx.globalAlpha = mAlpha;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                for (let i = 0; i <= canvas.width + 100; i += 60 + mLayer * 20) {
                    const x = (i + bgOffset * mSpeed) % (canvas.width + 200) - 100;
                    const h = mHeight + Math.sin(i * 0.015 + mLayer) * (40 + mLayer * 15);
                    ctx.lineTo(x, canvas.height - GROUND_HEIGHT - h);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Subtle ground fog
            const fogGrad = ctx.createLinearGradient(0, canvas.height - GROUND_HEIGHT - 30, 0, canvas.height - GROUND_HEIGHT);
            fogGrad.addColorStop(0, 'transparent');
            fogGrad.addColorStop(1, 'rgba(100, 80, 150, 0.15)');
            ctx.fillStyle = fogGrad;
            ctx.fillRect(0, canvas.height - GROUND_HEIGHT - 50, canvas.width, 60);
            break;
    }
}


function draw() {
    // Fill with black instead of clearRect when alpha is false - slightly faster
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawBackground();

    // Floor - batched drawing to reduce state changes
    const groundY = canvas.height - GROUND_HEIGHT;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, groundY, canvas.width, GROUND_HEIGHT);

    // Batch all floor drawing into minimal state changes
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(canvas.width, groundY);
    ctx.stroke();

    // Floor pattern - batch all lines together
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const floorStart = (floorPatternOffset | 0);
    for (let i = floorStart; i < canvas.width; i += 40) {
        ctx.moveTo(i, groundY);
        ctx.lineTo(i - 20, canvas.height);
    }
    ctx.stroke();

    if (finishLine) finishLine.draw();

    // Draw obstacles - only visible ones (culling)
    for (let i = 0, len = obstacles.length; i < len; i++) {
        const obs = obstacles[i];
        // Skip offscreen obstacles
        if (obs.x > -obs.w && obs.x < canvas.width + 50) {
            obs.draw();
        }
    }
    
    // Draw powerups - only visible ones
    for (let i = 0, len = powerUps.length; i < len; i++) {
        const pu = powerUps[i];
        if (pu.x > -pu.size && pu.x < canvas.width + 50) {
            pu.draw();
        }
    }
    
    // Draw Gold God ability coins
    for (let i = 0, len = abilityCoins.length; i < len; i++) {
        abilityCoins[i].draw();
    }

    // Draw player on top of powerups
    if (player && !playerExploded) {
        player.draw();
        drawPlayerHearts();
    }
    
    // Batch particle drawing - use single globalAlpha reset at end
    let lastAlpha = 1;
    for (let i = 0, len = particles.length; i < len; i++) {
        const p = particles[i];
        if (p.active && p.life > 0) {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x | 0, p.y | 0, p.size | 0, p.size | 0);
            lastAlpha = p.life;
        }
    }
    if (lastAlpha !== 1) ctx.globalAlpha = 1;
    
    // Cube fragments
    for (let i = 0, len = cubeFragments.length; i < len; i++) {
        cubeFragments[i].draw();
    }
    
    // Draw progress bar (only in quest levels, not unlimited)
    if (showProgressBar && gameState === 'PLAYING' && !isUnlimitedMode) {
        drawProgressBar();
    }
    
    // Draw Gold God ability cooldown timer
    drawGoldGodCooldown();
}

// Draw hearts below the player
function drawPlayerHearts() {
    if (shieldCount <= 0 || !player) return;
    
    const heartSize = 16;
    const spacing = 20;
    const totalWidth = shieldCount * spacing;
    const startX = (player.x + player.size / 2 - totalWidth / 2 + spacing / 2) | 0;
    const y = (player.y + player.size + 15) | 0;
    
    ctx.save();
    ctx.font = `${heartSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Glow effect - only if shadows enabled
    if (perfSettings.shadowsEnabled) {
        ctx.shadowBlur = perfSettings.reducedShadowBlur;
        ctx.shadowColor = '#ff0055';
    }
    
    for (let i = 0; i < shieldCount; i++) {
        const x = startX + i * spacing;
        ctx.fillText('❤️', x, y);
    }
    
    ctx.restore();
}

// Draw stylish progress bar
function drawProgressBar() {
    const levelConfig = LEVELS[currentLevel];
    if (!levelConfig) return;
    
    const progress = Math.min(distanceTraveled / levelConfig.length, 1);
    const percentage = Math.floor(progress * 100);
    
    // Bar dimensions
    const barWidth = 400;
    const barHeight = 28;
    const barX = (canvas.width - barWidth) / 2;
    const barY = 55;
    const borderRadius = 14;
    const filledWidth = barWidth * progress;
    
    ctx.save();
    
    // Background (dark with border)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.5)';
    ctx.lineWidth = 2;
    
    // Draw rounded rectangle background
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, borderRadius);
    ctx.fill();
    ctx.stroke();
    
    // Clip for the filled portion
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(barX + 2, barY + 2, filledWidth - 4, barHeight - 4, borderRadius - 2);
    ctx.clip();
    
    // Gradient fill
    const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
    gradient.addColorStop(0, '#00f3ff');
    gradient.addColorStop(0.5, '#00ffaa');
    gradient.addColorStop(1, '#00ff55');
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, barY, filledWidth, barHeight);
    
    // Animated diagonal stripes
    const stripeWidth = 20;
    const stripeOffset = (Date.now() * 0.05) % (stripeWidth * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    
    for (let i = -stripeWidth * 2; i < barWidth + stripeWidth * 2; i += stripeWidth * 2) {
        ctx.beginPath();
        ctx.moveTo(barX + i + stripeOffset, barY);
        ctx.lineTo(barX + i + stripeWidth + stripeOffset, barY);
        ctx.lineTo(barX + i + stripeOffset, barY + barHeight);
        ctx.lineTo(barX + i - stripeWidth + stripeOffset, barY + barHeight);
        ctx.closePath();
        ctx.fill();
    }
    
    ctx.restore();
    
    // Glow effect on the filled portion
    if (progress > 0) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#00f3ff';
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(barX + 2, barY + 2, Math.max(0, filledWidth - 4), barHeight - 4, borderRadius - 2);
        ctx.stroke();
    }
    
    // Percentage text
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#000';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${percentage}%`, barX + barWidth / 2, barY + barHeight / 2 + 1);
    
    // Finish line icon at the end
    ctx.font = '20px Arial';
    ctx.fillText('🏁', barX + barWidth + 25, barY + barHeight / 2);
    
    // Level indicator at the start
    ctx.font = 'bold 14px "Orbitron", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(`LV ${currentLevel}`, barX - 15, barY + barHeight / 2);
    
    ctx.restore();
}

function loop(currentTime) {
    // Cache timestamp for this frame
    frameTimestamp = currentTime;
    
    // Calculate delta time with high-precision timing
    if (lastTime === 0) lastTime = currentTime;
    const rawDelta = currentTime - lastTime;
    lastTime = currentTime;
    
    // Normalize delta time to target FPS and cap to prevent huge jumps
    deltaTime = rawDelta / TARGET_FRAME_TIME;
    deltaTime = Math.min(deltaTime, 3); // Cap at 3x to prevent spiral after tab switch
    
    // Track frame timing for performance monitoring
    updateFrameStats(rawDelta);

    // Update game state
    if (gameState === 'PLAYING') {
        update(deltaTime);
    } else if (gameState === 'GAMEOVER') {
        if (player && !playerExploded) {
            player.update(deltaTime);
        }
        // Optimized obstacle cleanup - single pass
        let writeIdx = 0;
        for (let i = 0, len = obstacles.length; i < len; i++) {
            obstacles[i].update(deltaTime);
            if (!obstacles[i].markedForDeletion) {
                if (writeIdx !== i) obstacles[writeIdx] = obstacles[i];
                writeIdx++;
            }
        }
        obstacles.length = writeIdx;

        // Optimized particle cleanup with object pooling
        writeIdx = 0;
        for (let i = 0, len = particles.length; i < len; i++) {
            particles[i].update(deltaTime);
            if (particles[i].active && particles[i].life > 0) {
                if (writeIdx !== i) particles[writeIdx] = particles[i];
                writeIdx++;
            } else {
                returnToPool(particles[i]); // Return to pool for reuse
            }
        }
        particles.length = writeIdx;

        // Optimized cube fragment cleanup
        writeIdx = 0;
        for (let i = 0, len = cubeFragments.length; i < len; i++) {
            cubeFragments[i].update(deltaTime);
            if (cubeFragments[i].life > 0) {
                if (writeIdx !== i) cubeFragments[writeIdx] = cubeFragments[i];
                writeIdx++;
            }
        }
        cubeFragments.length = writeIdx;

    } else if (gameState === 'WIN') {
        let writeIdx = 0;
        for (let i = 0, len = particles.length; i < len; i++) {
            particles[i].update(deltaTime);
            if (particles[i].active && particles[i].life > 0) {
                if (writeIdx !== i) particles[writeIdx] = particles[i];
                writeIdx++;
            } else {
                returnToPool(particles[i]);
            }
        }
        particles.length = writeIdx;
    }

    draw();
    requestAnimationFrame(loop);
}

// Level selection UI
function showLevelSelect() {
    hideAllScreens(); // Make sure all other screens are closed first
    gameState = 'LEVEL_SELECT';
    document.getElementById('level-select-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
    document.getElementById('current-level-display').classList.remove('visible');
    updateLevelButtons();
    updateUI();
    updateCosmeticsButtonVisibility(); // Show cosmetics button in menu
    soundManager.unpause(); // Resume music when going to menu
}

function updateLevelButtons() {
    const buttons = document.querySelectorAll('.level-btn');
    buttons.forEach(btn => {
        const levelData = btn.dataset.level;
        
        // Unlimited and Hardcore modes are always unlocked
        if (levelData === 'unlimited' || levelData === 'hardcore') {
            btn.classList.remove('locked');
            btn.classList.add('unlocked');
            return;
        }
        
        const level = parseInt(levelData);
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
    // Check if starting unlimited or hardcore mode
    if (level === 'unlimited') {
        isUnlimitedMode = true;
        isHardcoreMode = false;
        currentLevel = 1; // Use level 1 config as base
    } else if (level === 'hardcore') {
        isUnlimitedMode = true; // Hardcore is a variant of unlimited
        isHardcoreMode = true;
        currentLevel = 1;
    } else {
        isUnlimitedMode = false;
        isHardcoreMode = false;
        currentLevel = level;
    }
    
    init();
    gameState = 'PLAYING';
    updateCosmeticsButtonVisibility(); // Hide cosmetics button during gameplay
    gameStartTime = Date.now(); // Start timer
    coinsCollectedThisRun = 0; // Reset coins for this run
    obstaclesClearedThisRun = 0; // Reset obstacles cleared
    powerupsCollectedThisRun = 0; // Reset powerups collected
    document.getElementById('level-select-screen').classList.remove('active');
    document.querySelector('.game-title').style.opacity = '0.2';
    document.getElementById('current-level-display').classList.add('visible');
    
    // Update level display for unlimited/hardcore mode
    if (isHardcoreMode) {
        document.getElementById('current-level-num').innerText = '💀';
    } else if (isUnlimitedMode) {
        document.getElementById('current-level-num').innerText = '∞';
    }

    // Reset powerups
    powerUps = [];
    shieldCount = 0;
    isBoosting = false;
    boostTimer = 0;
    isBulldozing = false;
    bulldozerTimer = 0;
    isGhosting = false;
    ghostTimer = 0;
    isMagnet = false;
    magnetTimer = 0;
    safeModeTimer = 0;
    landingGracePeriod = 0;
    canvas.style.transform = ''; // Reset any screen shake
    updateShieldUI();

    soundManager.unpause(); // Resume music when starting level
}


// Event Listeners
window.addEventListener('resize', resize);

document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const levelData = btn.dataset.level;
        
        // Handle unlimited mode (always unlocked)
        if (levelData === 'unlimited') {
            startLevel('unlimited');
            return;
        }
        
        // Handle hardcore mode (always unlocked)
        if (levelData === 'hardcore') {
            startLevel('hardcore');
            return;
        }
        
        const level = parseInt(levelData);
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
        localStorage.setItem('jumpHopJumpKey', jumpKey);
        document.getElementById('bind-jump-btn').innerText = jumpKey === 'Space' ? 'SPACE' : jumpKey;
        document.getElementById('bind-jump-btn').classList.remove('active');
        isBindingKey = false;
        return;
    }
    
    // Ability key binding
    if (isBindingAbilityKey) {
        if (e.code === 'Escape') {
            isBindingAbilityKey = false;
            const btn = document.getElementById('bind-ability-btn');
            if (btn) {
                btn.innerText = abilityKey === 'Space' ? 'SPACE' : abilityKey.replace('Key', '');
                btn.classList.remove('active');
            }
            return;
        }
        abilityKey = e.code;
        localStorage.setItem('jumpHopAbilityKey', abilityKey);
        const btn = document.getElementById('bind-ability-btn');
        if (btn) {
            btn.innerText = abilityKey === 'Space' ? 'SPACE' : abilityKey.replace('Key', '');
            btn.classList.remove('active');
        }
        isBindingAbilityKey = false;
        return;
    }
    
    // Gold God ability activation
    if (e.code === abilityKey && gameState === 'PLAYING') {
        activateGoldGodAbility();
    }

    if (e.code === jumpKey) {
        if (gameState === 'PLAYING') {
            player.jump();
        } else if (gameState === 'GAMEOVER') {
            if (!canRestart) return; // Prevent restart during wasted animation
            init();
            gameState = 'PLAYING';
            updateCosmeticsButtonVisibility();
            canRestart = true;
            document.getElementById('game-over-screen').classList.remove('active');
            document.getElementById('wasted-screen').classList.remove('active');
            document.querySelector('.game-title').style.opacity = '0.2';
            document.getElementById('current-level-display').classList.add('visible');
            document.getElementById('current-level-num').innerText = isHardcoreMode ? '💀' : (isUnlimitedMode ? '∞' : currentLevel);
            soundManager.unpause();
        }
        // WIN state - do nothing on spacebar, force player to click Back to Menu
    } else if (e.code === 'Escape') {
        if (gameState === 'GAMEOVER' || gameState === 'WIN') {
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

    if (gameState === 'PLAYING') {
        player.jump();
    } else if (gameState === 'GAMEOVER') {
        if (!canRestart) return; // Prevent restart during wasted animation
        init();
        gameState = 'PLAYING';
        updateCosmeticsButtonVisibility();
        canRestart = true;
        document.getElementById('game-over-screen').classList.remove('active');
        document.getElementById('wasted-screen').classList.remove('active');
        document.querySelector('.game-title').style.opacity = '0.2';
        document.getElementById('current-level-display').classList.add('visible');
        document.getElementById('current-level-num').innerText = isHardcoreMode ? '💀' : (isUnlimitedMode ? '∞' : currentLevel);
        soundManager.unpause();
    }
    // WIN state - do nothing on click, force player to click Back to Menu button
});

// Customization Functions
function showCustomizeScreen() {
    hideAllScreens(); // Make sure all other screens are closed first
    gameState = 'CUSTOMIZE';
    document.getElementById('customize-screen').classList.add('active');
    document.querySelector('.game-title').style.opacity = '1';
    initPreviewCanvas();
    updatePreview();
    renderShopUI();
    updateCustomColorUI();
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
    const skinToShow = previewingSkin || playerSkin;

    // Check if showing a sprite skin
    const hasSkinPreview = skinToShow !== 'none' && (SKINS[skinToShow]?.imageUrl || SKINS[skinToShow]?.pixels);
    
    // Update ability description in preview panel
    const abilityEl = document.getElementById('preview-ability');
    if (abilityEl) {
        const skin = SKINS[skinToShow];
        if (skin && skin.ability) {
            abilityEl.textContent = skin.ability;
            abilityEl.style.display = 'block';
        } else {
            abilityEl.style.display = 'none';
        }
    }
    
    const centerX = previewCanvas.width / 2;
    const centerY = previewCanvas.height / 2;
    
    // Sprites are bigger and bob up/down, shapes rotate
    const size = hasSkinPreview ? 120 : 80;
    
    previewCtx.save();
    
    if (hasSkinPreview) {
        // Bob up and down for sprites (no rotation)
        const bobOffset = Math.sin(Date.now() * 0.003) * 8;
        previewCtx.translate(centerX, centerY + bobOffset);
    } else {
        // Rotate for shapes
        previewRotation += 1.5;
        previewCtx.translate(centerX, centerY);
        previewCtx.rotate((previewRotation * Math.PI) / 180);
    }

    // Glow
    previewCtx.shadowBlur = 25;
    previewCtx.shadowColor = hasSkinPreview ? '#00f3ff' : colorToShow;

    // Draw skin if previewing or equipped, otherwise draw shape
    const skinCanvas = skinToShow !== 'none' ? getSkinCanvas(skinToShow, size) : null;
    const skinImg = skinToShow !== 'none' ? skinImages[skinToShow] : null;
    if (skinCanvas) {
        previewCtx.drawImage(skinCanvas, -size/2, -size/2);
    } else if (skinImg) {
        previewCtx.drawImage(skinImg, -size/2, -size/2, size, size);
    } else {
        drawShape(previewCtx, shapeToShow, size, colorToShow);
    }

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
            
        // Exclusive Reward Backgrounds (Preview)
        case 'vortex':
            const vortexPrev = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w);
            vortexPrev.addColorStop(0, '#200050');
            vortexPrev.addColorStop(1, '#000010');
            ctx.fillStyle = vortexPrev;
            ctx.fillRect(0, 0, w, h);
            // Spiral rings
            for (let i = 0; i < 5; i++) {
                ctx.strokeStyle = `hsl(${i * 60}, 80%, 60%)`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.ellipse(w/2, h/2, 10 + i * 15, 5 + i * 7, i * 0.3, 0, Math.PI * 2);
                ctx.stroke();
            }
            break;
            
        case 'cybergrid':
            ctx.fillStyle = '#000830';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 1;
            // Grid lines
            for (let i = 0; i < 8; i++) {
                ctx.globalAlpha = i / 8;
                ctx.beginPath();
                ctx.moveTo(0, h * 0.4 + i * 8);
                ctx.lineTo(w, h * 0.4 + i * 8);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'inferno':
            const infernoPrev = ctx.createLinearGradient(0, 0, 0, h);
            infernoPrev.addColorStop(0, '#200500');
            infernoPrev.addColorStop(1, '#601800');
            ctx.fillStyle = infernoPrev;
            ctx.fillRect(0, 0, w, h);
            // Fire glow
            ctx.fillStyle = 'rgba(255, 100, 0, 0.3)';
            ctx.beginPath();
            ctx.arc(w/2, h, w/2, 0, Math.PI * 2);
            ctx.fill();
            break;
            
        case 'abyss':
            const abyssPrev = ctx.createLinearGradient(0, 0, 0, h);
            abyssPrev.addColorStop(0, '#020208');
            abyssPrev.addColorStop(1, '#100030');
            ctx.fillStyle = abyssPrev;
            ctx.fillRect(0, 0, w, h);
            // Glowing runes
            ctx.fillStyle = 'rgba(150, 50, 255, 0.5)';
            ctx.font = '12px monospace';
            ctx.fillText('⍟', w*0.3, h*0.5);
            ctx.fillText('⌬', w*0.7, h*0.6);
            break;
            
        case 'throneroom':
            // Iron Throne preview - with rose window
            const thronePrev = ctx.createLinearGradient(0, 0, 0, h);
            thronePrev.addColorStop(0, '#1a1815');
            thronePrev.addColorStop(1, '#0a0908');
            ctx.fillStyle = thronePrev;
            ctx.fillRect(0, 0, w, h);
            // Rose window glow
            const prevWindowGlow = ctx.createRadialGradient(w/2, h*0.25, 0, w/2, h*0.25, w*0.35);
            prevWindowGlow.addColorStop(0, 'rgba(255, 250, 230, 0.8)');
            prevWindowGlow.addColorStop(1, 'transparent');
            ctx.fillStyle = prevWindowGlow;
            ctx.fillRect(0, 0, w, h*0.6);
            // Window circle
            ctx.fillStyle = 'rgba(220, 210, 180, 0.7)';
            ctx.beginPath();
            ctx.arc(w/2, h*0.25, w*0.2, 0, Math.PI * 2);
            ctx.fill();
            // Window spokes
            ctx.strokeStyle = '#1a1510';
            ctx.lineWidth = 2;
            for (let i = 0; i < 7; i++) {
                const ang = (i / 7) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(w/2, h*0.25);
                ctx.lineTo(w/2 + Math.cos(ang) * w*0.2, h*0.25 + Math.sin(ang) * w*0.2);
                ctx.stroke();
            }
            // Throne silhouette
            ctx.fillStyle = '#151210';
            for (let i = 0; i < 15; i++) {
                const sx = w/2 + (i - 7) * 4;
                const sHeight = 25 + Math.sin(i * 0.5) * 15;
                ctx.fillRect(sx, h*0.55 - sHeight, 2, sHeight);
            }
            break;
            
        case 'nebulacore':
            const nebulaPrev = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w);
            nebulaPrev.addColorStop(0, '#ffffff');
            nebulaPrev.addColorStop(0.2, '#8050ff');
            nebulaPrev.addColorStop(1, '#100020');
            ctx.fillStyle = nebulaPrev;
            ctx.fillRect(0, 0, w, h);
            break;
            
        case 'obsidian':
            const obsidianPrev = ctx.createLinearGradient(0, 0, 0, h);
            obsidianPrev.addColorStop(0, '#030308');
            obsidianPrev.addColorStop(1, '#080815');
            ctx.fillStyle = obsidianPrev;
            ctx.fillRect(0, 0, w, h);
            // Glass shards
            ctx.fillStyle = 'rgba(60, 60, 100, 0.5)';
            ctx.beginPath();
            ctx.moveTo(w*0.3, h*0.2);
            ctx.lineTo(w*0.5, h*0.6);
            ctx.lineTo(w*0.2, h*0.5);
            ctx.fill();
            break;
            
        case 'prismatic':
            ctx.fillStyle = '#0a0a20';
            ctx.fillRect(0, 0, w, h);
            // Rainbow beams
            const colors = ['#ff0000', '#ff7700', '#ffff00', '#00ff00', '#00ffff', '#0077ff', '#7700ff'];
            for (let i = 0; i < colors.length; i++) {
                ctx.strokeStyle = colors[i];
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.moveTo(w*0.3, h*0.4);
                ctx.lineTo(w*0.9, h*0.2 + i * 8);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
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
    
    // Add note if skin is equipped
    const shapeSection = shapeContainer.closest('.shop-section');
    const existingNote = shapeSection.querySelector('.skin-override-note');
    if (existingNote) existingNote.remove();
    
    if (playerSkin && playerSkin !== 'none') {
        const note = document.createElement('p');
        note.className = 'skin-override-note';
        note.innerHTML = '⚠️ <em>Skin equipped - shapes hidden in game</em>';
        shapeSection.insertBefore(note, shapeContainer);
        shapeContainer.classList.add('skin-equipped');
    } else {
        shapeContainer.classList.remove('skin-equipped');
    }

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
            'northern': '🏔️',
            // Exclusive Reward Backgrounds
            'vortex': '🌀',
            'cybergrid': '📐',
            'inferno': '🔥',
            'abyss': '🕳️',
            'throneroom': '⚔️',
            'nebulacore': '🌟',
            'obsidian': '🖤',
            'prismatic': '🌈'
        };

        Object.entries(SHOP_ITEMS.backgrounds).forEach(([bg, price]) => {
            const btn = document.createElement('button');
            btn.className = 'shape-btn bg-btn';
            btn.dataset.background = bg;

            const isUnlocked = unlockedBackgrounds.includes(bg);
            const isRewardOnly = price === -1;
            
            if (!isUnlocked && price > 0) {
                btn.classList.add('locked-item');
                const priceTag = document.createElement('div');
                priceTag.className = 'item-price';
                priceTag.innerText = price;
                btn.appendChild(priceTag);
            } else if (!isUnlocked && isRewardOnly) {
                btn.classList.add('locked-item');
                btn.classList.add('reward-only-item');
                const priceTag = document.createElement('div');
                priceTag.className = 'item-price reward-price';
                priceTag.innerText = '🎁';
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

    // Skins
    const skinsContainer = document.querySelector('.skins-grid');
    if (skinsContainer) {
        skinsContainer.innerHTML = '';

        Object.entries(SKINS).forEach(([skinId, skin]) => {
            const btn = document.createElement('button');
            btn.className = 'skin-item';
            btn.dataset.skin = skinId;

            const isUnlocked = unlockedSkins.includes(skinId);
            if (!isUnlocked) {
                btn.classList.add('locked');
                const priceTag = document.createElement('div');
                priceTag.className = 'skin-price rewards-only';
                priceTag.innerText = '🎁 Rewards';
                btn.appendChild(priceTag);
            }

            if (playerSkin === skinId) btn.classList.add('active');

            // Create skin preview using canvas for pixel art or image
            const preview = document.createElement('div');
            preview.className = 'skin-preview';
            if (skin.imageUrl) {
                // Image-based skin - show the uploaded sprite
                const img = document.createElement('img');
                img.src = skin.imageUrl;
                img.alt = skin.name;
                img.style.width = '64px';
                img.style.height = '64px';
                img.style.imageRendering = 'pixelated';
                img.style.objectFit = 'contain';
                img.crossOrigin = 'anonymous';
                preview.appendChild(img);
            } else if (skin.pixels) {
                // Create a canvas for the pixel art - 64px for crisp 32x32 at 2x
                const previewSize = 64;
                const skinPreviewCanvas = document.createElement('canvas');
                skinPreviewCanvas.width = previewSize;
                skinPreviewCanvas.height = previewSize;
                skinPreviewCanvas.style.width = `${previewSize}px`;
                skinPreviewCanvas.style.height = `${previewSize}px`;
                skinPreviewCanvas.style.imageRendering = 'pixelated';
                const skinPreviewCtx = skinPreviewCanvas.getContext('2d');
                skinPreviewCtx.imageSmoothingEnabled = false;
                
                // Draw the cached skin or create it
                const cachedSkin = getSkinCanvas(skinId, previewSize);
                if (cachedSkin) {
                    skinPreviewCtx.drawImage(cachedSkin, 0, 0);
                }
                preview.appendChild(skinPreviewCanvas);
            } else {
                // Fallback to icon
                preview.innerHTML = `<span style="font-size: 3rem;">${skin.icon || '?'}</span>`;
            }

            const name = document.createElement('div');
            name.className = 'skin-name';
            name.textContent = skin.name;

            btn.appendChild(preview);
            btn.appendChild(name);
            
            btn.addEventListener('click', () => handleSkinClick(skinId, isUnlocked));
            skinsContainer.appendChild(btn);
        });
    }
}

// Handle skin click - Skins are REWARDS PASS EXCLUSIVE (cannot buy with coins)
function handleSkinClick(skinId, isUnlocked) {
    clearSelection();
    if (isUnlocked) {
        previewingSkin = null;
        // If clicking the already equipped skin, unequip it (go back to shape)
        if (playerSkin === skinId) {
            setPlayerSkin('none');
            showToast('Skin unequipped - using shape', 'info');
        } else {
            setPlayerSkin(skinId);
            showToast(`${SKINS[skinId].name} equipped!`, 'success');
        }
        renderShopUI();
    } else {
        // Skins are rewards-only - preview but don't allow purchase
        previewingSkin = skinId;
        // Still highlight to show preview but don't allow purchase
        highlightSelected('skin', skinId);
        // Don't set selectedItem - prevents purchase button from appearing
        selectedItem = null;
        updateUnlockButton();
    }
}

function setPlayerSkin(skinId) {
    playerSkin = skinId;
    previewingSkin = null;
    saveProgress();
    renderShopUI();
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
        // Unequip skin when selecting a shape
        if (playerSkin && playerSkin !== 'none') {
            playerSkin = 'none';
            showToast(`${shape.charAt(0).toUpperCase() + shape.slice(1)} equipped!`, 'success');
        }
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
    } else if (price === -1) {
        // Reward-only background - show preview but can't purchase
        previewingBackground = bg;
        selectedItem = { type: 'background', value: bg, price: price, rewardOnly: true };
        highlightSelected('background', bg);
        updateUnlockButton();
        showToast('🎁 This background is exclusive to Level Rewards!', 'info');
    } else {
        // Select the background for purchase
        previewingBackground = bg;
        selectedItem = { type: 'background', value: bg, price: price };
        highlightSelected('background', bg);
        updateUnlockButton();
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
    } else if (type === 'skin') {
        const btn = document.querySelector(`.skin-item[data-skin="${value}"]`);
        if (btn) btn.classList.add('selected-for-purchase');
    }
}

// Clear selection state
function clearSelection() {
    previewingShape = null;
    previewingColor = null;
    previewingBackground = null;
    previewingSkin = null;
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
    const previewBtn = document.getElementById('cust-preview-btn');
    const priceSpan = document.getElementById('unlock-price');
    
    if (!unlockBtn) return;
    
    // Handle reward-only items
    if (selectedItem && selectedItem.rewardOnly) {
        unlockBtn.style.display = 'flex';
        unlockBtn.disabled = true;
        priceSpan.textContent = '🎁 REWARDS';
        unlockBtn.querySelector('.unlock-text').textContent = 'REWARDS ONLY';
        
        // Still show preview button for backgrounds
        if (previewBtn && selectedItem.type === 'background') {
            previewBtn.style.display = 'flex';
        }
    } else if (selectedItem && selectedItem.price > 0) {
        unlockBtn.style.display = 'flex';
        unlockBtn.querySelector('.unlock-text').textContent = 'UNLOCK';
        priceSpan.textContent = selectedItem.price;
        
        // Disable if not enough coins
        if (coins < selectedItem.price) {
            unlockBtn.disabled = true;
        } else {
            unlockBtn.disabled = false;
        }
        
        // Show preview button only for backgrounds
        if (previewBtn) {
            if (selectedItem.type === 'background') {
                previewBtn.style.display = 'flex';
            } else {
                previewBtn.style.display = 'none';
            }
        }
    } else {
        unlockBtn.style.display = 'none';
        if (previewBtn) previewBtn.style.display = 'none';
    }
}

// Draw background preview on the main canvas behind the customize screen
function drawBackgroundPreview(bg) {
    // Draw the selected background on the main game canvas
    // The customize screen is semi-transparent so this will show through
    drawFullBackgroundPreview(bg);
}

// Render loop for customize screen background preview
let customizeAnimFrame = null;
function startCustomizeBackgroundPreview() {
    function renderCustomizeBg() {
        if (gameState !== 'CUSTOMIZE') {
            customizeAnimFrame = null;
            return;
        }
        
        // Draw the preview background or current background
        const bgToShow = previewingBackground || currentBackground;
        drawFullBackgroundPreview(bgToShow);
        
        customizeAnimFrame = requestAnimationFrame(renderCustomizeBg);
    }
    
    if (!customizeAnimFrame) {
        renderCustomizeBg();
    }
}

// Draw a background on the main game canvas
function drawFullBackgroundPreview(bgName) {
    ctx.save();
    
    switch(bgName) {
        case 'space':
            const spaceGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            spaceGrad.addColorStop(0, '#0a0a1a');
            spaceGrad.addColorStop(0.5, '#1a1a3a');
            spaceGrad.addColorStop(1, '#0a0a1a');
            ctx.fillStyle = spaceGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Draw stars
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 100; i++) {
                const x = (i * 137.5) % canvas.width;
                const y = (i * 73.3) % canvas.height;
                const size = (i % 3) + 1;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'aurora':
            const auroraGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            auroraGrad.addColorStop(0, '#0a0a20');
            auroraGrad.addColorStop(0.3, '#1a2a40');
            auroraGrad.addColorStop(0.6, '#0a3030');
            auroraGrad.addColorStop(1, '#0a0a15');
            ctx.fillStyle = auroraGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Aurora waves
            const time = Date.now() * 0.001;
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.moveTo(0, canvas.height * 0.3 + i * 40);
                for (let x = 0; x < canvas.width; x += 20) {
                    const y = canvas.height * 0.3 + i * 40 + Math.sin(x * 0.01 + time + i) * 30;
                    ctx.lineTo(x, y);
                }
                ctx.strokeStyle = `rgba(0, ${150 + i * 50}, ${100 + i * 50}, 0.3)`;
                ctx.lineWidth = 20;
                ctx.stroke();
            }
            break;
            
        case 'sunset':
            const sunsetGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            sunsetGrad.addColorStop(0, '#1a0a20');
            sunsetGrad.addColorStop(0.3, '#4a1a3a');
            sunsetGrad.addColorStop(0.5, '#8a3a2a');
            sunsetGrad.addColorStop(0.7, '#ca6a1a');
            sunsetGrad.addColorStop(1, '#2a1a1a');
            ctx.fillStyle = sunsetGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Sun glow
            const sunGrad = ctx.createRadialGradient(canvas.width * 0.7, canvas.height * 0.5, 0, canvas.width * 0.7, canvas.height * 0.5, 150);
            sunGrad.addColorStop(0, 'rgba(255, 200, 100, 0.4)');
            sunGrad.addColorStop(1, 'rgba(255, 100, 50, 0)');
            ctx.fillStyle = sunGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            break;
            
        case 'midnight':
            const midnightGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            midnightGrad.addColorStop(0, '#05050a');
            midnightGrad.addColorStop(0.5, '#0a0a15');
            midnightGrad.addColorStop(1, '#050508');
            ctx.fillStyle = midnightGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Faint stars
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            for (let i = 0; i < 50; i++) {
                const x = (i * 97.3) % canvas.width;
                const y = (i * 61.7) % canvas.height;
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'ocean':
            const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            oceanGrad.addColorStop(0, '#0a1a2a');
            oceanGrad.addColorStop(0.5, '#0a2a4a');
            oceanGrad.addColorStop(1, '#051525');
            ctx.fillStyle = oceanGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Waves
            const waveTime = Date.now() * 0.002;
            for (let i = 0; i < 5; i++) {
                ctx.beginPath();
                ctx.moveTo(0, canvas.height * 0.6 + i * 30);
                for (let x = 0; x < canvas.width; x += 10) {
                    const y = canvas.height * 0.6 + i * 30 + Math.sin(x * 0.02 + waveTime + i * 0.5) * 15;
                    ctx.lineTo(x, y);
                }
                ctx.strokeStyle = `rgba(0, 150, 200, ${0.1 + i * 0.05})`;
                ctx.lineWidth = 3;
                ctx.stroke();
            }
            break;
            
        case 'forest':
            const forestGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            forestGrad.addColorStop(0, '#0a1a0a');
            forestGrad.addColorStop(0.5, '#1a3a1a');
            forestGrad.addColorStop(1, '#0a150a');
            ctx.fillStyle = forestGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Tree silhouettes
            ctx.fillStyle = 'rgba(0, 30, 0, 0.5)';
            for (let i = 0; i < 8; i++) {
                const x = (i * canvas.width / 8) + 50;
                const h = 100 + (i % 3) * 50;
                ctx.beginPath();
                ctx.moveTo(x, canvas.height);
                ctx.lineTo(x - 30, canvas.height - h);
                ctx.lineTo(x + 30, canvas.height - h);
                ctx.closePath();
                ctx.fill();
            }
            break;
            
        case 'volcano':
            const volcanoGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            volcanoGrad.addColorStop(0, '#1a0a0a');
            volcanoGrad.addColorStop(0.5, '#3a1a0a');
            volcanoGrad.addColorStop(1, '#0a0505');
            ctx.fillStyle = volcanoGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Lava glow
            const lavaGrad = ctx.createRadialGradient(canvas.width * 0.5, canvas.height, 0, canvas.width * 0.5, canvas.height, 200);
            lavaGrad.addColorStop(0, 'rgba(255, 100, 0, 0.4)');
            lavaGrad.addColorStop(1, 'rgba(100, 0, 0, 0)');
            ctx.fillStyle = lavaGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            break;
            
        case 'arctic':
            const arcticGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            arcticGrad.addColorStop(0, '#1a2a3a');
            arcticGrad.addColorStop(0.5, '#2a4a5a');
            arcticGrad.addColorStop(1, '#1a2a35');
            ctx.fillStyle = arcticGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Snow particles
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            const snowTime = Date.now() * 0.001;
            for (let i = 0; i < 30; i++) {
                const x = ((i * 83.7) + snowTime * 20) % canvas.width;
                const y = ((i * 47.3) + snowTime * 30) % canvas.height;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'desert':
            const desertGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            desertGrad.addColorStop(0, '#2a2a1a');
            desertGrad.addColorStop(0.4, '#4a3a2a');
            desertGrad.addColorStop(1, '#1a1a0a');
            ctx.fillStyle = desertGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Sand dunes
            ctx.fillStyle = 'rgba(80, 60, 30, 0.3)';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            for (let x = 0; x < canvas.width; x += 50) {
                const y = canvas.height - 100 + Math.sin(x * 0.01) * 50;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.closePath();
            ctx.fill();
            break;
            
        case 'nebula':
            const nebulaGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            nebulaGrad.addColorStop(0, '#1a0a2a');
            nebulaGrad.addColorStop(0.5, '#2a1a4a');
            nebulaGrad.addColorStop(1, '#0a1a3a');
            ctx.fillStyle = nebulaGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Nebula clouds
            for (let i = 0; i < 5; i++) {
                const cloudGrad = ctx.createRadialGradient(
                    (i * 200) % canvas.width, (i * 150) % canvas.height, 0,
                    (i * 200) % canvas.width, (i * 150) % canvas.height, 100
                );
                cloudGrad.addColorStop(0, `rgba(${100 + i * 30}, 50, ${150 + i * 20}, 0.2)`);
                cloudGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = cloudGrad;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            break;
            
        case 'storm':
            const stormGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            stormGrad.addColorStop(0, '#1a1a2a');
            stormGrad.addColorStop(0.5, '#2a2a3a');
            stormGrad.addColorStop(1, '#0a0a15');
            ctx.fillStyle = stormGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Rain
            ctx.strokeStyle = 'rgba(150, 150, 200, 0.3)';
            ctx.lineWidth = 1;
            const rainTime = Date.now() * 0.01;
            for (let i = 0; i < 50; i++) {
                const x = (i * 47) % canvas.width;
                const y = ((i * 31) + rainTime * 5) % canvas.height;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x - 5, y + 20);
                ctx.stroke();
            }
            break;
            
        case 'crystal':
            const crystalGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            crystalGrad.addColorStop(0, '#1a1a2a');
            crystalGrad.addColorStop(0.5, '#2a3a4a');
            crystalGrad.addColorStop(1, '#1a2a3a');
            ctx.fillStyle = crystalGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Crystal formations
            ctx.strokeStyle = 'rgba(150, 200, 255, 0.2)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 10; i++) {
                const x = (i * canvas.width / 10) + 30;
                ctx.beginPath();
                ctx.moveTo(x, canvas.height);
                ctx.lineTo(x + 20, canvas.height - 80 - (i % 3) * 30);
                ctx.lineTo(x + 40, canvas.height);
                ctx.stroke();
            }
            break;
            
        case 'sakura':
            const sakuraGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            sakuraGrad.addColorStop(0, '#2a1a2a');
            sakuraGrad.addColorStop(0.5, '#3a2a3a');
            sakuraGrad.addColorStop(1, '#1a1520');
            ctx.fillStyle = sakuraGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Cherry blossom petals
            ctx.fillStyle = 'rgba(255, 180, 200, 0.4)';
            const petalTime = Date.now() * 0.001;
            for (let i = 0; i < 20; i++) {
                const x = ((i * 67) + petalTime * 30) % canvas.width;
                const y = ((i * 43) + petalTime * 20) % canvas.height;
                ctx.beginPath();
                ctx.ellipse(x, y, 5, 3, (i * 0.5), 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'cave':
            const caveGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            caveGrad.addColorStop(0, '#0a0a0a');
            caveGrad.addColorStop(0.5, '#151515');
            caveGrad.addColorStop(1, '#050505');
            ctx.fillStyle = caveGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Stalactites
            ctx.fillStyle = 'rgba(50, 50, 60, 0.5)';
            for (let i = 0; i < 12; i++) {
                const x = (i * canvas.width / 12) + 20;
                const h = 40 + (i % 4) * 20;
                ctx.beginPath();
                ctx.moveTo(x - 10, 0);
                ctx.lineTo(x, h);
                ctx.lineTo(x + 10, 0);
                ctx.closePath();
                ctx.fill();
            }
            break;
            
        case 'neon_city':
            const neonGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            neonGrad.addColorStop(0, '#0a0a1a');
            neonGrad.addColorStop(1, '#1a0a2a');
            ctx.fillStyle = neonGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // City silhouette
            ctx.fillStyle = 'rgba(20, 20, 40, 0.8)';
            for (let i = 0; i < 10; i++) {
                const x = i * (canvas.width / 10);
                const h = 80 + (i % 4) * 40;
                ctx.fillRect(x, canvas.height - h, canvas.width / 12, h);
            }
            // Neon lights
            ctx.fillStyle = 'rgba(255, 0, 100, 0.5)';
            ctx.fillRect(100, canvas.height - 150, 3, 20);
            ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
            ctx.fillRect(300, canvas.height - 120, 3, 15);
            break;
            
        case 'galaxy':
            const galaxyGrad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width * 0.6);
            galaxyGrad.addColorStop(0, '#2a1a3a');
            galaxyGrad.addColorStop(0.5, '#1a1a2a');
            galaxyGrad.addColorStop(1, '#0a0a15');
            ctx.fillStyle = galaxyGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Spiral galaxy hint
            ctx.strokeStyle = 'rgba(200, 150, 255, 0.1)';
            ctx.lineWidth = 30;
            const galaxyTime = Date.now() * 0.0001;
            ctx.beginPath();
            for (let a = 0; a < Math.PI * 4; a += 0.1) {
                const r = a * 30;
                const x = canvas.width/2 + Math.cos(a + galaxyTime) * r;
                const y = canvas.height/2 + Math.sin(a + galaxyTime) * r * 0.5;
                if (a === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            break;
            
        case 'underwater':
            const underwaterGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            underwaterGrad.addColorStop(0, '#0a2a3a');
            underwaterGrad.addColorStop(0.5, '#0a3a4a');
            underwaterGrad.addColorStop(1, '#051a25');
            ctx.fillStyle = underwaterGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Bubbles
            ctx.fillStyle = 'rgba(150, 200, 255, 0.3)';
            const bubbleTime = Date.now() * 0.002;
            for (let i = 0; i < 15; i++) {
                const x = (i * 73) % canvas.width;
                const y = (canvas.height - (i * 51 + bubbleTime * 30) % canvas.height);
                const size = 3 + (i % 4) * 2;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'retrowave':
            const retroGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            retroGrad.addColorStop(0, '#0a0a1a');
            retroGrad.addColorStop(0.5, '#2a1a3a');
            retroGrad.addColorStop(1, '#1a0a2a');
            ctx.fillStyle = retroGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Sun
            const sunY = canvas.height * 0.4;
            const retroSunGrad = ctx.createLinearGradient(0, sunY - 60, 0, sunY + 60);
            retroSunGrad.addColorStop(0, '#ff6b6b');
            retroSunGrad.addColorStop(0.5, '#feca57');
            retroSunGrad.addColorStop(1, '#ff9ff3');
            ctx.fillStyle = retroSunGrad;
            ctx.beginPath();
            ctx.arc(canvas.width * 0.5, sunY, 60, 0, Math.PI * 2);
            ctx.fill();
            // Grid lines
            ctx.strokeStyle = 'rgba(255, 0, 150, 0.3)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 10; i++) {
                const y = canvas.height * 0.6 + i * 20;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
            break;
            
        case 'autumn':
            const autumnGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            autumnGrad.addColorStop(0, '#2a1a0a');
            autumnGrad.addColorStop(0.5, '#3a2a1a');
            autumnGrad.addColorStop(1, '#1a1005');
            ctx.fillStyle = autumnGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Falling leaves
            const leafTime = Date.now() * 0.001;
            const leafColors = ['rgba(200, 100, 50, 0.5)', 'rgba(220, 150, 50, 0.5)', 'rgba(180, 80, 30, 0.5)'];
            for (let i = 0; i < 15; i++) {
                ctx.fillStyle = leafColors[i % 3];
                const x = ((i * 89) + Math.sin(leafTime + i) * 20) % canvas.width;
                const y = ((i * 67) + leafTime * 25) % canvas.height;
                ctx.beginPath();
                ctx.ellipse(x, y, 6, 4, leafTime + i, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'twilight':
            const twilightGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            twilightGrad.addColorStop(0, '#1a0a2a');
            twilightGrad.addColorStop(0.3, '#3a1a4a');
            twilightGrad.addColorStop(0.6, '#5a2a3a');
            twilightGrad.addColorStop(1, '#1a0a1a');
            ctx.fillStyle = twilightGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Twilight stars
            ctx.fillStyle = 'rgba(255, 200, 255, 0.4)';
            for (let i = 0; i < 40; i++) {
                const x = (i * 113.7) % canvas.width;
                const y = (i * 67.3) % (canvas.height * 0.6);
                const twinkle = Math.sin(Date.now() * 0.003 + i) * 0.5 + 0.5;
                ctx.globalAlpha = 0.3 + twinkle * 0.4;
                ctx.beginPath();
                ctx.arc(x, y, 1 + (i % 2), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'mountain':
            const mountainGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            mountainGrad.addColorStop(0, '#1a2a3a');
            mountainGrad.addColorStop(0.4, '#2a3a4a');
            mountainGrad.addColorStop(1, '#0a1a2a');
            ctx.fillStyle = mountainGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Mountain silhouettes
            ctx.fillStyle = 'rgba(20, 30, 50, 0.8)';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            ctx.lineTo(150, canvas.height - 200);
            ctx.lineTo(300, canvas.height - 120);
            ctx.lineTo(450, canvas.height - 280);
            ctx.lineTo(600, canvas.height - 150);
            ctx.lineTo(750, canvas.height - 220);
            ctx.lineTo(canvas.width, canvas.height - 100);
            ctx.lineTo(canvas.width, canvas.height);
            ctx.closePath();
            ctx.fill();
            // Snow caps
            ctx.fillStyle = 'rgba(200, 220, 255, 0.3)';
            ctx.beginPath();
            ctx.moveTo(450, canvas.height - 280);
            ctx.lineTo(420, canvas.height - 230);
            ctx.lineTo(480, canvas.height - 230);
            ctx.closePath();
            ctx.fill();
            break;
            
        case 'cherry':
            const cherryGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            cherryGrad.addColorStop(0, '#2a1525');
            cherryGrad.addColorStop(0.5, '#3a2535');
            cherryGrad.addColorStop(1, '#1a1020');
            ctx.fillStyle = cherryGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Cherry blossoms falling
            const cherryTime = Date.now() * 0.001;
            for (let i = 0; i < 25; i++) {
                const x = ((i * 67) + cherryTime * 25 + Math.sin(cherryTime + i * 0.5) * 30) % canvas.width;
                const y = ((i * 43) + cherryTime * 15) % canvas.height;
                ctx.fillStyle = `rgba(255, ${180 + (i % 40)}, ${200 + (i % 30)}, 0.5)`;
                ctx.beginPath();
                ctx.ellipse(x, y, 5, 3, cherryTime * 2 + i, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'cosmos':
            const cosmosGrad = ctx.createRadialGradient(canvas.width * 0.3, canvas.height * 0.4, 0, canvas.width * 0.5, canvas.height * 0.5, canvas.width);
            cosmosGrad.addColorStop(0, '#2a1a4a');
            cosmosGrad.addColorStop(0.3, '#1a1a3a');
            cosmosGrad.addColorStop(0.7, '#0a0a2a');
            cosmosGrad.addColorStop(1, '#050510');
            ctx.fillStyle = cosmosGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Cosmic dust and stars
            const cosmosTime = Date.now() * 0.0005;
            for (let i = 0; i < 80; i++) {
                const x = (i * 97.3 + cosmosTime * 10) % canvas.width;
                const y = (i * 61.7) % canvas.height;
                const twinkle = Math.sin(Date.now() * 0.005 + i * 0.7) * 0.5 + 0.5;
                ctx.fillStyle = `rgba(${200 + (i % 55)}, ${180 + (i % 75)}, 255, ${0.2 + twinkle * 0.5})`;
                ctx.beginPath();
                ctx.arc(x, y, 1 + (i % 3) * 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            // Nebula clouds
            for (let i = 0; i < 3; i++) {
                const nebulaGrad = ctx.createRadialGradient(
                    (i * 300 + 100) % canvas.width, (i * 200 + 100) % canvas.height, 0,
                    (i * 300 + 100) % canvas.width, (i * 200 + 100) % canvas.height, 120
                );
                nebulaGrad.addColorStop(0, `rgba(${100 + i * 40}, 50, ${200 - i * 30}, 0.15)`);
                nebulaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = nebulaGrad;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            break;
            
        case 'volcanic':
            const volcanicGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            volcanicGrad.addColorStop(0, '#1a0505');
            volcanicGrad.addColorStop(0.4, '#2a0a0a');
            volcanicGrad.addColorStop(0.7, '#3a1505');
            volcanicGrad.addColorStop(1, '#0a0202');
            ctx.fillStyle = volcanicGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Lava glow from bottom
            const lavaGlow = ctx.createRadialGradient(canvas.width * 0.5, canvas.height + 50, 0, canvas.width * 0.5, canvas.height, 300);
            lavaGlow.addColorStop(0, 'rgba(255, 100, 0, 0.4)');
            lavaGlow.addColorStop(0.5, 'rgba(255, 50, 0, 0.2)');
            lavaGlow.addColorStop(1, 'rgba(100, 0, 0, 0)');
            ctx.fillStyle = lavaGlow;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Ember particles rising
            const emberTime = Date.now() * 0.002;
            ctx.fillStyle = 'rgba(255, 150, 50, 0.6)';
            for (let i = 0; i < 20; i++) {
                const x = (i * 83 + Math.sin(emberTime + i) * 20) % canvas.width;
                const y = canvas.height - ((i * 47 + emberTime * 40) % (canvas.height * 0.7));
                ctx.beginPath();
                ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'synthwave':
            const synthGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            synthGrad.addColorStop(0, '#0a0015');
            synthGrad.addColorStop(0.4, '#1a0030');
            synthGrad.addColorStop(0.6, '#2a0045');
            synthGrad.addColorStop(1, '#0a0010');
            ctx.fillStyle = synthGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Synthwave sun
            const synthSunY = canvas.height * 0.35;
            const synthSunGrad = ctx.createLinearGradient(0, synthSunY - 70, 0, synthSunY + 70);
            synthSunGrad.addColorStop(0, '#ff2a6d');
            synthSunGrad.addColorStop(0.5, '#ff6b2b');
            synthSunGrad.addColorStop(1, '#d61c7b');
            ctx.fillStyle = synthSunGrad;
            ctx.beginPath();
            ctx.arc(canvas.width * 0.5, synthSunY, 70, 0, Math.PI * 2);
            ctx.fill();
            // Horizontal lines through sun
            ctx.fillStyle = '#0a0015';
            for (let i = 0; i < 5; i++) {
                ctx.fillRect(canvas.width * 0.5 - 80, synthSunY - 30 + i * 15, 160, 3);
            }
            // Grid floor
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.4)';
            ctx.lineWidth = 1;
            for (let i = 0; i < 15; i++) {
                const y = canvas.height * 0.55 + i * 15;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
            break;
            
        case 'ethereal':
            const etherealGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            etherealGrad.addColorStop(0, '#1a1a2a');
            etherealGrad.addColorStop(0.5, '#2a2a4a');
            etherealGrad.addColorStop(1, '#1a2a3a');
            ctx.fillStyle = etherealGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Ethereal wisps
            const etherealTime = Date.now() * 0.001;
            for (let i = 0; i < 8; i++) {
                ctx.beginPath();
                ctx.moveTo(0, canvas.height * 0.3 + i * 50);
                for (let x = 0; x < canvas.width; x += 10) {
                    const y = canvas.height * 0.3 + i * 50 + Math.sin(x * 0.01 + etherealTime + i * 0.8) * 40;
                    ctx.lineTo(x, y);
                }
                ctx.strokeStyle = `rgba(${150 + i * 10}, ${200 + i * 5}, 255, 0.15)`;
                ctx.lineWidth = 15 + i * 3;
                ctx.stroke();
            }
            // Floating particles
            ctx.fillStyle = 'rgba(200, 220, 255, 0.4)';
            for (let i = 0; i < 30; i++) {
                const x = (i * 67 + etherealTime * 15) % canvas.width;
                const y = (i * 43 + Math.sin(etherealTime + i) * 30) % canvas.height;
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'firefly':
            const fireflyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            fireflyGrad.addColorStop(0, '#0a1510');
            fireflyGrad.addColorStop(0.5, '#0a2015');
            fireflyGrad.addColorStop(1, '#050a08');
            ctx.fillStyle = fireflyGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Fireflies
            const fireflyTime = Date.now() * 0.002;
            for (let i = 0; i < 25; i++) {
                const x = (i * 73 + Math.sin(fireflyTime * 0.5 + i * 2) * 50) % canvas.width;
                const y = (i * 47 + Math.cos(fireflyTime * 0.3 + i * 1.5) * 40) % canvas.height;
                const pulse = Math.sin(fireflyTime * 2 + i * 3) * 0.5 + 0.5;
                
                // Glow
                const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, 15 + pulse * 10);
                glowGrad.addColorStop(0, `rgba(255, 255, 100, ${0.4 + pulse * 0.4})`);
                glowGrad.addColorStop(0.5, `rgba(200, 255, 50, ${0.2 + pulse * 0.2})`);
                glowGrad.addColorStop(1, 'rgba(100, 200, 0, 0)');
                ctx.fillStyle = glowGrad;
                ctx.fillRect(x - 25, y - 25, 50, 50);
                
                // Core
                ctx.fillStyle = `rgba(255, 255, 200, ${0.6 + pulse * 0.4})`;
                ctx.beginPath();
                ctx.arc(x, y, 2 + pulse, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'northern':
            const northernGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            northernGrad.addColorStop(0, '#050515');
            northernGrad.addColorStop(0.5, '#0a0a25');
            northernGrad.addColorStop(1, '#050510');
            ctx.fillStyle = northernGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Northern lights waves
            const northernTime = Date.now() * 0.001;
            for (let i = 0; i < 5; i++) {
                ctx.beginPath();
                ctx.moveTo(0, canvas.height * 0.2 + i * 60);
                for (let x = 0; x < canvas.width; x += 5) {
                    const y = canvas.height * 0.2 + i * 60 + 
                              Math.sin(x * 0.008 + northernTime + i * 0.5) * 50 +
                              Math.sin(x * 0.015 + northernTime * 1.5) * 20;
                    ctx.lineTo(x, y);
                }
                const hue = 120 + i * 30; // Green to cyan
                ctx.strokeStyle = `hsla(${hue}, 80%, 50%, 0.25)`;
                ctx.lineWidth = 30 + i * 10;
                ctx.stroke();
            }
            // Stars
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            for (let i = 0; i < 50; i++) {
                const x = (i * 83.7) % canvas.width;
                const y = (i * 37.3) % canvas.height;
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        // ========== EXCLUSIVE REWARD BACKGROUNDS (Full Preview) ==========
        
        case 'vortex':
            // 3D Swirling Vortex
            const vortexGradFull = ctx.createRadialGradient(
                canvas.width/2, canvas.height/2, 0,
                canvas.width/2, canvas.height/2, canvas.width
            );
            vortexGradFull.addColorStop(0, '#000010');
            vortexGradFull.addColorStop(0.5, '#0a0030');
            vortexGradFull.addColorStop(1, '#000005');
            ctx.fillStyle = vortexGradFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const vortexTime = Date.now() * 0.001;
            const vcX = canvas.width / 2;
            const vcY = canvas.height / 2;
            for (let ring = 0; ring < 20; ring++) {
                const depth = (ring + vortexTime * 2) % 20;
                const scale = Math.pow(depth / 20, 2);
                const radius = 50 + scale * 400;
                const rotation = vortexTime * 0.5 + ring * 0.3;
                
                ctx.save();
                ctx.translate(vcX, vcY);
                ctx.rotate(rotation);
                ctx.globalAlpha = 0.8 - scale * 0.7;
                
                const hue = (ring * 25 + vortexTime * 30) % 360;
                ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`;
                ctx.lineWidth = 3 + scale * 5;
                
                ctx.beginPath();
                for (let a = 0; a < Math.PI * 2; a += 0.1) {
                    const wobble = Math.sin(a * 4 + vortexTime * 3) * 10 * scale;
                    const x = Math.cos(a) * (radius + wobble);
                    const y = Math.sin(a) * (radius + wobble) * 0.3;
                    if (a === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'cybergrid':
            // 3D Perspective Grid
            ctx.fillStyle = '#000830';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const cgVpX = canvas.width / 2;
            const cgVpY = canvas.height * 0.35;
            const cgTime = Date.now() * 0.001;
            
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            
            for (let i = 0; i < 25; i++) {
                const z = (i + cgTime * 3) % 25;
                const depth = z / 25;
                const y = cgVpY + (canvas.height - cgVpY) * depth;
                const spread = depth * canvas.width * 0.7;
                
                ctx.globalAlpha = depth * 0.8;
                ctx.beginPath();
                ctx.moveTo(cgVpX - spread, y);
                ctx.lineTo(cgVpX + spread, y);
                ctx.stroke();
            }
            
            for (let i = -12; i <= 12; i++) {
                const angle = i * 0.08;
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.moveTo(cgVpX, cgVpY);
                ctx.lineTo(cgVpX + Math.sin(angle) * canvas.width, canvas.height);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            break;
            
        case 'inferno':
            // Fiery Hellscape
            const infernoGradFull = ctx.createLinearGradient(0, 0, 0, canvas.height);
            infernoGradFull.addColorStop(0, '#0a0000');
            infernoGradFull.addColorStop(0.3, '#200500');
            infernoGradFull.addColorStop(0.7, '#401000');
            infernoGradFull.addColorStop(1, '#601800');
            ctx.fillStyle = infernoGradFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const infTime = Date.now() * 0.001;
            
            // Lava glow
            const lavaGlowFull = ctx.createRadialGradient(
                canvas.width / 2, canvas.height + 100, 0,
                canvas.width / 2, canvas.height, canvas.width
            );
            lavaGlowFull.addColorStop(0, 'rgba(255, 100, 0, 0.5)');
            lavaGlowFull.addColorStop(1, 'rgba(255, 50, 0, 0)');
            ctx.fillStyle = lavaGlowFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Fire pillars
            for (let pillar = 0; pillar < 6; pillar++) {
                const px = pillar * (canvas.width / 5);
                const height = 150 + Math.sin(infTime + pillar) * 50;
                
                const pillarGradFull = ctx.createLinearGradient(px, canvas.height, px, canvas.height - height);
                pillarGradFull.addColorStop(0, 'rgba(255, 100, 0, 0.8)');
                pillarGradFull.addColorStop(0.5, 'rgba(255, 200, 50, 0.6)');
                pillarGradFull.addColorStop(1, 'rgba(255, 50, 0, 0)');
                ctx.fillStyle = pillarGradFull;
                ctx.beginPath();
                ctx.moveTo(px - 20, canvas.height);
                ctx.quadraticCurveTo(px - 30, canvas.height - height * 0.5, px, canvas.height - height);
                ctx.quadraticCurveTo(px + 30, canvas.height - height * 0.5, px + 20, canvas.height);
                ctx.fill();
            }
            
            // Embers
            for (let i = 0; i < 30; i++) {
                const x = (i * 47) % canvas.width;
                const y = canvas.height - ((infTime * 50 + i * 30) % (canvas.height * 0.8));
                ctx.fillStyle = `hsl(${20 + Math.random() * 20}, 100%, 60%)`;
                ctx.beginPath();
                ctx.arc(x, y, 2 + Math.random() * 2, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'abyss':
            // Deep Glowing Chasm
            const abyssGradFull = ctx.createLinearGradient(0, 0, 0, canvas.height);
            abyssGradFull.addColorStop(0, '#020208');
            abyssGradFull.addColorStop(0.4, '#050515');
            abyssGradFull.addColorStop(1, '#000005');
            ctx.fillStyle = abyssGradFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Deep glow
            const abyssGlowFull = ctx.createRadialGradient(
                canvas.width / 2, canvas.height + 200, 0,
                canvas.width / 2, canvas.height, canvas.width
            );
            abyssGlowFull.addColorStop(0, 'rgba(80, 0, 150, 0.4)');
            abyssGlowFull.addColorStop(1, 'rgba(0, 0, 20, 0)');
            ctx.fillStyle = abyssGlowFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Floating platforms
            for (let layer = 0; layer < 4; layer++) {
                ctx.globalAlpha = 0.3 + layer * 0.15;
                ctx.fillStyle = `rgb(${15 + layer * 8}, ${10 + layer * 5}, ${25 + layer * 10})`;
                
                for (let rock = 0; rock < 3; rock++) {
                    const rx = rock * 300 + layer * 80;
                    const ry = canvas.height * (0.3 + layer * 0.15);
                    ctx.beginPath();
                    ctx.ellipse(rx, ry, 60 + layer * 20, 15 + layer * 5, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
            
            // Glowing runes
            const abyssTime = Date.now() * 0.001;
            const runeChars = '⍟⌬⎔⏣⏢';
            ctx.font = 'bold 30px monospace';
            ctx.textAlign = 'center';
            for (let i = 0; i < 6; i++) {
                const rx = canvas.width * (0.15 + i * 0.15);
                const ry = canvas.height * 0.4 + Math.sin(i + abyssTime) * 40;
                const runeHue = (abyssTime * 30 + i * 40) % 360;
                ctx.fillStyle = `hsla(${runeHue}, 80%, 60%, ${0.3 + Math.sin(abyssTime * 2 + i) * 0.2})`;
                ctx.fillText(runeChars[i % runeChars.length], rx, ry);
            }
            break;
            
        case 'throneroom':
            // Iron Throne - Full preview with rose window
            const throneGradFull = ctx.createLinearGradient(0, 0, 0, canvas.height);
            throneGradFull.addColorStop(0, '#1a1815');
            throneGradFull.addColorStop(0.5, '#151210');
            throneGradFull.addColorStop(1, '#0a0908');
            ctx.fillStyle = throneGradFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Stone walls
            ctx.fillStyle = '#252220';
            ctx.fillRect(0, 0, canvas.width * 0.15, canvas.height);
            ctx.fillRect(canvas.width * 0.85, 0, canvas.width * 0.15, canvas.height);
            
            // Rose Window
            const wCX = canvas.width / 2;
            const wCY = canvas.height * 0.22;
            const wR = Math.min(canvas.width * 0.28, 180);
            
            // Window glow
            const wGlowFull = ctx.createRadialGradient(wCX, wCY, 0, wCX, wCY, wR * 1.8);
            wGlowFull.addColorStop(0, 'rgba(255, 250, 230, 0.9)');
            wGlowFull.addColorStop(0.3, 'rgba(200, 180, 140, 0.5)');
            wGlowFull.addColorStop(1, 'transparent');
            ctx.fillStyle = wGlowFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height * 0.6);
            
            // Window circle
            ctx.fillStyle = 'rgba(220, 210, 180, 0.85)';
            ctx.beginPath();
            ctx.arc(wCX, wCY, wR, 0, Math.PI * 2);
            ctx.fill();
            
            // Window frame
            ctx.strokeStyle = '#1a1510';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(wCX, wCY, wR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(wCX, wCY, wR * 0.4, 0, Math.PI * 2);
            ctx.stroke();
            
            // Seven spokes
            ctx.lineWidth = 6;
            for (let sp = 0; sp < 7; sp++) {
                const spAngle = (sp / 7) * Math.PI * 2 - Math.PI / 2;
                ctx.beginPath();
                ctx.moveTo(wCX, wCY);
                ctx.lineTo(wCX + Math.cos(spAngle) * wR, wCY + Math.sin(spAngle) * wR);
                ctx.stroke();
            }
            
            // Center emblem
            const cEmblem = ctx.createRadialGradient(wCX, wCY, 0, wCX, wCY, wR * 0.2);
            cEmblem.addColorStop(0, 'rgba(180, 80, 60, 0.9)');
            cEmblem.addColorStop(1, 'rgba(80, 30, 20, 0.5)');
            ctx.fillStyle = cEmblem;
            ctx.beginPath();
            ctx.arc(wCX, wCY, wR * 0.18, 0, Math.PI * 2);
            ctx.fill();
            
            // Light rays
            ctx.globalAlpha = 0.08;
            for (let ray = 0; ray < 12; ray++) {
                const rAng = (ray / 12) * Math.PI - Math.PI / 2;
                ctx.fillStyle = '#fffde8';
                ctx.beginPath();
                ctx.moveTo(wCX + Math.cos(rAng - 0.05) * wR, wCY + Math.sin(rAng - 0.05) * wR);
                ctx.lineTo(wCX + Math.cos(rAng + 0.05) * wR, wCY + Math.sin(rAng + 0.05) * wR);
                ctx.lineTo(wCX + Math.cos(rAng) * wR * 3 + 20, canvas.height);
                ctx.lineTo(wCX + Math.cos(rAng) * wR * 3 - 20, canvas.height);
                ctx.closePath();
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Platform
            const platY = canvas.height * 0.72;
            ctx.fillStyle = '#1a1815';
            ctx.beginPath();
            ctx.moveTo(canvas.width * 0.25, canvas.height);
            ctx.lineTo(canvas.width * 0.75, canvas.height);
            ctx.lineTo(canvas.width * 0.7, platY);
            ctx.lineTo(canvas.width * 0.3, platY);
            ctx.closePath();
            ctx.fill();
            
            // Iron Throne - swords
            const tX = canvas.width / 2;
            const tBaseY = platY + 10;
            const tHeight = canvas.height * 0.45;
            const animTime = Date.now() * 0.001;
            
            for (let layer = 0; layer < 3; layer++) {
                const lSwords = 25 + layer * 10;
                const lSpread = 60 + layer * 25;
                const lHeight = tHeight * (1 - layer * 0.15);
                const shade = 45 + layer * 15;
                
                for (let i = 0; i < lSwords; i++) {
                    const prog = i / lSwords;
                    const xOff = (prog - 0.5) * lSpread * 2;
                    const hVar = Math.sin(prog * Math.PI) * 0.4 + 0.6;
                    const sH = lHeight * hVar * (0.8 + Math.random() * 0.4);
                    const aVar = (Math.random() - 0.5) * 0.3;
                    const tipX = tX + xOff + Math.sin(aVar) * sH * 0.2;
                    const tipY = tBaseY - sH;
                    
                    const sShade = shade + Math.floor(Math.random() * 30) - 15;
                    ctx.strokeStyle = `rgb(${sShade}, ${sShade - 5}, ${sShade - 10})`;
                    ctx.lineWidth = 2 + Math.random();
                    ctx.beginPath();
                    ctx.moveTo(tX + xOff, tBaseY);
                    ctx.lineTo(tipX, tipY);
                    ctx.stroke();
                    
                    if (Math.random() > 0.85) {
                        ctx.strokeStyle = `rgba(180, 175, 165, ${0.2 + Math.sin(animTime * 3 + i) * 0.1})`;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(tX + xOff + 1, tBaseY);
                        ctx.lineTo(tipX + 1, tipY);
                        ctx.stroke();
                    }
                }
            }
            
            // Throne seat
            ctx.fillStyle = '#151210';
            ctx.beginPath();
            ctx.ellipse(tX, tBaseY - 20, 50, 25, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Dust particles
            ctx.fillStyle = 'rgba(255, 250, 220, 0.4)';
            for (let d = 0; d < 40; d++) {
                const dx = (d * 37 + animTime * 10) % canvas.width;
                const dy = (d * 53 + animTime * 15) % (canvas.height * 0.7);
                ctx.globalAlpha = Math.sin(animTime + d) * 0.3 + 0.4;
                ctx.beginPath();
                ctx.arc(dx, dy, 0.5 + Math.random(), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            
            // Haze
            ctx.globalAlpha = 0.05;
            const hazeFull = ctx.createLinearGradient(0, 0, 0, canvas.height);
            hazeFull.addColorStop(0, '#c0b090');
            hazeFull.addColorStop(1, 'transparent');
            ctx.fillStyle = hazeFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
            break;
            
        case 'nebulacore':
            // Heart of Nebula
            const nebulaGradFull = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, 0,
                canvas.width / 2, canvas.height / 2, canvas.width
            );
            nebulaGradFull.addColorStop(0, '#200530');
            nebulaGradFull.addColorStop(0.3, '#100320');
            nebulaGradFull.addColorStop(1, '#050110');
            ctx.fillStyle = nebulaGradFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const nebTime = Date.now() * 0.001;
            
            // Gas clouds
            for (let cloud = 0; cloud < 10; cloud++) {
                const cx = (cloud * 150 + Math.sin(cloud + nebTime * 0.3) * 50) % canvas.width;
                const cy = canvas.height * 0.3 + (cloud * 70) % (canvas.height * 0.5);
                const cloudSize = 60 + cloud * 12;
                const hue = (cloud * 30 + nebTime * 10) % 360;
                
                const cloudGradFull = ctx.createRadialGradient(cx, cy, 0, cx, cy, cloudSize);
                cloudGradFull.addColorStop(0, `hsla(${hue}, 70%, 50%, 0.4)`);
                cloudGradFull.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = cloudGradFull;
                ctx.fillRect(cx - cloudSize * 1.5, cy - cloudSize, cloudSize * 3, cloudSize * 2);
            }
            
            // Star core
            const pulse = 1 + Math.sin(nebTime * 3) * 0.2;
            const starCoreFull = ctx.createRadialGradient(
                canvas.width / 2, canvas.height / 2, 0,
                canvas.width / 2, canvas.height / 2, 80 * pulse
            );
            starCoreFull.addColorStop(0, 'rgba(255, 255, 255, 1)');
            starCoreFull.addColorStop(0.2, 'rgba(200, 150, 255, 0.8)');
            starCoreFull.addColorStop(1, 'rgba(50, 0, 100, 0)');
            ctx.fillStyle = starCoreFull;
            ctx.fillRect(canvas.width / 2 - 150, canvas.height / 2 - 150, 300, 300);
            
            // Stars
            for (let i = 0; i < 80; i++) {
                const x = (i * 83) % canvas.width;
                const y = (i * 67) % canvas.height;
                const twinkle = 0.3 + Math.sin(nebTime * 3 + i) * 0.4;
                ctx.fillStyle = `rgba(255, 255, 255, ${twinkle})`;
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'obsidian':
            // Dark Volcanic Glass
            const obsidianGradFull = ctx.createLinearGradient(0, 0, 0, canvas.height);
            obsidianGradFull.addColorStop(0, '#030308');
            obsidianGradFull.addColorStop(0.5, '#080812');
            obsidianGradFull.addColorStop(1, '#050508');
            ctx.fillStyle = obsidianGradFull;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const obsTime = Date.now() * 0.001;
            
            // Glass shards
            for (let shard = 0; shard < 12; shard++) {
                const sx = shard * 100 + 50;
                const sy = canvas.height * 0.2 + (shard * 60) % (canvas.height * 0.6);
                const angle = shard * 0.5 + obsTime * 0.1;
                const size = 40 + shard * 8;
                
                ctx.save();
                ctx.translate(sx, sy);
                ctx.rotate(angle);
                
                const shardGradFull = ctx.createLinearGradient(-size, -size, size, size);
                shardGradFull.addColorStop(0, 'rgba(30, 30, 50, 0.8)');
                shardGradFull.addColorStop(0.5, 'rgba(80, 80, 120, 0.7)');
                shardGradFull.addColorStop(1, 'rgba(20, 20, 40, 0.5)');
                ctx.fillStyle = shardGradFull;
                
                ctx.beginPath();
                ctx.moveTo(0, -size);
                ctx.lineTo(size * 0.6, -size * 0.2);
                ctx.lineTo(size * 0.4, size * 0.8);
                ctx.lineTo(-size * 0.3, size * 0.5);
                ctx.lineTo(-size * 0.5, 0);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = 'rgba(150, 150, 200, 0.4)';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                ctx.restore();
            }
            
            // Molten veins
            ctx.strokeStyle = 'rgba(255, 100, 50, 0.4)';
            ctx.lineWidth = 2;
            for (let vein = 0; vein < 4; vein++) {
                ctx.beginPath();
                const startX = vein * 250;
                const startY = canvas.height * 0.7 + vein * 20;
                ctx.moveTo(startX, startY);
                for (let seg = 0; seg < 5; seg++) {
                    const nx = startX + (seg + 1) * 50 + Math.sin(obsTime + seg) * 20;
                    const ny = startY + Math.sin(seg * 0.8 + obsTime) * 30;
                    ctx.lineTo(nx, ny);
                }
                ctx.stroke();
            }
            break;
            
        case 'prismatic':
            // Rainbow Light Refraction
            ctx.fillStyle = '#050510';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const prismXFull = canvas.width * 0.3;
            const prismYFull = canvas.height * 0.3;
            const prismTime = Date.now() * 0.001;
            
            ctx.save();
            ctx.translate(prismXFull, prismYFull);
            ctx.rotate(prismTime * 0.05);
            
            const prismGradFull = ctx.createLinearGradient(-60, -80, 60, 80);
            prismGradFull.addColorStop(0, 'rgba(200, 220, 255, 0.7)');
            prismGradFull.addColorStop(1, 'rgba(100, 150, 200, 0.4)');
            ctx.fillStyle = prismGradFull;
            
            ctx.beginPath();
            ctx.moveTo(0, -80);
            ctx.lineTo(60, 50);
            ctx.lineTo(-60, 50);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            
            // Light beam
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(0, prismYFull - 20);
            ctx.lineTo(prismXFull - 30, prismYFull - 20);
            ctx.stroke();
            
            // Rainbow beams
            const colorsFull = ['#ff0000', '#ff7700', '#ffff00', '#00ff00', '#00ffff', '#0077ff', '#7700ff'];
            for (let i = 0; i < colorsFull.length; i++) {
                const angle = (i - 3) * 0.12 + prismTime * 0.02;
                const length = 400;
                const endX = prismXFull + 40 + Math.cos(angle) * length;
                const endY = prismYFull + 20 + Math.sin(angle) * length;
                
                ctx.strokeStyle = colorsFull[i];
                ctx.lineWidth = 6;
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.moveTo(prismXFull + 40, prismYFull + 20);
                ctx.lineTo(endX, endY);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            
            // Light particles
            for (let i = 0; i < 40; i++) {
                const x = (i * 47 + prismTime * 30) % canvas.width;
                const y = (i * 67 + Math.sin(prismTime + i) * 30) % canvas.height;
                const hue = (i * 50 + prismTime * 100) % 360;
                ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.6)`;
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
            
        case 'default':
            // Default dark background
            const defaultGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            defaultGrad.addColorStop(0, '#0a0a15');
            defaultGrad.addColorStop(0.5, '#0f0f20');
            defaultGrad.addColorStop(1, '#0a0a15');
            ctx.fillStyle = defaultGrad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            break;
            
        default:
            ctx.fillStyle = '#0a0a1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // Draw ground
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(0, canvas.height - GROUND_HEIGHT, canvas.width, GROUND_HEIGHT);
    
    ctx.restore();
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
    const prefix = `jumpHop_${userId}_`;
    localStorage.setItem(prefix + 'progress', unlockedLevels.toString());
    localStorage.setItem(prefix + 'coins', coins.toString());
    localStorage.setItem(prefix + 'hops', hops.toString());
    localStorage.setItem(prefix + 'highScore', highScore.toString());
    localStorage.setItem(prefix + 'unlockedColors', JSON.stringify(unlockedColors));
    localStorage.setItem(prefix + 'unlockedShapes', JSON.stringify(unlockedShapes));
    localStorage.setItem(prefix + 'unlockedBackgrounds', JSON.stringify(unlockedBackgrounds));
    localStorage.setItem(prefix + 'unlockedSkins', JSON.stringify(unlockedSkins));

    // Save current customization (per user)
    localStorage.setItem(prefix + 'color', playerColor);
    localStorage.setItem(prefix + 'shape', playerShape);
    localStorage.setItem(prefix + 'background', currentBackground);
    localStorage.setItem(prefix + 'skin', playerSkin);

    // Save lifetime statistics
    localStorage.setItem(prefix + 'allTimeCoins', allTimeCoins.toString());
    localStorage.setItem(prefix + 'allTimePowerups', allTimePowerups.toString());
    localStorage.setItem(prefix + 'allTimeObstacles', allTimeObstaclesCleared.toString());
    localStorage.setItem(prefix + 'allTimeDeaths', allTimeDeaths.toString());
    localStorage.setItem(prefix + 'timePlayed', timePlayedSeconds.toString());
    localStorage.setItem(prefix + 'totalDistance', totalDistanceMeters.toString());
    
    // Save season pass data
    localStorage.setItem(prefix + 'seasonLevel', seasonPassLevel.toString());
    localStorage.setItem(prefix + 'seasonXP', seasonPassXP.toString());
    localStorage.setItem(prefix + 'seasonPremium', seasonPassPremium.toString());
    localStorage.setItem(prefix + 'claimedRewards', JSON.stringify(claimedRewards));
    localStorage.setItem(prefix + 'customColorUnlocked', customColorUnlocked.toString());

    // Global settings (not per user)
    localStorage.setItem('jumpHopJumpKey', jumpKey);
    localStorage.setItem('jumpHopAbilityKey', abilityKey);
    localStorage.setItem('jumpHopMusic', isMusicEnabled);
    localStorage.setItem('jumpHopProgressBar', showProgressBar);
    localStorage.setItem('jumpHopParticles', perfSettings.particlesEnabled);
    localStorage.setItem('jumpHopShadows', perfSettings.shadowsEnabled);
    localStorage.setItem('jumpHopLastUser', userId);
    
    // Update stats UI
    updateStatsUI();
    updateHopsDisplay();
}

// Update hops display in UI
function updateHopsDisplay() {
    const hopsCount = document.getElementById('hops-count');
    if (hopsCount) hopsCount.textContent = hops;
    const customizeHops = document.getElementById('customize-hops-count');
    if (customizeHops) customizeHops.textContent = hops;
}

let isNewPlayer = false;

function loadProgress() {
    // Load last user
    const lastUser = localStorage.getItem('jumpHopLastUser');
    if (lastUser) {
        userId = lastUser;
    } else {
        // New player - will show create account modal
        isNewPlayer = true;
        userId = 'guest'; // Temporary until they create account
    }

    const prefix = `jumpHop_${userId}_`;

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

    const savedSkins = localStorage.getItem(prefix + 'unlockedSkins');
    if (savedSkins) {
        unlockedSkins = JSON.parse(savedSkins);
    }
    else unlockedSkins = ['none'];

    // Load saved customization (per user)
    const savedColor = localStorage.getItem(prefix + 'color');
    if (savedColor) playerColor = savedColor;
    else playerColor = '#00f3ff';

    const savedShape = localStorage.getItem(prefix + 'shape');
    if (savedShape) playerShape = savedShape;
    else playerShape = 'square';

    const savedSkin = localStorage.getItem(prefix + 'skin');
    if (savedSkin) playerSkin = savedSkin;
    else playerSkin = 'none';

    const savedBackground = localStorage.getItem(prefix + 'background');
    if (savedBackground) currentBackground = savedBackground;
    else currentBackground = 'default';

    // Load Global Settings
    const savedJumpKey = localStorage.getItem('jumpHopJumpKey');
    if (savedJumpKey) jumpKey = savedJumpKey;
    
    const savedAbilityKey = localStorage.getItem('jumpHopAbilityKey');
    if (savedAbilityKey) abilityKey = savedAbilityKey;

    const savedMusic = localStorage.getItem('jumpHopMusic');
    if (savedMusic !== null) isMusicEnabled = JSON.parse(savedMusic);
    
    const savedProgressBar = localStorage.getItem('jumpHopProgressBar');
    if (savedProgressBar !== null) showProgressBar = JSON.parse(savedProgressBar);
    
    const savedParticles = localStorage.getItem('jumpHopParticles');
    if (savedParticles !== null) perfSettings.particlesEnabled = JSON.parse(savedParticles);
    
    const savedShadows = localStorage.getItem('jumpHopShadows');
    if (savedShadows !== null) perfSettings.shadowsEnabled = JSON.parse(savedShadows);

    // Load volume settings
    const savedMusicVol = localStorage.getItem('jumpHopMusicVolume');
    if (savedMusicVol !== null) {
        musicVolume = parseFloat(savedMusicVol);
    }
    const savedSfxVol = localStorage.getItem('jumpHopSfxVolume');
    if (savedSfxVol !== null) {
        sfxVolume = parseFloat(savedSfxVol);
    }

    // Load lifetime statistics
    const savedAllTimeCoins = localStorage.getItem(prefix + 'allTimeCoins');
    if (savedAllTimeCoins) allTimeCoins = parseInt(savedAllTimeCoins);
    else allTimeCoins = 0;

    const savedAllTimePowerups = localStorage.getItem(prefix + 'allTimePowerups');
    if (savedAllTimePowerups) allTimePowerups = parseInt(savedAllTimePowerups);
    else allTimePowerups = 0;

    const savedAllTimeObstacles = localStorage.getItem(prefix + 'allTimeObstacles');
    if (savedAllTimeObstacles) allTimeObstaclesCleared = parseInt(savedAllTimeObstacles);
    else allTimeObstaclesCleared = 0;

    const savedAllTimeDeaths = localStorage.getItem(prefix + 'allTimeDeaths');
    if (savedAllTimeDeaths) allTimeDeaths = parseInt(savedAllTimeDeaths);
    else allTimeDeaths = 0;

    const savedTimePlayed = localStorage.getItem(prefix + 'timePlayed');
    if (savedTimePlayed) timePlayedSeconds = parseInt(savedTimePlayed);
    else timePlayedSeconds = 0;

    const savedTotalDistance = localStorage.getItem(prefix + 'totalDistance');
    if (savedTotalDistance) totalDistanceMeters = parseFloat(savedTotalDistance);
    else totalDistanceMeters = 0;
    
    // Load hops (premium currency)
    const savedHops = localStorage.getItem(prefix + 'hops');
    if (savedHops) hops = parseInt(savedHops);
    else hops = 0;
    
    // Load season pass data
    const savedSeasonLevel = localStorage.getItem(prefix + 'seasonLevel');
    if (savedSeasonLevel) seasonPassLevel = parseInt(savedSeasonLevel);
    else seasonPassLevel = 1;
    
    const savedSeasonXP = localStorage.getItem(prefix + 'seasonXP');
    if (savedSeasonXP) seasonPassXP = parseInt(savedSeasonXP);
    else seasonPassXP = 0;
    
    const savedSeasonPremium = localStorage.getItem(prefix + 'seasonPremium');
    if (savedSeasonPremium) seasonPassPremium = savedSeasonPremium === 'true';
    else seasonPassPremium = false;
    
    const savedClaimedRewards = localStorage.getItem(prefix + 'claimedRewards');
    if (savedClaimedRewards) claimedRewards = JSON.parse(savedClaimedRewards);
    else claimedRewards = [];
    
    const savedCustomColor = localStorage.getItem(prefix + 'customColorUnlocked');
    if (savedCustomColor) customColorUnlocked = savedCustomColor === 'true';
    else customColorUnlocked = false;

    updateUI();
    updateSettingsUI();
    updateStatsUI();
    updateHopsDisplay();
}

function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

// Check if a username is already taken
async function isUsernameTaken(username) {
    if (!cloudSyncEnabled || !supabase) return false;
    
    try {
        const { data, error } = await supabase
            .from('players')
            .select('id')
            .eq('id', username)
            .single();
        
        // If we get data, the username exists
        return data !== null;
    } catch (error) {
        return false;
    }
}

// Create a new account with chosen username
async function createAccount(username) {
    // Validate username
    if (username.length < 3 || username.length > 20) {
        return { success: false, error: 'Username must be 3-20 characters' };
    }
    
    // Only allow alphanumeric and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return { success: false, error: 'Only letters, numbers, and underscores allowed' };
    }
    
    // Check if username is taken
    const taken = await isUsernameTaken(username);
    if (taken) {
        return { success: false, error: 'Username already taken' };
    }
    
    // Create the account
    userId = username;
    localStorage.setItem('jumpHopLastUser', userId);
    
    // Save initial progress to cloud
    if (cloudSyncEnabled) {
        await saveToCloud();
    }
    saveProgress();
    
    return { success: true };
}

// Show create account modal for new players
function showCreateAccountModal() {
    document.getElementById('create-account-modal').classList.add('active');
    document.getElementById('create-username').value = '';
    document.getElementById('create-error').style.display = 'none';
    document.getElementById('create-success').style.display = 'none';
    // Hide level select while creating account
    document.getElementById('level-select-screen').classList.remove('active');
}

function hideCreateAccountModal() {
    document.getElementById('create-account-modal').classList.remove('active');
    document.getElementById('level-select-screen').classList.add('active');
}

async function switchAccount(newId) {
    if (!newId || newId.trim() === '') return;
    const targetId = newId.trim();
    
    // Check if target account has password protection
    if (cloudSyncEnabled) {
        const { hasPassword } = await checkAccountPassword(targetId);
        if (hasPassword) {
            // Account is password protected - show login modal
            showLoginModal(targetId);
            return;
        }
    }
    
    // No password - proceed with switch
    await performAccountSwitch(targetId);
}

// Actually perform the account switch (after password verification if needed)
async function performAccountSwitch(targetId) {
    userId = targetId;
    loadProgress(); // Reloads data for new ID from localStorage
    
    // Try to load from cloud for the new account
    if (cloudSyncEnabled) {
        const cloudLoaded = await loadFromCloud();
        if (cloudLoaded) {
            updateUI();
            updateLevelButtons();
            updateStatsUI();
        }
        
        // Check if this account has password/PIN and update UI
        const { hasPassword, hasPin } = await checkAccountPassword(userId);
        currentAccountHasPassword = hasPassword;
        currentAccountHasPin = hasPin;
        updatePasswordUI();
        updatePinUI();
    }
    
    showToast('Account Switched', `Now playing as ${userId}`, 'success');
}


function updateUI() {
    document.getElementById('coin-count').innerText = coins;
    document.getElementById('high-score').innerText = highScore;
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
    if (!customColorUnlocked) {
        e.preventDefault();
        showToast('Custom Color is locked!', 'error');
        return;
    }
    setPlayerColor(e.target.value);
});

// Unlock custom color button
document.getElementById('unlock-custom-color-btn').addEventListener('click', () => {
    if (customColorUnlocked) return;
    
    const cost = 5000;
    if (coins >= cost) {
        coins -= cost;
        customColorUnlocked = true;
        showToast('Custom Color Unlocked! 🎨', 'success');
        saveProgress();
        saveToCloud();
        updateUI();
        updateCustomColorUI();
    } else {
        showToast(`Need ${cost} coins! (Have: ${coins})`, 'error');
    }
});

// Update custom color picker UI based on unlock status
function updateCustomColorUI() {
    const container = document.getElementById('custom-color-container');
    const colorInput = document.getElementById('color-input');
    const unlockBtn = document.getElementById('unlock-custom-color-btn');
    
    if (customColorUnlocked) {
        container.classList.remove('locked');
        colorInput.style.display = 'block';
        unlockBtn.style.display = 'none';
    } else {
        container.classList.add('locked');
        colorInput.style.display = 'none';
        unlockBtn.style.display = 'block';
    }
}

// Cosmetics button (top UI)
document.getElementById('cosmetics-btn').addEventListener('click', () => {
    showCustomizeScreen();
});

// Rewards button (top UI)
document.getElementById('season-pass-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showRewards();
});

// Rewards back button
document.getElementById('rewards-back-btn').addEventListener('click', () => {
    hideRewards();
});

// Unlock VIP button (with Hops)
document.getElementById('unlock-vip-btn').addEventListener('click', () => {
    if (seasonPassPremium) return;
    if (hops >= 500) {
        hops -= 500;
        seasonPassPremium = true;
        showToast('VIP Rewards Unlocked! ✨', 'success');
        saveProgress();
        saveToCloud();
        renderRewardsUI();
        updateHopsDisplay();
    } else {
        showToast(`Need 500 Hops! (Have: ${hops})`, 'error');
    }
});

// Unlock VIP button (with Coins)
document.getElementById('unlock-vip-coins-btn').addEventListener('click', () => {
    if (seasonPassPremium) return;
    if (coins >= 20000) {
        coins -= 20000;
        seasonPassPremium = true;
        showToast('VIP Rewards Unlocked! ✨', 'success');
        saveProgress();
        saveToCloud();
        renderRewardsUI();
        updateUI();
    } else {
        showToast(`Need 20,000 Coins! (Have: ${coins})`, 'error');
    }
});

// Function to show/hide menu buttons based on game state
function updateCosmeticsButtonVisibility() {
    const cosmeticsBtn = document.getElementById('cosmetics-btn');
    const rewardsBtn = document.getElementById('season-pass-btn');
    const menuButtonsRow = document.querySelector('.menu-buttons-row');
    
    if (gameState === 'PLAYING') {
        if (cosmeticsBtn) cosmeticsBtn.style.display = 'none';
        if (rewardsBtn) rewardsBtn.style.display = 'none';
        if (menuButtonsRow) menuButtonsRow.style.display = 'none';
    } else {
        if (cosmeticsBtn) cosmeticsBtn.style.display = 'inline-block';
        if (rewardsBtn) rewardsBtn.style.display = 'inline-block';
        if (menuButtonsRow) menuButtonsRow.style.display = 'flex';
    }
}

// Settings UI
function showSettings() {
    if (gameState === 'SETTINGS') return;
    previousGameState = gameState;
    gameState = 'SETTINGS';
    
    // Hide other screens to prevent overlap
    document.getElementById('level-select-screen').classList.remove('active');
    document.getElementById('customize-screen').classList.remove('active');
    document.getElementById('game-over-screen').classList.remove('active');
    document.getElementById('level-complete-screen').classList.remove('active');
    
    document.getElementById('settings-modal').classList.add('active');
    updateSettingsUI();
    updateStatsUI(); // Update stats display
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
    gameState = previousGameState;
    
    // Restore the previous screen
    if (previousGameState === 'LEVEL_SELECT') {
        document.getElementById('level-select-screen').classList.add('active');
    } else if (previousGameState === 'CUSTOMIZE') {
        document.getElementById('customize-screen').classList.add('active');
    } else if (previousGameState === 'GAMEOVER') {
        document.getElementById('game-over-screen').classList.add('active');
    } else if (previousGameState === 'WIN') {
        document.getElementById('level-complete-screen').classList.add('active');
    }
    // If we were playing, the game loop continues automatically
}

function updateSettingsUI() {
    document.getElementById('toggle-music-btn').innerText = isMusicEnabled ? 'ON' : 'OFF';
    document.getElementById('toggle-progress-btn').innerText = showProgressBar ? 'ON' : 'OFF';
    document.getElementById('bind-jump-btn').innerText = jumpKey === 'Space' ? 'SPACE' : jumpKey;
    const abilityBtn = document.getElementById('bind-ability-btn');
    if (abilityBtn) {
        abilityBtn.innerText = abilityKey === 'Space' ? 'SPACE' : abilityKey.replace('Key', '');
    }
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
    localStorage.setItem('jumpHopMusic', isMusicEnabled);
    updateSettingsUI();
    if (!isMusicEnabled) soundManager.stop();
    else soundManager.resume();
});

document.getElementById('toggle-progress-btn').addEventListener('click', () => {
    showProgressBar = !showProgressBar;
    localStorage.setItem('jumpHopProgressBar', showProgressBar);
    updateSettingsUI();
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

document.getElementById('bind-ability-btn').addEventListener('click', function () {
    isBindingAbilityKey = true;
    this.innerText = 'PRESS KEY...';
    this.classList.add('active');
});

document.getElementById('load-account-btn').addEventListener('click', () => {
    // Show the switch account modal
    document.getElementById('switch-account-modal').classList.add('active');
    document.getElementById('switch-account-id').value = '';
    document.getElementById('switch-password-input').value = '';
    document.getElementById('switch-error').style.display = 'none';
});

// Create Account Modal handlers
document.getElementById('create-account-btn').addEventListener('click', async () => {
    const username = document.getElementById('create-username').value.trim();
    const errorEl = document.getElementById('create-error');
    const successEl = document.getElementById('create-success');
    
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    
    if (!username) {
        errorEl.textContent = 'Please enter a username';
        errorEl.style.display = 'block';
        return;
    }
    
    // Disable button while processing
    const btn = document.getElementById('create-account-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    
    const result = await createAccount(username);
    
    if (result.success) {
        successEl.textContent = 'Account created! Welcome, ' + username + '!';
        successEl.style.display = 'block';
        
        // Update UI
        updateUI();
        updateLevelButtons();
        document.getElementById('account-id-display').textContent = userId;
        
        // Close modal after short delay
        setTimeout(() => {
            hideCreateAccountModal();
            showToast('Welcome! 🎮', 'Account created: ' + username, 'success');
        }, 1000);
    } else {
        errorEl.textContent = result.error;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }
});

document.getElementById('create-switch-btn').addEventListener('click', () => {
    document.getElementById('create-account-modal').classList.remove('active');
    document.getElementById('switch-account-modal').classList.add('active');
    document.getElementById('switch-account-id').value = '';
    document.getElementById('switch-password-input').value = '';
    document.getElementById('switch-error').style.display = 'none';
});

// Switch Account Modal handlers
document.getElementById('switch-cancel-btn').addEventListener('click', () => {
    document.getElementById('switch-account-modal').classList.remove('active');
    // If new player, show create account modal again
    if (isNewPlayer) {
        showCreateAccountModal();
    }
});

document.getElementById('switch-login-btn').addEventListener('click', async () => {
    const accountId = document.getElementById('switch-account-id').value.trim();
    const password = document.getElementById('switch-password-input').value;
    const errorEl = document.getElementById('switch-error');
    
    if (!accountId) {
        errorEl.textContent = 'Please enter an Account ID';
        errorEl.style.display = 'block';
        return;
    }
    
    // Check if account exists and has a password
    const { hasPassword } = await checkAccountPassword(accountId);
    
    if (hasPassword) {
        // Account has password - verify it
        if (!password) {
            errorEl.textContent = 'This account requires a password';
            errorEl.style.display = 'block';
            return;
        }
        
        const valid = await verifyPassword(accountId, password);
        if (!valid) {
            errorEl.textContent = 'Incorrect password';
            errorEl.style.display = 'block';
            return;
        }
    }
    
    // Success - switch to the account
    document.getElementById('switch-account-modal').classList.remove('active');
    await performAccountSwitch(accountId);
});

// Forgot password from switch account modal
document.getElementById('switch-forgot-btn').addEventListener('click', async () => {
    const accountId = document.getElementById('switch-account-id').value.trim();
    
    if (!accountId) {
        document.getElementById('switch-error').textContent = 'Enter your Account ID first';
        document.getElementById('switch-error').style.display = 'block';
        return;
    }
    
    // Check if account has a PIN set
    const { hasPin } = await checkAccountPassword(accountId);
    
    if (!hasPin) {
        showToast('No Recovery PIN', 'This account has no recovery PIN set', 'error', 4000);
        return;
    }
    
    // Hide switch modal, show PIN recovery modal
    document.getElementById('switch-account-modal').classList.remove('active');
    pendingLoginAccountId = accountId;
    document.getElementById('pin-recovery-modal').classList.add('active');
    document.getElementById('recovery-account-id').textContent = accountId;
    document.getElementById('recovery-pin-verify').value = '';
    document.getElementById('recovery-error').style.display = 'none';
});

document.getElementById('copy-account-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(userId).then(() => {
        showToast('Copied!', 'Account ID copied to clipboard', 'success', 2000);
    });
});

// Password protection event listeners
document.getElementById('set-password-btn').addEventListener('click', showPasswordModal);

document.getElementById('password-cancel-btn').addEventListener('click', hidePasswordModal);

document.getElementById('password-save-btn').addEventListener('click', async () => {
    const password = document.getElementById('password-input').value;
    const confirm = document.getElementById('password-confirm').value;
    const errorEl = document.getElementById('password-error');
    
    // Validation
    if (password.length < 4) {
        errorEl.textContent = 'Password must be at least 4 characters';
        errorEl.style.display = 'block';
        return;
    }
    
    if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
    }
    
    const success = await setAccountPassword(password);
    if (success) {
        hidePasswordModal();
        showToast('Password Set! 🔒', 'Your account is now protected', 'success');
    } else {
        errorEl.textContent = 'Failed to set password. Please try again.';
        errorEl.style.display = 'block';
    }
});

// Login modal event listeners
document.getElementById('login-cancel-btn').addEventListener('click', hideLoginModal);

document.getElementById('login-submit-btn').addEventListener('click', async () => {
    const password = document.getElementById('login-password-input').value;
    const errorEl = document.getElementById('login-error');
    
    if (!password) {
        errorEl.textContent = 'Please enter your password';
        errorEl.style.display = 'block';
        return;
    }
    
    const valid = await verifyPassword(pendingLoginAccountId, password);
    if (valid) {
        hideLoginModal();
        await performAccountSwitch(pendingLoginAccountId);
    } else {
        errorEl.textContent = 'Incorrect password';
        errorEl.style.display = 'block';
    }
});

// Security PIN save
document.getElementById('save-pin-btn').addEventListener('click', async () => {
    const pin = document.getElementById('recovery-pin-input').value.trim();
    
    if (!pin) {
        showToast('PIN Required', 'Please enter a 4-6 digit PIN', 'warning');
        return;
    }
    
    // Validate PIN is 4-6 digits
    if (!/^\d{4,6}$/.test(pin)) {
        showToast('Invalid PIN', 'PIN must be 4-6 digits only', 'warning');
        return;
    }
    
    const success = await saveSecurityPin(pin);
    if (success) {
        showToast('PIN Saved! 🔐', 'Your recovery PIN has been set', 'success');
        document.getElementById('recovery-pin-input').value = '';
    } else {
        showToast('Save Failed', 'Could not save PIN. Please try again.', 'error');
    }
});

// Forgot password button - show PIN recovery modal
document.getElementById('forgot-password-btn').addEventListener('click', async () => {
    // Check if this account has a PIN set
    const { hasPin } = await checkAccountPassword(pendingLoginAccountId);
    
    if (!hasPin) {
        showToast('No Recovery PIN', 'This account has no recovery PIN set. Contact support.', 'error', 4000);
        return;
    }
    
    // Show PIN recovery modal
    hideLoginModal();
    document.getElementById('pin-recovery-modal').classList.add('active');
    document.getElementById('recovery-account-id').textContent = pendingLoginAccountId;
    document.getElementById('recovery-pin-verify').value = '';
    document.getElementById('recovery-error').style.display = 'none';
});

// PIN Recovery modal handlers
document.getElementById('recovery-cancel-btn').addEventListener('click', () => {
    document.getElementById('pin-recovery-modal').classList.remove('active');
    pendingLoginAccountId = null;
});

document.getElementById('recovery-verify-btn').addEventListener('click', async () => {
    const pin = document.getElementById('recovery-pin-verify').value.trim();
    const errorEl = document.getElementById('recovery-error');
    
    if (!pin) {
        errorEl.textContent = 'Please enter your recovery PIN';
        errorEl.style.display = 'block';
        return;
    }
    
    const valid = await verifySecurityPin(pendingLoginAccountId, pin);
    if (valid) {
        // PIN verified - show reset password modal
        document.getElementById('pin-recovery-modal').classList.remove('active');
        document.getElementById('reset-password-modal').classList.add('active');
        document.getElementById('reset-password-input').value = '';
        document.getElementById('reset-password-confirm').value = '';
        document.getElementById('reset-error').style.display = 'none';
        showToast('PIN Verified! ✓', 'Now create a new password', 'success');
    } else {
        errorEl.textContent = 'Incorrect PIN';
        errorEl.style.display = 'block';
    }
});

// Reset Password modal handler
document.getElementById('reset-save-btn').addEventListener('click', async () => {
    const password = document.getElementById('reset-password-input').value;
    const confirm = document.getElementById('reset-password-confirm').value;
    const errorEl = document.getElementById('reset-error');
    
    if (password.length < 4) {
        errorEl.textContent = 'Password must be at least 4 characters';
        errorEl.style.display = 'block';
        return;
    }
    
    if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
    }
    
    const success = await resetAccountPassword(pendingLoginAccountId, password);
    if (success) {
        document.getElementById('reset-password-modal').classList.remove('active');
        showToast('Password Reset! 🔐', 'You can now log in with your new password', 'success');
        
        // Now log them in automatically
        await performAccountSwitch(pendingLoginAccountId);
    } else {
        errorEl.textContent = 'Failed to reset password. Please try again.';
        errorEl.style.display = 'block';
    }
});

// Toggle password visibility - using event delegation for reliability
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-password');
    if (btn) {
        e.preventDefault();
        e.stopPropagation();
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (input) {
            if (input.type === 'password') {
                input.type = 'text';
                btn.textContent = '🙈';
                btn.style.color = 'rgba(0, 243, 255, 0.8)';
            } else {
                input.type = 'password';
                btn.textContent = '👁️';
                btn.style.color = 'rgba(255,255,255,0.5)';
            }
        }
    }
});

// Navigation Buttons
document.getElementById('go-retry-btn').addEventListener('click', () => {
    init();
    gameState = 'PLAYING';
    updateCosmeticsButtonVisibility();
    canRestart = true;
    document.getElementById('game-over-screen').classList.remove('active');
    document.getElementById('wasted-screen').classList.remove('active');
    document.querySelector('.game-title').style.opacity = '0.2';
    document.getElementById('current-level-display').classList.add('visible');
    document.getElementById('current-level-num').innerText = isHardcoreMode ? '💀' : (isUnlimitedMode ? '∞' : currentLevel);
    soundManager.unpause();
});

document.getElementById('go-menu-btn').addEventListener('click', () => {
    showLevelSelect();
    document.getElementById('game-over-screen').classList.remove('active');
    document.getElementById('wasted-screen').classList.remove('active');
});

document.getElementById('win-menu-btn').addEventListener('click', () => {
    showLevelSelect();
    document.getElementById('level-complete-screen').classList.remove('active');
});

document.getElementById('cust-back-btn').addEventListener('click', () => {
    previewingBackground = null;
    previewingShape = null;
    previewingColor = null;
    previewingSkin = null;
    selectedItem = null;
    showLevelSelect();
    document.getElementById('customize-screen').classList.remove('active');
});

// Preview button - shows full background preview
document.getElementById('cust-preview-btn').addEventListener('click', () => {
    if (!selectedItem || selectedItem.type !== 'background') return;
    
    // Hide customize screen
    document.getElementById('customize-screen').classList.remove('active');
    
    // Show preview overlay
    const overlay = document.getElementById('bg-preview-overlay');
    overlay.style.display = 'flex';
    
    // Start background preview render
    gameState = 'BG_PREVIEW';
    startFullBackgroundPreview(selectedItem.value);
});

// Background preview overlay - click to return
document.getElementById('bg-preview-overlay').addEventListener('click', () => {
    closeBackgroundPreview();
});

// Background preview - keypress to return
function handlePreviewKeypress(e) {
    if (gameState === 'BG_PREVIEW') {
        closeBackgroundPreview();
    }
}
document.addEventListener('keydown', handlePreviewKeypress);

// Close background preview and return to customize
function closeBackgroundPreview() {
    // Hide overlay regardless of state
    const overlay = document.getElementById('bg-preview-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    
    // Stop the preview render loop
    if (bgPreviewAnimFrame) {
        cancelAnimationFrame(bgPreviewAnimFrame);
        bgPreviewAnimFrame = null;
    }
    
    // Only change state if we were in preview
    if (gameState === 'BG_PREVIEW') {
        // Show customize screen again
        document.getElementById('customize-screen').classList.add('active');
        gameState = 'CUSTOMIZE';
    }
}

// Full background preview render loop
let bgPreviewAnimFrame = null;
function startFullBackgroundPreview(bgName) {
    function renderBgPreview() {
        if (gameState !== 'BG_PREVIEW') {
            bgPreviewAnimFrame = null;
            return;
        }
        
        drawFullBackgroundPreview(bgName);
        bgPreviewAnimFrame = requestAnimationFrame(renderBgPreview);
    }
    
    renderBgPreview();
}

// Unlock button
document.getElementById('cust-unlock-btn').addEventListener('click', () => {
    if (!selectedItem) return;
    
    const { type, value, price } = selectedItem;
    
    if (coins < price) {
        showToast('Not Enough Coins! 🪙', `You need ${price - coins} more coins`, 'warning');
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
    } else if (type === 'skin') {
        unlockedSkins.push(value);
        previewingSkin = null;
        setPlayerSkin(value);
        showToast('Skin Unlocked! 🎭', `${SKINS[value].name} is now yours!`, 'success');
    }
    
    // Save progress to localStorage AND cloud
    saveProgress();
    if (cloudSyncEnabled) saveToCloud();
    
    // Clear selection and re-render
    selectedItem = null;
    previewingColor = null;
    previewingShape = null;
    previewingBackground = null;
    previewingSkin = null;
    renderShopUI();
    
    // Play sound
    if (soundManager.ctx) {
        soundManager.playPowerup();
    }
});


// Start
loadProgress();

// Preload skin sprites
preloadSkinSprites();

// Initialize cloud sync and try to load from cloud
initSupabase();
if (cloudSyncEnabled) {
    loadFromCloud().then(async (cloudLoaded) => {
        if (cloudLoaded) {
            updateUI();
            updateLevelButtons();
            updateStatsUI();
            console.log('☁️ Cloud data loaded successfully');
        }
        
        // Check password/PIN status for current account
        const { hasPassword, hasPin } = await checkAccountPassword(userId);
        currentAccountHasPassword = hasPassword;
        currentAccountHasPin = hasPin;
        updatePasswordUI();
        updatePinUI();
    });
}

// Start time tracking
startTimeTracking();

// Show create account modal for new players
if (isNewPlayer) {
    // Wait a moment for DOM to be ready
    setTimeout(() => {
        showCreateAccountModal();
    }, 100);
}

init();
loop();
