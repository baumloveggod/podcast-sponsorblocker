import axios from 'axios';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOADS_DIR = join(__dirname, 'downloads');

// Ensure downloads directory exists
await mkdir(DOWNLOADS_DIR, { recursive: true });

/**
 * Extract podcast and episode name from URL
 * Generische Logik: {Hostname}/{Filename}
 * @param {string} url - The podcast episode URL
 * @returns {Object} { podcastName, episodeName }
 */
function extractPodcastInfo(url) {
  try {
    // Parse URL um Host zu extrahieren
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Extrahiere Dateinamen aus URL
    const filename = url.split('/').pop().split('?')[0];
    const cleanName = filename.replace(/\.(mp3|m4a|wav|m4v|mp4)$/i, '');

    // Episode-Name bereinigen
    let episodeName = cleanName;

    // Entferne Timestamps (13-stellige Zahlen = Unix timestamp in ms)
    episodeName = episodeName.split('_')
      .filter(part => !/^\d{13}$/.test(part))
      .join('_');

    // Entferne "podcast" prefix falls vorhanden
    episodeName = episodeName.replace(/^podcast[_-]/i, '');

    // Falls Episode-Name leer ist, nutze Dateinamen
    if (!episodeName || episodeName.length === 0) {
      episodeName = cleanName;
    }

    // Host bereinigen: www. entfernen, nur Hauptdomain behalten
    const hostParts = hostname.replace(/^www\./, '').split('.');
    const podcastName = hostParts.length > 1 ? hostParts[0] : hostname;

    return {
      podcastName,
      episodeName
    };
  } catch (error) {
    // Fallback bei ungültiger URL
    const filename = url.split('/').pop().split('?')[0];
    const cleanName = filename.replace(/\.(mp3|m4a|wav)$/i, '');

    return {
      podcastName: 'Unknown',
      episodeName: cleanName
    };
  }
}

/**
 * Download podcast episode from URL
 * Creates directory structure: downloads/PodcastName/EpisodeName/
 * @param {string} url - The podcast episode URL
 * @returns {Promise<Object>} { filepath, episodeDir }
 */
export async function downloadPodcast(url) {
  try {
    const { podcastName, episodeName } = extractPodcastInfo(url);

    // Create directory structure: downloads/PodcastName/EpisodeName/
    const episodeDir = join(DOWNLOADS_DIR, podcastName, episodeName);
    await mkdir(episodeDir, { recursive: true });

    // Create filename with timestamp
    const filename = `${episodeName}.mp3`;
    const filepath = join(episodeDir, filename);

    console.log(`Downloading podcast from: ${url}`);
    console.log(`Saving to: ${episodeDir}`);

    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 300000, // 5 minutes timeout
      maxRedirects: 10,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'audio/mpeg,audio/*,*/*'
      },
      validateStatus: (status) => status >= 200 && status < 400
    });

    const writer = createWriteStream(filepath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`Download completed: ${filepath}`);
        resolve({ filepath, episodeDir });
      });
      writer.on('error', reject);
    });
  } catch (error) {
    throw new Error(`Failed to download podcast: ${error.message}`);
  }
}
