const config = require('../config');

// Middleware to check if user is authenticated for dashboard
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Middleware for API authentication
function requireApiAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (apiKey && apiKey === config.API_KEY) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized - Invalid API key' });
    }
}

module.exports = {
    requireAuth,
    requireApiAuth
};
