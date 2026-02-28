import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, 'podcasts.db');

let SQL;
let db;

// Initialize database
export async function initDatabase() {
  SQL = await initSqlJs();

  // Load existing database or create new one
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create table if not exists
  db.run(`
    CREATE TABLE IF NOT EXISTS podcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      segments TEXT NOT NULL,
      cost_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration für bestehende DBs
  try { db.run(`ALTER TABLE podcasts ADD COLUMN cost_data TEXT`); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS requested_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      request_count INTEGER DEFAULT 1,
      first_requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate existing URLs: strip query parameters for consistent lookup
  const urlsToMigrate = [];
  const migrateStmt = db.prepare('SELECT id, url FROM podcasts');
  while (migrateStmt.step()) {
    urlsToMigrate.push(migrateStmt.getAsObject());
  }
  migrateStmt.free();
  for (const row of urlsToMigrate) {
    const normalized = normalizeUrl(row.url);
    if (normalized !== row.url) {
      try {
        db.run('UPDATE podcasts SET url = ? WHERE id = ?', [normalized, row.id]);
        console.log(`[DB] Migrated podcast URL: ${row.url} -> ${normalized}`);
      } catch {}
    }
  }

  // Also migrate requested_urls
  const reqToMigrate = [];
  const reqMigrateStmt = db.prepare('SELECT id, url FROM requested_urls');
  while (reqMigrateStmt.step()) {
    reqToMigrate.push(reqMigrateStmt.getAsObject());
  }
  reqMigrateStmt.free();
  for (const row of reqToMigrate) {
    const normalized = normalizeUrl(row.url);
    if (normalized !== row.url) {
      try {
        db.run('UPDATE requested_urls SET url = ? WHERE id = ?', [normalized, row.id]);
        console.log(`[DB] Migrated requested URL: ${row.url} -> ${normalized}`);
      } catch (e) {
        // Conflict: normalized URL already exists → delete old duplicate
        try { db.run('DELETE FROM requested_urls WHERE id = ?', [row.id]); } catch {}
      }
    }
  }

  // Remove requested_urls that are already in podcasts (analyzed)
  db.run(`DELETE FROM requested_urls WHERE url IN (SELECT url FROM podcasts)`);

  saveDatabase();
}

// Save database to disk
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}

export const getPodcastByUrl = (url) => {
  const normalized = normalizeUrl(url);
  const stmt = db.prepare('SELECT * FROM podcasts WHERE url = ?');
  stmt.bind([normalized]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }

  stmt.free();
  return null;
};

export const getAllPodcasts = () => {
  const stmt = db.prepare('SELECT id, url, title, cost_data, created_at, updated_at FROM podcasts ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
};

export const trackRequestedUrl = (url) => {
  db.run(
    `INSERT INTO requested_urls (url)
     VALUES (?)
     ON CONFLICT(url) DO UPDATE SET
       request_count = request_count + 1,
       last_requested_at = CURRENT_TIMESTAMP`,
    [normalizeUrl(url)]
  );
  saveDatabase();
};

export const isUrlRequested = (url) => {
  const stmt = db.prepare('SELECT 1 FROM requested_urls WHERE url = ? LIMIT 1');
  stmt.bind([normalizeUrl(url)]);
  const found = stmt.step();
  stmt.free();
  return found;
};

export const getRequestedUrls = () => {
  const stmt = db.prepare('SELECT * FROM requested_urls ORDER BY last_requested_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
};

export const deleteRequestedUrl = (id) => {
  db.run('DELETE FROM requested_urls WHERE id = ?', [id]);
  saveDatabase();
};

export const deleteRequestedUrlByUrl = (url) => {
  db.run('DELETE FROM requested_urls WHERE url = ?', [normalizeUrl(url)]);
  saveDatabase();
};

export const savePodcast = (url, title, segments, costData = null) => {
  try {
    db.run(
      `INSERT INTO podcasts (url, title, segments, cost_data)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         segments = excluded.segments,
         cost_data = excluded.cost_data,
         updated_at = CURRENT_TIMESTAMP`,
      [normalizeUrl(url), title, JSON.stringify(segments), costData ? JSON.stringify(costData) : null]
    );

    saveDatabase();
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to save podcast: ${error.message}`);
  }
};
