require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '256kb' }));

// ── CORS (allow all origins in dev/staging; lock down in prod) ───────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/tables',     require('./routes/tables'));
app.use('/api/queue',      require('./routes/queue'));
app.use('/api/llm-assign', require('./routes/llm'));

// ── Staging banner injection ──────────────────────────────────────────────────
// Injects a yellow "STAGING" bar into the HTML for non-production deploys
const STAGING_BANNER = `
<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#d29922;color:#0d1117;text-align:center;font-size:12px;font-weight:600;padding:4px;letter-spacing:0.5px">
  ⚠ STAGING ENVIRONMENT — not for production use
</div>
<style>#nav{top:24px !important}</style>`;

function injectStagingBanner(html) {
  return html.replace('<body>', '<body>' + STAGING_BANNER);
}

// ── Serve the frontend ────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.get('/', (req, res) => {
  const file = path.join(PUBLIC_DIR, 'index.html');
  if (process.env.NODE_ENV === 'staging') {
    const fs = require('fs');
    const html = fs.readFileSync(file, 'utf8');
    res.send(injectStagingBanner(html));
  } else {
    res.sendFile(file);
  }
});

app.use(express.static(PUBLIC_DIR));

// ── 404 fallback (SPA) ───────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`\n🍽  TableFlow running → http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  if (!process.env.GROQ_API_KEY) {
    console.warn('   ⚠  GROQ_API_KEY not set — LLM assign will be unavailable');
  }
});
