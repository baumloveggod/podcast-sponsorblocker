import { readdir, rename, mkdir, rmdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOADS_DIR = join(__dirname, 'downloads');

/**
 * Migrate folder structure from old to new generic naming
 * Old: downloads/LdN/LdN464/
 * New: downloads/lagedernation/LdN464/
 */
async function migrateFolderStructure() {
  console.log('🔄 Migrating folder structure to generic naming...\n');

  try {
    // Read all podcast folders
    const podcasts = await readdir(DOWNLOADS_DIR);

    for (const podcastFolder of podcasts) {
      if (podcastFolder === '.DS_Store') continue;

      const oldPodcastPath = join(DOWNLOADS_DIR, podcastFolder);
      console.log(`📂 Processing: ${podcastFolder}/`);

      // Read all episode folders
      const episodes = await readdir(oldPodcastPath);

      for (const episodeFolder of episodes) {
        if (episodeFolder === '.DS_Store') continue;

        const oldEpisodePath = join(oldPodcastPath, episodeFolder);
        console.log(`  📁 Episode: ${episodeFolder}/`);

        // Determine new structure based on episode name
        let newPodcastName;

        // LdN episodes should go to "lagedernation" (hostname from lagedernation.org)
        if (/^LdN\d+$/i.test(episodeFolder)) {
          newPodcastName = 'lagedernation';
          console.log(`    → Moving to: ${newPodcastName}/${episodeFolder}/`);
        } else {
          // Keep other podcasts as-is (no changes needed)
          newPodcastName = podcastFolder;
          console.log(`    → Keeping structure: ${newPodcastName}/${episodeFolder}/`);
          continue;
        }

        // Create new podcast directory if needed
        const newPodcastPath = join(DOWNLOADS_DIR, newPodcastName);
        await mkdir(newPodcastPath, { recursive: true });

        // Move episode folder to new location
        const newEpisodePath = join(newPodcastPath, episodeFolder);
        await rename(oldEpisodePath, newEpisodePath);
        console.log(`    ✓ Moved to: ${newPodcastName}/${episodeFolder}/`);
      }

      // Remove old podcast folder if empty
      try {
        const remaining = await readdir(oldPodcastPath);
        if (remaining.length === 0 || (remaining.length === 1 && remaining[0] === '.DS_Store')) {
          await rmdir(oldPodcastPath);
          console.log(`  🗑️  Removed empty folder: ${podcastFolder}/`);
        }
      } catch (err) {
        console.log(`  ⚠️  Could not remove ${podcastFolder}/: ${err.message}`);
      }
    }

    console.log('\n✅ Migration complete!');
    console.log('\nNew structure:');

    // Show final structure
    const finalPodcasts = await readdir(DOWNLOADS_DIR);
    for (const podcast of finalPodcasts) {
      if (podcast === '.DS_Store') continue;
      console.log(`\ndownloads/${podcast}/`);
      const podcastPath = join(DOWNLOADS_DIR, podcast);
      const episodes = await readdir(podcastPath);
      for (const episode of episodes) {
        if (episode === '.DS_Store') continue;
        console.log(`  └── ${episode}/`);
      }
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateFolderStructure();
