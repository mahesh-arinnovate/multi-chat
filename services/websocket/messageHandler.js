import chatManager from '../chat/chatManager.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'crypto';

/**
 * Handle incoming WebSocket messages
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Parsed message object
 */
export async function handleMessage(ws, message) {
  try {
    const { type, content, sessionId, scenario, userName, userRole } = message;

    switch (type) {
      case 'start_session': {
        const newSessionId = sessionId || randomUUID();
        
        // Validate required fields
        if (!scenario || !userName || !userRole) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Missing required fields: scenario, userName, and userRole are required.',
          }));
          return;
        }
        
        // Create callbacks for streaming
        // Store WebSocket reference for binary audio streaming
        const onStreamChunk = (data) => {
          if (ws.readyState === 1) { // WebSocket.OPEN
            // If data has binary audio buffer, send as binary; otherwise send as JSON
            if (data.type === 'ai_audio_chunk' && data.audioBuffer) {
              // Send binary audio chunk - Buffer is already in the correct format for ws.send
              // ws.send automatically handles Buffer objects as binary
              ws.send(data.audioBuffer);
            } else {
              // Send JSON message
              ws.send(JSON.stringify(data));
            }
          }
        };

        const onStreamComplete = (data) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify(data));
          }
        };

        const onError = (data) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify(data));
          }
        };

        try {
          // Create session (async now)
          const session = await chatManager.createSession(newSessionId, {
            scenario: scenario,
            userName: userName,
            userRole: userRole,
            onStreamChunk,
            onStreamComplete,
            onError,
          });

          // Store sessionId in WebSocket
          ws.sessionId = newSessionId;

          // Send session created confirmation
          ws.send(JSON.stringify({
            type: 'session_created',
            session: session,
          }));

          logger.info(`Session started: ${newSessionId}`);
        } catch (error) {
          logger.error('Error creating session:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: error.message || 'Failed to create session',
          }));
        }
        break;
      }

      case 'message': {
        const activeSessionId = sessionId || ws.sessionId;
        
        if (!activeSessionId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No active session. Please start a session first.',
          }));
          return;
        }

        if (!chatManager.hasSession(activeSessionId)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Session not found. Please start a new session.',
          }));
          return;
        }

        if (!content || typeof content !== 'string') {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message content.',
          }));
          return;
        }

        // Process message
        await chatManager.processUserMessage(activeSessionId, content);
        break;
      }

      case 'get_session': {
        const activeSessionId = sessionId || ws.sessionId;
        
        if (!activeSessionId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No active session.',
          }));
          return;
        }

        const session = chatManager.getSession(activeSessionId);
        if (!session) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Session not found.',
          }));
          return;
        }

        ws.send(JSON.stringify({
          type: 'session_info',
          session: session,
        }));
        break;
      }

      case 'audio_playback_complete': {
        const activeSessionId = sessionId || ws.sessionId;
        
        if (!activeSessionId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No active session.',
          }));
          return;
        }

        if (!chatManager.hasSession(activeSessionId)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Session not found.',
          }));
          return;
        }

        // Notify chatManager that audio playback is complete
        // This will trigger next agent response generation
        chatManager.onAudioPlaybackComplete(activeSessionId, message.aiId);
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }

      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${type}`,
        }));
    }
  } catch (error) {
    logger.error('Message handler error:', error);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message || 'Internal server error',
      }));
    }
  }
}
