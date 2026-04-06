const crypto = require('crypto');
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

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Trust proxy - Fix for rate limit warning
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW,
    max: config.RATE_LIMIT_MAX,
    message: 'Too many requests, please try again later.',
    trustProxy: true
});
app.use('/api/', limiter);

// Session middleware
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date(),
        uptime: process.uptime()
    });
});

// Routes
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
    res.render('login');
});

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
            sessionsList.push({
                id,
                phoneNumber: sock.user?.id?.split(':')[0] || 'Unknown',
                status: 'connected'
            });
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
            sessionsList.push({
                id,
                phoneNumber: sock.user?.id?.split(':')[0] || 'Pending',
                status: 'connected',
                lastSeen: new Date()
            });
        }
    } catch(e) {}
    res.render('sessions', { sessions: sessionsList });
});

app.get('/settings', auth.requireAuth, (req, res) => {
    res.render('settings', { config });
});

app.get('/logs', auth.requireAuth, async (req, res) => {
    res.render('logs', { logs: [] });
});

// API Routes - PAIRING CODE (FULLY FIXED)
app.post('/api/pair', async (req, res) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }
    
    const cleanNumber = phoneNumber.toString().replace(/\D/g, '');
    if (!cleanNumber.match(/^[1-9][0-9]{9,14}$/)) {
        return res.status(400).json({ error: 'Invalid phone number format. Use country code + number (e.g., 254712345678)' });
    }
    
    try {
        const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
        const fs = require('fs-extra');
        
        const sessionDir = path.join(__dirname, 'sessions', `temp_${Date.now()}`);
        await fs.ensureDir(sessionDir);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        // Create a proper pino logger (silent mode)
        const silentLogger = pino({ level: 'silent' });
        
        const sock = makeWASocket({
            auth: state,
            browser: Browsers.macOS('RIOT MD'),
            printQRInTerminal: false,
            logger: silentLogger,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (message) => message
        });
        
        // Request pairing code
        const code = await sock.requestPairingCode(cleanNumber);
        
        // Clean up temp session after 15 seconds
        setTimeout(async () => {
            try {
                await fs.remove(sessionDir);
                sock.end();
            } catch(e) {}
        }, 15000);
        
        // Auto-start bot after pairing
        const userId = `user_${Date.now()}`;
        await database.createUser(userId, cleanNumber);
        
        setTimeout(async () => {
            try {
                const { startBot } = require('./index');
                await startBot(userId, cleanNumber);
            } catch(e) {
                console.error('Auto-start error:', e);
            }
        }, 3000);
        
        res.json({ 
            success: true, 
            code: `RIOT-MD-${code}`,
            message: `Pairing code generated for ${cleanNumber}`
        });
        
    } catch (error) {
        console.error('Pairing error:', error);
        res.status(500).json({ error: error.message || 'Failed to generate pairing code' });
    }
});

app.get('/api/sessions', auth.requireApiAuth, async (req, res) => {
    const sessionsList = [];
    try {
        const { sessions } = require('./index');
        for (const [id, sock] of sessions) {
            sessionsList.push({
                id,
                phoneNumber: sock.user?.id?.split(':')[0] || 'Unknown',
                status: 'connected'
            });
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
        if (!sock) {
            return res.status(404).json({ error: 'Session not found' });
        }
        await sock.sendMessage(to, { text: message });
        res.json({ success: true, message: 'Message sent' });
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
    logger.info('Client connected to dashboard');
    socket.on('disconnect', () => {
        logger.info('Client disconnected');
    });
});

// Error handling
app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🌐 Dashboard running on http://localhost:${PORT}`);
    logger.info(`📡 API available at http://localhost:${PORT}/api`);
});

module.exports = { app, server, io };
