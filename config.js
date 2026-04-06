import dotenv from 'dotenv';
dotenv.config();

const config = {
    // Bot Configuration
    BOT_NAME: 'RIOT MD',
    BOT_VERSION: 'v1.0',
    DEVELOPER: 'Sydney Sider',
    PREFIX: process.env.PREFIX || '.',
    
    // Owner Configuration
    OWNER_NUMBER: process.env.OWNER_NUMBER || '254700000000',
    OWNER_NAME: process.env.OWNER_NAME || 'Admin',
    
    // Server Configuration
    PORT: process.env.PORT || 3000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'riot-md-secret-key-2024',
    
    // Database Configuration
    DATABASE_URL: process.env.DATABASE_URL || 'mongodb://localhost:27017/riot-md',
    DB_TYPE: process.env.DB_TYPE || 'json',
    
    // API Configuration
    API_KEY: process.env.API_KEY || 'riot-md-api-key',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    
    // Session Configuration
    SESSION_DIR: './sessions',
    MAX_SESSIONS: parseInt(process.env.MAX_SESSIONS) || 100,
    
    // Security Configuration
    RATE_LIMIT_WINDOW: 60000,
    RATE_LIMIT_MAX: 30,
    COMMAND_COOLDOWN: 3000,
    
    // Anti-Ban Configuration
    TYPING_SIMULATION: true,
    READ_RECEIPTS: true,
    DELAY_BETWEEN_ACTIONS: 2000,
    
    // Features
    ENABLE_PAIRING_CODE: true,
    ENABLE_WEB_DASHBOARD: true,
    ENABLE_API: true,
    ENABLE_PLUGINS: true,
    ENABLE_AUTO_UPDATE: true,
    
    // Auto Update
    GITHUB_REPO: 'https://github.com/riot160/RIOT',
    UPDATE_CHECK_INTERVAL: 86400000,
};

export default config;
