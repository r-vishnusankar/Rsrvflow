const router = require('express').Router();
const { prisma, requireAuth } = require('../middleware/auth');

// POST /api/llm-assign — Groq-powered auto assign (server-side only, key never in browser)
router.post('/', requireAuth, async (req, res) => {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) {
    return res.status(503).json({ error: 'GROQ_API_KEY not configured on this server' });
  }

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

    if (!queueEntries.length) return res.status(400).json({ error: 'No customers in queue' });
    if (!availTables.length) return res.status(400).json({ error: 'No tables available' });

    const waitingQ = queueEntries.map(e => e.customer);
    const model = (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();

    const prompt = `You are a restaurant seating manager. Assign waiting customers to available tables optimally.

WAITING CUSTOMERS (priority order — longest wait first):
${waitingQ.map((c, i) => `${i + 1}. ${c.name} (id: ${c.id}), party of ${c.partySize}, waiting ${Math.floor((Date.now() - c.joinedAt.getTime()) / 60000)} mins`).join('\n')}

AVAILABLE TABLES:
${availTables.map(t => `${t.id}: ${t.seats} seats, zone: ${t.zone}`).join('\n')}

Rules:
- Prefer exact seat match (party of 4 → 4-seat table)
- If no exact match, use next larger table
- Prioritise customers who waited longest
- Don't assign 2-top tables to parties of 4+
- Private rooms preferred for larger parties (5+)

Respond ONLY with a valid JSON array, no other text:
[{"customerId":"...","customerName":"...","tableId":"...","reason":"one short sentence"}]
If no assignments are possible, return [].`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.2,
      }),
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) {
      const msg = groqData.error?.message || `Groq HTTP ${groqRes.status}`;
      return res.status(502).json({ error: msg });
    }

    const raw = (groqData.choices?.[0]?.message?.content || '').trim();
    if (!raw) return res.status(502).json({ error: 'Empty response from LLM' });

    let assignments;
    try {
      const clean = raw.replace(/```json\s*|```/gi, '').trim();
      const a = clean.indexOf('['), b = clean.lastIndexOf(']');
      assignments = JSON.parse(a >= 0 && b > a ? clean.slice(a, b + 1) : clean);
    } catch {
      return res.status(502).json({ error: 'LLM returned invalid JSON', raw });
    }

    if (!Array.isArray(assignments)) {
      return res.status(502).json({ error: 'LLM returned non-array', raw });
    }

    // Apply the assignments
    const applied = [];
    for (const a of assignments) {
      const c = waitingQ.find(x => x.id === a.customerId || x.name === a.customerName);
      const t = availTables.find(x => x.id === a.tableId && x.status === 'AVAILABLE');
      if (!c || !t) continue;

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

      // Mark table as used so subsequent loop iterations don't double-assign
      t.status = 'OCCUPIED';
      applied.push({ customerId: c.id, customerName: c.name, tableId: t.id, reason: a.reason });
    }

    // Re-number queue
    const remaining = await prisma.queueEntry.findMany({
      where: { organizationId: req.user.orgId },
      orderBy: { position: 'asc' },
    });
    for (let i = 0; i < remaining.length; i++) {
      await prisma.queueEntry.update({
        where: { id: remaining[i].id },
        data: { position: i + 1 },
      });
    }

    await prisma.auditEvent.create({
      data: {
        organizationId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'llm.assign',
        payload: { applied },
      },
    }).catch(() => {});

    res.json({ applied });
  } catch (err) {
    console.error('[POST /llm-assign]', err);
    res.status(500).json({ error: err.message || 'LLM assign failed' });
  }
});

module.exports = router;
