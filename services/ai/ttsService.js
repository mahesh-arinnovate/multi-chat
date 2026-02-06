import { createClient, LiveTTSEvents } from '@deepgram/sdk';
import { logger } from '../../utils/logger.js';

/**
 * TTS Service - Converts text to speech using Deepgram
 * Supports different voice models for male/female agents
 */
class TTSService {
  constructor() {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      logger.warn('DEEPGRAM_API_KEY not found in environment variables');
    }
    this.deepgram = apiKey ? createClient(apiKey) : null;
    
    // Voice models for different genders - multiple options for distinct voices
    // Using aura-2 models for better quality
    this.voiceModels = {
      female: [
        'aura-2-thalia-en',    // Female voice 1
        'aura-2-amalthea-en',  // Female voice 2
        'aura-2-andromeda-en', // Female voice 3
      ],
      male: [
        'aura-2-arcas-en',     // Male voice 1
        'aura-2-orpheus-en',   // Male voice 2
        'aura-2-zeus-en',      // Male voice 3
      ],
    };
  }

  /**
   * Create WAV header for PCM16 audio (48kHz, mono, 16-bit)
   * @returns {Buffer} WAV header buffer
   */
  createWavHeader() {
    return Buffer.from([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00, // File size placeholder
      0x57, 0x41, 0x56, 0x45, // "WAVE"
      0x66, 0x6d, 0x74, 0x20, // "fmt "
      0x10, 0x00, 0x00, 0x00, // Chunk size (16)
      0x01, 0x00, // Audio format (PCM)
      0x01, 0x00, // Channels (1 = mono)
      0x80, 0xbb, 0x00, 0x00, // Sample rate (48000)
      0x00, 0xee, 0x02, 0x00, // Byte rate (96000)
      0x02, 0x00, // Block align (2)
      0x10, 0x00, // Bits per sample (16)
      0x64, 0x61, 0x74, 0x61, // "data"
      0x00, 0x00, 0x00, 0x00, // Data size placeholder
    ]);
  }

  /**
   * Create a TTS connection for streaming audio
   * @param {string} gender - 'male' or 'female'
   * @param {number} voiceIndex - Index to select different voice (0-2) for distinct voices
   * @param {Function} onAudioChunk - Callback for audio chunks (Buffer)
   * @param {Function} onError - Callback for errors
   * @returns {Object} Deepgram TTS connection
   */
  createTTSConnection(gender, voiceIndex = 0, onAudioChunk, onError) {
    if (!this.deepgram) {
      throw new Error('Deepgram API key not configured');
    }

    const voiceArray = this.voiceModels[gender] || this.voiceModels.female;
    const modelIndex = Math.min(voiceIndex, voiceArray.length - 1); // Ensure index is within bounds
    const model = voiceArray[modelIndex];
    
    logger.info(`Creating TTS connection with model: ${model} for gender: ${gender}`);

    const connection = this.deepgram.speak.live({
      model: model,
      encoding: 'linear16',
      sample_rate: 48000,
    });

    connection.on(LiveTTSEvents.Open, () => {
      logger.info('TTS connection opened');
    });

    connection.on(LiveTTSEvents.Audio, (data) => {
      try {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        onAudioChunk(buffer);
      } catch (err) {
        logger.error('Error processing TTS audio chunk:', err);
        onError?.(err);
      }
    });

    connection.on(LiveTTSEvents.Error, (err) => {
      logger.error('TTS error:', err);
      onError?.(err);
    });

    connection.on(LiveTTSEvents.Flushed, () => {
      logger.debug('TTS flushed');
    });

    connection.on(LiveTTSEvents.Close, () => {
      logger.info('TTS connection closed');
    });

    return connection;
  }

  /**
   * Generate audio for text and stream it
   * @param {string} text - Text to convert to speech
   * @param {string} gender - 'male' or 'female'
   * @param {number} voiceIndex - Index to select different voice (0-2) for distinct voices
   * @param {Function} onAudioChunk - Callback for audio chunks
   * @param {Function} onComplete - Callback when complete
   * @param {Function} onError - Callback for errors
   */
  async streamTextToSpeech(text, gender, voiceIndex = 0, onAudioChunk, onComplete, onError) {
    if (!text || !text.trim()) {
      onComplete?.();
      return;
    }

    try {
      const connection = this.createTTSConnection(gender, voiceIndex, onAudioChunk, onError);
      
      // Wait for connection to open
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('TTS connection timeout'));
        }, 5000);

        connection.on(LiveTTSEvents.Open, () => {
          clearTimeout(timeout);
          resolve();
        });

        connection.on(LiveTTSEvents.Error, (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      // Send text to Deepgram - stream immediately, don't wait
      connection.sendText(text);
      connection.flush();

      // Stream audio chunks as they arrive (live streaming)
      // Don't wait for completion - chunks will stream via onAudioChunk callback
      let flushed = false;
      
      // Set up flush handler to know when streaming is complete
      connection.on(LiveTTSEvents.Flushed, () => {
        if (!flushed) {
          flushed = true;
          try {
            connection.finish();
          } catch (err) {
            logger.warn('Error finishing TTS connection:', err);
          }
          onComplete?.();
        }
      });
      
      // Set a timeout to ensure we don't wait forever
      setTimeout(() => {
        if (!flushed) {
          logger.warn('TTS stream timeout, closing connection');
          flushed = true;
          try {
            connection.finish();
          } catch (err) {
            logger.warn('Error finishing TTS connection on timeout:', err);
          }
          onComplete?.();
        }
      }, 30000); // 30 second max
      
      // Return immediately - chunks will stream via onAudioChunk callback in real-time
      // Connection stays open and streams chunks as they arrive
    } catch (error) {
      logger.error('Error in streamTextToSpeech:', error);
      onError?.(error);
    }
  }
}

export default new TTSService();
