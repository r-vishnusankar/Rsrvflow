const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const { prisma, requireAuth } = require('../middleware/auth');

// Helper: convert customer + queue entry → frontend shape
function customerToFrontend(c, queueEntry) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone || '',
    partySize: c.partySize,
    status: c.status.toLowerCase(),
    joinedAt: c.joinedAt.getTime(),
    tableId: c.tableId || null,
    position: queueEntry?.position ?? null,
    sessionToken: c.sessionToken || undefined,
  };
}

// ─── PUBLIC ROUTES (no auth needed) ──────────────────────────────────────────

// POST /api/queue/join — customer joins queue (no login required)
const joinSchema = z.object({
  orgSlug: z.string().min(1),
  name: z.string().min(1).max(60),
  phone: z.string().max(20).optional(),
  partySize: z.number().int().min(1).max(20),
});

router.post('/join', async (req, res) => {
  const parse = joinSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.issues[0].message });
  }

  const { orgSlug, name, phone, partySize } = parse.data;

  try {
    const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!org) return res.status(404).json({ error: 'Restaurant not found' });

    // Get next position
    const lastEntry = await prisma.queueEntry.findFirst({
      where: { organizationId: org.id },
      orderBy: { position: 'desc' },
    });
    const position = (lastEntry?.position ?? 0) + 1;

    const sessionToken = crypto.randomBytes(32).toString('hex');

    const customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        name,
        phone: phone || null,
        partySize,
        status: 'WAITING',
        sessionToken,
        queueEntry: {
          create: { organizationId: org.id, position },
        },
      },
      include: { queueEntry: true },
    });

    res.status(201).json(customerToFrontend(customer, customer.queueEntry));
  } catch (err) {
    console.error('[POST /queue/join]', err);
    res.status(500).json({ error: 'Failed to join queue' });
  }
});

// GET /api/queue/status?token=... — customer polls their own status
router.get('/status', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    const customer = await prisma.customer.findUnique({
      where: { sessionToken: token },
      include: { queueEntry: true },
    });
    if (!customer) return res.status(404).json({ error: 'Session not found' });

    // Count people ahead in queue
    let position = null;
    if (customer.queueEntry) {
      const ahead = await prisma.queueEntry.count({
        where: {
          organizationId: customer.organizationId,
          position: { lt: customer.queueEntry.position },
        },
      });
      position = ahead + 1;
    }

    // Get table info if assigned
    let tableInfo = null;
    if (customer.tableId) {
      const t = await prisma.floorTable.findFirst({
        where: { id: customer.tableId, organizationId: customer.organizationId },
      });
      if (t) tableInfo = { id: t.id, code: t.code, zone: t.zone };
    }

    res.json({
      id: customer.id,
      name: customer.name,
      partySize: customer.partySize,
      status: customer.status.toLowerCase(),
      joinedAt: customer.joinedAt.getTime(),
      position,
      tableId: customer.tableId || null,
      tableInfo,
    });
  } catch (err) {
    console.error('[GET /queue/status]', err);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// ─── AUTHENTICATED ROUTES (admin/staff) ──────────────────────────────────────

// GET /api/queue — list current waiting queue + all customers today
router.get('/', requireAuth, async (req, res) => {
  try {
    const entries = await prisma.queueEntry.findMany({
      where: { organizationId: req.user.orgId },
      orderBy: { position: 'asc' },
      include: { customer: true },
    });

    const queue = entries.map(e => customerToFrontend(e.customer, e));
    res.json(queue);
  } catch (err) {
    console.error('[GET /queue]', err);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// DELETE /api/queue/:customerId — remove from queue (leave / admin removes)
router.delete('/:customerId', requireAuth, async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.customerId, organizationId: req.user.orgId },
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    await prisma.queueEntry.deleteMany({ where: { customerId: customer.id } });
    await prisma.customer.update({
      where: { id: customer.id },
      data: { status: 'LEFT' },
    });

    // Re-number remaining queue
    await reorderQueue(req.user.orgId);

    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /queue/:id]', err);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

// POST /api/queue/assign — seat a customer at a table
const assignSchema = z.object({
  customerId: z.string(),
  tableId: z.string(),
});

router.post('/assign', requireAuth, async (req, res) => {
  const parse = assignSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.issues[0].message });
  }

  const { customerId, tableId } = parse.data;

  try {
    const [customer, table] = await Promise.all([
      prisma.customer.findFirst({ where: { id: customerId, organizationId: req.user.orgId } }),
      prisma.floorTable.findFirst({ where: { id: tableId, organizationId: req.user.orgId } }),
    ]);

    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!table) return res.status(404).json({ error: 'Table not found' });
    if (table.status !== 'AVAILABLE') return res.status(409).json({ error: 'Table is not available' });

    // Assign in a transaction
    await prisma.$transaction([
      prisma.floorTable.update({
        where: { id: tableId },
        data: { status: 'OCCUPIED', guestName: customer.name, occupantId: customer.id },
      }),
      prisma.customer.update({
        where: { id: customer.id },
        data: { status: 'NOTIFIED', tableId },
      }),
      prisma.queueEntry.deleteMany({ where: { customerId: customer.id } }),
    ]);

    await reorderQueue(req.user.orgId);

    await prisma.auditEvent.create({
      data: {
        organizationId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'queue.assign',
        payload: { customerId, tableId, customerName: customer.name },
      },
    }).catch(() => {});

    res.json({ ok: true, customerId, tableId });
  } catch (err) {
    console.error('[POST /queue/assign]', err);
    res.status(500).json({ error: 'Failed to assign' });
  }
});

// POST /api/queue/auto-assign — rule-based: seat all possible customers
router.post('/auto-assign', requireAuth, async (req, res) => {
  try {
    const [queueEntries, availTables] = await Promise.all([
      prisma.queueEntry.findMany({
        where: { organizationId: req.user.orgId },
        orderBy: { position: 'asc' },
        include: { customer: true },
      }),
      prisma.floorTable.findMany({
        where: { organizationId: req.user.orgId, status: 'AVAILABLE' },
      }),
    ]);

    const remaining = [...availTables];
    const assigned = [];

    for (const entry of queueEntries) {
      const c = entry.customer;
      const tableIdx = findBestTableIdx(remaining, c.partySize);
      if (tableIdx === -1) continue;

      const t = remaining[tableIdx];
      remaining.splice(tableIdx, 1);

      await prisma.$transaction([
        prisma.floorTable.update({
          where: { id: t.id },
          data: { status: 'OCCUPIED', guestName: c.name, occupantId: c.id },
        }),
        prisma.customer.update({
          where: { id: c.id },
          data: { status: 'NOTIFIED', tableId: t.id },
        }),
        prisma.queueEntry.deleteMany({ where: { customerId: c.id } }),
      ]);

      assigned.push({ customerId: c.id, customerName: c.name, tableId: t.id, tableCode: t.code });
    }

    await reorderQueue(req.user.orgId);
    res.json({ assigned });
  } catch (err) {
    console.error('[POST /queue/auto-assign]', err);
    res.status(500).json({ error: 'Auto-assign failed' });
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function findBestTableIdx(tables, partySize) {
  // Prefer smallest table that fits the party
  const fits = tables
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.seats >= partySize)
    .sort((a, b) => a.t.seats - b.t.seats);
  return fits.length ? fits[0].i : -1;
}

async function reorderQueue(orgId) {
  // Re-number positions 1..N after a removal so positions stay contiguous
  const entries = await prisma.queueEntry.findMany({
    where: { organizationId: orgId },
    orderBy: { position: 'asc' },
  });
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].position !== i + 1) {
      await prisma.queueEntry.update({
        where: { id: entries[i].id },
        data: { position: i + 1 },
      });
    }
  }
}

module.exports = router;
