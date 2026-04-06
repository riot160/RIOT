import config from '../config.js';

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated === true) {
        return next();
    }
    
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    res.redirect('/login');
}

function requireApiAuth(req, res, next) {
    let apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        apiKey = req.query.api_key;
    }
    
    const validApiKey = process.env.API_KEY || config.API_KEY || 'riot-md-api-key';
    
    if (apiKey && apiKey === validApiKey) {
        return next();
    }
    
    res.status(401).json({ error: 'Unauthorized - Invalid API key' });
}

function optionalAuth(req, res, next) {
    if (req.session && req.session.authenticated === true) {
        req.user = { authenticated: true, type: 'session' };
        return next();
    }
    
    let apiKey = req.headers['x-api-key'] || req.query.api_key;
    const validApiKey = process.env.API_KEY || config.API_KEY || 'riot-md-api-key';
    
    if (apiKey && apiKey === validApiKey) {
        req.user = { authenticated: true, type: 'api' };
        return next();
    }
    
    req.user = { authenticated: false };
    next();
}

function requireOwner(req, res, next) {
    if (!req.session || !req.session.authenticated) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

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

export { requireAuth, requireApiAuth, optionalAuth, requireOwner, createRateLimiter };
