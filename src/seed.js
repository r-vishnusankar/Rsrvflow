/**
 * TableFlow seed script
 * Run: node src/seed.js
 *
 * Creates:
 *   - Organization: spice-garden
 *   - Owner:  admin@spicegarden.com / Admin1234!
 *   - Staff:  staff@spicegarden.com / Staff1234!
 *   - Full floor plan (matches Rserve.html buildTables())
 *   - 3 demo customers in the queue
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱  Seeding TableFlow...');

  // ── Organization ────────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'spice-garden' },
    update: {},
    create: {
      name: 'Spice Garden',
      slug: 'spice-garden',
      displayName: 'Spice Garden',
    },
  });
  console.log(`   Org: ${org.name} (${org.slug})`);

  // ── Users ────────────────────────────────────────────────────────────────────
  const adminHash  = await bcrypt.hash('Admin1234!', 12);
  const staffHash  = await bcrypt.hash('Staff1234!', 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@spicegarden.com' },
    update: {},
    create: { email: 'admin@spicegarden.com', passwordHash: adminHash, name: 'Restaurant Admin' },
  });

  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@spicegarden.com' },
    update: {},
    create: { email: 'staff@spicegarden.com', passwordHash: staffHash, name: 'Floor Staff' },
  });

  // Memberships
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: adminUser.id, organizationId: org.id } },
    update: {},
    create: { userId: adminUser.id, organizationId: org.id, role: 'OWNER' },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: staffUser.id, organizationId: org.id } },
    update: {},
    create: { userId: staffUser.id, organizationId: org.id, role: 'STAFF' },
  });
  console.log(`   Users: ${adminUser.email} (OWNER), ${staffUser.email} (STAFF)`);

  // ── Floor tables ─────────────────────────────────────────────────────────────
  // Delete existing tables for this org so we can re-seed cleanly
  await prisma.floorTable.deleteMany({ where: { organizationId: org.id } });

  const tables = buildTables();
  await prisma.floorTable.createMany({
    data: tables.map(t => ({
      id: `${org.id}:${t.id}`, // namespaced to org
      code: t.id,
      organizationId: org.id,
      label: t.label,
      zone: t.zone,
      seats: t.seats,
      tableType: t.type,
      status: t.status.toUpperCase(),
      x: t.x,
      y: t.y,
      r: t.r ?? null,
      w: t.w ?? null,
      h: t.h ?? null,
    })),
    skipDuplicates: true,
  });
  console.log(`   Tables: ${tables.length} created`);

  // ── Demo queue ───────────────────────────────────────────────────────────────
  // Clear old queue entries for this org
  await prisma.queueEntry.deleteMany({ where: { organizationId: org.id } });
  await prisma.customer.deleteMany({ where: { organizationId: org.id, status: 'WAITING' } });

  const demoGuests = [
    { name: 'Priya Sharma', partySize: 2 },
    { name: 'Amit Patel',   partySize: 4 },
    { name: 'Kavya Iyer',   partySize: 3 },
  ];

  for (let i = 0; i < demoGuests.length; i++) {
    const g = demoGuests[i];
    const crypto = require('crypto');
    await prisma.customer.create({
      data: {
        organizationId: org.id,
        name: g.name,
        partySize: g.partySize,
        status: 'WAITING',
        sessionToken: crypto.randomBytes(32).toString('hex'),
        joinedAt: new Date(Date.now() - (demoGuests.length - i) * 8 * 60 * 1000),
        queueEntry: {
          create: { organizationId: org.id, position: i + 1 },
        },
      },
    });
  }
  console.log(`   Queue: ${demoGuests.length} demo customers added`);

  console.log('\n✅  Seed complete!\n');
  console.log('   Login credentials:');
  console.log('   Admin  →  admin@spicegarden.com  /  Admin1234!');
  console.log('   Staff  →  staff@spicegarden.com  /  Staff1234!');
  console.log('   Org slug: spice-garden\n');
}

// ── Floor plan (mirrors buildTables() in Rserve.html) ───────────────────────
function buildTables() {
  const t = [];
  const rndSt = ['available','available','occupied','available','reserved','cleaning','available','occupied','available','available','cleaning','reserved','available','available','occupied'];
  let si = 0;
  const ns = () => rndSt[si++ % rndSt.length];

  // Top booths
  [[60,8],[130,8],[200,8]].forEach((_, i) =>
    t.push({ id: `B${i+1}`, type: 'booth', label: 'Booth', zone: 'Top booths', seats: 4, x: 60+i*72, y: 8, w: 52, h: 38, status: ns() }));
  [[580,8],[650,8],[720,8]].forEach((_, i) =>
    t.push({ id: `B${i+4}`, type: 'booth', label: 'Booth', zone: 'Top booths', seats: 4, x: 580+i*70, y: 8, w: 52, h: 38, status: ns() }));

  // Left private rooms
  [52, 148, 244].forEach((y, i) =>
    t.push({ id: `R${i+1}`, type: 'private', label: 'Private room', zone: 'Private rooms', seats: 6, x: 18, y, w: 110, h: 86, status: ns() }));

  // Center 4-tops
  let tn = 1;
  [200,296,392].forEach(cx =>
    [60,148,236,320].forEach(cy =>
      t.push({ id: `T${tn++}`, type: 'round4', label: 'Round table', zone: 'Center', seats: 4, x: cx, y: cy, r: 32, status: ns() })));

  // Main floor 6-tops
  [490,582].forEach(cx =>
    [60,148,236,320].forEach(cy =>
      t.push({ id: `T${tn++}`, type: 'round6', label: 'Round table', zone: 'Main floor', seats: 6, x: cx, y: cy, r: 36, status: ns() })));

  // Side 2-tops
  let sn = 1;
  [680,750].forEach(cx =>
    [60,150,240,330].forEach(cy =>
      t.push({ id: `S${sn++}`, type: 'round2', label: 'Small table', zone: 'Side', seats: 2, x: cx, y: cy, r: 24, status: ns() })));

  return t;
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
