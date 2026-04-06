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
const express = require('express');
const sessionManager = require('./lib/session');
const commandHandler = require('./lib/commands');
const database = require('./lib/database');
const logger = require('./lib/logger');

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
});

// Initialize Sessions
const sessions = new Map();

// Command Handler
const commands = commandHandler.loadCommands();

// Start Express Server
if (config.ENABLE_WEB_DASHBOARD) {
    require('./server');
}

// Main Function to Start Bot for a User
async function startBot(userId, phoneNumber) {
    try {
        const sessionPath = path.join(config.SESSION_DIR, userId);
        await fs.ensureDir(sessionPath);
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: !config.ENABLE_PAIRING_CODE,
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
        
        // Store session
        sessions.set(userId, sock);
        
        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (connection === 'connecting') {
                logger.info(`User ${userId}: Connecting...`);
            }
            
            if (qr && !config.ENABLE_PAIRING_CODE) {
                console.log(chalk.yellow(`QR Code for ${userId}:`));
                require('qrcode-terminal').generate(qr, { small: true });
                await database.updateSession(userId, { qr: qr, status: 'waiting_qr' });
            }
            
            if (connection === 'open') {
                logger.info(`User ${userId}: Connected successfully!`);
                await database.updateSession(userId, { 
                    status: 'connected',
                    phoneNumber: sock.user.id.split(':')[0],
                    lastSeen: new Date()
                });
                
                // Send startup message
                const startupMsg = `╭━━━┫ RIOT MD ACTIVE ┣━━━╮\n┃\n┃ 🤖 Bot: RIOT MD\n┃ 📱 Status: Connected\n┃ ⚡ Commands: ${commands.size}\n┃ 🔧 Prefix: ${config.PREFIX}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━╯`;
                await sock.sendMessage(sock.user.id, { text: startupMsg });
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
                }
            }
        });
        
        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);
        
        // Handle incoming messages
        sock.ev.on('messages.upsert', async (msg) => {
            const message = msg.messages[0];
            if (!message.message || message.key.fromMe) return;
            
            await commandHandler.handleMessage(sock, message, commands, userId);
            
            // Anti-ban: random typing simulation
            if (config.TYPING_SIMULATION && Math.random() > 0.7) {
                await sock.sendPresenceUpdate('composing', message.key.remoteJid);
                setTimeout(() => sock.sendPresenceUpdate('paused', message.key.remoteJid), 1500);
            }
        });
        
        // Handle group participants update
        sock.ev.on('group-participants.update', async (update) => {
            await commandHandler.handleGroupUpdate(sock, update);
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
            sock.ws.close();
        }, 5000);
        
        return code;
    } catch (error) {
        logger.error('Pairing code error:', error);
        return null;
    }
}

// Auto-reconnect all sessions on startup
async function restoreSessions() {
    const sessions = await database.getAllSessions();
    for (const session of sessions) {
        if (session.status === 'connected') {
            logger.info(`Restoring session for ${session.userId}`);
            await startBot(session.userId, session.phoneNumber);
        }
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log(chalk.red('\n\n⚠️ Shutting down RIOT MD...'));
    for (const [userId, sock] of sessions) {
        await sock.ws.close();
        logger.info(`Closed session for ${userId}`);
    }
    process.exit(0);
});

// Export functions for API
module.exports = {
    startBot,
    generatePairingCode,
    sessions,
    commands
};

// Start restoring sessions
restoreSessions();

// Auto-update check
if (config.ENABLE_AUTO_UPDATE) {
    setInterval(async () => {
        logger.info('Checking for updates...');
        // Implement GitHub update check
    }, config.UPDATE_CHECK_INTERVAL);
  }
