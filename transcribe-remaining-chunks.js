import { transcribeAudio } from './transcribe.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DOWNLOADS_DIR = '/Users/andreaslenkenhoff/Documents/podcast sponsorblocker/downloads';
const BASE_NAME = 'podcast_1771341938163_LdN464';

/**
 * Transkribiert Chunks 2-8 der Podcast-Episode
 */
async function transcribeRemainingChunks() {
  console.log('=== Transkribiere verbleibende Chunks (2-8) ===\n');

  let fullTranscription = { text: '', segments: [] };
  let timeOffset = 1200; // 20 Minuten (chunks 0 und 1 sind bereits fertig)

  // Chunks 2-8 verarbeiten
  for (let i = 2; i <= 8; i++) {
    const chunkPath = join(DOWNLOADS_DIR, `${BASE_NAME}_chunk${i}.mp3`);

    console.log(`\n[${i-1}/7] Transkribiere Chunk ${i}...`);
    console.log(`Datei: ${chunkPath}`);

    try {
      const chunkTranscription = await transcribeAudio(chunkPath);

      // Zeitstempel für Chunks nach dem ersten anpassen
      const adjustedSegments = chunkTranscription.segments.map(seg => ({
        ...seg,
        start: seg.start + timeOffset,
        end: seg.end + timeOffset
      }));

      fullTranscription.text += ' ' + chunkTranscription.text;
      fullTranscription.segments.push(...adjustedSegments);

      console.log(`✓ Chunk ${i} transkribiert (${chunkTranscription.segments.length} Segmente)`);

      // Speichere einzelnes Chunk-Transkript
      const chunkOutputPath = join(DOWNLOADS_DIR, `${BASE_NAME}_chunk${i}_transcript.json`);
      await writeFile(chunkOutputPath, JSON.stringify(chunkTranscription, null, 2));
      console.log(`✓ Gespeichert: ${chunkOutputPath}`);

      // Update time offset für nächsten Chunk (10 Minuten = 600 Sekunden)
      timeOffset += 600;

    } catch (error) {
      console.error(`✗ Fehler bei Chunk ${i}:`, error.message);
      console.log('Fahre mit nächstem Chunk fort...');
    }
  }

  // Speichere vollständiges Transkript
  const fullOutputPath = join(DOWNLOADS_DIR, `${BASE_NAME}_full_transcript.json`);
  await writeFile(fullOutputPath, JSON.stringify(fullTranscription, null, 2));
  console.log(`\n✓ Vollständiges Transkript gespeichert: ${fullOutputPath}`);

  // Erstelle timestamped TXT Version
  const timestampedText = fullTranscription.segments
    .map(seg => {
      const start = formatTime(seg.start);
      const end = formatTime(seg.end);
      return `[${start} - ${end}] ${seg.text}`;
    })
    .join('\n');

  const timestampedPath = join(DOWNLOADS_DIR, `${BASE_NAME}_full_transcript_timestamped.txt`);
  await writeFile(timestampedPath, timestampedText);
  console.log(`✓ Zeitgestempeltes Transkript gespeichert: ${timestampedPath}`);

  console.log('\n=== Transkription abgeschlossen ===');
  console.log(`Gesamt-Segmente: ${fullTranscription.segments.length}`);
  console.log(`Gesamt-Dauer: ${formatTime(fullTranscription.segments[fullTranscription.segments.length - 1]?.end || 0)}`);
}

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Run script
transcribeRemainingChunks().catch(console.error);
