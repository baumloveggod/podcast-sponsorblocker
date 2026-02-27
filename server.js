import express from 'express';
import dotenv from 'dotenv';
import { getPodcastByUrl, savePodcast, initDatabase, trackRequestedUrl, getAllPodcasts, getRequestedUrls, isUrlRequested } from './database.js';
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
  const runningJob = [...jobs.values()].find(j => j.url === url && j.status === 'running');

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
      for (let i = 0; i < audioChunks.length; i++) {
        const chunkTranscription = await transcribeAudio(audioChunks[i], dl.episodeDir);
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

      const segments = await detectAdSegments(fullTranscription, dl.episodeDir);
      const title = url.split('/').pop().split('?')[0];
      savePodcast(url, title, segments);

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
 * Alle analysierten Podcasts aus der DB.
 */
app.get('/podcasts', (req, res) => {
  const podcasts = getAllPodcasts();
  res.json({ count: podcasts.length, podcasts });
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

app.listen(PORT, () => {
  console.log(`\n🎙️  Podcast Sponsorblocker API running on port ${PORT}`);
  console.log(`📝 API Documentation: http://localhost:${PORT}/`);
  console.log(`🔍 Example: http://localhost:${PORT}/analyze?url=<podcast_url>\n`);
});
