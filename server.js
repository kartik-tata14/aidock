const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Database mode: Turso (production) or SQLite file (local dev)
const USE_LOCAL_DB = process.env.USE_LOCAL_DB === 'true' || !process.env.TURSO_DATABASE_URL;

let db;
let dbInitialized = false;
let dbInitPromise = null;

// Ensure database is initialized (for serverless)
async function ensureDb() {
  if (dbInitialized) return;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await initDatabase();
      await initSchema();
      dbInitialized = true;
    })();
  }
  await dbInitPromise;
}

// ===== Database abstraction layer =====
// Normalizes sql.js and @libsql/client interfaces

async function initDatabase() {
  if (USE_LOCAL_DB) {
    // Local development with sql.js
    const initSqlJs = require('sql.js');
    const fs = require('fs');
    const DB_PATH = path.join(__dirname, 'aidock.db');
    const SQL = await initSqlJs();
    
    if (fs.existsSync(DB_PATH)) {
      db = new SQL.Database(fs.readFileSync(DB_PATH));
    } else {
      db = new SQL.Database();
    }
    
    // Wrap sql.js methods for async compatibility
    const origRun = db.run.bind(db);
    const origExec = db.exec.bind(db);
    
    db.execute = async (sql, params = []) => {
      // Convert ? placeholders for sql.js which uses positional $1, $2, etc. or array
      try {
        const result = origExec(sql, params);
        if (result.length === 0) return { rows: [] };
        // Convert sql.js format to standard format
        const cols = result[0].columns;
        const rows = result[0].values.map(vals => {
          const obj = {};
          cols.forEach((c, i) => obj[c] = vals[i]);
          return obj;
        });
        return { rows };
      } catch (e) {
        // run() for INSERT/UPDATE/DELETE
        origRun(sql, params);
        return { rows: [] };
      }
    };
    
    db.saveToFile = () => {
      const fs = require('fs');
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    };
    
    console.log('📁 Using local SQLite database');
  } else {
    // Production with Turso
    const { createClient } = require('@libsql/client');
    
    const tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    
    // Wrap Turso client to match our db.execute(sql, params) interface
    // @libsql/client expects { sql, args } object format
    db = {
      execute: async (sql, params = []) => {
        try {
          const result = await tursoClient.execute({ sql, args: params });
          return { rows: result.rows };
        } catch (err) {
          console.error('Turso execute error:', err.message, '| SQL:', sql.substring(0, 100));
          throw err;
        }
      },
      saveToFile: () => {} // No-op for Turso (auto-persisted)
    };
    
    console.log('☁️ Connected to Turso database');
  }
}

// Helper to get last insert ID
async function getLastInsertId() {
  const result = await db.execute("SELECT last_insert_rowid() as id");
  return result.rows[0].id || result.rows[0]['last_insert_rowid()'];
}

// ===== Middleware =====
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// CORS for Chrome extension
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Ensure database is initialized for all API routes
app.use('/api', async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (err) {
    console.error('Database initialization error:', err);
    res.status(500).json({ error: 'Database connection failed. Please try again.' });
  }
});

// ===== Auth helpers =====
function generateToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function authMiddleware(req, res, next) {
  const token = req.cookies.aidock_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('aidock_token');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ===== Auth routes =====
const MAX_REFERRALS = 5;
const SLOTS_PER_REFERRAL = 2;
const BASE_TOOL_LIMIT = 10;

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, primary_role, secondary_role, invite_code } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await db.execute("SELECT id FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const newInviteCode = crypto.randomBytes(6).toString('hex');
    const hash = bcrypt.hashSync(password, 10);

    let referrerId = null;
    if (invite_code && typeof invite_code === 'string' && invite_code.trim()) {
      const ref = await db.execute("SELECT id FROM users WHERE invite_code = ?", [invite_code.trim()]);
      if (ref.rows.length > 0) referrerId = ref.rows[0].id;
    }

    await db.execute(
      "INSERT INTO users (name, email, password_hash, primary_role, secondary_role, invite_code, referred_by, tool_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name.trim(), email.toLowerCase().trim(), hash, (primary_role || '').trim(), (secondary_role || '').trim(), newInviteCode, referrerId, BASE_TOOL_LIMIT]
    );
    const userId = await getLastInsertId();

    if (referrerId) {
      const refCount = await db.execute("SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ?", [referrerId]);
      const currentRefs = refCount.rows[0].cnt || 0;
      if (currentRefs < MAX_REFERRALS) {
        try {
          await db.execute("INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)", [referrerId, userId]);
          await db.execute("UPDATE users SET tool_limit = MIN(tool_limit + ?, ?) WHERE id = ?",
            [SLOTS_PER_REFERRAL, BASE_TOOL_LIMIT + MAX_REFERRALS * SLOTS_PER_REFERRAL, referrerId]);
        } catch {}
      }
    }
    db.saveToFile();

    const user = { id: userId, name: name.trim(), email: email.toLowerCase().trim(), primary_role: (primary_role || '').trim(), secondary_role: (secondary_role || '').trim() };
    const token = generateToken(user);
    res.cookie('aidock_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ user, token });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const result = await db.execute("SELECT id, name, email, password_hash FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const row = result.rows[0];
    if (!bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = { id: row.id, name: row.name, email: row.email };
    const token = generateToken(user);
    res.cookie('aidock_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('aidock_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await db.execute("SELECT primary_role, secondary_role, invite_code, tool_limit, avatar FROM users WHERE id = ?", [req.user.id]);
    const row = result.rows[0] || {};
    const refResult = await db.execute("SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ?", [req.user.id]);
    const referral_count = refResult.rows[0].cnt || 0;
    res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        primary_role: row.primary_role || '',
        secondary_role: row.secondary_role || '',
        invite_code: row.invite_code || '',
        tool_limit: row.tool_limit || BASE_TOOL_LIMIT,
        referral_count,
        avatar: row.avatar || ''
      }
    });
  } catch (err) {
    console.error('Auth/me error:', err);
    res.status(500).json({ error: 'Failed to fetch user data.' });
  }
});

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const { primary_role, secondary_role } = req.body;
    await db.execute("UPDATE users SET primary_role = ?, secondary_role = ? WHERE id = ?",
      [(primary_role || '').trim(), (secondary_role || '').trim(), req.user.id]);
    db.saveToFile();
    res.json({ ok: true, primary_role: (primary_role || '').trim(), secondary_role: (secondary_role || '').trim() });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

app.put('/api/auth/avatar', authMiddleware, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: 'No avatar provided.' });
    if (!avatar.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image format.' });
    if (avatar.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'Image too large. Max 1.5MB.' });
    await db.execute("UPDATE users SET avatar = ? WHERE id = ?", [avatar, req.user.id]);
    db.saveToFile();
    res.json({ ok: true, avatar });
  } catch (err) {
    console.error('Avatar update error:', err);
    res.status(500).json({ error: 'Failed to update avatar.' });
  }
});

// ===== Tools CRUD =====
function rowToTool(r) {
  return { id: r.id, user_id: r.user_id, name: r.name, url: r.url, category: r.category, pricing: r.pricing, description: r.description, notes: r.notes, created_at: r.created_at, updated_at: r.updated_at };
}

app.get('/api/tools', authMiddleware, async (req, res) => {
  try {
    const result = await db.execute("SELECT id, user_id, name, url, category, pricing, description, notes, created_at, updated_at FROM tools WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
    const tools = result.rows.map(rowToTool);
    res.json({ tools });
  } catch (err) {
    console.error('Get tools error:', err);
    res.status(500).json({ error: 'Failed to fetch tools.' });
  }
});

app.post('/api/tools', authMiddleware, async (req, res) => {
  try {
    const { name, url, category, pricing, description, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });

    const limitResult = await db.execute("SELECT tool_limit FROM users WHERE id = ?", [req.user.id]);
    const userToolLimit = limitResult.rows[0]?.tool_limit || BASE_TOOL_LIMIT;
    const countResult = await db.execute("SELECT COUNT(*) as cnt FROM tools WHERE user_id = ?", [req.user.id]);
    const toolCount = countResult.rows[0].cnt;
    if (toolCount >= userToolLimit) {
      return res.status(403).json({ error: `Tool limit reached (${userToolLimit} slots). Invite friends to unlock more!` });
    }

    const nameNorm = name.trim().toLowerCase();
    const urlNorm = (url || '').trim().toLowerCase();
    const dup = await db.execute(
      "SELECT id FROM tools WHERE user_id = ? AND (LOWER(name) = ? OR (url != '' AND LOWER(url) = ?))",
      [req.user.id, nameNorm, urlNorm]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'This tool is already in your dock.' });
    }

    await db.execute("INSERT INTO tools (user_id, name, url, category, pricing, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.user.id, name.trim(), url || '', category || 'Other', pricing || 'Unknown', description || '', notes || '']);
    const toolId = await getLastInsertId();
    db.saveToFile();

    const result = await db.execute("SELECT id, user_id, name, url, category, pricing, description, notes, created_at, updated_at FROM tools WHERE id = ?", [toolId]);
    res.json({ tool: rowToTool(result.rows[0]) });
  } catch (err) {
    console.error('Add tool error:', err);
    res.status(500).json({ error: 'Failed to add tool.' });
  }
});

app.put('/api/tools/:id', authMiddleware, async (req, res) => {
  try {
    const { name, url, category, pricing, description, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });

    const existing = await db.execute("SELECT id FROM tools WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Tool not found.' });

    await db.execute("UPDATE tools SET name=?, url=?, category=?, pricing=?, description=?, notes=?, updated_at=datetime('now') WHERE id=? AND user_id=?",
      [name.trim(), url || '', category || 'Other', pricing || 'Unknown', description || '', notes || '', Number(req.params.id), req.user.id]);
    db.saveToFile();

    const result = await db.execute("SELECT id, user_id, name, url, category, pricing, description, notes, created_at, updated_at FROM tools WHERE id = ?", [Number(req.params.id)]);
    res.json({ tool: rowToTool(result.rows[0]) });
  } catch (err) {
    console.error('Update tool error:', err);
    res.status(500).json({ error: 'Failed to update tool.' });
  }
});

app.delete('/api/tools/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await db.execute("SELECT id FROM tools WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Tool not found.' });

    await db.execute("DELETE FROM tools WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user.id]);
    db.saveToFile();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete tool error:', err);
    res.status(500).json({ error: 'Failed to delete tool.' });
  }
});

app.post('/api/tools/import', authMiddleware, async (req, res) => {
  try {
    const { tools: toolsList } = req.body;
    if (!Array.isArray(toolsList)) return res.status(400).json({ error: 'Expected an array of tools.' });

    let count = 0;
    let skipped = 0;
    for (const t of toolsList) {
      if (!t.name) continue;
      const nameNorm = t.name.trim().toLowerCase();
      const urlNorm = (t.url || '').trim().toLowerCase();
      const existing = await db.execute(
        "SELECT id FROM tools WHERE user_id = ? AND (LOWER(name) = ? OR (url != '' AND LOWER(url) = ?))",
        [req.user.id, nameNorm, urlNorm]
      );
      if (existing.rows.length > 0) { skipped++; continue; }
      await db.execute("INSERT INTO tools (user_id, name, url, category, pricing, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [req.user.id, t.name.trim(), t.url || '', t.category || 'Other', t.pricing || 'Unknown', t.description || '', t.notes || '']);
      count++;
    }
    db.saveToFile();
    res.json({ imported: count, skipped });
  } catch (err) {
    console.error('Import tools error:', err);
    res.status(500).json({ error: 'Failed to import tools.' });
  }
});

// ===== Proxy for description fetching =====
app.get('/api/fetch-description', authMiddleware, async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL is required.' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    clearTimeout(timeout);
    if (!resp.ok) return res.status(502).json({ error: `Page returned status ${resp.status}` });
    const html = await resp.text();

    const patterns = [
      /meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
      /meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
      /meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
      /meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i,
      /meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:description["']/i,
    ];
    let desc = '';
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m && m[1] && m[1].length > 10) { desc = m[1].trim().slice(0, 300); break; }
    }
    if (!desc) {
      const ldBlocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      for (const ld of ldBlocks) {
        try {
          const d = JSON.parse(ld[1]);
          const obj = Array.isArray(d) ? d[0] : d;
          if (obj.description && obj.description.length > 10) { desc = obj.description.trim().slice(0, 300); break; }
        } catch {}
      }
    }
    if (!desc) {
      const p = html.match(/<p[^>]*>([^<]{30,})<\/p>/i);
      if (p) desc = p[1].trim().slice(0, 300);
    }

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1] : '';
    const h1Match = html.match(/<h1[^>]*>([^<]{3,})<\/h1>/i);
    const h2Matches = [...html.matchAll(/<h2[^>]*>([^<]{3,})<\/h2>/gi)].map(m => m[1]).join(' ');
    const blob = [targetUrl, pageTitle, desc, h1Match?.[1] || '', h2Matches].join(' ').toLowerCase();
    
    let domain = '';
    try { domain = new URL(targetUrl).hostname.toLowerCase(); } catch {}

    const catKeywords = [
      ['Coding & Development', ['\\bcode\\b', 'developer', 'programming', '\\bide\\b', '\\bapi\\b', '\\bsdk\\b', 'github', 'gitlab', 'bitbucket', 'coding', 'devtool', 'debug', 'compiler', 'terminal', 'repository', 'deploy', 'ci/cd', 'ci cd', 'open.?source', 'software engineer', 'vscode', 'developer tool', 'code generat', 'copilot', 'cursor', 'replit', 'codepen', 'codesandbox', 'stackblitz', '\\bnpm\\b', '\\byarn\\b', 'package manager', 'codeium', 'tabnine', 'code assist', 'code complet', 'sourcegraph', 'refactor', 'lint', 'devin', 'bolt\\.new', 'v0\\.dev', 'lovable', 'windsurf', 'aider', 'continue\\.dev', 'ai cod', 'code review', 'pull request', 'merge', 'commit', 'version control', '\\bgit\\b', 'jupyter', 'notebook', 'python', 'javascript', 'typescript', 'react', 'vue', 'angular']],
      ['Writing & Content', ['writing', 'copywriting', 'content creat', '\\bblog\\b', 'article', '\\bseo\\b', 'grammar', 'paraphrase', 'essay', 'summariz', 'translat', 'proofread', 'rewrite', 'storytell', 'copysmith', 'jasper', '\\bwriter\\b', 'grammarly', 'quillbot', 'wordtune', 'hemingway', 'copy\\.ai', 'writesonic', 'rytr', 'longshot', 'frase', 'surfer', 'clearscope', 'ai writ', 'text generat', 'content generat', 'blog post', 'marketing copy', 'ad copy', 'headlines', 'captions', 'script writ', 'email writ', 'product description', 'landing page', 'notion ai', 'compose', 'draft', 'outline', 'brainstorm', 'ideate']],
      ['Video & Images', ['video', 'image generat', 'photo', 'visual', 'animation', 'render', '3d model', '\\bfilm\\b', 'video edit', 'thumbnail', 'generate image', '\\bart\\b', 'diffusion', 'midjourney', 'dall-e', 'dall.e', 'stable diffusion', 'text to image', 'text-to-image', 'image edit', '\\breel', '\\bclip', 'short.?form', 'content creator', 'tiktok', 'instagram', 'youtube', 'motion graphic', 'screen record', 'subtitle', 'caption', 'runway', 'pika', 'sora', 'leonardo', 'ideogram', 'playground ai', 'clipdrop', 'remove\\.bg', 'upscale', 'ai video', 'ai image', 'ai art', 'ai photo', 'generative art', 'img2img', 'txt2img', 'luma', 'heygen', 'synthesia', 'descript', 'kapwing', 'canva', 'adobe firefly', 'invideo', 'pictory', 'fliki', 'lumen5', 'video ai', 'avatar', 'deepfake', 'face swap', 'background remov', 'photo edit', 'enhance', 'colorize', 'restore']],
      ['Audio', ['audio', 'music', 'voice', 'speech', 'podcast', 'sound', 'transcri', '\\btts\\b', 'text-to-speech', 'text to speech', '\\bsong\\b', 'voice clone', 'whisper', 'narrat', 'elevenlabs', 'murf', 'play\\.ht', 'resemble', 'descript', 'otter', 'fireflies', 'speechify', 'natural reader', 'voiceover', 'dubbing', 'audio generat', 'suno', 'udio', 'ai music', 'music generat', 'beat', 'melody', 'soundtrack', 'noise remov', 'audio enhance', 'vocal', 'podcast edit', 'audio transcri', 'speech to text', 'speech-to-text', '\\basr\\b', 'dictation', 'caption']],
      ['Design & UI', ['design', 'figma', '\\bui\\b', '\\bux\\b', 'prototype', 'wireframe', 'layout', 'graphic', '\\blog\\b', 'canva', 'illustration', 'mockup', 'brand', 'color palette', 'adobe', 'sketch', 'framer', 'webflow', 'bubble', 'website build', 'landing page', 'template', 'uizard', 'galileo ai', 'magician', 'vizcom', 'diagram', 'dribbble', 'behance', 'ai design', 'design tool', 'creative tool', 'visual design', 'product design', 'user interface', 'user experience', 'responsive', 'mobile design', 'app design']],
      ['Chatbots & Assistants', ['chatbot', 'chat ai', 'conversational ai', '\\bgpt\\b', '\\bllm\\b', 'ai assistant', 'claude', 'gemini', 'openai', 'anthropic', 'chatgpt', 'personal ai', 'ask ai', 'character\\.ai', 'pi\\.ai', 'poe', 'perplexity', 'you\\.com', 'bing chat', 'bard', 'ai chat', 'chat with', 'talk to ai', 'ask question', 'ai companion', 'virtual assistant', 'conversational', 'dialogue', 'chat interface', 'ai model', 'language model', 'mistral', 'llama', 'groq', 'together ai', 'replicate', 'hugging face', 'ollama', 'gpt-4', 'gpt-3', 'gpt4', 'gpt3', 'claude-3', 'gemini pro', 'chat completion']],
      ['Workflow Automation', ['automat', 'workflow', 'zapier', 'integrat', 'no-code', 'low-code', 'pipeline', 'trigger', 'schedule', '\\brpa\\b', 'productiv', 'make\\.com', 'ifttt', '\\bn8n\\b', '\\bagent\\b', 'task manag', 'project manag', 'notion', 'airtable', 'monday', 'asana', 'clickup', 'ai agent', 'autonomous', 'multi-agent', 'crew ai', 'langchain', 'auto-gpt', 'autogen', 'ai workflow', 'orchestrat', 'batch process', 'bulk', 'streamlin', 'efficien', 'time sav', 'automate task', 'repetitive', 'routine', 'ai-powered workflow']],
      ['Research & Analysis', ['research', 'insight', 'knowledge', '\\bpaper\\b', 'academic', 'citation', 'scholar', 'science', 'arxiv', 'semantic', 'literature', 'peer review', 'consensus', 'elicit', 'scite', 'semantic scholar', 'connected papers', 'research rabbit', 'paperpal', 'explainpaper', 'scispace', 'research ai', 'literature review', 'find paper', 'ai research', 'discover', 'explore', 'synthesis', 'evidence', 'study']],
      ['Data & Analytics', ['\\bdata\\b', 'dashboard', 'analytics', 'visualiz', 'database', '\\bsql\\b', '\\bchart\\b', 'metric', 'monitor', 'spreadsheet', 'bi tool', 'tableau', 'dataset', 'excel', 'google sheet', 'looker', 'power bi', 'domo', 'amplitude', 'mixpanel', 'segment', 'ai analytics', 'data analysis', 'data science', 'machine learning', '\\bml\\b', 'predict', 'forecast', 'trend', 'report', 'insight', 'etl', 'data pipeline', 'business intelligence', 'kpi', 'conversion', 'funnel', 'cohort']]
    ];
    
    let suggestedCategory = 'Other';
    let maxScore = 0;
    
    for (const [cat, keywords] of catKeywords) {
      let score = 0;
      for (const k of keywords) {
        const regex = new RegExp(k, 'gi');
        const domainMatches = (domain.match(regex) || []).length;
        const blobMatches = (blob.match(regex) || []).length;
        score += domainMatches * 3 + blobMatches;
      }
      if (score > maxScore) { maxScore = score; suggestedCategory = cat; }
    }

    res.json({ description: desc, suggestedCategory });
  } catch (err) {
    console.error('fetch-description error:', err.message);
    res.status(502).json({ error: 'Failed to fetch description: ' + (err.message || 'Unknown error') });
  }
});

// ===== Stacks CRUD =====
function rowToStack(r) {
  return { id: r.id, user_id: r.user_id, name: r.name, description: r.description, color: r.color, icon: r.icon, created_at: r.created_at, views: r.views || 0, clones: r.clones || 0, share_slug: r.share_slug || null };
}

app.get('/api/stacks', authMiddleware, async (req, res) => {
  try {
    const result = await db.execute("SELECT id, user_id, name, description, color, icon, created_at, views, clones, share_slug FROM stacks WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
    const stacks = result.rows.map(rowToStack);
    for (const s of stacks) {
      const tr = await db.execute("SELECT tool_id, description, notes FROM stack_tools WHERE stack_id = ? ORDER BY sort_order, added_at", [s.id]);
      s.tool_ids = tr.rows.map(r => r.tool_id);
      s.stack_tool_meta = {};
      for (const r of tr.rows) {
        s.stack_tool_meta[r.tool_id] = { description: r.description || '', notes: r.notes || '' };
      }
    }
    res.json({ stacks });
  } catch (err) {
    console.error('Get stacks error:', err);
    res.status(500).json({ error: 'Failed to fetch stacks.' });
  }
});

app.post('/api/stacks', authMiddleware, async (req, res) => {
  try {
    const { name, description, color, icon } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Stack name is required.' });
    await db.execute("INSERT INTO stacks (user_id, name, description, color, icon) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, name.trim(), description || '', color || '#0a84ff', icon || '📂']);
    const stackId = await getLastInsertId();
    db.saveToFile();
    const result = await db.execute("SELECT id, user_id, name, description, color, icon, created_at, views, clones, share_slug FROM stacks WHERE id = ?", [stackId]);
    const stack = rowToStack(result.rows[0]);
    stack.tool_ids = [];
    res.json({ stack });
  } catch (err) {
    console.error('Create stack error:', err);
    res.status(500).json({ error: 'Failed to create stack.' });
  }
});

app.put('/api/stacks/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, color, icon } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Stack name is required.' });
    const existing = await db.execute("SELECT id FROM stacks WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Stack not found.' });
    await db.execute("UPDATE stacks SET name=?, description=?, color=?, icon=? WHERE id=? AND user_id=?",
      [name.trim(), description || '', color || '#0a84ff', icon || '📂', Number(req.params.id), req.user.id]);
    db.saveToFile();
    const result = await db.execute("SELECT id, user_id, name, description, color, icon, created_at, views, clones, share_slug FROM stacks WHERE id = ?", [Number(req.params.id)]);
    const stack = rowToStack(result.rows[0]);
    const tr = await db.execute("SELECT tool_id, description, notes FROM stack_tools WHERE stack_id = ? ORDER BY sort_order, added_at", [stack.id]);
    stack.tool_ids = tr.rows.map(r => r.tool_id);
    stack.stack_tool_meta = {};
    for (const r of tr.rows) {
      stack.stack_tool_meta[r.tool_id] = { description: r.description || '', notes: r.notes || '' };
    }
    res.json({ stack });
  } catch (err) {
    console.error('Update stack error:', err);
    res.status(500).json({ error: 'Failed to update stack.' });
  }
});

app.delete('/api/stacks/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await db.execute("SELECT id FROM stacks WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Stack not found.' });
    await db.execute("DELETE FROM stack_tools WHERE stack_id = ?", [Number(req.params.id)]);
    await db.execute("DELETE FROM stacks WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user.id]);
    db.saveToFile();
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete stack error:', err);
    res.status(500).json({ error: 'Failed to delete stack.' });
  }
});

app.post('/api/stacks/:id/tools', authMiddleware, async (req, res) => {
  try {
    const { tool_id } = req.body;
    if (!tool_id) return res.status(400).json({ error: 'tool_id is required.' });
    const stackOwned = await db.execute("SELECT id FROM stacks WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (stackOwned.rows.length === 0) return res.status(404).json({ error: 'Stack not found.' });
    const toolOwned = await db.execute("SELECT id FROM tools WHERE id = ? AND user_id = ?", [tool_id, req.user.id]);
    if (toolOwned.rows.length === 0) return res.status(404).json({ error: 'Tool not found.' });
    const toolData = await db.execute("SELECT description, notes FROM tools WHERE id = ?", [tool_id]);
    const toolDesc = toolData.rows[0]?.description || '';
    const toolNotes = toolData.rows[0]?.notes || '';
    try {
      await db.execute("INSERT INTO stack_tools (stack_id, tool_id, description, notes) VALUES (?, ?, ?, ?)", [Number(req.params.id), Number(tool_id), toolDesc, toolNotes]);
      db.saveToFile();
    } catch (e) {
      return res.status(409).json({ error: 'Tool already in this stack.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Add tool to stack error:', err);
    res.status(500).json({ error: 'Failed to add tool to stack.' });
  }
});

app.put('/api/stacks/:id/tools/:toolId', authMiddleware, async (req, res) => {
  try {
    const stackOwned = await db.execute("SELECT id FROM stacks WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user.id]);
    if (stackOwned.rows.length === 0) return res.status(404).json({ error: 'Stack not found.' });
    const { description, notes } = req.body;
    await db.execute("UPDATE stack_tools SET description = ?, notes = ? WHERE stack_id = ? AND tool_id = ?",
      [description || '', notes || '', Number(req.params.id), Number(req.params.toolId)]);
    db.saveToFile();
    res.json({ ok: true });
  } catch (err) {
    console.error('Update stack tool error:', err);
    res.status(500).json({ error: 'Failed to update stack tool.' });
  }
});

app.delete('/api/stacks/:id/tools/:toolId', authMiddleware, async (req, res) => {
  try {
    await db.execute("DELETE FROM stack_tools WHERE stack_id = ? AND tool_id = ?", [Number(req.params.id), Number(req.params.toolId)]);
    db.saveToFile();
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove tool from stack error:', err);
    res.status(500).json({ error: 'Failed to remove tool from stack.' });
  }
});

app.post('/api/stacks/:id/share', authMiddleware, async (req, res) => {
  try {
    const existing = await db.execute("SELECT id, share_slug FROM stacks WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Stack not found.' });
    let slug = existing.rows[0].share_slug;
    if (!slug) {
      slug = crypto.randomBytes(6).toString('base64url');
      await db.execute("UPDATE stacks SET share_slug = ? WHERE id = ?", [slug, Number(req.params.id)]);
      db.saveToFile();
    }
    res.json({ slug });
  } catch (err) {
    console.error('Share stack error:', err);
    res.status(500).json({ error: 'Failed to share stack.' });
  }
});

app.delete('/api/stacks/:id/share', authMiddleware, async (req, res) => {
  try {
    await db.execute("UPDATE stacks SET share_slug = NULL WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user.id]);
    db.saveToFile();
    res.json({ ok: true });
  } catch (err) {
    console.error('Unshare stack error:', err);
    res.status(500).json({ error: 'Failed to unshare stack.' });
  }
});

app.get('/api/stacks/public/:slug', async (req, res) => {
  try {
    const result = await db.execute("SELECT id, user_id, name, description, color, icon, created_at, views, clones, share_slug FROM stacks WHERE share_slug = ?", [req.params.slug]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stack not found or not shared.' });
    const stack = rowToStack(result.rows[0]);
    await db.execute("UPDATE stacks SET views = views + 1 WHERE id = ?", [stack.id]);
    stack.views += 1;
    db.saveToFile();
    const uResult = await db.execute("SELECT name, avatar FROM users WHERE id = ?", [stack.user_id]);
    stack.creator_name = uResult.rows[0]?.name || 'Unknown';
    stack.creator_avatar = uResult.rows[0]?.avatar || null;
    const tr = await db.execute("SELECT t.id, t.name, t.url, t.category, t.pricing, st.description, st.notes, t.description as t_desc, t.notes as t_notes FROM tools t JOIN stack_tools st ON t.id = st.tool_id WHERE st.stack_id = ? ORDER BY st.sort_order, st.added_at", [stack.id]);
    stack.tools = tr.rows.map(r => ({ id: r.id, name: r.name, url: r.url, category: r.category, pricing: r.pricing, description: r.description || r.t_desc || '', notes: r.notes || r.t_notes || '' }));
    delete stack.user_id;
    res.json({ stack });
  } catch (err) {
    console.error('Get public stack error:', err);
    res.status(500).json({ error: 'Failed to fetch stack.' });
  }
});

app.post('/api/stacks/clone/:slug', authMiddleware, async (req, res) => {
  try {
    const result = await db.execute("SELECT id, user_id, name, description, color, icon, created_at, views, clones, share_slug FROM stacks WHERE share_slug = ?", [req.params.slug]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stack not found.' });
    const src = rowToStack(result.rows[0]);
    await db.execute("INSERT INTO stacks (user_id, name, description, color, icon) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, src.name, src.description || '', src.color || '#0a84ff', src.icon || '📂']);
    const newId = await getLastInsertId();
    const limitResult = await db.execute("SELECT tool_limit FROM users WHERE id = ?", [req.user.id]);
    const userToolLimit = limitResult.rows[0]?.tool_limit || BASE_TOOL_LIMIT;
    const countResult = await db.execute("SELECT COUNT(*) as cnt FROM tools WHERE user_id = ?", [req.user.id]);
    let currentToolCount = countResult.rows[0].cnt;
    let skipped = 0;

    const tr = await db.execute("SELECT t.name, t.url, t.category, t.pricing, t.description, t.notes, st.description AS st_desc, st.notes AS st_notes FROM tools t JOIN stack_tools st ON t.id = st.tool_id WHERE st.stack_id = ? ORDER BY st.sort_order, st.added_at", [src.id]);
    for (const r of tr.rows) {
      const existing = await db.execute("SELECT id FROM tools WHERE user_id = ? AND (LOWER(name) = ? OR (url != '' AND LOWER(url) = ?))",
        [req.user.id, r.name.toLowerCase(), (r.url || '').toLowerCase()]);
      let toolId;
      if (existing.rows.length > 0) {
        toolId = existing.rows[0].id;
      } else {
        if (currentToolCount >= userToolLimit) { skipped++; continue; }
        await db.execute("INSERT INTO tools (user_id, name, url, category, pricing, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [req.user.id, r.name, r.url || '', r.category || 'Other', r.pricing || 'Unknown', r.description || '', r.notes || '']);
        toolId = await getLastInsertId();
        currentToolCount++;
      }
      try { await db.execute("INSERT INTO stack_tools (stack_id, tool_id, description, notes) VALUES (?, ?, ?, ?)", [newId, toolId, r.st_desc || '', r.st_notes || '']); } catch {}
    }
    await db.execute("UPDATE stacks SET clones = clones + 1 WHERE id = ?", [src.id]);
    db.saveToFile();
    const newResult = await db.execute("SELECT id, user_id, name, description, color, icon, created_at, views, clones, share_slug FROM stacks WHERE id = ?", [newId]);
    const newStack = rowToStack(newResult.rows[0]);
    const ntr = await db.execute("SELECT tool_id FROM stack_tools WHERE stack_id = ?", [newId]);
    newStack.tool_ids = ntr.rows.map(r => r.tool_id);
    res.json({ stack: newStack, skipped });
  } catch (err) {
    console.error('Clone stack error:', err);
    res.status(500).json({ error: 'Failed to clone stack.' });
  }
});

// ===== Friends / Social =====
app.get('/api/friends', authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;
    const friendIds = new Set();

    const referred = await db.execute("SELECT referred_id FROM referrals WHERE referrer_id = ?", [myId]);
    referred.rows.forEach(r => friendIds.add(r.referred_id));

    const me = await db.execute("SELECT referred_by FROM users WHERE id = ?", [myId]);
    if (me.rows[0]?.referred_by) friendIds.add(me.rows[0].referred_by);

    if (friendIds.size === 0) return res.json({ friends: [] });

    const friends = [];
    for (const fid of friendIds) {
      const u = await db.execute("SELECT id, name, primary_role, secondary_role, avatar FROM users WHERE id = ?", [fid]);
      if (u.rows.length === 0) continue;
      const row = u.rows[0];
      const tc = await db.execute("SELECT COUNT(*) as cnt FROM tools WHERE user_id = ?", [fid]);
      const toolCount = tc.rows[0].cnt || 0;
      const sc = await db.execute("SELECT COUNT(*) as cnt FROM stacks WHERE user_id = ?", [fid]);
      const stackCount = sc.rows[0].cnt || 0;
      const sharedCount = await db.execute("SELECT COUNT(*) as cnt FROM stacks WHERE user_id = ? AND share_slug IS NOT NULL AND share_slug != ''", [fid]);
      const sharedStackCount = sharedCount.rows[0].cnt || 0;
      friends.push({
        id: row.id,
        name: row.name || '',
        primary_role: row.primary_role || '',
        secondary_role: row.secondary_role || '',
        avatar: row.avatar || '',
        tool_count: toolCount,
        stack_count: stackCount,
        shared_stack_count: sharedStackCount
      });
    }
    res.json({ friends });
  } catch (err) {
    console.error('Get friends error:', err);
    res.status(500).json({ error: 'Failed to fetch friends.' });
  }
});

app.get('/api/friends/:id/profile', authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;
    const friendId = Number(req.params.id);

    const friendIds = new Set();
    const referred = await db.execute("SELECT referred_id FROM referrals WHERE referrer_id = ?", [myId]);
    referred.rows.forEach(r => friendIds.add(r.referred_id));
    const me = await db.execute("SELECT referred_by FROM users WHERE id = ?", [myId]);
    if (me.rows[0]?.referred_by) friendIds.add(me.rows[0].referred_by);

    if (!friendIds.has(friendId)) return res.status(403).json({ error: 'Not your friend.' });

    const u = await db.execute("SELECT id, name, primary_role, secondary_role, avatar FROM users WHERE id = ?", [friendId]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const row = u.rows[0];

    const toolResult = await db.execute("SELECT id, user_id, name, url, category, pricing, description, notes, created_at, updated_at FROM tools WHERE user_id = ? ORDER BY created_at DESC", [friendId]);
    const tools = toolResult.rows.map(rowToTool);

    const stackResult = await db.execute("SELECT id, user_id, name, description, color, icon, created_at, views, clones, share_slug FROM stacks WHERE user_id = ? AND share_slug IS NOT NULL AND share_slug != '' ORDER BY created_at DESC", [friendId]);
    const stacks = stackResult.rows.map(rowToStack);
    for (const s of stacks) {
      const tr = await db.execute("SELECT t.id, t.name, t.url, t.category, t.pricing, t.description FROM tools t JOIN stack_tools st ON t.id = st.tool_id WHERE st.stack_id = ? ORDER BY st.sort_order, st.added_at", [s.id]);
      s.tools = tr.rows.map(r => ({ id: r.id, name: r.name, url: r.url, category: r.category, pricing: r.pricing, description: r.description || '' }));
    }

    res.json({
      friend: { id: row.id, name: row.name || '', primary_role: row.primary_role || '', secondary_role: row.secondary_role || '', avatar: row.avatar || '' },
      tools,
      stacks
    });
  } catch (err) {
    console.error('Get friend profile error:', err);
    res.status(500).json({ error: 'Failed to fetch friend profile.' });
  }
});

app.get('/api/referrer/:code', async (req, res) => {
  try {
    const code = (req.params.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Missing invite code' });
    const result = await db.execute("SELECT name, primary_role, avatar FROM users WHERE invite_code = ?", [code]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }
    const row = result.rows[0];
    const firstName = (row.name || '').split(' ')[0];
    res.json({ name: firstName, role: row.primary_role || '', avatar: row.avatar || '' });
  } catch (err) {
    console.error('Referrer lookup error:', err);
    res.status(500).json({ error: 'Failed to lookup referrer.' });
  }
});

// ===== Page routes =====
app.get('/auth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));
app.get('/join/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invite.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/dashboard/*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/stack/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shared-stack.html')));

// ===== Initialize database schema =====
async function initSchema() {
  // Users table
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    primary_role TEXT DEFAULT '',
    secondary_role TEXT DEFAULT '',
    invite_code TEXT,
    referred_by INTEGER,
    tool_limit INTEGER DEFAULT 10,
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now'))
  )`);
  
  // Add columns if missing (migrations)
  const migrations = [
    "ALTER TABLE users ADD COLUMN primary_role TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN secondary_role TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN invite_code TEXT",
    "ALTER TABLE users ADD COLUMN referred_by INTEGER",
    "ALTER TABLE users ADD COLUMN tool_limit INTEGER DEFAULT 10",
    "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''"
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch {}
  }
  
  try { await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code)"); } catch {}
  
  // Referrals table
  await db.execute(`CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL,
    referred_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    UNIQUE(referrer_id, referred_id),
    FOREIGN KEY (referrer_id) REFERENCES users(id),
    FOREIGN KEY (referred_id) REFERENCES users(id)
  )`);
  
  // Backfill invite codes
  const noCode = await db.execute("SELECT id FROM users WHERE invite_code IS NULL OR invite_code = ''");
  for (const row of noCode.rows) {
    await db.execute("UPDATE users SET invite_code = ? WHERE id = ?", [crypto.randomBytes(6).toString('hex'), row.id]);
  }
  
  // Tools table
  await db.execute(`CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT DEFAULT '',
    category TEXT DEFAULT 'Other',
    pricing TEXT DEFAULT 'Unknown',
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  
  // Stacks table
  await db.execute(`CREATE TABLE IF NOT EXISTS stacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#0a84ff',
    icon TEXT DEFAULT '📂',
    share_slug TEXT UNIQUE,
    views INTEGER DEFAULT 0,
    clones INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  
  const stackMigrations = [
    "ALTER TABLE stacks ADD COLUMN share_slug TEXT",
    "ALTER TABLE stacks ADD COLUMN views INTEGER DEFAULT 0",
    "ALTER TABLE stacks ADD COLUMN clones INTEGER DEFAULT 0"
  ];
  for (const sql of stackMigrations) {
    try { await db.execute(sql); } catch {}
  }
  try { await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stacks_slug ON stacks(share_slug)"); } catch {}
  
  // Stack tools junction table
  await db.execute(`CREATE TABLE IF NOT EXISTS stack_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stack_id INTEGER NOT NULL,
    tool_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT (datetime('now')),
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    FOREIGN KEY (stack_id) REFERENCES stacks(id) ON DELETE CASCADE,
    FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
    UNIQUE(stack_id, tool_id)
  )`);
  
  const stackToolMigrations = [
    "ALTER TABLE stack_tools ADD COLUMN description TEXT DEFAULT ''",
    "ALTER TABLE stack_tools ADD COLUMN notes TEXT DEFAULT ''"
  ];
  for (const sql of stackToolMigrations) {
    try { await db.execute(sql); } catch {}
  }
  
  // Indexes
  try { await db.execute("CREATE INDEX IF NOT EXISTS idx_tools_user ON tools(user_id)"); } catch {}
  try { await db.execute("CREATE INDEX IF NOT EXISTS idx_stacks_user ON stacks(user_id)"); } catch {}
  try { await db.execute("CREATE INDEX IF NOT EXISTS idx_stack_tools_stack ON stack_tools(stack_id)"); } catch {}
  
  db.saveToFile();
}

// ===== Start =====
async function start() {
  await initDatabase();
  await initSchema();
  
  app.listen(PORT, () => {
    console.log(`\n  ⬡ AIDock server running at http://localhost:${PORT}\n`);
  });
}

// Export for Vercel serverless
module.exports = app;

// Start server if running directly (not imported by Vercel)
if (require.main === module) {
  start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
}
