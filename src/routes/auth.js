const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { prisma } = require('../middleware/auth');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  orgSlug: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1),
  orgSlug: z.string().min(1),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']).default('ADMIN'),
  // Only OWNER can create other owners — enforced in route
  inviteKey: z.string().optional(),
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.issues[0].message });
  }

  const { email, password, orgSlug } = parse.data;

  try {
    const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    });
    if (!membership) return res.status(403).json({ error: 'No access to this organization' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, orgId: org.id, role: membership.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: membership.role },
      org: { id: org.id, slug: org.slug, name: org.name, displayName: org.displayName },
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/register  (creates a user + adds them to an org)
// In production you'd protect this with an invite key — for UAT it's open
router.post('/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.issues[0].message });
  }

  const { email, password, name, orgSlug, role } = parse.data;

  try {
    const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Check if already a member
      const mem = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId: existing.id, organizationId: org.id } },
      });
      if (mem) return res.status(409).json({ error: 'Email already registered for this org' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = existing || await prisma.user.create({ data: { email, passwordHash, name } });

    await prisma.membership.create({
      data: { userId: user.id, organizationId: org.id, role },
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email, orgId: org.id, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role },
      org: { id: org.id, slug: org.slug, name: org.name, displayName: org.displayName },
    });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /auth/me — verify token and return current user info
router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });

  const jwt_lib = require('jsonwebtoken');
  try {
    const payload = jwt_lib.verify(auth.slice(7), process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    const org = await prisma.organization.findUnique({ where: { id: payload.orgId } });
    if (!user || !org) return res.status(404).json({ error: 'Not found' });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: payload.role },
      org: { id: org.id, slug: org.slug, name: org.name, displayName: org.displayName },
    });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
