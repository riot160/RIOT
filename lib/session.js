const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');

const SESSION_DIR = config.SESSION_DIR;
const ENCRYPTION_KEY = crypto.scryptSync(config.SESSION_SECRET, 'salt', 32);
const IV_LENGTH = 16;

// Encrypt session data
function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

// Decrypt session data
function decrypt(text) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Save session
async function saveSession(userId, sessionData) {
    try {
        const sessionPath = path.join(SESSION_DIR, `${userId}.enc`);
        const encrypted = encrypt(JSON.stringify(sessionData));
        await fs.writeFile(sessionPath, encrypted);
        logger.info(`Session saved for ${userId}`);
        return true;
    } catch (error) {
        logger.error(`Failed to save session for ${userId}:`, error);
        return false;
    }
}

// Load session
async function loadSession(userId) {
    try {
        const sessionPath = path.join(SESSION_DIR, `${userId}.enc`);
        if (await fs.pathExists(sessionPath)) {
            const encrypted = await fs.readFile(sessionPath, 'utf8');
            const decrypted = decrypt(encrypted);
            logger.info(`Session loaded for ${userId}`);
            return JSON.parse(decrypted);
        }
    } catch (error) {
        logger.error(`Failed to load session for ${userId}:`, error);
    }
    return null;
}

// Delete session
async function deleteSession(userId) {
    try {
        const sessionPath = path.join(SESSION_DIR, `${userId}.enc`);
        if (await fs.pathExists(sessionPath)) {
            await fs.remove(sessionPath);
            logger.info(`Session deleted for ${userId}`);
            return true;
        }
    } catch (error) {
        logger.error(`Failed to delete session for ${userId}:`, error);
    }
    return false;
}

// List all sessions
async function listSessions() {
    try {
        const files = await fs.readdir(SESSION_DIR);
        return files.filter(f => f.endsWith('.enc')).map(f => f.replace('.enc', ''));
    } catch (error) {
        logger.error('Failed to list sessions:', error);
        return [];
    }
}

module.exports = {
    saveSession,
    loadSession,
    deleteSession,
    listSessions
};
