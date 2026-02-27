import OpenAI from 'openai';
import { createReadStream } from 'fs';

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
 * Transcribe audio file using OpenAI Whisper API
 * Note: Individual chunk transcripts are no longer saved.
 * Only the final combined transcript is saved in server.js
 * @param {string} audioFilePath - Path to the audio file
 * @param {string} episodeDir - (Unused, kept for API compatibility)
 * @returns {Promise<Object>} Transcription with timestamps
 */
export async function transcribeAudio(audioFilePath, episodeDir = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Transcribing audio file: ${audioFilePath} (attempt ${attempt}/${retries})`);

      const client = getOpenAIClient();
      const transcription = await client.audio.transcriptions.create({
        file: createReadStream(audioFilePath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      }, {
        timeout: 120000, // 2 minute timeout
        maxRetries: 2
      });

      console.log('Transcription completed');

      const result = {
        text: transcription.text,
        segments: transcription.segments || []
      };

      // No longer saving individual chunk transcripts
      // Only the final combined transcript is saved in server.js

      return result;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);

      if (attempt === retries) {
        throw new Error(`Failed to transcribe audio after ${retries} attempts: ${error.message}`);
      }

      // Wait before retry (exponential backoff)
      const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// saveTranscript() function removed - transcripts are now only saved
// once in server.js after all chunks are combined
