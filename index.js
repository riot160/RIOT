// Use dynamic imports for ES modules
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');
const P = (await import('pino')).default;
import fs from 'fs-extra';
import path from 'path';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import chalk from 'chalk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import config and database
import config from './config.js';
import database from './lib/database.js';

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

// Session directory
const SESSION_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.Railway_VOLUME_MOUNT_PATH, 'sessions')
    : path.join(process.cwd(), 'sessions');

await fs.ensureDir(SESSION_DIR);
console.log(chalk.green(`✓ Session directory: ${SESSION_DIR}`));

// Global sessions map
const sessions = new Map();
let botConnected = false;
let isConnecting = false;

// Initialize database
await database.init();
console.log(chalk.green('✓ Database initialized'));

// Start bot function
async function startBot() {
    if (isConnecting) {
        console.log(chalk.yellow('Bot already connecting...'));
        return;
    }
    
    isConnecting = true;
    const phoneNumber = process.env.OWNER_NUMBER || config.OWNER_NUMBER;
    
    if (!phoneNumber) {
        console.log(chalk.red('✗ OWNER_NUMBER not set'));
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
            printQRInTerminal: true,
            generateHighQualityLinkPreview: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(chalk.yellow('📱 QR Code received'));
                // Also try pairing code
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(chalk.green(`🔑 PAIRING CODE: ${code}`));
                } catch(e) {}
            }
            
            if (connection === 'open') {
                botConnected = true;
                isConnecting = false;
                const userId = sock.user.id.split(':')[0];
                console.log(chalk.green(`✓ Connected as: ${userId}`));
                sessions.set('owner', sock);
                
                await database.updateSession('owner', {
                    status: 'connected',
                    phoneNumber: userId,
                    lastSeen: new Date()
                });
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
            
            if (text === '.ping') {
                await sock.sendMessage(remoteJid, { text: '🏓 Pong!' });
            } else if (text === '.time') {
                await sock.sendMessage(remoteJid, { text: `🕐 ${new Date().toLocaleTimeString()}` });
            } else if (text === '.info') {
                await sock.sendMessage(remoteJid, { text: `🤖 RIOT MD\nConnected: Yes\nPrefix: .` });
            }
        });
        
    } catch (error) {
        console.error(chalk.red('Error starting bot:'), error);
        isConnecting = false;
        setTimeout(startBot, 10000);
    }
}

// Generate pairing code
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
        const timeout = setTimeout(() => reject(new Error('Timeout')), 55000);
        
        sock.ev.on('connection.update', async (update) => {
            const { qr } = update;
            if (qr) {
                clearTimeout(timeout);
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    resolve(code);
                } catch (err) {
                    reject(err);
                }
                setTimeout(() => sock.end(), 60000);
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
    });
}

// Express server
const app = express();
const server = createServer(app);
const io = new SocketIO(server);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 60000, max: 30 });
app.use('/api/', limiter);

app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 86400000 }
}));

// Routes
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>RIOT MD Login</title>
        <style>
            body{background:#000;color:#0f0;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;}
            .login{background:#111;padding:40px;border:1px solid #0f0;border-radius:10px;}
            input{background:#000;border:1px solid #0f0;color:#0f0;padding:10px;margin:10px 0;width:100%;}
            button{background:#0f0;color:#000;padding:10px;border:none;cursor:pointer;width:100%;}
        </style></head>
        <body>
        <div class="login">
            <h2>🔐 RIOT MD Login</h2>
            <input type="text" id="user" placeholder="Username"><br>
            <input type="password" id="pass" placeholder="Password"><br>
            <button onclick="login()">Login</button>
        </div>
        <script>
        async function login() {
            const res = await fetch('/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: user.value, password: pass.value})
            });
            if (res.ok) location.href = '/dashboard';
            else alert('Invalid credentials');
        }
        </script>
        </body></html>
    `);
});

app.post('/login', (req, res) => {
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
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>RIOT MD Dashboard</title>
        <style>
            body{background:#000;color:#0f0;font-family:monospace;padding:20px;}
            .card{background:#111;border:1px solid #0f0;padding:20px;margin:10px 0;border-radius:10px;}
            input,button{padding:10px;margin:5px;background:#000;border:1px solid #0f0;color:#0f0;}
            button{cursor:pointer;background:#0f0;color:#000;}
            .code{font-size:24px;font-weight:bold;text-align:center;padding:20px;background:#000;}
        </style></head>
        <body>
        <h1>🤖 RIOT MD Dashboard</h1>
        <div class="card">
            <h2>🔐 Connect WhatsApp</h2>
            <input type="tel" id="phone" placeholder="254712345678">
            <button onclick="pair()">Generate Pairing Code</button>
            <div id="result"></div>
        </div>
        <div class="card">
            <h2>📊 Status</h2>
            <div id="status">Bot: ${botConnected ? '✅ Connected' : '❌ Disconnected'}</div>
        </div>
        <script>
        async function pair() {
            const phone = document.getElementById('phone').value;
            if (!phone) return alert('Enter phone number');
            document.getElementById('result').innerHTML = 'Generating...';
            const res = await fetch('/api/pair', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({phoneNumber: phone})
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('result').innerHTML = '<div class="code">📱 CODE: ' + data.code + '</div><p>Enter this in WhatsApp → Settings → Linked Devices → Link with phone number</p>';
            } else {
                document.getElementById('result').innerHTML = '<div style="color:red">Error: ' + data.error + '</div>';
            }
        }
        </script>
        </body></html>
    `);
});

// API endpoints
app.post('/api/pair', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number required' });
    
    let clean = phoneNumber.toString().replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '254' + clean.substring(1);
    
    try {
        const code = await generatePairingCode(clean);
        res.json({ success: true, code });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ bot: config.BOT_NAME, status: botConnected ? 'online' : 'offline', uptime: process.uptime() });
});

// Start everything
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(chalk.green(`🌐 Dashboard: http://localhost:${PORT}`));
    console.log(chalk.green(`📡 API: http://localhost:${PORT}/api`));
});

// Start bot
startBot();

export { sessions, generatePairingCode };
