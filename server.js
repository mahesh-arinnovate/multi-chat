import express from 'express';
import { createServer } from 'http';
import { initWebSocketServer } from './services/websocket/websocketServer.js';
import apiRoutes from './routes/api.js';
import { config } from './config/config.js';
import { logger } from './utils/logger.js';

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// API Routes
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: './public' });
});

// Initialize WebSocket server
initWebSocketServer(server);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = config.server.port;
server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  logger.info(`WebSocket server running on ws://localhost:${PORT}`);
  logger.info(`OpenAI Model: ${config.openai.model}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
