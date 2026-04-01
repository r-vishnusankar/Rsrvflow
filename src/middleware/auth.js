const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verify JWT and attach req.user = { id, email, orgId, role }
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = auth.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }

  // Attach to request — all route handlers can trust this
  req.user = {
    id: payload.userId,
    email: payload.email,
    orgId: payload.orgId,
    role: payload.role,
  };
  next();
}

// Must be called after requireAuth. Rejects STAFF from admin-only routes.
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role === 'STAFF') {
    return res.status(403).json({ error: 'Admin or Owner role required' });
  }
  next();
}

// Optional auth — attaches user if token present, but doesn't fail if absent
// Used for the customer-facing queue routes that accept session tokens instead
async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      req.user = {
        id: payload.userId,
        email: payload.email,
        orgId: payload.orgId,
        role: payload.role,
      };
    } catch {
      // ignore invalid tokens in optional mode
    }
  }
  next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth, prisma };
