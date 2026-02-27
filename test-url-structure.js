import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract podcast and episode name from URL
 * (Gleiche Logik wie in download.js)
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
 * Zeige Ordnerstruktur für eine URL
 */
function showStructure(url) {
  const { podcastName, episodeName } = extractPodcastInfo(url);
  const episodeDir = join(__dirname, 'downloads', podcastName, episodeName);

  console.log(`\n📥 URL: ${url}`);
  console.log(`📂 Struktur:`);
  console.log(`   downloads/`);
  console.log(`   └── ${podcastName}/`);
  console.log(`       └── ${episodeName}/`);
  console.log(`           ├── ${episodeName}.mp3 (temporär)`);
  console.log(`           ├── transcript_timestamped.txt`);
  console.log(`           └── ad_detection_response.txt`);
  console.log(`\n📍 Voller Pfad: ${episodeDir}`);
  console.log(`─────────────────────────────────────────────────`);
}

// Test mit verschiedenen URLs
const testUrls = [
  'https://example.com/LdN464.mp3',
  'https://podcast.de/LdN465.mp3',
  'https://example.com/podcast_1771341938163_LdN466.mp3',
  'https://my-podcast.com/Episode123.mp3',
  'https://test.com/MeinPodcast_Episode42.mp3',
  'https://feeds.feedburner.com/podcast_1234567890123_CustomName.mp3'
];

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║  Podcast URL → Ordnerstruktur Test              ║');
console.log('╚══════════════════════════════════════════════════╝');

testUrls.forEach(url => showStructure(url));

// Wenn URL als Argument übergeben wird
if (process.argv[2]) {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Deine URL:                                      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  showStructure(process.argv[2]);
}
