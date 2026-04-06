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

// ✅ Shared sessions store — no circular require
const { sessions } = require('./lib/sessions');

global.crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.set('trust proxy', 1);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW,
    max: config.RATE_LIMIT_MAX,
    message: 'Too many requests, please try again later.',
    keyGenerator: (req) => req.ip || req.connection.remoteAddress
});
app.use('/api/', limiter);

app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 86400000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'dashboard/views'));
app.use(express.static(path.join(__dirname, 'dashboard/public')));

// ─── Helper: safe socket close ────────────────────────────────────────────────
function closeSock(sock) {
    try { if (sock?.ws) sock.ws.close(); } catch (_) {}
}

// ─── Helper: format phone number ─────────────────────────────────────────────
function formatPhoneNumber(input) {
    let clean = input.toString().replace(/\D/g, '');
    if (clean.startsWith('0') && clean.length === 10) {
        clean = '254' + clean.substring(1);
    }
    if (clean.length < 11) {
        clean = '254' + clean;
    }
    return clean;
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date(), uptime: process.uptime() });
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const validPassword = process.env.ADMIN_PASSWORD || 'admin123';
    if (username === config.OWNER_NAME && password === validPassword) {
        req.session.authenticated = true;
        return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
});

// ─── Dashboard Routes ─────────────────────────────────────────────────────────
app.get('/dashboard', auth.requireAuth, async (req, res) => {
    const sessionsList = [];
    for (const [id, sock] of sessions) {
        sessionsList.push({
            id,
            phoneNumber: sock.user?.id?.split(':')[0] || 'Unknown',
            status: 'connected'
        });
    }
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

app.get('/sessions', auth.requireAuth, (req, res) => {
    const sessionsList = [];
    for (const [id, sock] of sessions) {
        sessionsList.push({
            id,
            phoneNumber: sock.user?.id?.split(':')[0] || 'Pending',
            status: 'connected',
            lastSeen: new Date()
        });
    }
    res.render('sessions', { sessions: sessionsList });
});

app.get('/settings', auth.requireAuth, (req, res) => res.render('settings', { config }));
app.get('/logs', auth.requireAuth, (req, res) => res.render('logs', { logs: [] }));

// ─── ✅ FIXED Pairing Code Endpoint ──────────────────────────────────────────
//
//  ROOT CAUSE OF TIMEOUT:
//  requestPairingCode() must be called when the `qr` event fires,
//  NOT after connection === 'open'. The `qr` event is the signal that
//  Baileys is ready to authenticate. Intercept it and call
//  requestPairingCode() instead of displaying the QR code.
//
app.post('/api/pair', async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }

    const cleanNumber = formatPhoneNumber(phoneNumber);

    if (!cleanNumber.match(/^[1-9][0-9]{9,14}$/)) {
        return res.status(400).json({ error: 'Invalid phone number. Use format: 254712345678' });
    }

    let sock = null;
    let sessionDir = null;
    let codeResolved = false;

    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            Browsers,
            fetchLatestBaileysVersion,
            DisconnectReason
        } = require('@whiskeysockets/baileys');
        const fs = require('fs-extra');

        sessionDir = path.join(__dirname, 'sessions', `pairing_${Date.now()}`);
        await fs.ensureDir(sessionDir);

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            browser: Browsers.ubuntu('Chrome'),
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 2000,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: false
            // ✅ Do NOT set fireInitQueries: false — it prevents QR from emitting
        });

        const code = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out waiting for WhatsApp. Please try again.'));
            }, 55000);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // ✅ THIS is the correct trigger — qr fires when Baileys is ready to auth
                if (qr && !codeResolved) {
                    codeResolved = true;
                    clearTimeout(timeout);
                    try {
                        const pairingCode = await sock.requestPairingCode(cleanNumber);
                        resolve(pairingCode);
                    } catch (err) {
                        reject(new Error('requestPairingCode failed: ' + err.message));
                    }
                }

                if (connection === 'open' && !codeResolved) {
                    // Session already exists — linked without needing a code
                    clearTimeout(timeout);
                    resolve('ALREADY_LINKED');
                }

                if (connection === 'close' && !codeResolved) {
                    clearTimeout(timeout);
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = DisconnectReason[statusCode] || statusCode || 'Unknown';
                    reject(new Error(`Connection closed (${reason}). Try again.`));
                }
            });

            sock.ev.on('creds.update', saveCreds);
        });

        // 60s grace period — user has time to enter the code on their phone
        setTimeout(async () => {
            closeSock(sock);
            try { await fs.remove(sessionDir); } catch (_) {}
        }, 60000);

        return res.json({
            success: true,
            code,
            message: `Pairing code for ${cleanNumber}: ${code}`
        });

    } catch (error) {
        logger.error('Pairing error: ' + error.message);
        closeSock(sock);
        if (sessionDir) {
            try {
                const fs = require('fs-extra');
                await fs.remove(sessionDir);
            } catch (_) {}
        }
        return res.status(500).json({ error: error.message || 'Failed to generate pairing code' });
    }
});

// ─── Simple GET Test Endpoint ─────────────────────────────────────────────────
app.get('/api/simple-pair', async (req, res) => {
    const testNumber = formatPhoneNumber(req.query.number || '254712345678');

    let sock = null;
    let sessionDir = null;
    let codeResolved = false;

    try {
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            Browsers
        } = require('@whiskeysockets/baileys');
        const fs = require('fs-extra');

        sessionDir = path.join(__dirname, 'sessions', `simple_${Date.now()}`);
        await fs.ensureDir(sessionDir);

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        sock = makeWASocket({
            auth: state,
            browser: Browsers.ubuntu('Chrome'),
            logger: pino({ level: 'silent' }),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        const code = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout — WhatsApp did not respond in time.'));
            }, 55000);

            sock.ev.on('connection.update', async (update) => {
                const { connection, qr } = update;

                // ✅ Same fix — intercept qr event
                if (qr && !codeResolved) {
                    codeResolved = true;
                    clearTimeout(timeout);
                    try {
                        const pairingCode = await sock.requestPairingCode(testNumber);
                        resolve(pairingCode);
                    } catch (err) {
                        reject(err);
                    }
                }

                if (connection === 'close' && !codeResolved) {
                    clearTimeout(timeout);
                    reject(new Error('Connection closed before QR was ready.'));
                }
            });

            sock.ev.on('creds.update', saveCreds);
        });

        setTimeout(async () => {
            closeSock(sock);
            try { await fs.remove(sessionDir); } catch (_) {}
        }, 60000);

        return res.json({ success: true, code, number: testNumber });

    } catch (error) {
        closeSock(sock);
        if (sessionDir) {
            try {
                const fs = require('fs-extra');
                await fs.remove(sessionDir);
            } catch (_) {}
        }
        return res.status(500).json({ error: error.message });
    }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/sessions', auth.requireApiAuth, (req, res) => {
    const sessionsList = [];
    for (const [id, sock] of sessions) {
        sessionsList.push({
            id,
            phoneNumber: sock.user?.id?.split(':')[0] || 'Unknown',
            status: 'connected'
        });
    }
    res.json({ sessions: sessionsList });
});

app.get('/api/status', (req, res) => {
    res.json({
        bot: config.BOT_NAME,
        version: config.BOT_VERSION,
        status: 'online',
        activeSessions: sessions.size,
        uptime: process.uptime(),
        timestamp: new Date()
    });
});

app.post('/api/send', auth.requireApiAuth, async (req, res) => {
    const { sessionId, to, message } = req.body;
    if (!sessionId || !to || !message) {
        return res.status(400).json({ error: 'sessionId, to, and message are required' });
    }
    const sock = sessions.get(sessionId);
    if (!sock) return res.status(404).json({ error: 'Session not found' });
    try {
        await sock.sendMessage(to, { text: message });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/users', auth.requireApiAuth, async (req, res) => {
    const users = await database.getAllUsers();
    res.json({ users });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    logger.info('Dashboard client connected');
    socket.on('disconnect', () => logger.info('Dashboard client disconnected'));
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🌐 Dashboard   → http://localhost:${PORT}`);
    logger.info(`📡 API         → http://localhost:${PORT}/api`);
    logger.info(`🔧 Test pair   → http://localhost:${PORT}/api/simple-pair?number=254712345678`);
});

module.exports = { app, server, io };
