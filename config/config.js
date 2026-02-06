import dotenv from 'dotenv';

dotenv.config();

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    wsPort: parseInt(process.env.WS_PORT || process.env.PORT || '3000', 10),
  },
  interview: {
    maxQuestionsPerAgent: parseInt(process.env.MAX_QUESTIONS_PER_AGENT || '3', 10),
  },
};

if (!config.openai.apiKey) {
  console.warn('Warning: OPENAI_API_KEY is not set. Please set it in your .env file.');
}
