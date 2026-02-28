import OpenAI from 'openai';
import { writeFile } from 'fs/promises';
import { join } from 'path';

let openai;

function getOpenAIClient() {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openai;
}

/**
 * Splits segments into chunks of ~chunkDurationSec with overlapSec overlap
 */
function splitIntoChunks(segments, chunkDurationSec = 1200, overlapSec = 30) {
  const chunks = [];
  let chunkStartTime = 0;
  const lastEnd = segments[segments.length - 1].end;

  while (chunkStartTime < lastEnd) {
    const chunkEndTime = chunkStartTime + chunkDurationSec;

    const chunkSegments = segments.filter(
      seg => seg.start >= chunkStartTime && seg.start < chunkEndTime
    );

    if (chunkSegments.length === 0) break;

    chunks.push({ segments: chunkSegments, startTime: chunkStartTime, endTime: chunkEndTime });

    if (chunkEndTime >= lastEnd) break;

    chunkStartTime = chunkEndTime - overlapSec;
  }

  return chunks;
}

/**
 * Merges overlapping or close ad segments (< gapThresholdMs apart)
 */
function mergeAdSegments(allSegments, gapThresholdMs = 30000) {
  if (allSegments.length === 0) return [];

  const sorted = [...allSegments].sort((a, b) => a.start_ms - b.start_ms);
  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start_ms <= last.end_ms + gapThresholdMs && current.category === last.category) {
      last.end_ms = Math.max(last.end_ms, current.end_ms);
      if (current.description && !last.description.includes(current.description)) {
        last.description += ' / ' + current.description;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Detect advertisement segments using GPT-4, chunked by ~20 minutes with 30s overlap
 */
export async function detectAdSegments(transcription, episodeDir = null) {
  const CHUNK_DURATION_SEC = 600; // 10 minutes
  const OVERLAP_SEC = 30;
  const GAP_THRESHOLD_MS = 30000;

  console.log('Analyzing transcription for advertisement segments...');
  console.log(`Total segments: ${transcription.segments.length}`);

  const chunks = splitIntoChunks(transcription.segments, CHUNK_DURATION_SEC, OVERLAP_SEC);
  console.log(`Split into ${chunks.length} chunk(s) of ~${CHUNK_DURATION_SEC / 60} minutes`);

  const client = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
  console.log(`Using model: ${model}`);

  const allAdSegments = [];
  const allResponses = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkLabel = `Chunk ${i + 1}/${chunks.length} (${formatTime(chunk.startTime)} - ${formatTime(chunk.endTime)})`;
    console.log(`\n  Processing ${chunkLabel} with ${chunk.segments.length} segments...`);

    const segmentDetails = chunk.segments.map((seg) => {
      return `${formatTime(seg.start)} - ${formatTime(seg.end)}: ${seg.text}`;
    }).join('\n');

    const prompt = `Analysiere das folgende Podcast-Transkript und identifiziere alle Werbesegmente.

Transkript mit Zeitstempeln:
${segmentDetails}

Gebe mir eine Liste aller Werbesegmente zurück. Unterscheide dabei zwei Kategorien:

1. "sponsor" - Externe Werbung/Sponsoren:
   - Produkt- oder Firmenwerbung (z.B. NordVPN, Vodafone, etc.)
   - Rabattcodes oder Affiliate-Links
   - Produktbeschreibungen mit Kaufaufforderungen
   - Host-Reads für externe Firmen
   - Explizite Ansagen wie "Werbung" gefolgt von externem Produkt

2. "eigenwerbung" - Eigenwerbung des Podcasts:
   - Aufrufe zur Mitgliedschaft / Unterstützung des eigenen Podcasts
   - Hinweise auf eigene Produkte, Newsletter, andere eigene Podcasts
   - "Werde Mitglied unter ...", "Unterstütze uns unter ..."

Wichtig für den Übergang: Wenn ein Satz thematisch nicht zum Gespräch davor passt und stattdessen ein Produkt oder eine Dienstleistung beschreibt, gehört er zum Werbesegment — auch wenn kein explizites "Werbung" gesagt wurde.

Antworte ausschließlich mit einem JSON-Array im folgenden Format (keine Erklärungen):
{
  "segments": [
    {
      "start_ms": <Start in Millisekunden>,
      "end_ms": <Ende in Millisekunden>,
      "category": "sponsor" | "eigenwerbung",
      "description": "<Kurze Beschreibung der Werbung>"
    }
  ]
}

Wenn keine Werbung gefunden wurde, gebe ein leeres Array zurück: {"segments": []}`;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'Du bist ein Experte für Podcast-Analyse und erkennst zuverlässig Werbesegmente. Antworte immer mit validem JSON.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices[0].message.content;
    const chunkResult = JSON.parse(response);
    const found = chunkResult.segments || [];

    totalInputTokens += completion.usage?.prompt_tokens || 0;
    totalOutputTokens += completion.usage?.completion_tokens || 0;

    console.log(`  ${chunkLabel}: ${found.length} segment(s) found (tokens: ${completion.usage?.total_tokens || '?'})`);
    allAdSegments.push(...found);
    allResponses.push({ chunkLabel, response });
  }

  const mergedSegments = mergeAdSegments(allAdSegments, GAP_THRESHOLD_MS);
  console.log(`\nFound ${allAdSegments.length} raw segment(s), merged to ${mergedSegments.length}`);

  if (episodeDir) {
    const responsePath = join(episodeDir, 'ad_detection_response.txt');
    const formattedResponse = [
      `=== GPT-4 Ad Detection Response ===`,
      `Model: ${model}`,
      `Timestamp: ${new Date().toISOString()}`,
      ``,
      ...allResponses.map(r => `=== ${r.chunkLabel} ===\n${r.response}`),
      ``,
      `=== MERGED RESULT ===`,
      JSON.stringify({ segments: mergedSegments }, null, 2)
    ].join('\n');
    await writeFile(responsePath, formattedResponse);
    console.log(`✓ GPT response saved: ${responsePath}`);
  }

  // GPT-4-turbo: $10/1M input, $30/1M output
  const gptCost = (totalInputTokens / 1_000_000) * 10 + (totalOutputTokens / 1_000_000) * 30;
  console.log(`GPT cost: $${gptCost.toFixed(4)} (${totalInputTokens} in, ${totalOutputTokens} out tokens)`);

  return { segments: mergedSegments, gptCost, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
