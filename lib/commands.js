import config from '../config.js';
import logger from './logger.js';

const cooldowns = new Map();
let commands = new Map();

function loadCommands() {
    generateBasicCommands();
    return commands;
}

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

async function executeBasicCommand(commandName, client, message, args, userId) {
    const remoteJid = message.key.remoteJid;
    
    switch(commandName) {
        case 'ping':
            const start = Date.now();
            await client.sendMessage(remoteJid, { text: '🏓 Pinging...' });
            const end = Date.now();
            await client.sendMessage(remoteJid, { text: `🏓 Pong! ${end - start}ms` });
            break;
            
        case 'time':
            await client.sendMessage(remoteJid, { text: `🕐 Time: ${new Date().toLocaleTimeString()}` });
            break;
            
        case 'date':
            await client.sendMessage(remoteJid, { text: `📅 Date: ${new Date().toLocaleDateString()}` });
            break;
            
        case 'info':
            await client.sendMessage(remoteJid, { text: `🤖 RIOT MD\n📱 Version: ${config.BOT_VERSION}\n⚡ Commands: ping, time, date, info, help` });
            break;
            
        case 'help':
            await client.sendMessage(remoteJid, { text: `╭━━━┫ RIOT MD COMMANDS ┣━━━╮\n┃\n┃ .ping - Check response\n┃ .time - Current time\n┃ .date - Current date\n┃ .info - Bot info\n┃ .help - This menu\n┃\n╰━━━━━━━━━━━━━━━━━━━━━╯` });
            break;
    }
}

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
            const cooldownKey = `${userId}-${commandName}`;
            if (cooldowns.has(cooldownKey)) {
                const remaining = (cooldowns.get(cooldownKey) + config.COMMAND_COOLDOWN) - Date.now();
                if (remaining > 0) {
                    await client.sendMessage(remoteJid, { text: `⏳ Please wait ${Math.ceil(remaining/1000)} seconds.` });
                    return;
                }
            }
            cooldowns.set(cooldownKey, Date.now());
            setTimeout(() => cooldowns.delete(cooldownKey), config.COMMAND_COOLDOWN);
            
            await command.run(client, message, args, userId);
            logger.info(`Command executed: ${commandName} by ${userId}`);
        } catch (error) {
            logger.error(`Error executing ${commandName}:`, error);
            await client.sendMessage(remoteJid, { text: '❌ An error occurred.' });
        }
    }
}

async function handleGroupUpdate(client, update) {}

function getCommandCount() {
    return commands.size;
}

export { loadCommands, handleMessage, handleGroupUpdate, getCommandCount };
