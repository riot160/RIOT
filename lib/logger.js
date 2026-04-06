import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '..', 'logs');

await fs.ensureDir(logsDir);

const logger = {
    info: (message) => {
        const log = `[INFO] ${new Date().toISOString()} - ${message}`;
        console.log(chalk.blue(log));
        fs.appendFile(path.join(logsDir, 'info.log'), log + '\n').catch(() => {});
    },
    
    error: (message, error) => {
        const log = `[ERROR] ${new Date().toISOString()} - ${message} ${error ? error.stack || error : ''}`;
        console.log(chalk.red(log));
        fs.appendFile(path.join(logsDir, 'error.log'), log + '\n').catch(() => {});
    },
    
    warn: (message) => {
        const log = `[WARN] ${new Date().toISOString()} - ${message}`;
        console.log(chalk.yellow(log));
        fs.appendFile(path.join(logsDir, 'warn.log'), log + '\n').catch(() => {});
    },
    
    debug: (message) => {
        if (process.env.DEBUG === 'true') {
            const log = `[DEBUG] ${new Date().toISOString()} - ${message}`;
            console.log(chalk.gray(log));
        }
    }
};

export default logger;
