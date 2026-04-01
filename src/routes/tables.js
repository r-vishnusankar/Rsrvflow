const router = require('express').Router();
const { z } = require('zod');
const { prisma, requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/tables/public — public floor plan info (no auth)
router.get('/public', async (req, res) => {
  const { orgSlug } = req.query;
  if (!orgSlug) return res.status(400).json({ error: 'orgSlug required' });
  try {
    const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) return res.status(404).json({ error: 'Org not found' });
    const tables = await prisma.floorTable.findMany({
      where: { organizationId: org.id },
      select: {
        id: true, code: true, x: true, y: true, r: true, w: true, h: true,
        zone: true, status: true, tableType: true
      },
      orderBy: { id: 'asc' }
    });
    res.json(tables.map(t => ({ ...t, status: t.status.toLowerCase(), type: t.tableType })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch public tables' });
  }
});

// Helper: convert Prisma table row → frontend shape
function tableToFrontend(t) {
  return {
    id: t.id,
    code: t.code,
    label: t.label,
    zone: t.zone,
    seats: t.seats,
    type: t.tableType,
    status: t.status.toLowerCase(),
    guest: t.guestName || null,
    occupantId: t.occupantId || null,
    x: t.x,
    y: t.y,
    r: t.r || undefined,
    w: t.w || undefined,
    h: t.h || undefined,
  };
}

// GET /api/tables — list all tables for the org
router.get('/', requireAuth, async (req, res) => {
  try {
    const tables = await prisma.floorTable.findMany({
      where: { organizationId: req.user.orgId },
      orderBy: { id: 'asc' },
    });
    res.json(tables.map(tableToFrontend));
  } catch (err) {
    console.error('[GET /tables]', err);
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

// PATCH /api/tables/:id — update status, guestName, clear
const patchSchema = z.object({
  status: z.enum(['available', 'occupied', 'cleaning', 'reserved']).optional(),
  guestName: z.string().nullable().optional(),
  occupantId: z.string().nullable().optional(),
});

router.patch('/:id', requireAuth, async (req, res) => {
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.issues[0].message });
  }

  try {
    // Verify table belongs to this org
    const existing = await prisma.floorTable.findFirst({
      where: { id: req.params.id, organizationId: req.user.orgId },
    });
    if (!existing) return res.status(404).json({ error: 'Table not found' });

    const { status, guestName, occupantId } = parse.data;
    const data = {};
    if (status !== undefined) {
      data.status = status.toUpperCase();
      // Auto-clear guest info if marking as available or cleaning
      if (data.status === 'AVAILABLE' || data.status === 'CLEANING') {
        data.guestName = null;
        data.occupantId = null;
      }
    }
    if (guestName !== undefined) data.guestName = guestName;
    if (occupantId !== undefined) data.occupantId = occupantId;

    const updated = await prisma.floorTable.update({
      where: { id: req.params.id },
      data,
    });

    // Audit log
    await prisma.auditEvent.create({
      data: {
        organizationId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'table.update',
        payload: { tableId: req.params.id, changes: parse.data },
      },
    }).catch(() => {}); // non-fatal

    res.json(tableToFrontend(updated));
  } catch (err) {
    console.error('[PATCH /tables/:id]', err);
    res.status(500).json({ error: 'Failed to update table' });
  }
});

// POST /api/tables/:id/clear — vacate table, set guest to null, status → cleaning
router.post('/:id/clear', requireAuth, async (req, res) => {
  try {
    const existing = await prisma.floorTable.findFirst({
      where: { id: req.params.id, organizationId: req.user.orgId },
    });
    if (!existing) return res.status(404).json({ error: 'Table not found' });

    // Mark the previously seated customer as DONE
    if (existing.occupantId) {
      await prisma.customer.update({
        where: { id: existing.occupantId },
        data: { status: 'DONE', tableId: null },
      }).catch(() => {});
    }

    const updated = await prisma.floorTable.update({
      where: { id: req.params.id },
      data: { status: 'CLEANING', guestName: null, occupantId: null },
    });

    res.json(tableToFrontend(updated));
  } catch (err) {
    console.error('[POST /tables/:id/clear]', err);
    res.status(500).json({ error: 'Failed to clear table' });
  }
});

module.exports = router;
