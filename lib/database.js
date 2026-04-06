import mongoose from 'mongoose';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;

// JSON Database implementation
class JSONDatabase {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database');
        this.usersFile = path.join(this.dbPath, 'users.json');
        this.sessionsFile = path.join(this.dbPath, 'sessions.json');
    }
    
    async init() {
        await fs.ensureDir(this.dbPath);
        
        if (!await fs.pathExists(this.usersFile)) {
            await fs.writeJson(this.usersFile, []);
            console.log('Created users.json');
        }
        
        if (!await fs.pathExists(this.sessionsFile)) {
            await fs.writeJson(this.sessionsFile, []);
            console.log('Created sessions.json');
        }
        
        return true;
    }
    
    async getUsers() {
        try {
            return await fs.readJson(this.usersFile);
        } catch (error) {
            return [];
        }
    }
    
    async saveUsers(users) {
        await fs.writeJson(this.usersFile, users, { spaces: 2 });
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
            return [];
        }
    }
    
    async saveSessions(sessions) {
        await fs.writeJson(this.sessionsFile, sessions, { spaces: 2 });
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
            console.log('MongoDB connected');
            
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
            console.error('MongoDB connection error:', error);
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

const database = {
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

export default database;
