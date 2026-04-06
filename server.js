const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const config = require('./config');
const database = require('./lib/database');
const { generatePairingCode, startBot, sessions } = require('./index');
const auth = require('./lib/auth');
const logger = require('./lib/logger');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

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
    message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// Session middleware
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 86400000 }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'dashboard/views'));
app.use(express.static(path.join(__dirname, 'dashboard/public')));

// Routes
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === config.OWNER_NAME && password === process.env.ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.get('/dashboard', auth.requireAuth, async (req, res) => {
    const stats = {
        totalUsers: await database.getUserCount(),
        activeSessions: sessions.size,
        totalCommands: require('./lib/commands').getCommandCount(),
        uptime: process.uptime()
    };
    res.render('dashboard', { stats, config });
});

app.get('/users', auth.requireAuth, async (req, res) => {
    const users = await database.getAllUsers();
    res.render('users', { users });
});

app.get('/sessions', auth.requireAuth, async (req, res) => {
    const sessionList = Array.from(sessions.entries()).map(([id, sock]) => ({
        id,
        status: 'connected',
        phoneNumber: sock.user?.id
    }));
    res.render('sessions', { sessions: sessionList });
});

app.get('/settings', auth.requireAuth, (req, res) => {
    res.render('settings', { config });
});

app.get('/logs', auth.requireAuth, async (req, res) => {
    const logs = await logger.getLogs();
    res.render('logs', { logs });
});

// API Routes
app.post('/api/pair', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number required' });
    }
    
    const code = await generatePairingCode(phoneNumber);
    if (code) {
        const userId = `user_${Date.now()}`;
        await database.createUser(userId, phoneNumber);
        res.json({ 
            success: true, 
            code: `RIOT-MD-${code}`,
            message: `Pairing code generated for ${phoneNumber}`,
            instructions: `Open WhatsApp > Linked Devices > Link with phone number > Enter: RIOT-MD-${code}`
        });
        
        // Start bot after pairing
        setTimeout(() => startBot(userId, phoneNumber), 3000);
    } else {
        res.status(500).json({ error: 'Failed to generate pairing code' });
    }
});

app.get('/api/sessions', auth.requireApiAuth, async (req, res) => {
    const sessionList = Array.from(sessions.entries()).map(([id, sock]) => ({
        id,
        phoneNumber: sock.user?.id,
        status: 'connected'
    }));
    res.json({ sessions: sessionList });
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
    const sock = sessions.get(sessionId);
    
    if (!sock) {
        return res.status(404).json({ error: 'Session not found' });
    }
    
    try {
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

// Socket.IO for real-time updates
io.on('connection', (socket) => {
    logger.info('Client connected to dashboard');
    
    socket.on('getStats', async () => {
        const stats = {
            users: await database.getUserCount(),
            sessions: sessions.size,
            commands: require('./lib/commands').getCommandCount()
        };
        socket.emit('stats', stats);
    });
    
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
server.listen(config.PORT, () => {
    logger.info(`🌐 Dashboard running on http://localhost:${config.PORT}`);
    logger.info(`📡 API available at http://localhost:${config.PORT}/api`);
});

module.exports = { app, server, io };
