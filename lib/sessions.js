/**
 * Shared sessions store
 * Import this in both index.js and server.js to avoid circular require issues
 */
const sessions = new Map();

module.exports = { sessions };
