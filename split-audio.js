import { exec } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';

const execAsync = promisify(exec);

const MAX_FILE_SIZE_MB = 24; // Whisper API limit is 25MB
const CHUNK_DURATION_SECONDS = 600; // 10 minutes per chunk

/**
 * Split audio file into chunks if it exceeds Whisper API size limit
 * Chunks are saved in the same directory as the input file
 * @param {string} inputPath - Path to input audio file
 * @param {string} episodeDir - Directory for this episode
 * @returns {Promise<string[]>} Array of paths to audio chunks
 */
export async function splitAudioIfNeeded(inputPath, episodeDir = null) {
  try {
    // Check file size
    const stats = await stat(inputPath);
    const fileSizeMB = stats.size / (1024 * 1024);

    console.log(`Audio file size: ${fileSizeMB.toFixed(2)} MB`);

    // If file is small enough, return as single chunk
    if (fileSizeMB <= MAX_FILE_SIZE_MB) {
      console.log('File size is within Whisper API limit, no splitting needed');
      return [inputPath];
    }

    console.log(`File exceeds ${MAX_FILE_SIZE_MB}MB limit, splitting into chunks...`);

    // Get audio duration first
    const durationCommand = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
    const { stdout: durationOutput } = await execAsync(durationCommand);
    const totalDuration = parseFloat(durationOutput.trim());

    console.log(`Total duration: ${Math.floor(totalDuration / 60)} minutes`);

    // Create output directory and base name
    const dir = episodeDir || dirname(inputPath);
    const ext = extname(inputPath);
    const name = basename(inputPath, ext);

    const chunks = [];
    let startTime = 0;
    let chunkIndex = 0;

    // Split into chunks
    while (startTime < totalDuration) {
      const outputPath = join(dir, `${name}_chunk${chunkIndex}${ext}`);

      // Split chunk using ffmpeg with compression
      // Use mono, 16kHz, 64kbps for speech (Whisper recommended settings)
      const command = `ffmpeg -i "${inputPath}" -ss ${startTime} -t ${CHUNK_DURATION_SECONDS} -ac 1 -ar 16000 -b:a 64k "${outputPath}" -y`;

      console.log(`Creating chunk ${chunkIndex} (${Math.floor(startTime / 60)}min - ${Math.floor((startTime + CHUNK_DURATION_SECONDS) / 60)}min)...`);
      await execAsync(command);

      chunks.push(outputPath);
      startTime += CHUNK_DURATION_SECONDS;
      chunkIndex++;
    }

    console.log(`Split into ${chunks.length} chunks`);
    return chunks;
  } catch (error) {
    throw new Error(`Failed to split audio: ${error.message}`);
  }
}
