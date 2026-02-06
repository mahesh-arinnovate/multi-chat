import conversationMemory from './conversationMemory.js';
import orchestrator from './orchestrator.js';
import agentGenerator from '../ai/agentGenerator.js';
import openaiService from '../ai/openaiService.js';
import ttsService from '../ai/ttsService.js';
import { logger } from '../../utils/logger.js';

/**
 * Chat Manager - Central Message Hub for multi-agent interview sessions
 * Manages shared conversation state and orchestrates agent responses
 */
class ChatManager {
  constructor() {
    // Map of sessionId -> session data
    this.sessions = new Map();
  }

  /**
   * Create a new practice session
   * @param {string} sessionId - Session identifier
   * @param {Object} options - Session options
   * @param {string} options.scenario - Practice scenario description
   * @param {string} options.userName - User's name
   * @param {string} options.userRole - User's role
   * @param {Function} options.onStreamChunk - Callback for stream chunks
   * @param {Function} options.onStreamComplete - Callback for stream completion
   * @param {Function} options.onError - Callback for errors
   * @returns {Promise<Object>} Session info
   */
  async createSession(sessionId, options = {}) {
    const {
      scenario,
      userName,
      userRole,
      onStreamChunk,
      onStreamComplete,
      onError,
    } = options;

    if (!scenario || !userName || !userRole) {
      throw new Error('Scenario, userName, and userRole are required');
    }

    // Initialize conversation memory with user info and scenario
    conversationMemory.initializeSession(sessionId, scenario, userName, userRole);

    // Generate agents dynamically from scenario
    let agents;
    try {
      agents = await agentGenerator.generateAgents(scenario, userName, userRole);
      if (!agents || agents.length === 0) {
        throw new Error('Failed to generate agents');
      }
    } catch (error) {
      logger.error('Error generating agents:', error);
      onError({
        type: 'error',
        message: error.message || 'Failed to generate agents',
      });
      throw error;
    }

    // Store session data
    this.sessions.set(sessionId, {
      agents,
      scenario,
      userName,
      userRole,
      createdAt: new Date().toISOString(),
      onStreamChunk,
      onStreamComplete,
      onError,
      isProcessing: false, // Flag to prevent concurrent processing
    });

    logger.info(`Practice session ${sessionId} created with ${agents.length} agents`);

    // Start the conversation with first agent response
    setTimeout(async () => {
      await this.continueConversation(sessionId);
    }, 500);

    return {
      sessionId,
      agents: agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        designation: agent.designation,
      })),
      scenario,
    };
  }

  /**
   * Continue conversation - single brain decides next speaker and generates response
   * @param {string} sessionId - Session identifier
   */
  async continueConversation(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.error(`Session ${sessionId} not found`);
      return;
    }

    // Prevent concurrent processing - CRITICAL: Only one agent can speak at a time
    if (session.isProcessing) {
      logger.warn(`Session ${sessionId} is already processing, skipping to prevent concurrent responses`);
      return;
    }

    // Also check if we're waiting for audio to complete
    if (session.waitingForAudioComplete) {
      logger.warn(`Session ${sessionId} is waiting for audio playback to complete, skipping`);
      return;
    }

    session.isProcessing = true;

    try {
      // Use single brain to decide who speaks next and generate response
      const decision = await orchestrator.decideAndGenerateResponse(
        sessionId,
        session.agents,
        session.scenario,
        session.userName,
        session.userRole
      );

      if (decision.speaker === 'user') {
        // User's turn - wait for user input
        logger.info('User turn - waiting for input');
        session.isProcessing = false;
        
        // Send event to enable user input
        session.onStreamChunk({
          type: 'user_turn',
          message: 'It\'s your turn to speak',
        });
        return;
      }

      // An agent should speak
      const agentId = decision.speaker;
      const agent = session.agents.find(a => a.id === agentId);
      
      if (!agent) {
        logger.error(`Agent ${agentId} not found`);
        session.isProcessing = false;
        return;
      }

      // Notify that AI is thinking/speaking - disable user input
      session.onStreamChunk({
        type: 'ai_thinking',
        message: 'AI is thinking...',
      });

          // Notify that response is starting
      session.onStreamChunk({
            type: 'ai_response_start',
        aiId: agentId,
        personality: `${agent.name} (${agent.designation})`,
        gender: agent.gender,
          });

      // If response was already generated by orchestrator, use it; otherwise generate with streaming
      let responseText = decision.response;
      let fullResponse = '';

      if (responseText && responseText.trim() !== '') {
        // Use the response from orchestrator (already generated)
        fullResponse = responseText;
        
        // Display text immediately
        session.onStreamChunk({
          type: 'ai_response_chunk',
          aiId: agentId,
          chunk: fullResponse,
        });
      } else {
        // Generate response with streaming
        const history = conversationMemory.getFormattedMessages(sessionId);
        const systemPrompt = `You are ${agent.name}, ${agent.designation}. ${agent.personalities}

This is a practice conversation for ${session.userName} who is practicing for: "${session.scenario}".
User Role: ${session.userRole}

Speak naturally like a real person. NO bot-like responses, NO formal speech, NO acting.`;

        const messages = [
          { role: 'system', content: systemPrompt },
          ...history,
        ];

        // Stream the response
        await openaiService.streamChatCompletion(
          messages,
          // onChunk
          (chunk) => {
            fullResponse += chunk;
            session.onStreamChunk({
              type: 'ai_response_chunk',
              aiId: agentId,
              chunk: chunk,
            });
          },
          // onComplete
          (completeResponse) => {
            fullResponse = completeResponse;
          },
          // onError
          (error) => {
            logger.error(`Error streaming agent response:`, error);
            session.onError({
              type: 'error',
              aiId: agentId,
              message: error.message || 'Failed to generate response',
            });
            session.isProcessing = false;
          }
        );
      }

      // Add to conversation memory
      conversationMemory.addAssistantMessage(sessionId, fullResponse, agentId);

      // Stream audio using TTS (independent from text display)
      const agentGender = agent.gender || 'female';
      // Get voice index based on agent's position in agents array (for distinct voices)
      const agentIndex = session.agents.findIndex(a => a.id === agentId);
      const voiceIndex = agentIndex >= 0 ? agentIndex % 3 : 0; // Cycle through 3 voices
      
      let firstAudioChunk = true;
      let ttsFirstAudioSent = false;
      
      try {
        await ttsService.streamTextToSpeech(
          fullResponse,
          agentGender,
          voiceIndex,
          // onAudioChunk - send audio chunks as binary
          (audioBuffer) => {
            if (firstAudioChunk) {
              firstAudioChunk = false;
              if (!ttsFirstAudioSent) {
                ttsFirstAudioSent = true;
                // Send tts_first_audio event (JSON)
                session.onStreamChunk({
                  type: 'tts_first_audio',
                  aiId: agentId,
                });
              }
              // Send WAV header with first chunk
              const wavHeader = ttsService.createWavHeader();
              session.onStreamChunk({
                type: 'ai_audio_chunk',
                aiId: agentId,
                audioBuffer: Buffer.concat([wavHeader, audioBuffer]),
              });
            } else {
              // Send subsequent audio chunks as binary
              session.onStreamChunk({
                type: 'ai_audio_chunk',
                aiId: agentId,
                audioBuffer: audioBuffer,
              });
            }
          },
          // onComplete
          () => {
            session.onStreamChunk({
              type: 'ai_audio_end',
              aiId: agentId,
            });
          },
          // onError
          (error) => {
            logger.error(`Error in TTS for agent ${agentId}:`, error);
          }
        );
      } catch (error) {
        logger.error(`Error starting TTS for agent ${agentId}:`, error);
      }

      // Notify completion
      session.onStreamComplete({
        type: 'ai_response_end',
        aiId: agentId,
        fullMessage: fullResponse,
        personality: `${agent.name} (${agent.designation})`,
      });

      // Mark that we're waiting for audio playback to complete
      // Don't continue conversation until audio playback is done
      session.waitingForAudioComplete = true;
      session.currentSpeakingAgentId = agentId;
      // Keep isProcessing = true until audio completes to prevent concurrent responses
      // session.isProcessing will be set to false in onAudioPlaybackComplete

      // Check if AI decided to end the conversation
      if (decision.speaker === 'end' || decision.shouldEnd) {
        logger.info(`Session ${sessionId} ended gracefully by AI decision`);
        // Send end event to frontend
        session.onStreamComplete({
          type: 'conversation_ended',
          message: 'Conversation ended gracefully',
        });
        session.waitingForAudioComplete = false;
        session.currentSpeakingAgentId = null;
        session.isProcessing = false;
        return; // Don't continue conversation
      }

      // Don't continue conversation here - wait for audio_playback_complete event
      // The conversation will continue in onAudioPlaybackComplete method
      // isProcessing remains true to prevent concurrent agent responses

    } catch (error) {
      logger.error('Error in continueConversation:', error);
      session.isProcessing = false;
      session.onError({
        type: 'error',
        message: error.message || 'Failed to continue conversation',
      });
    }
  }

  /**
   * Called when audio playback completes - triggers next agent response
   * @param {string} sessionId - Session identifier
   * @param {string} aiId - Agent ID that finished speaking
   */
  async onAudioPlaybackComplete(sessionId, aiId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.error(`Session ${sessionId} not found`);
      return;
    }

    // Check if we were waiting for this agent's audio to complete
    if (session.waitingForAudioComplete && session.currentSpeakingAgentId === aiId) {
      logger.info(`Audio playback complete for agent ${aiId}, continuing conversation`);
      session.waitingForAudioComplete = false;
      session.currentSpeakingAgentId = null;
      session.isProcessing = false; // Now we can process next response

      // Continue conversation (agent might speak again or user turn)
      // Add a small delay before next decision to ensure audio is fully stopped
      setTimeout(async () => {
        await this.continueConversation(sessionId);
      }, 500);
    } else {
      logger.warn(`Audio playback complete for ${aiId} but not waiting for it (waiting: ${session.waitingForAudioComplete}, current: ${session.currentSpeakingAgentId})`);
    }
  }

  /**
   * Process a user message - single brain decides next speaker and generates response
   * @param {string} sessionId - Session identifier
   * @param {string} message - User message
   */
  async processUserMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Disable user input immediately when they send a message
    session.onStreamChunk({
      type: 'ai_thinking',
      message: 'Processing your response...',
    });

    // Add user message to conversation memory
    conversationMemory.addUserMessage(sessionId, message);

    // Continue conversation (single brain will decide next speaker)
    await this.continueConversation(sessionId);
  }

  /**
   * Get session info
   * @param {string} sessionId - Session identifier
   * @returns {Object|null} Session info or null if not found
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      scenario: session.scenario,
      userName: session.userName,
      userRole: session.userRole,
      createdAt: session.createdAt,
      agents: session.agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        designation: agent.designation,
      })),
      messageCount: conversationMemory.getMessages(sessionId).length,
    };
  }

  /**
   * Delete a session
   * @param {string} sessionId - Session identifier
   */
  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    conversationMemory.clearSession(sessionId);
    logger.info(`Session ${sessionId} deleted`);
  }

  /**
   * Check if session exists
   * @param {string} sessionId - Session identifier
   * @returns {boolean}
   */
  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  /**
   * Get all active session IDs
   * @returns {Array} Array of session IDs
   */
  getActiveSessions() {
    return Array.from(this.sessions.keys());
  }
}

export default new ChatManager();
