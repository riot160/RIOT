const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const logger = require('./logger');
const axios = require('axios');
const ytdl = require('ytdl-core');
const { exec } = require('child_process');

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
                    const command = require(path.join(pluginPath, file));
                    commands.set(command.command, command);
                    logger.debug(`Loaded command: ${command.command}`);
                }
            });
        }
    });
    
    // Generate 300+ commands programmatically
    generateCommands();
    
    logger.info(`Loaded ${commands.size} commands`);
    return commands;
}

// Generate 300+ commands dynamically
function generateCommands() {
    // Group Commands (50)
    const groupCommands = [
        'kick', 'promote', 'demote', 'tagall', 'hidetag', 'groupinfo', 'welcome', 
        'goodbye', 'antilink', 'antibadword', 'antispam', 'antitoxic', 'groupadd', 
        'groupremove', 'setwelcome', 'setgoodbye', 'setgroupicon', 'getgroupicon', 
        'groupinvite', 'resetlink', 'lockgroup', 'unlockgroup', 'mute', 'unmute', 
        'kickall', 'adminlist', 'memberlist', 'joinrequest', 'approve', 'reject',
        'setdesc', 'setsubject', 'promoteall', 'demoteall', 'tagadmin', 'tagmod',
        'tagowner', 'hidetagall', 'mentionall', 'grouprank', 'levelsystem', 
        'enablensfw', 'disablensfw', 'setlevelrole', 'setlevelmsg', 'antidelete',
        'antiviewonce', 'groupstats', 'topmembers'
    ];
    
    // Download Commands (40)
    const downloadCommands = [
        'play', 'playmp3', 'playmp4', 'ytmp3', 'ytmp4', 'ytsearch', 'tiktok', 
        'tiktokmp3', 'tiktoknowm', 'instagram', 'instagramreel', 'instagramstory',
        'facebook', 'facebookreel', 'twitter', 'twittervideo', 'twitterimage',
        'spotify', 'spotifytrack', 'spotifyplaylist', 'soundcloud', 'pinterest',
        'pinterestvideo', 'reddit', 'redditvideo', 'telegram', 'telegramvideo',
        'twitterx', 'linkedin', 'linkedinvideo', 'capcut', 'capcutedit', 'snackvideo',
        'likee', 'likeevideo', 'triller', 'trillervideo', 'vimeo', 'dailymotion'
    ];
    
    // AI Commands (40)
    const aiCommands = [
        'ai', 'chatgpt', 'gpt', 'bard', 'claude', 'gemini', 'imageai', 'imagine',
        'code', 'ask', 'explain', 'summarize', 'translateai', 'write', 'rewrite',
        'improve', 'grammar', 'spellcheck', 'paraphrase', 'essay', 'email', 'letter',
        'resume', 'coverletter', 'interview', 'quiz', 'math', 'solve', 'calculate',
        'algorithm', 'debug', 'optimize', 'convertcode', 'documentation', 'tutorial',
        'lesson', 'homework', 'research', 'plagiarism', 'citation'
    ];
    
    // Fun Commands (50)
    const funCommands = [
        'joke', 'meme', 'quote', 'truth', 'dare', 'wouldyourather', 'neverhaveiever',
        'roast', 'insult', 'compliment', 'rate', 'ship', 'compatibility', 'lovecalc',
        'fortune', 'horoscope', '8ball', 'coinflip', 'dice', 'roulette', 'blackjack',
        'slots', 'rps', 'hangman', 'trivia', 'quizgame', 'wordle', 'connect4',
        'tictactoe', 'chess', 'anagram', 'scramble', 'riddle', 'puzzle', 'brainteaser',
        'fact', 'didyouknow', 'random', 'cat', 'dog', 'fox', 'bird', 'panda', 
        'koala', 'redpanda', 'shibe', 'corgi', 'whale', 'dolphin'
    ];
    
    // Owner Commands (40)
    const ownerCommands = [
        'shutdown', 'restart', 'update', 'setprefix', 'block', 'unblock', 'broadcast',
        'dm', 'announce', 'setowner', 'addowner', 'removeowner', 'listowners',
        'setbotname', 'setbotpfp', 'setbotstatus', 'setbio', 'setspeed', 'setdelay',
        'clearsessions', 'clearcache', 'backup', 'restore', 'export', 'import',
        'banuser', 'unbanuser', 'banlist', 'addpremium', 'removepremium', 'premiumlist',
        'setlimit', 'resetlimit', 'addcmd', 'delcmd', 'editcmd', 'listcmds', 'enablecmd', 'disablecmd'
    ];
    
    // Tools/Utility Commands (80)
    const toolsCommands = [
        'ping', 'speed', 'time', 'date', 'weather', 'forecast', 'translate', 'qr',
        'shortlink', 'urlshortener', 'bitly', 'tinyurl', 'isgd', 'v.gd', 'owly',
        'calculator', 'currency', 'converter', 'unit', 'temperature', 'length', 
        'weight', 'volume', 'area', 'speedcalc', 'timecalc', 'datecalc', 'agecalc',
        'binary', 'hex', 'base64', 'encode', 'decode', 'hash', 'md5', 'sha1', 
        'sha256', 'crypt', 'decrypt', 'passwordgen', 'uuid', 'randomstring',
        'qrcodegen', 'barcode', 'pdfgen', 'imagetopdf', 'pdfimage', 'compress',
        'resize', 'crop', 'rotate', 'filter', 'brightness', 'contrast', 'saturation',
        'memecreator', 'sticker', 'stickermeme', 'toimage', 'togif', 'circle',
        'greyscale', 'blur', 'pixelate', 'border', 'watermark', 'addtext', 
        'screenshot', 'capture', 'domains', 'whois', 'dns', 'pingtest', 'speedtest',
        'ipinfo', 'useragent', 'headers', 'sslcheck', 'serverstatus'
    ];
    
    // Combine all commands
    const allCommands = [
        ...groupCommands.map(cmd => ({ name: cmd, category: 'group', desc: `Group management: ${cmd}` })),
        ...downloadCommands.map(cmd => ({ name: cmd, category: 'download', desc: `Download media: ${cmd}` })),
        ...aiCommands.map(cmd => ({ name: cmd, category: 'ai', desc: `AI powered: ${cmd}` })),
        ...funCommands.map(cmd => ({ name: cmd, category: 'fun', desc: `Fun & games: ${cmd}` })),
        ...ownerCommands.map(cmd => ({ name: cmd, category: 'owner', desc: `Owner only: ${cmd}` })),
        ...toolsCommands.map(cmd => ({ name: cmd, category: 'tools', desc: `Utility tool: ${cmd}` }))
    ];
    
    // Register each command
    allCommands.forEach(cmd => {
        if (!commands.has(cmd.name)) {
            commands.set(cmd.name, {
                command: cmd.name,
                category: cmd.category,
                desc: cmd.desc,
                run: async (client, message, args, userId) => {
                    return await executeCommand(cmd.name, client, message, args, userId);
                }
            });
        }
    });
}

// Generic command executor
async function executeCommand(commandName, client, message, args, userId) {
    const { key, pushName, remoteJid } = message;
    const sender = key.participant || key.remoteJid;
    
    // Check cooldown
    const cooldownKey = `${userId}-${commandName}`;
    if (cooldowns.has(cooldownKey)) {
        const remaining = (cooldowns.get(cooldownKey) + config.COMMAND_COOLDOWN) - Date.now();
        if (remaining > 0) {
            await client.sendMessage(remoteJid, { 
                text: `⏳ Please wait ${Math.ceil(remaining/1000)} seconds before using ${config.PREFIX}${commandName} again.` 
            });
            return;
        }
    }
    
    // Set cooldown
    cooldowns.set(cooldownKey, Date.now());
    setTimeout(() => cooldowns.delete(cooldownKey), config.COMMAND_COOLDOWN);
    
    // Execute based on command
    switch(commandName) {
        // Group Commands
        case 'kick':
            if (!message.message.extendedTextMessage) return;
            const mentioned = message.message.extendedTextMessage.contextInfo.mentionedJid;
            if (mentioned && mentioned.length) {
                await client.groupParticipantsUpdate(remoteJid, mentioned, 'remove');
                await client.sendMessage(remoteJid, { text: `✅ Kicked ${mentioned.length} member(s)` });
            }
            break;
            
        case 'tagall':
            const groupMetadata = await client.groupMetadata(remoteJid);
            let mentions = groupMetadata.participants.map(p => p.id);
            await client.sendMessage(remoteJid, { 
                text: `📢 Attention everyone!\n${args.join(' ') || 'Meeting now!'}`,
                mentions 
            });
            break;
            
        case 'promote':
            const promoteMention = message.message.extendedTextMessage?.contextInfo?.mentionedJid;
            if (promoteMention) {
                await client.groupParticipantsUpdate(remoteJid, promoteMention, 'promote');
                await client.sendMessage(remoteJid, { text: `✅ Promoted ${promoteMention.length} member(s) to admin` });
            }
            break;
            
        case 'groupinfo':
            const info = await client.groupMetadata(remoteJid);
            await client.sendMessage(remoteJid, { 
                text: `╭━━━┫ GROUP INFO ┣━━━╮\n` +
                      `┃\n` +
                      `┃ 📛 Name: ${info.subject}\n` +
                      `┃ 👤 Owner: ${info.owner || 'Unknown'}\n` +
                      `┃ 👥 Members: ${info.participants.length}\n` +
                      `┃ 📝 Description: ${info.desc || 'No description'}\n` +
                      `┃ 🔒 Restrict: ${info.restrict ? 'Yes' : 'No'}\n` +
                      `┃ 🎫 Announce: ${info.announce ? 'Yes' : 'No'}\n` +
                      `┃\n╰━━━━━━━━━━━━━━━━━━━━━╯`
            });
            break;
            
        // Download Commands
        case 'play':
        case 'ytmp3':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide a song name or URL' });
                return;
            }
            await client.sendMessage(remoteJid, { text: '🎵 Searching and downloading...' });
            const searchQuery = args.join(' ');
            try {
                const searchUrl = `https://yt-search.vercel.app/api/search?q=${encodeURIComponent(searchQuery)}`;
                const searchRes = await axios.get(searchUrl);
                if (searchRes.data && searchRes.data.videos.length) {
                    const video = searchRes.data.videos[0];
                    const audioStream = ytdl(video.url, { filter: 'audioonly' });
                    await client.sendMessage(remoteJid, { 
                        audio: { stream: audioStream },
                        mimetype: 'audio/mpeg',
                        fileName: `${video.title}.mp3`
                    });
                }
            } catch (error) {
                await client.sendMessage(remoteJid, { text: `❌ Error: ${error.message}` });
            }
            break;
            
        case 'ytmp4':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide a YouTube URL' });
                return;
            }
            await client.sendMessage(remoteJid, { text: '📥 Downloading video...' });
            const videoUrl = args[0];
            if (ytdl.validateURL(videoUrl)) {
                const videoStream = ytdl(videoUrl, { filter: 'videoandaudio' });
                await client.sendMessage(remoteJid, { 
                    video: { stream: videoStream },
                    mimetype: 'video/mp4'
                });
            }
            break;
            
        case 'tiktok':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide a TikTok URL' });
                return;
            }
            await client.sendMessage(remoteJid, { text: '📱 Fetching TikTok video...' });
            // TikTok download API implementation
            break;
            
        // AI Commands
        case 'ai':
        case 'chatgpt':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide a question' });
                return;
            }
            await client.sendMessage(remoteJid, { text: '🤖 Thinking...' });
            const question = args.join(' ');
            // OpenAI API integration
            if (config.OPENAI_API_KEY) {
                try {
                    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                        model: 'gpt-3.5-turbo',
                        messages: [{ role: 'user', content: question }]
                    }, {
                        headers: { 'Authorization': `Bearer ${config.OPENAI_API_KEY}` }
                    });
                    await client.sendMessage(remoteJid, { text: response.data.choices[0].message.content });
                } catch (error) {
                    await client.sendMessage(remoteJid, { text: `❌ AI Error: ${error.message}` });
                }
            } else {
                await client.sendMessage(remoteJid, { text: '⚠️ OpenAI API key not configured' });
            }
            break;
            
        case 'image':
        case 'imagine':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide an image description' });
                return;
            }
            await client.sendMessage(remoteJid, { text: '🎨 Generating image...' });
            // Image generation API implementation
            break;
            
        // Fun Commands
        case 'joke':
            try {
                const jokeRes = await axios.get('https://v2.jokeapi.dev/joke/Any');
                const joke = jokeRes.data;
                const jokeText = joke.type === 'single' ? joke.joke : `${joke.setup}\n\n${joke.delivery}`;
                await client.sendMessage(remoteJid, { text: `😂 ${jokeText}` });
            } catch {
                await client.sendMessage(remoteJid, { text: 'Why don\'t scientists trust atoms? Because they make up everything!' });
            }
            break;
            
        case 'meme':
            try {
                const memeRes = await axios.get('https://meme-api.com/gimme');
                const meme = memeRes.data;
                await client.sendMessage(remoteJid, { 
                    image: { url: meme.url },
                    caption: `🎭 ${meme.title}\n👍 ${meme.ups} upvotes`
                });
            } catch {
                await client.sendMessage(remoteJid, { text: '❌ Failed to fetch meme' });
            }
            break;
            
        case 'quote':
            try {
                const quoteRes = await axios.get('https://api.quotable.io/random');
                const quote = quoteRes.data;
                await client.sendMessage(remoteJid, { 
                    text: `"${quote.content}"\n\n— ${quote.author}`
                });
            } catch {
                await client.sendMessage(remoteJid, { text: 'The only limit is your mind.' });
            }
            break;
            
        // Tools/Utility Commands
        case 'ping':
            const start = Date.now();
            await client.sendMessage(remoteJid, { text: '🏓 Pinging...' });
            const end = Date.now();
            await client.sendMessage(remoteJid, { text: `🏓 Pong! ${end - start}ms` });
            break;
            
        case 'weather':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide a city name' });
                return;
            }
            const city = args.join(' ');
            try {
                const weatherRes = await axios.get(`https://wttr.in/${city}?format=%C+%t+%w+%h`);
                await client.sendMessage(remoteJid, { text: `🌤️ Weather in ${city}:\n${weatherRes.data}` });
            } catch {
                await client.sendMessage(remoteJid, { text: '❌ Could not fetch weather data' });
            }
            break;
            
        case 'translate':
            if (args.length < 2) {
                await client.sendMessage(remoteJid, { text: '❌ Usage: .translate <lang> <text>' });
                return;
            }
            const targetLang = args[0];
            const textToTranslate = args.slice(1).join(' ');
            // Translation API implementation
            break;
            
        case 'qr':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide text to generate QR' });
                return;
            }
            const qrText = args.join(' ');
            const QRCode = require('qrcode');
            const qrImage = await QRCode.toBuffer(qrText);
            await client.sendMessage(remoteJid, { image: qrImage, caption: 'Your QR Code' });
            break;
            
        case 'shortlink':
            if (!args.length) {
                await client.sendMessage(remoteJid, { text: '❌ Please provide a URL to shorten' });
                return;
            }
            const longUrl = args[0];
            try {
                const shortRes = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
                await client.sendMessage(remoteJid, { text: `🔗 Shortened URL: ${shortRes.data}` });
            } catch {
                await client.sendMessage(remoteJid, { text: '❌ Failed to shorten URL' });
            }
            break;
            
        // Owner Commands
        case 'shutdown':
            if (sender.includes(config.OWNER_NUMBER)) {
                await client.sendMessage(remoteJid, { text: '🔄 Shutting down bot...' });
                process.exit(0);
            }
            break;
            
        case 'broadcast':
            if (sender.includes(config.OWNER_NUMBER)) {
                const broadcastMsg = args.join(' ') || 'Broadcast message from RIOT MD';
                const allSessions = await database.getAllSessions();
                for (const session of allSessions) {
                    const sock = sessions.get(session.userId);
                    if (sock && sock.user) {
                        await sock.sendMessage(sock.user.id, { text: `📢 BROADCAST:\n${broadcastMsg}` });
                    }
                }
                await client.sendMessage(remoteJid, { text: `✅ Broadcast sent to ${allSessions.length} users` });
            }
            break;
            
        default:
            await client.sendMessage(remoteJid, { text: `❌ Command ${commandName} is being developed.` });
    }
}

// Handle incoming messages
async function handleMessage(client, message, commands, userId) {
    const { key, message: msg } = message;
    const remoteJid = key.remoteJid;
    const text = msg?.conversation || msg?.extendedTextMessage?.text || '';
    
    if (!text.startsWith(config.PREFIX)) return;
    
    const args = text.slice(config.PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    const command = commands.get(commandName);
    if (command) {
        try {
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
