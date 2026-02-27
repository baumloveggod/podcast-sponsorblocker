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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS requested_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      request_count INTEGER DEFAULT 1,
      first_requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDatabase();
}

// Save database to disk
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(DB_PATH, buffer);
}

export const getPodcastByUrl = (url) => {
  const stmt = db.prepare('SELECT * FROM podcasts WHERE url = ?');
  stmt.bind([url]);

  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }

  stmt.free();
  return null;
};

export const getAllPodcasts = () => {
  const stmt = db.prepare('SELECT id, url, title, created_at, updated_at FROM podcasts ORDER BY created_at DESC');
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
    [url]
  );
  saveDatabase();
};

export const isUrlRequested = (url) => {
  const stmt = db.prepare('SELECT 1 FROM requested_urls WHERE url = ? LIMIT 1');
  stmt.bind([url]);
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

export const savePodcast = (url, title, segments) => {
  try {
    db.run(
      `INSERT INTO podcasts (url, title, segments)
       VALUES (?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET
         segments = excluded.segments,
         updated_at = CURRENT_TIMESTAMP`,
      [url, title, JSON.stringify(segments)]
    );

    saveDatabase();
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to save podcast: ${error.message}`);
  }
};
