import express from 'express';
import dotenv from 'dotenv';
import https from 'https';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getPodcastByUrl, savePodcast, initDatabase, trackRequestedUrl, getAllPodcasts, getRequestedUrls, isUrlRequested, deleteRequestedUrl, deleteRequestedUrlByUrl } from './database.js';
import { downloadPodcast } from './download.js';
import { transcribeAudio } from './transcribe.js';
import { detectAdSegments } from './detect-ads.js';
import { splitAudioIfNeeded } from './split-audio.js';
import { unlink, writeFile, appendFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Whitelist
const WHITELIST_PATH = join(__dirname, 'whitelist.json');

function loadWhitelist() {
  if (!existsSync(WHITELIST_PATH)) return { hosts: [] };
  return JSON.parse(readFileSync(WHITELIST_PATH, 'utf-8'));
}

function saveWhitelist(data) {
  writeFileSync(WHITELIST_PATH, JSON.stringify(data, null, 2));
}

function isWhitelisted(url) {
  const { hosts } = loadWhitelist();
  return hosts.find(h => url.includes(h.match)) || null;
}

const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY environment variable is not set!');
  console.error('Please create a .env file with your OpenAI API key.');
  process.exit(1);
}

// Initialize database
await initDatabase();

const app = express();

app.use(express.json());

// CORS für lokales Admin-Dashboard
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Request-Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} ${ms}ms${req.query.url ? ` – ${decodeURIComponent(req.query.url).split('/').pop()}` : ''}`);
  });
  next();
});

/**
 * GET /analyze?url=<podcast_url>
 *
 * Analyzes a podcast episode for advertisement segments.
 * Returns cached results if available, otherwise downloads,
 * transcribes, and analyzes the podcast.
 */
app.get('/analyze', (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing required parameter: url' });
  }

  const whitelisted = isWhitelisted(url);
  if (whitelisted) {
    return res.json({
      cached: false,
      whitelisted: true,
      host: whitelisted.name,
      url,
      segments: [],
      message: `${whitelisted.name} ist auf der Whitelist – keine Werbung erwartet.`
    });
  }

  const cached = getPodcastByUrl(url);

  if (cached) {
    return res.json({
      cached: true,
      url: cached.url,
      title: cached.title,
      ...JSON.parse(cached.segments)
    });
  }

  // URL merken für späteren Review
  trackRequestedUrl(url);

  // Prüfen ob ein Job für diese URL läuft (in jobs-Map)
  const normalizedUrl = (() => { try { const u = new URL(url); u.search = ''; return u.toString(); } catch { return url; } })();
  const runningJob = [...jobs.values()].find(j => {
    try { const u = new URL(j.url); u.search = ''; return u.toString() === normalizedUrl && j.status === 'running'; } catch { return j.url === url && j.status === 'running'; }
  });

  return res.status(404).json({
    error: 'not_analyzed',
    analyzing: !!runningJob,
    message: runningJob
      ? 'Analysis is currently running for this episode.'
      : 'This episode has not been analyzed yet.',
  });
});

// Laufende Jobs: jobId → { status, url, startedAt, result?, error? }
const jobs = new Map();

/**
 * POST /process
 * { "url": "https://..." }
 *
 * Startet die Analyse-Pipeline für eine URL.
 * Nur für serverseitige Aufrufe vorgesehen (kein App-Zugriff).
 */
app.post('/process', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Missing required field: url' });
  }

  // Bereits in DB → kein erneutes Processing nötig
  const existing = getPodcastByUrl(url);
  if (existing) {
    return res.json({
      status: 'already_processed',
      url: existing.url,
      title: existing.title,
    });
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, { status: 'running', url, startedAt: Date.now() });

  // Asynchron starten, sofort jobId zurückgeben
  res.json({ jobId, status: 'running', url });

  // Pipeline im Hintergrund
  (async () => {
    const episodeDir = join(__dirname, 'episodes', jobId);
    let downloadedFilePath;
    let audioChunks = [];

    try {
      console.log(`\n[Job ${jobId}] Downloading: ${url}`);
      const dl = await downloadPodcast(url);
      downloadedFilePath = dl.filepath;
      const transcriptPath = join(dl.episodeDir, 'transcript_timestamped.txt');

      audioChunks = await splitAudioIfNeeded(downloadedFilePath, dl.episodeDir);

      let fullTranscription = { text: '', segments: [] };
      let transcriptExists = false;
      try { await access(transcriptPath); transcriptExists = true; } catch {}

      let timeOffset = 0;
      let totalWhisperSeconds = 0;
      let totalWhisperCost = 0;
      for (let i = 0; i < audioChunks.length; i++) {
        const chunkTranscription = await transcribeAudio(audioChunks[i], dl.episodeDir);
        totalWhisperSeconds += chunkTranscription.durationSeconds || 0;
        totalWhisperCost += chunkTranscription.whisperCost || 0;
        const adjustedSegments = chunkTranscription.segments.map(seg => ({
          ...seg,
          start: seg.start + timeOffset,
          end: seg.end + timeOffset,
        }));
        const timestampedText = adjustedSegments
          .map(seg => `[${formatTime(seg.start)} - ${formatTime(seg.end)}] ${seg.text}`)
          .join('\n');

        if (i === 0 && !transcriptExists) {
          await writeFile(transcriptPath, timestampedText + '\n');
        } else {
          await appendFile(transcriptPath, timestampedText + '\n');
        }

        fullTranscription.text += ' ' + chunkTranscription.text;
        fullTranscription.segments.push(...adjustedSegments);
        timeOffset += 600;
      }

      const adResult = await detectAdSegments(fullTranscription, dl.episodeDir);
      const costData = {
        whisper: { totalSeconds: totalWhisperSeconds, cost: totalWhisperCost },
        gpt: { inputTokens: adResult.inputTokens || 0, outputTokens: adResult.outputTokens || 0, cost: adResult.gptCost || 0 },
        totalCost: totalWhisperCost + (adResult.gptCost || 0),
      };
      console.log(`[Job ${jobId}] Total cost: $${costData.totalCost.toFixed(4)}`);

      const title = url.split('/').pop().split('?')[0];
      savePodcast(url, title, { segments: adResult.segments }, costData);
      deleteRequestedUrlByUrl(url);

      jobs.set(jobId, { status: 'done', url, title, startedAt: jobs.get(jobId).startedAt, finishedAt: Date.now() });
      console.log(`[Job ${jobId}] Done`);
    } catch (err) {
      jobs.set(jobId, { status: 'error', url, error: err.message, startedAt: jobs.get(jobId).startedAt, finishedAt: Date.now() });
      console.error(`[Job ${jobId}] Error:`, err.message);
    } finally {
      try {
        if (downloadedFilePath) await unlink(downloadedFilePath);
        for (const chunk of audioChunks) {
          if (chunk !== downloadedFilePath) await unlink(chunk);
        }
      } catch {}
    }
  })();
});

/**
 * GET /process/:jobId
 * Status eines laufenden/abgeschlossenen Jobs abfragen.
 */
app.get('/process/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/**
 * GET /podcasts
 * Alle analysierten Podcasts aus der DB + whitelisted Hosts.
 */
app.get('/podcasts', (req, res) => {
  const podcasts = getAllPodcasts();
  const { hosts: whitelistedHosts } = loadWhitelist();
  res.json({
    analyzed: { count: podcasts.length, podcasts },
    whitelisted: { count: whitelistedHosts.length, hosts: whitelistedHosts },
  });
});

/**
 * GET /podcasts/requested
 * Alle URLs die angefragt wurden, aber noch nicht analysiert sind.
 */
app.get('/podcasts/requested', (req, res) => {
  const requested = getRequestedUrls();
  res.json({ count: requested.length, requested });
});

/**
 * DELETE /podcasts/requested/:id
 * Entfernt eine URL aus der requested-Liste.
 */
app.delete('/podcasts/requested/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Ungültige ID' });
  deleteRequestedUrl(id);
  res.json({ success: true });
});

/**
 * GET /whitelist
 * Alle whitelisted Podcast-Hosts.
 */
app.get('/whitelist', (req, res) => {
  res.json(loadWhitelist());
});

/**
 * POST /whitelist
 * { "name": "Morgen Grauen", "match": "103e68ee0" }
 * Fügt einen neuen Host zur Whitelist hinzu.
 */
app.post('/whitelist', (req, res) => {
  const { name, match } = req.body;
  if (!name || !match) return res.status(400).json({ error: 'name und match sind erforderlich' });

  const data = loadWhitelist();
  if (data.hosts.find(h => h.match === match)) {
    return res.status(409).json({ error: 'Dieser match-Wert existiert bereits' });
  }
  data.hosts.push({ name, match });
  saveWhitelist(data);
  res.json({ success: true, hosts: data.hosts });
});

/**
 * DELETE /whitelist/:name
 * Entfernt einen Host aus der Whitelist (per name).
 */
app.delete('/whitelist/:name', (req, res) => {
  const data = loadWhitelist();
  const before = data.hosts.length;
  data.hosts = data.hosts.filter(h => h.name !== req.params.name);
  if (data.hosts.length === before) return res.status(404).json({ error: 'Host nicht gefunden' });
  saveWhitelist(data);
  res.json({ success: true, hosts: data.hosts });
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'podcast-sponsorblocker',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /
 * API documentation
 */
app.get('/', (req, res) => {
  res.json({
    service: 'Podcast Sponsorblocker API',
    version: '1.1.0',
    endpoints: {
      'GET /analyze?url=<url>': 'Gibt gecachte Ad-Segmente zurück. 404 wenn noch nicht analysiert.',
      'POST /process': 'Startet Analyse-Pipeline (server-only). Body: { url }. Gibt jobId zurück.',
      'GET /process/:jobId': 'Status eines laufenden oder abgeschlossenen Jobs.',
      'GET /podcasts': 'Alle analysierten Podcasts aus der DB.',
      'GET /podcasts/requested': 'Alle anefragten aber noch nicht analysierten URLs.',
      'GET /whitelist': 'Alle whitelisted Podcast-Hosts.',
      'POST /whitelist': 'Host zur Whitelist hinzufügen. Body: { name, match }.',
      'DELETE /whitelist/:name': 'Host aus Whitelist entfernen.',
      'GET /health': 'Health check',
    },
  });
});

/**
 * Format seconds to MM:SS
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const sslOptions = {
  key: readFileSync(process.env.SSL_KEY_PATH),
  cert: readFileSync(process.env.SSL_CERT_PATH),
};

const HOST = process.env.HOST || '0.0.0.0';

https.createServer(sslOptions, app).listen(PORT, HOST, () => {
  console.log(`\n🎙️  Podcast Sponsorblocker API running on https://${HOST}:${PORT}`);
  console.log(`📝 API Documentation: https://${HOST}:${PORT}/`);
  console.log(`🔍 Example: https://${HOST}:${PORT}/analyze?url=<podcast_url>\n`);
});
