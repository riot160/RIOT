// lib/auth.js
// Authentication middleware for dashboard and API

const config = require('../config');

/**
 * Middleware to check if user is authenticated for dashboard
 * Redirects to login page if not authenticated
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated === true) {
        return next();
    }
    
    // If it's an API request, return 401
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized - Please login first' });
    }
    
    // For dashboard pages, redirect to login
    res.redirect('/login');
}

/**
 * Middleware for API authentication using API key
 * Checks for API key in headers or query parameters
 */
function requireApiAuth(req, res, next) {
    // Check for API key in headers (preferred)
    let apiKey = req.headers['x-api-key'];
    
    // If not in headers, check query parameters
    if (!apiKey) {
        apiKey = req.query.api_key;
    }
    
    // If still not found, check Authorization header (Bearer token)
    if (!apiKey && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7);
        }
    }
    
    // Validate API key
    const validApiKey = process.env.API_KEY || config.API_KEY || 'riot-md-api-key';
    
    if (apiKey && apiKey === validApiKey) {
        return next();
    }
    
    // Return 401 if invalid
    res.status(401).json({ 
        error: 'Unauthorized - Invalid or missing API key',
        message: 'Provide API key via X-API-Key header, api_key query param, or Bearer token'
    });
}

/**
 * Optional authentication - doesn't require auth but sets user if present
 */
function optionalAuth(req, res, next) {
    // Check if authenticated via session
    if (req.session && req.session.authenticated === true) {
        req.user = { authenticated: true, type: 'session' };
        return next();
    }
    
    // Check if authenticated via API key
    let apiKey = req.headers['x-api-key'] || req.query.api_key;
    const validApiKey = process.env.API_KEY || config.API_KEY || 'riot-md-api-key';
    
    if (apiKey && apiKey === validApiKey) {
        req.user = { authenticated: true, type: 'api' };
        return next();
    }
    
    // Not authenticated but continue (optional)
    req.user = { authenticated: false };
    next();
}

/**
 * Check if user is owner
 */
function requireOwner(req, res, next) {
    // First check authentication
    if (!req.session || !req.session.authenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if the authenticated user is the owner
    // This assumes owner is the one who logged in via dashboard
    next();
}

/**
 * Rate limit wrapper for sensitive endpoints
 */
function createRateLimiter(limit = 10, windowMs = 60000) {
    const requests = new Map();
    
    return (req, res, next) => {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        
        if (!requests.has(key)) {
            requests.set(key, []);
        }
        
        const timestamps = requests.get(key).filter(t => now - t < windowMs);
        
        if (timestamps.length >= limit) {
            return res.status(429).json({ 
                error: 'Too many requests. Please try again later.',
                retryAfter: Math.ceil((windowMs - (now - timestamps[0])) / 1000)
            });
        }
        
        timestamps.push(now);
        requests.set(key, timestamps);
        next();
    };
}

module.exports = {
    requireAuth,
    requireApiAuth,
    optionalAuth,
    requireOwner,
    createRateLimiter
};
