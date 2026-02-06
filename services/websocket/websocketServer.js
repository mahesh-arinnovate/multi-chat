import { WebSocketServer } from 'ws';
import { handleMessage } from './messageHandler.js';
import { logger } from '../../utils/logger.js';
import chatManager from '../chat/chatManager.js';

/**
 * Initialize WebSocket server
 * @param {http.Server} server - HTTP server instance
 * @returns {WebSocketServer} WebSocket server instance
 */
export function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    logger.info(`WebSocket client connected from ${clientIp}`);

    // Initialize session ID
    ws.sessionId = null;

    // Handle incoming messages (JSON) and binary data (audio chunks)
    ws.on('message', async (data, isBinary) => {
      try {
        // Binary data = audio chunks from user (for future STT support)
        if (isBinary === true) {
          // Handle binary audio data if needed in future
          return;
        }

        // JSON messages
        const message = JSON.parse(data.toString());
        logger.debug('Received WebSocket message:', message);
        await handleMessage(ws, message);
      } catch (error) {
        logger.error('Error parsing WebSocket message:', error);
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
          }));
        }
      }
    });

    // Handle connection close
    ws.on('close', () => {
      logger.info(`WebSocket client disconnected (session: ${ws.sessionId || 'none'})`);
      
      // Optionally clean up session when client disconnects
      // Uncomment if you want to auto-delete sessions on disconnect
      // if (ws.sessionId && chatManager.hasSession(ws.sessionId)) {
      //   chatManager.deleteSession(ws.sessionId);
      // }
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Multi-AI Interview Practice Platform. Click "Start Interview" to begin.',
    }));
  });

  wss.on('error', (error) => {
    logger.error('WebSocket server error:', error);
  });

  logger.info('WebSocket server initialized');
  return wss;
}
