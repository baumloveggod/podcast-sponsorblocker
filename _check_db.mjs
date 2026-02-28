import { initDatabase, getAllPodcasts } from './database.js';
await initDatabase();
const all = getAllPodcasts();
const p = all.find(x => x.url.includes('LdN464') || x.url.includes('464'));
if (!p) {
  console.log('Kein LdN464 Eintrag');
} else {
  const segs = JSON.parse(p.segments);
  console.log('Segmente in DB:', segs.segments.length);
  segs.segments.forEach(s => console.log(' -', s.category, s.start_ms, '-', s.end_ms));
}
