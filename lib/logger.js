const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
fs.ensureDirSync(logsDir);

// Simple logger for production
const logger = {
    info: (message) => {
        const log = `[INFO] ${new Date().toISOString()} - ${message}`;
        console.log(chalk.blue(log));
        fs.appendFileSync(path.join(logsDir, 'info.log'), log + '\n');
    },
    
    error: (message, error) => {
        const log = `[ERROR] ${new Date().toISOString()} - ${message} ${error ? error.stack || error : ''}`;
        console.log(chalk.red(log));
        fs.appendFileSync(path.join(logsDir, 'error.log'), log + '\n');
    },
    
    warn: (message) => {
        const log = `[WARN] ${new Date().toISOString()} - ${message}`;
        console.log(chalk.yellow(log));
        fs.appendFileSync(path.join(logsDir, 'warn.log'), log + '\n');
    },
    
    debug: (message) => {
        if (process.env.DEBUG === 'true') {
            const log = `[DEBUG] ${new Date().toISOString()} - ${message}`;
            console.log(chalk.gray(log));
        }
    }
};

module.exports = logger;
