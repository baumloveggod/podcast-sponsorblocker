import { readFile } from 'fs/promises';
import { join } from 'path';
import dotenv from 'dotenv';
import { detectAdSegments } from './detect-ads.js';

dotenv.config();

const EPISODE_DIR = '/Users/andreaslenkenhoff/Documents/podcast sponsorblocker/downloads/dts/LdN464';
const TRANSCRIPT_FILE = join(EPISODE_DIR, 'transcript_timestamped.txt');

/**
 * Parst transcript_timestamped.txt zurück in das {text, segments[]} Format
 * Unterstützt beide Formate:
 *   [MM:SS]  Text
 *   [MM:SS - MM:SS]  Text
 */
function parseTranscript(content) {
  const lines = content.split('\n');
  const segments = [];

  const withEnd    = /^\[(\d+):(\d+)\s*-\s*(\d+):(\d+)\]\s{1,2}(.+)$/;
  const startOnly  = /^\[(\d+):(\d+)\]\s{1,2}(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const m2 = trimmed.match(withEnd);
    if (m2) {
      segments.push({
        start: parseInt(m2[1]) * 60 + parseInt(m2[2]),
        end:   parseInt(m2[3]) * 60 + parseInt(m2[4]),
        text:  m2[5].trim()
      });
      continue;
    }

    const m1 = trimmed.match(startOnly);
    if (m1) {
      segments.push({
        start: parseInt(m1[1]) * 60 + parseInt(m1[2]),
        end:   null,
        text:  m1[3].trim()
      });
    }
    // Sonst: Header-Zeile o.ä. → überspringen
  }

  // end-Werte für Segmente ohne End-Timestamp nachträglich setzen
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].end === null) {
      segments[i].end = i + 1 < segments.length
        ? segments[i + 1].start
        : segments[i].start + 5;
    }
  }

  const text = segments.map(s => s.text).join(' ');
  return { text, segments };
}

function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

async function main() {
  console.log('=== Test: Ad Detection für LdN464 ===\n');
  console.log(`Lese Transkript: ${TRANSCRIPT_FILE}\n`);

  const content = await readFile(TRANSCRIPT_FILE, 'utf-8');
  const transcription = parseTranscript(content);

  const lastSeg = transcription.segments[transcription.segments.length - 1];
  console.log(`Parsed: ${transcription.segments.length} Segmente`);
  console.log(`Gesamtdauer: ${Math.floor(lastSeg.end / 60)} Minuten\n`);

  const result = await detectAdSegments(transcription, EPISODE_DIR);

  console.log('\n=== ERGEBNIS ===');
  console.log(`${result.segments.length} Werbesegment(e) gefunden:\n`);

  for (const seg of result.segments) {
    console.log(`  [${formatMs(seg.start_ms)} - ${formatMs(seg.end_ms)}] ${seg.description}`);
  }

  console.log('\nFertig.');
}

main().catch(err => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
