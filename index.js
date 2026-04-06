const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    makeInMemoryStore,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');
const chalk = require('chalk');
const database = require('./lib/database');
const logger = require('./lib/logger');

// ✅ Import shared sessions store (NO circular dependency)
const { sessions } = require('./lib/sessions');

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
console.log(chalk.yellow(`⚡ Starting RIOT MD Bot...`));
console.log(chalk.yellow(`📱 Multi-User Mode: ENABLED`));
console.log(chalk.yellow(`🔌 API Server: http://localhost:${config.PORT}`));
console.log(chalk.gray(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));

// Initialize Database
database.init().then(() => {
    console.log(chalk.green('✓ Database initialized'));
}).catch(err => {
    console.error(chalk.red('✗ Database initialization failed:'), err);
});

// Command Handler
const commandHandler = require('./lib/commands');
let commands = new Map();

// Load commands
try {
    commands = commandHandler.loadCommands();
    console.log(chalk.green(`✓ Loaded ${commands.size} commands`));
} catch (err) {
    console.error(chalk.red('✗ Failed to load commands:'), err);
}

// Start Bot for a User
async function startBot(userId, phoneNumber) {
    try {
        const sessionPath = path.join(config.SESSION_DIR, userId);
        await fs.ensureDir(sessionPath);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.macOS('RIOT MD'),
            logger: P({ level: 'silent' }),
            generateHighQualityLinkPreview: true,
            patchMessageBeforeSending: (message) => {
                const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
                if (requiresPatch) {
                    message = {
                        viewOnceMessage: {
                            message: {
                                messageContextInfo: {
                                    deviceListMetadataVersion: 2,
                                    deviceListMetadata: {},
                                },
                                ...message,
                            },
                        },
                    };
                }
                return message;
            },
        });
        
        // Store session in shared Map
        sessions.set(userId, sock);
        logger.info(`Session started for ${userId}`);
        
        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'connecting') {
                logger.info(`User ${userId}: Connecting...`);
            }
            
            if (connection === 'open') {
                logger.info(`User ${userId}: Connected successfully!`);
                await database.updateSession(userId, { 
                    status: 'connected',
                    phoneNumber: sock.user?.id?.split(':')[0] || phoneNumber,
                    lastSeen: new Date()
                });
                
                // Send startup message
                const startupMsg = `╭━━━┫ RIOT MD ACTIVE ┣━━━╮\n┃\n┃ 🤖 Bot: RIOT MD\n┃ 📱 Status: Connected\n┃ ⚡ Commands: ${commands.size}\n┃ 🔧 Prefix: ${config.PREFIX}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━╯`;
                try {
                    await sock.sendMessage(sock.user.id, { text: startupMsg });
                } catch(e) {}
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                logger.warn(`User ${userId}: Connection closed. Reconnecting: ${shouldReconnect}`);
                await database.updateSession(userId, { status: 'disconnected' });
                
                if (shouldReconnect) {
                    setTimeout(() => startBot(userId, phoneNumber), 5000);
                } else {
                    await database.updateSession(userId, { status: 'logged_out' });
                    sessions.delete(userId);
                }
            }
        });
        
        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);
        
        // Handle incoming messages
        sock.ev.on('messages.upsert', async (msg) => {
            const message = msg.messages[0];
            if (!message.message || message.key.fromMe) return;
            
            try {
                await commandHandler.handleMessage(sock, message, commands, userId);
            } catch (err) {
                logger.error(`Error handling message: ${err.message}`);
            }
            
            // Anti-ban: random typing simulation
            if (config.TYPING_SIMULATION && Math.random() > 0.7) {
                try {
                    await sock.sendPresenceUpdate('composing', message.key.remoteJid);
                    setTimeout(() => sock.sendPresenceUpdate('paused', message.key.remoteJid), 1500);
                } catch(e) {}
            }
        });
        
        // Handle group participants update
        sock.ev.on('group-participants.update', async (update) => {
            try {
                await commandHandler.handleGroupUpdate(sock, update);
            } catch(e) {}
        });
        
        return sock;
        
    } catch (error) {
        logger.error(`Error starting bot for ${userId}:`, error);
        return null;
    }
}

// Generate Pairing Code
async function generatePairingCode(phoneNumber) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(path.join(config.SESSION_DIR, 'temp'));
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.macOS('RIOT MD'),
            logger: P({ level: 'silent' }),
        });
        
        const code = await sock.requestPairingCode(phoneNumber);
        
        sock.ev.on('creds.update', saveCreds);
        
        setTimeout(() => {
            try { sock.ws?.close(); } catch(e) {}
        }, 5000);
        
        return code;
    } catch (error) {
        logger.error('Pairing code error:', error);
        return null;
    }
}

// Auto-reconnect all sessions on startup
async function restoreSessions() {
    try {
        const allSessions = await database.getAllSessions();
        for (const session of allSessions) {
            if (session.status === 'connected' && session.phoneNumber) {
                logger.info(`Restoring session for ${session.userId}`);
                await startBot(session.userId, session.phoneNumber);
            }
        }
    } catch (error) {
        logger.error('Error restoring sessions:', error);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log(chalk.red('\n\n⚠️ Shutting down RIOT MD...'));
    for (const [userId, sock] of sessions) {
        try {
            sock.ws?.close();
            logger.info(`Closed session for ${userId}`);
        } catch(e) {}
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log(chalk.red('\n\n⚠️ Shutting down RIOT MD...'));
    for (const [userId, sock] of sessions) {
        try {
            sock.ws?.close();
            logger.info(`Closed session for ${userId}`);
        } catch(e) {}
    }
    process.exit(0);
});

// Start restoring sessions
restoreSessions();

// Start Express Server (moved to bottom to avoid circular dependency)
if (config.ENABLE_WEB_DASHBOARD) {
    setTimeout(() => {
        require('./server');
    }, 1000);
}

// Export functions for API (no circular dependencies)
module.exports = {
    startBot,
    generatePairingCode,
    getSessions: () => sessions,
    getCommands: () => commands
};
