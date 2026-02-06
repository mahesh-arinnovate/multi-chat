import OpenAI from 'openai';
import { config } from '../../config/config.js';
import { logger } from '../../utils/logger.js';

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    this.model = config.openai.model;
  }

  /**
   * Create a streaming chat completion
   * @param {Array} messages - Array of message objects with role and content
   * @param {Function} onChunk - Callback function for each chunk
   * @param {Function} onComplete - Callback function when stream completes
   * @param {Function} onError - Callback function for errors
   * @returns {Promise<void>}
   */
  async streamChatCompletion(messages, onChunk, onComplete, onError) {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        stream: true,
        temperature: 0.7,
      });

      let fullResponse = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          onChunk(content);
        }
      }

      onComplete(fullResponse);
    } catch (error) {
      logger.error('OpenAI API Error:', error);
      onError(error);
    }
  }

  /**
   * Create a non-streaming chat completion (for testing)
   * @param {Array} messages - Array of message objects with role and content
   * @returns {Promise<string>}
   */
  async createChatCompletion(messages) {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        temperature: 0.7,
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.error('OpenAI API Error:', error);
      throw error;
    }
  }
}

export default new OpenAIService();
