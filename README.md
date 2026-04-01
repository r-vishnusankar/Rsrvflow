# TableFlow — SaaS

Restaurant queue & table management. Multi-device, database-backed, UAT-ready.

---

## Quick start (local)

### 1. Install dependencies
```bash
npm install
```

### 2. Create `.env`
```bash
cp .env.example .env
```
Fill in:
- `DATABASE_URL` — get a free Postgres from [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com)
- `JWT_SECRET` — run `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` and paste the output
- `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com/keys) (optional — LLM assign will be disabled without it)

### 3. Push schema to database
```bash
npx prisma db push
```
> Use `npx prisma migrate dev --name init` if you want versioned migrations instead.

### 4. Seed demo data
```bash
node src/seed.js
```
This creates the org, admin + staff accounts, full floor plan, and 3 demo queue entries.

### 5. Start the server
```bash
npm start
# or for auto-reload during development:
npm run dev
```

Open http://localhost:3000

**Login credentials (seeded):**
- Admin: `admin@spicegarden.com` / `Admin1234!`
- Staff: `staff@spicegarden.com` / `Staff1234!`

---

## Deploy to Railway (recommended for UAT)

Railway gives you a live HTTPS URL in ~3 minutes.

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/tableflow.git
git push -u origin main
```

### 2. Create a Railway project
1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your repository

### 3. Add a Postgres database
In Railway dashboard: **New** → **Database** → **Add PostgreSQL**  
Railway auto-sets `DATABASE_URL` in your service's environment.

### 4. Set environment variables
In Railway dashboard → your service → **Variables**:
```
JWT_SECRET=<your 128-char hex string>
GROQ_API_KEY=<your groq key>
NODE_ENV=staging
```

### 5. Deploy
Railway auto-deploys on every `git push`. The `railway.toml` tells it to run migrations then start the server.

### 6. Run the seed script once
In Railway dashboard → your service → **Shell**:
```bash
node src/seed.js
```

Your staging URL will look like: `https://tableflow-production-xxxx.up.railway.app`

---

## Deploy to Render (alternative)

1. Go to [render.com](https://render.com) → **New Web Service** → connect GitHub repo
2. **Build command:** `npm install && npx prisma generate`
3. **Start command:** `npx prisma migrate deploy && node src/server.js`
4. Add a **PostgreSQL** database from Render dashboard
5. Set env vars: `DATABASE_URL`, `JWT_SECRET`, `GROQ_API_KEY`, `NODE_ENV=staging`
6. After first deploy, open **Shell** and run `node src/seed.js`

---

## Project structure

```
tableflow/
├── prisma/
│   └── schema.prisma         # Database schema (6 models)
├── src/
│   ├── server.js             # Express app, routes, static serving
│   ├── seed.js               # Demo data seeder
│   ├── middleware/
│   │   └── auth.js           # JWT verify, requireAuth, requireAdmin
│   └── routes/
│       ├── auth.js           # POST /api/auth/login, /register, GET /me
│       ├── tables.js         # GET/PATCH /api/tables, POST /api/tables/:id/clear
│       ├── queue.js          # GET/POST/DELETE /api/queue, /join, /assign, /auto-assign
│       └── llm.js            # POST /api/llm-assign (Groq, server-side only)
├── public/
│   └── index.html            # Single-page frontend (all CSS + JS inline)
├── .env.example
├── railway.toml
├── UAT-SCENARIOS.md
└── README.md
```

---

## API reference

All `/api/` routes (except `/api/queue/join` and `/api/queue/status`) require:
```
Authorization: Bearer <jwt>
```

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Returns JWT |
| POST | `/api/auth/register` | None | Create user + add to org |
| GET | `/api/auth/me` | Bearer | Current user info |
| GET | `/api/tables` | Bearer | All tables for org |
| PATCH | `/api/tables/:id` | Bearer | Update status / guest |
| POST | `/api/tables/:id/clear` | Bearer | Vacate → cleaning |
| POST | `/api/queue/join` | None | Customer joins queue, returns session token |
| GET | `/api/queue/status?token=` | None | Customer polls own status |
| GET | `/api/queue` | Bearer | Full queue list |
| DELETE | `/api/queue/:id` | Bearer | Remove customer |
| POST | `/api/queue/assign` | Bearer | Seat customer at table |
| POST | `/api/queue/auto-assign` | Bearer | Rule-based bulk assign |
| POST | `/api/llm-assign` | Bearer | LLM-powered assign (Groq) |

---

## Resetting staging data

To wipe and re-seed between UAT sessions:
```bash
# In Railway or Render shell:
npx prisma migrate reset --force  # drops all data, re-runs migrations
node src/seed.js                  # re-seeds demo data
```
