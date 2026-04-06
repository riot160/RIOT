const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const logger = require('./logger');
const axios = require('axios');

// Safe imports - handle missing modules gracefully
let ytdl, ytSearch, ffmpeg;
try { ytdl = require('ytdl-core'); } catch(e) { ytdl = null; }
try { ytSearch = require('yt-search'); } catch(e) { ytSearch = null; }
try { ffmpeg = require('fluent-ffmpeg'); } catch(e) { ffmpeg = null; }

// Command cooldown tracking
const cooldowns = new Map();

// All commands storage
let commands = new Map();

// Load all plugins
function loadCommands() {
    const pluginFolders = ['group', 'download', 'ai', 'fun', 'owner', 'tools'];
    
    pluginFolders.forEach(folder => {
        const pluginPath = path.join(__dirname, '..', 'plugins', folder);
        if (fs.existsSync(pluginPath)) {
            const files = fs.readdirSync(pluginPath);
            files.forEach(file => {
                if (file.endsWith('.js')) {
                    try {
                        const command = require(path.join(pluginPath, file));
                        commands.set(command.command, command);
                        logger.debug(`Loaded command: ${command.command}`);
                    } catch(e) {
                        logger.error(`Failed to load command ${file}:`, e);
                    }
                }
            });
        }
    });
    
    // Generate basic commands
    generateBasicCommands();
    
    logger.info(`Loaded ${commands.size} commands`);
    return commands;
}

// Generate basic working commands
function generateBasicCommands() {
    const basicCommands = [
        { name: 'ping', desc: 'Check bot response time' },
        { name: 'time', desc: 'Current server time' },
        { name: 'date', desc: 'Current date' },
        { name: 'info', desc: 'Bot information' },
        { name: 'help', desc: 'Show all commands' }
    ];
    
    basicCommands.forEach(cmd => {
        if (!commands.has(cmd.name)) {
            commands.set(cmd.name, {
                command: cmd.name,
                category: 'tools',
                desc: cmd.desc,
                run: async (client, message, args, userId) => {
                    return await executeBasicCommand(cmd.name, client, message, args, userId);
                }
            });
        }
    });
}

// Execute basic commands
async function executeBasicCommand(commandName, client, message, args, userId) {
    const { key, pushName } = message;
    const remoteJid = key.remoteJid;
    const sender = key.participant || key.remoteJid;
    
    switch(commandName) {
        case 'ping':
            const start = Date.now();
            await client.sendMessage(remoteJid, { text: '🏓 Pinging...' });
            const end = Date.now();
            await client.sendMessage(remoteJid, { text: `🏓 Pong! ${end - start}ms` });
            break;
            
        case 'time':
            const now = new Date();
            await client.sendMessage(remoteJid, { text: `🕐 Current time: ${now.toLocaleTimeString()}` });
            break;
            
        case 'date':
            const today = new Date();
            await client.sendMessage(remoteJid, { text: `📅 Today's date: ${today.toLocaleDateString()}` });
            break;
            
        case 'info':
            await client.sendMessage(remoteJid, { 
                text: `╭━━━┫ RIOT MD INFO ┣━━━╮\n` +
                      `┃\n` +
                      `┃ 🤖 Name: ${config.BOT_NAME}\n` +
                      `┃ 📱 Version: ${config.BOT_VERSION}\n` +
                      `┃ 👨‍💻 Developer: ${config.DEVELOPER}\n` +
                      `┃ ⚡ Commands: ${commands.size}\n` +
                      `┃ 🔧 Prefix: ${config.PREFIX}\n` +
                      `┃\n╰━━━━━━━━━━━━━━━━━━━━━╯`
            });
            break;
            
        case 'help':
            const categories = new Map();
            for (const [name, cmd] of commands) {
                if (!categories.has(cmd.category)) categories.set(cmd.category, []);
                categories.get(cmd.category).push(`.${name}`);
            }
            let helpText = `╭━━━┫ RIOT MD COMMANDS ┣━━━╮\n┃\n`;
            for (const [cat, cmds] of categories) {
                helpText += `┃ 📁 ${cat.toUpperCase()}\n┃ ${cmds.slice(0, 5).join(', ')}\n┃\n`;
            }
            helpText += `╰━━━━━━━━━━━━━━━━━━━━━╯\n┃\n┃ 💡 Total: ${commands.size} commands\n┃ 🔧 Use .help <command> for details`;
            await client.sendMessage(remoteJid, { text: helpText });
            break;
    }
}

// Handle incoming messages
async function handleMessage(client, message, commandsMap, userId) {
    const { key, message: msg } = message;
    const remoteJid = key.remoteJid;
    const text = msg?.conversation || msg?.extendedTextMessage?.text || '';
    
    if (!text.startsWith(config.PREFIX)) return;
    
    const args = text.slice(config.PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    const command = commandsMap.get(commandName);
    if (command) {
        try {
            // Check cooldown
            const cooldownKey = `${userId}-${commandName}`;
            if (cooldowns.has(cooldownKey)) {
                const remaining = (cooldowns.get(cooldownKey) + config.COMMAND_COOLDOWN) - Date.now();
                if (remaining > 0) {
                    await client.sendMessage(remoteJid, { 
                        text: `⏳ Please wait ${Math.ceil(remaining/1000)} seconds.` 
                    });
                    return;
                }
            }
            cooldowns.set(cooldownKey, Date.now());
            setTimeout(() => cooldowns.delete(cooldownKey), config.COMMAND_COOLDOWN);
            
            await command.run(client, message, args, userId);
            logger.info(`Command executed: ${commandName} by ${userId}`);
        } catch (error) {
            logger.error(`Error executing ${commandName}:`, error);
            await client.sendMessage(remoteJid, { text: '❌ An error occurred while executing this command.' });
        }
    }
}

// Handle group updates
async function handleGroupUpdate(client, update) {
    // Implement welcome/goodbye messages, anti-link, etc.
}

function getCommandCount() {
    return commands.size;
}

module.exports = {
    loadCommands,
    handleMessage,
    handleGroupUpdate,
    getCommandCount
};
