import express from 'express';
import chatManager from '../services/chat/chatManager.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Get session info
 */
router.get('/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = chatManager.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });
  } catch (error) {
    logger.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * Get all active sessions
 */
router.get('/sessions', (req, res) => {
  try {
    const sessionIds = chatManager.getActiveSessions();
    const sessions = sessionIds.map(id => chatManager.getSession(id));
    res.json({ sessions });
  } catch (error) {
    logger.error('Error getting sessions:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

/**
 * Delete a session
 */
router.delete('/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!chatManager.hasSession(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }

    chatManager.deleteSession(sessionId);
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    logger.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
