const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

let db;

// JSON Database implementation
class JSONDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database');
        this.usersFile = path.join(this.dbPath, 'users.json');
        this.sessionsFile = path.join(this.dbPath, 'sessions.json');
    }
    
    async init() {
        // Ensure database directory exists
        await fs.ensureDir(this.dbPath);
        
        // Create users.json if it doesn't exist
        if (!await fs.pathExists(this.usersFile)) {
            await fs.writeJson(this.usersFile, []);
            logger.info('Created users.json');
        }
        
        // Create sessions.json if it doesn't exist
        if (!await fs.pathExists(this.sessionsFile)) {
            await fs.writeJson(this.sessionsFile, []);
            logger.info('Created sessions.json');
        }
        
        logger.info('JSON Database initialized successfully');
        return true;
    }
    
    async getUsers() {
        try {
            return await fs.readJson(this.usersFile);
        } catch (error) {
            logger.error('Error reading users.json:', error);
            return [];
        }
    }
    
    async saveUsers(users) {
        try {
            await fs.writeJson(this.usersFile, users, { spaces: 2 });
            return true;
        } catch (error) {
            logger.error('Error saving users.json:', error);
            return false;
        }
    }
    
    async createUser(userId, phoneNumber) {
        const users = await this.getUsers();
        users.push({
            userId,
            phoneNumber,
            createdAt: new Date(),
            status: 'pending',
            premium: false,
            commandsUsed: 0
        });
        await this.saveUsers(users);
        return true;
    }
    
    async getUser(userId) {
        const users = await this.getUsers();
        return users.find(u => u.userId === userId);
    }
    
    async getAllUsers() {
        return await this.getUsers();
    }
    
    async getUserCount() {
        const users = await this.getUsers();
        return users.length;
    }
    
    async updateUser(userId, data) {
        const users = await this.getUsers();
        const index = users.findIndex(u => u.userId === userId);
        if (index !== -1) {
            users[index] = { ...users[index], ...data };
            await this.saveUsers(users);
            return true;
        }
        return false;
    }
    
    async getSessions() {
        try {
            return await fs.readJson(this.sessionsFile);
        } catch (error) {
            logger.error('Error reading sessions.json:', error);
            return [];
        }
    }
    
    async saveSessions(sessions) {
        try {
            await fs.writeJson(this.sessionsFile, sessions, { spaces: 2 });
            return true;
        } catch (error) {
            logger.error('Error saving sessions.json:', error);
            return false;
        }
    }
    
    async updateSession(userId, data) {
        const sessions = await this.getSessions();
        const index = sessions.findIndex(s => s.userId === userId);
        if (index !== -1) {
            sessions[index] = { ...sessions[index], ...data };
        } else {
            sessions.push({ userId, ...data });
        }
        await this.saveSessions(sessions);
        return true;
    }
    
    async getAllSessions() {
        return await this.getSessions();
    }
}

// MongoDB Database implementation
class MongoDBDatabase {
    async init() {
        try {
            await mongoose.connect(config.DATABASE_URL);
            logger.info('MongoDB connected');
            
            // Define schemas
            const userSchema = new mongoose.Schema({
                userId: String,
                phoneNumber: String,
                createdAt: Date,
                status: String,
                premium: Boolean,
                commandsUsed: Number
            });
            
            const sessionSchema = new mongoose.Schema({
                userId: String,
                status: String,
                phoneNumber: String,
                lastSeen: Date,
                qr: String
            });
            
            this.User = mongoose.model('User', userSchema);
            this.Session = mongoose.model('Session', sessionSchema);
        } catch (error) {
            logger.error('MongoDB connection error:', error);
            throw error;
        }
    }
    
    async createUser(userId, phoneNumber) {
        const user = new this.User({
            userId,
            phoneNumber,
            createdAt: new Date(),
            status: 'pending',
            premium: false,
            commandsUsed: 0
        });
        await user.save();
        return true;
    }
    
    async getUser(userId) {
        return await this.User.findOne({ userId });
    }
    
    async getAllUsers() {
        return await this.User.find();
    }
    
    async getUserCount() {
        return await this.User.countDocuments();
    }
    
    async updateUser(userId, data) {
        return await this.User.updateOne({ userId }, data);
    }
    
    async updateSession(userId, data) {
        return await this.Session.updateOne({ userId }, data, { upsert: true });
    }
    
    async getAllSessions() {
        return await this.Session.find();
    }
}

// Initialize database
async function init() {
    if (config.DB_TYPE === 'mongodb') {
        db = new MongoDBDatabase();
        await db.init();
    } else {
        db = new JSONDatabase();
        await db.init();
    }
    return db;
}

function getDB() {
    return db;
}

module.exports = {
    init,
    getDB,
    createUser: (userId, phoneNumber) => db.createUser(userId, phoneNumber),
    getUser: (userId) => db.getUser(userId),
    getAllUsers: () => db.getAllUsers(),
    getUserCount: () => db.getUserCount(),
    updateUser: (userId, data) => db.updateUser(userId, data),
    updateSession: (userId, data) => db.updateSession(userId, data),
    getAllSessions: () => db.getAllSessions()
};
