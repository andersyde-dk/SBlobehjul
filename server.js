const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// ── Mapper ────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ── Database ──────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'shop.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    desc TEXT DEFAULT '',
    price INTEGER NOT NULL,
    age TEXT DEFAULT '–',
    color TEXT DEFAULT '–',
    cond TEXT DEFAULT 'God stand',
    sold INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    images TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO settings VALUES ('front_views', '0');
`);

// Indsæt demo-produkter hvis databasen er tom
const count = db.prepare('SELECT COUNT(*) as c FROM products').get();
if (count.c === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, desc, price, age, color, cond, sold)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('Sort løbehjul', 'Justerbar styrehøjde, nye dæk. Passer til børn fra 6 år. God stand.', 149, '6–12 år', 'Sort', 'God stand', 0);
  insert.run('Blåt løbehjul', 'Lidt brugt men i god stand. Perfekt til børn 6–10 år.', 99, '6–10 år', 'Blå', 'Brugt men funktionel', 0);
  insert.run('Rødt 3-hjulet', '3-hjulet løbehjul til de mindste. Meget stabilt.', 79, '2–5 år', 'Rød', 'God stand', 1);
}

// ── Billedupload ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Kun billeder tilladt'), ok);
  }
});

// ── Middleware ────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Hjælpefunktioner ──────────────────────────────────────
function parseProduct(p) {
  return { ...p, sold: p.sold === 1, images: JSON.parse(p.images || '[]') };
}

// ── API-ruter ─────────────────────────────────────────────

// GET alle produkter
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json(products.map(parseProduct));
});

// GET enkelt produkt + tæl visning
app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Ikke fundet' });
  db.prepare('UPDATE products SET views = views + 1 WHERE id = ?').run(p.id);
  res.json(parseProduct(p));
});

// POST nyt produkt
app.post('/api/products', (req, res) => {
  const { name, desc, price, age, color, cond } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Navn og pris er påkrævet' });
  const result = db.prepare(`
    INSERT INTO products (name, desc, price, age, color, cond)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, desc || '', price, age || '–', color || '–', cond || 'God stand');
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.json(parseProduct(p));
});

// PUT opdater produkt
app.put('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Ikke fundet' });
  const { name, desc, price, age, color, cond, sold } = req.body;
  db.prepare(`
    UPDATE products SET
      name = ?, desc = ?, price = ?, age = ?, color = ?, cond = ?, sold = ?
    WHERE id = ?
  `).run(
    name ?? p.name,
    desc ?? p.desc,
    price ?? p.price,
    age ?? p.age,
    color ?? p.color,
    cond ?? p.cond,
    sold !== undefined ? (sold ? 1 : 0) : p.sold,
    p.id
  );
  res.json(parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(p.id)));
});

// DELETE produkt
app.delete('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Ikke fundet' });
  // Slet billeder fra disk
  const images = JSON.parse(p.images || '[]');
  images.forEach(img => {
    const fp = path.join(UPLOADS_DIR, path.basename(img));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// POST upload billeder til et produkt
app.post('/api/products/:id/images', upload.array('images', 10), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Ikke fundet' });
  const existing = JSON.parse(p.images || '[]');
  const newImages = req.files.map(f => `/uploads/${f.filename}`);
  const all = [...existing, ...newImages];
  db.prepare('UPDATE products SET images = ? WHERE id = ?').run(JSON.stringify(all), p.id);
  res.json({ images: all });
});

// DELETE enkelt billede
app.delete('/api/products/:id/images', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Ikke fundet' });
  const { url } = req.body;
  const images = JSON.parse(p.images || '[]').filter(i => i !== url);
  const fp = path.join(UPLOADS_DIR, path.basename(url));
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  db.prepare('UPDATE products SET images = ? WHERE id = ?').run(JSON.stringify(images), p.id);
  res.json({ images });
});

// Forside-visninger
app.post('/api/stats/front-view', (req, res) => {
  db.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'front_views'").run();
  const val = db.prepare("SELECT value FROM settings WHERE key = 'front_views'").get();
  res.json({ front_views: parseInt(val.value) });
});

app.get('/api/stats', (req, res) => {
  const val = db.prepare("SELECT value FROM settings WHERE key = 'front_views'").get();
  res.json({ front_views: parseInt(val.value) });
});

// ── Forside ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'scootshop.html'));
});

// ── Start server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ScootShop kører på http://localhost:${PORT}`);
});
