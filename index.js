const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const socketIO = require('socket.io');
const config = require('./config');
const database = require('./lib/database');
const chalk = require('chalk');

// Display Banner
console.log(chalk.cyan(`
██████╗ ██╗ ██████╗ ████████╗
██╔══██╗██║██╔═══██╗╚══██╔══╝
██████╔╝██║██║   ██║   ██║   
██╔══██╗██║██║   ██║   ██║   
██║  ██║██║╚██████╔╝   ██║   
╚═╝  ╚═╝╚═╝ ╚═════╝    ╚═╝   
`));
console.log(chalk.bold.green(`RIOT MD MULTI DEVICE BOT`));
console.log(chalk.white(`Version: ${config.BOT_VERSION} | Developer: ${config.DEVELOPER}`));
console.log(chalk.gray(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));

// Session directory (Railway volume compatible)
const SESSION_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'sessions')
    : path.join(__dirname, 'sessions');

// Ensure session directory exists
fs.ensureDirSync(SESSION_DIR);
console.log(chalk.green(`✓ Session directory: ${SESSION_DIR}`));

// Global sessions map - REAL sessions only
const sessions = new Map();

// Track if bot is already connecting
let isConnecting = false;
let botConnected = false;

// Main async function to start everything
async function main() {
    // Initialize database
    await database.init();
    console.log(chalk.green('✓ Database initialized'));

    // Clear fake sessions from database
    const allSessions = await database.getAllSessions();
    for (const sess of allSessions) {
        if (!sess.phoneNumber || sess.phoneNumber === 'Unknown') {
            await database.updateSession(sess.userId, { status: 'invalid' });
            console.log(chalk.yellow(`Removed invalid session: ${sess.userId}`));
        }
    }

    // Start bot for owner
    await startBot();
    
    // Start Express Server
    startServer();
}

// Start bot for owner
async function startBot() {
    if (isConnecting) {
        console.log(chalk.yellow('Bot already connecting, skipping...'));
        return;
    }
    
    isConnecting = true;
    
    const phoneNumber = process.env.OWNER_NUMBER || config.OWNER_NUMBER;
    
    if (!phoneNumber) {
        console.log(chalk.red('✗ OWNER_NUMBER not set in environment variables'));
        isConnecting = false;
        return;
    }
    
    const sessionPath = path.join(SESSION_DIR, 'owner_session');
    await fs.ensureDir(sessionPath);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            browser: Browsers.macOS('RIOT MD'),
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: true
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(chalk.yellow('📱 QR Code received (use pairing code instead)'));
            }
            
            if (connection === 'open') {
                botConnected = true;
                isConnecting = false;
                const userId = sock.user.id.split(':')[0];
                console.log(chalk.green(`✓ Connected as: ${userId}`));
                console.log(chalk.green(`✓ Bot is now online!`));
                
                // Store REAL session
                sessions.set('owner', sock);
                
                // Update database with real phone number
                await database.updateSession('owner', { 
                    status: 'connected',
                    phoneNumber: userId,
                    lastSeen: new Date()
                });
                
                // Send startup message
                const startupMsg = `╭━━━┫ RIOT MD ACTIVE ┣━━━╮\n┃\n┃ 🤖 Bot: RIOT MD\n┃ 📱 Status: Connected\n┃ ⚡ Prefix: ${config.PREFIX}\n┃ 👨‍💻 Owner: ${userId}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━╯`;
                try {
                    await sock.sendMessage(sock.user.id, { text: startupMsg });
                } catch(e) {}
            }
            
            if (connection === 'close') {
                botConnected = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(chalk.yellow(`⚠️ Connection closed. Reconnecting: ${shouldReconnect}`));
                
                if (shouldReconnect) {
                    setTimeout(() => {
                        isConnecting = false;
                        startBot();
                    }, 5000);
                } else {
                    console.log(chalk.red('❌ Logged out. Please re-pair.'));
                    await database.updateSession('owner', { status: 'logged_out' });
                    sessions.delete('owner');
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Message handler
        sock.ev.on('messages.upsert', async (msg) => {
            const message = msg.messages[0];
            if (!message.message || message.key.fromMe) return;
            
            const text = message.message.conversation || message.message.extendedTextMessage?.text || '';
            const remoteJid = message.key.remoteJid;
            
            // Basic commands
            if (text === '.ping') {
                const start = Date.now();
                await sock.sendMessage(remoteJid, { text: '🏓 Pinging...' });
                const end = Date.now();
                await sock.sendMessage(remoteJid, { text: `🏓 Pong! ${end - start}ms` });
            } 
            else if (text === '.time') {
                await sock.sendMessage(remoteJid, { text: `🕐 Time: ${new Date().toLocaleTimeString()}` });
            }
            else if (text === '.date') {
                await sock.sendMessage(remoteJid, { text: `📅 Date: ${new Date().toLocaleDateString()}` });
            }
            else if (text === '.info') {
                await sock.sendMessage(remoteJid, { text: `🤖 RIOT MD\n📱 Version: ${config.BOT_VERSION}\n⚡ Commands: ping, time, date, info, .say <text>` });
            }
            else if (text.startsWith('.say ')) {
                const sayMsg = text.slice(5);
                await sock.sendMessage(remoteJid, { text: sayMsg });
            }
        });
        
    } catch (error) {
        console.error(chalk.red('Error starting bot:'), error);
        isConnecting = false;
        setTimeout(startBot, 10000);
    }
}

// Generate pairing code via API
async function generatePairingCode(phoneNumber) {
    const sessionPath = path.join(SESSION_DIR, `temp_${Date.now()}`);
    await fs.ensureDir(sessionPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.macOS('RIOT MD'),
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });
    
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for WhatsApp'));
        }, 55000);
        
        sock.ev.on('connection.update', async (update) => {
            const { qr, connection } = update;
            
            if (qr) {
                clearTimeout(timeout);
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    resolve(code);
                } catch (err) {
                    reject(err);
                }
                
                setTimeout(async () => {
                    try { await fs.remove(sessionPath); sock.end(); } catch(e) {}
                }, 60000);
            }
            
            if (connection === 'close') {
                clearTimeout(timeout);
                reject(new Error('Connection closed'));
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
    });
}

// Start Express Server
function startServer() {
    const app = express();
    const server = require('http').createServer(app);
    const io = socketIO(server);

    app.set('trust proxy', 1);
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors());
    app.use(compression());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const limiter = rateLimit({
        windowMs: 60000,
        max: 30,
        message: 'Too many requests'
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

    // Routes
    app.get('/', (req, res) => res.redirect('/dashboard'));
    app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

    app.get('/login', (req, res) => {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>RIOT MD Login</title><style>
                body{background:#000;color:#0f0;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;}
                .login{background:#111;padding:40px;border:1px solid #0f0;border-radius:10px;}
                input{background:#000;border:1px solid #0f0;color:#0f0;padding:10px;margin:10px 0;width:100%;}
                button{background:#0f0;color:#000;padding:10px;border:none;cursor:pointer;width:100%;}
            </style></head>
            <body>
            <div class="login"><h2>🔐 RIOT MD Login</h2>
            <input type="text" id="user" placeholder="Username"><br>
            <input type="password" id="pass" placeholder="Password"><br>
            <button onclick="login()">Login</button>
            <script>
            async function login(){
                const res=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user.value,password:pass.value})});
                if(res.ok)location.href='/dashboard';
                else alert('Invalid');
            }
            </script></div></body></html>
        `);
    });

    app.post('/login', async (req, res) => {
        const { username, password } = req.body;
        if (username === config.OWNER_NAME && password === (process.env.ADMIN_PASSWORD || 'admin123')) {
            req.session.authenticated = true;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid' });
        }
    });

    app.get('/dashboard', (req, res) => {
        if (!req.session.authenticated) return res.redirect('/login');
        
        // Get real session info
        let realSessionCount = 0;
        let realPhoneNumber = 'None';
        
        if (sessions.has('owner') && botConnected) {
            realSessionCount = 1;
            realPhoneNumber = process.env.OWNER_NUMBER || config.OWNER_NUMBER || 'Pending';
        }
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>RIOT MD Dashboard</title><style>
                body{background:#000;color:#0f0;font-family:monospace;padding:20px;}
                .card{background:#111;border:1px solid #0f0;padding:20px;margin:10px 0;border-radius:10px;}
                input{background:#000;border:1px solid #0f0;color:#0f0;padding:10px;margin:5px;}
                button{background:#0f0;color:#000;padding:10px;margin:5px;border:none;cursor:pointer;}
                .code{font-size:24px;font-weight:bold;color:#0f0;background:#000;padding:20px;text-align:center;}
                .status-connected{color:#0f0;}
                .status-disconnected{color:#f00;}
            </style></head>
            <body>
            <h1>🤖 RIOT MD Dashboard</h1>
            <div class="card">
                <h2>📊 Connection Status</h2>
                <div id="statusDisplay">
                    <strong>Bot Status:</strong> <span class="${botConnected ? 'status-connected' : 'status-disconnected'}">${botConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}</span><br>
                    <strong>Phone Number:</strong> ${realPhoneNumber}<br>
                    <strong>Session:</strong> ${realSessionCount > 0 ? 'Active' : 'None'}
                </div>
            </div>
            <div class="card">
                <h2>🔐 Connect WhatsApp</h2>
                <input type="tel" id="phone" placeholder="254712345678" value="${process.env.OWNER_NUMBER || ''}">
                <button onclick="pair()">Generate Pairing Code</button>
                <div id="result"></div>
            </div>
            <div class="card">
                <h2>📱 Test Commands</h2>
                <p>Send these messages to your bot:</p>
                <code>.ping</code> - Check response<br>
                <code>.time</code> - Current time<br>
                <code>.info</code> - Bot info<br>
                <code>.say hello</code> - Make bot say something
            </div>
            <script>
            async function pair(){
                const phone=document.getElementById('phone').value;
                if(!phone)return alert('Enter phone number');
                document.getElementById('result').innerHTML='Generating pairing code... Please wait up to 30 seconds.';
                document.getElementById('result').style.color='yellow';
                try {
                    const res=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phoneNumber:phone})});
                    const data=await res.json();
                    if(data.success){
                        document.getElementById('result').innerHTML='<div class="code">📱 CODE: ' + data.code + '</div><p>1. Open WhatsApp on your phone</p><p>2. Settings → Linked Devices</p><p>3. Tap "Link a Device"</p><p>4. Select "Link with phone number"</p><p>5. Enter: <strong>' + data.code + '</strong></p><p style="color:#0f0;">✓ Waiting for connection...</p>';
                    } else {
                        document.getElementById('result').innerHTML='<div style="color:red">Error: ' + data.error + '</div>';
                    }
                } catch(e) {
                    document.getElementById('result').innerHTML='<div style="color:red">Error: ' + e.message + '</div>';
                }
            }
            async function refreshStatus(){
                const res=await fetch('/api/status');
                const data=await res.json();
                const statusSpan = document.querySelector('#statusDisplay');
                if(statusSpan && data.botConnected !== undefined) {
                    location.reload();
                }
            }
            setInterval(refreshStatus, 10000);
            </script></body></html>
        `);
    });

    // API Endpoints
    app.post('/api/pair', async (req, res) => {
        const { phoneNumber } = req.body;
        if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });
        
        let clean = phoneNumber.toString().replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '254' + clean.substring(1);
        if (clean.length < 11) clean = '254' + clean;
        
        console.log(chalk.yellow(`Generating pairing code for: ${clean}`));
        
        try {
            const code = await generatePairingCode(clean);
            console.log(chalk.green(`✓ Pairing code generated: ${code}`));
            res.json({ success: true, code: code });
        } catch (error) {
            console.error(chalk.red(`Pairing error: ${error.message}`));
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/status', (req, res) => {
        res.json({
            bot: config.BOT_NAME,
            version: config.BOT_VERSION,
            status: botConnected ? 'online' : 'offline',
            botConnected: botConnected,
            activeSessions: sessions.size,
            uptime: process.uptime()
        });
    });

    app.get('/api/sessions', (req, res) => {
        const list = [];
        if (sessions.has('owner') && botConnected) {
            list.push({ 
                id: 'owner', 
                phoneNumber: process.env.OWNER_NUMBER || config.OWNER_NUMBER || 'Connected',
                status: 'connected' 
            });
        }
        res.json({ sessions: list });
    });

    // Start server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(chalk.green(`🌐 Dashboard: http://localhost:${PORT}`));
        console.log(chalk.green(`📡 API: http://localhost:${PORT}/api`));
        console.log(chalk.cyan(`\n💡 To connect your WhatsApp:`));
        console.log(chalk.cyan(`   1. Go to http://localhost:${PORT}/dashboard`));
        console.log(chalk.cyan(`   2. Login with admin/admin123`));
        console.log(chalk.cyan(`   3. Enter your phone number and get pairing code`));
        console.log(chalk.cyan(`   4. Enter code in WhatsApp → Settings → Linked Devices\n`));
    });
}

// Run main function
main().catch(console.error);

module.exports = { sessions, generatePairingCode, botConnected };
