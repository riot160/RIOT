const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const pino = require('pino');
const config = require('./config');
const database = require('./lib/database');
const auth = require('./lib/auth');
const logger = require('./lib/logger');

// Make crypto available globally
global.crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.set('trust proxy', 1);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW,
    max: config.RATE_LIMIT_MAX,
    message: 'Too many requests, please try again later.',
    trustProxy: true,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress
});
app.use('/api/', limiter);

// Session
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 86400000 }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'dashboard/views'));
app.use(express.static(path.join(__dirname, 'dashboard/public')));

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date(), uptime: process.uptime() });
});

// Routes
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === config.OWNER_NAME && password === (process.env.ADMIN_PASSWORD || 'admin123')) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.get('/dashboard', auth.requireAuth, async (req, res) => {
    const sessionsList = [];
    try {
        const { sessions } = require('./index');
        for (const [id, sock] of sessions) {
            sessionsList.push({ id, phoneNumber: sock.user?.id?.split(':')[0] || 'Unknown', status: 'connected' });
        }
    } catch(e) {}
    const stats = {
        totalUsers: await database.getUserCount(),
        activeSessions: sessionsList.length,
        totalCommands: 295,
        uptime: process.uptime()
    };
    res.render('dashboard', { stats, config });
});

app.get('/users', auth.requireAuth, async (req, res) => {
    const users = await database.getAllUsers();
    res.render('users', { users });
});

app.get('/sessions', auth.requireAuth, async (req, res) => {
    const sessionsList = [];
    try {
        const { sessions } = require('./index');
        for (const [id, sock] of sessions) {
            sessionsList.push({ id, phoneNumber: sock.user?.id?.split(':')[0] || 'Pending', status: 'connected', lastSeen: new Date() });
        }
    } catch(e) {}
    res.render('sessions', { sessions: sessionsList });
});

app.get('/settings', auth.requireAuth, (req, res) => res.render('settings', { config }));
app.get('/logs', auth.requireAuth, async (req, res) => res.render('logs', { logs: [] }));

// ========== FIXED PAIRING CODE ENDPOINT ==========
app.post('/api/pair', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }
    
    // Format phone number
    let cleanNumber = phoneNumber.toString().replace(/\D/g, '');
    if (cleanNumber.startsWith('0')) {
        cleanNumber = '254' + cleanNumber.substring(1);
    }
    if (!cleanNumber.startsWith('254') && !cleanNumber.startsWith('1') && !cleanNumber.startsWith('44') && !cleanNumber.startsWith('91')) {
        cleanNumber = '254' + cleanNumber;
    }
    
    if (!cleanNumber.match(/^[1-9][0-9]{9,14}$/)) {
        return res.status(400).json({ error: 'Invalid phone number. Use format: 254712345678' });
    }
    
    try {
        const { default: makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
        const fs = require('fs-extra');
        
        const sessionDir = path.join(__dirname, 'sessions', `pairing_${Date.now()}`);
        await fs.ensureDir(sessionDir);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        // Create socket with better connection handling
        const sock = makeWASocket({
            version,
            auth: state,
            browser: Browsers.macOS('RIOT MD'),
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            defaultQueryTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (msg) => msg,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            fireInitQueries: false,
            connectTimeoutMs: 30000,
            waitForOpenTimeoutMs: 10000
        });
        
        // Wait for socket to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Request pairing code
        const code = await sock.requestPairingCode(cleanNumber);
        
        // Clean up after 30 seconds
        setTimeout(async () => {
            try {
                await fs.remove(sessionDir);
                sock.end();
            } catch(e) {}
        }, 30000);
        
        res.json({ 
            success: true, 
            code: code,
            message: `Pairing code generated for ${cleanNumber}`
        });
        
    } catch (error) {
        console.error('Pairing error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate pairing code' });
    }
});

// ========== SIMPLE TEST ENDPOINT (Use this if above fails) ==========
app.get('/api/simple-pair', async (req, res) => {
    const testNumber = req.query.number || '254712345678';
    
    try {
        const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
        const fs = require('fs-extra');
        
        const sessionDir = path.join(__dirname, 'sessions', `simple_${Date.now()}`);
        await fs.ensureDir(sessionDir);
        
        const { state } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            browser: Browsers.ubuntu('RIOT MD'),
            logger: pino({ level: 'error' })
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                const code = await sock.requestPairingCode(testNumber);
                res.json({ success: true, code: code });
                await fs.remove(sessionDir);
                sock.end();
            }
            if (connection === 'close') {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Connection closed' });
                }
            }
        });
        
        // Timeout after 20 seconds
        setTimeout(() => {
            if (!res.headersSent) {
                res.status(408).json({ error: 'Timeout' });
                sock.end();
            }
        }, 20000);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API Routes
app.get('/api/sessions', auth.requireApiAuth, async (req, res) => {
    const sessionsList = [];
    try {
        const { sessions } = require('./index');
        for (const [id, sock] of sessions) {
            sessionsList.push({ id, phoneNumber: sock.user?.id?.split(':')[0] || 'Unknown', status: 'connected' });
        }
    } catch(e) {}
    res.json({ sessions: sessionsList });
});

app.get('/api/status', (req, res) => {
    let sessionsCount = 0;
    try {
        const { sessions } = require('./index');
        sessionsCount = sessions.size;
    } catch(e) {}
    res.json({
        bot: config.BOT_NAME,
        version: config.BOT_VERSION,
        status: 'online',
        activeSessions: sessionsCount,
        totalUsers: 0,
        uptime: process.uptime(),
        timestamp: new Date()
    });
});

app.post('/api/send', auth.requireApiAuth, async (req, res) => {
    const { sessionId, to, message } = req.body;
    try {
        const { sessions } = require('./index');
        const sock = sessions.get(sessionId);
        if (!sock) return res.status(404).json({ error: 'Session not found' });
        await sock.sendMessage(to, { text: message });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users', auth.requireApiAuth, async (req, res) => {
    const users = await database.getAllUsers();
    res.json({ users });
});

// Socket.IO
io.on('connection', (socket) => {
    logger.info('Client connected');
    socket.on('disconnect', () => logger.info('Client disconnected'));
});

// Error handling
app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🌐 Dashboard on http://localhost:${PORT}`);
    logger.info(`📡 API on http://localhost:${PORT}/api`);
    logger.info(`🔧 Test pairing: http://localhost:${PORT}/api/simple-pair?number=254712345678`);
});

module.exports = { app, server, io };
