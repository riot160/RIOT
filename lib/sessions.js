// lib/sessions.js
// Shared sessions store to avoid circular dependencies

const sessions = new Map();

module.exports = { sessions };
