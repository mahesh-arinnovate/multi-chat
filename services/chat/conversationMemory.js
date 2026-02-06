/**
 * Conversation Memory - Stores shared conversation context across AI instances
 */

class ConversationMemory {
  constructor() {
    // Map of sessionId -> array of messages
    this.memories = new Map();
  }

  /**
   * Initialize memory for a session
   * @param {string} sessionId - Session identifier
   * @param {string} scenario - Practice scenario description
   * @param {string} userName - User's name
   * @param {string} userRole - User's role in the scenario
   */
  initializeSession(sessionId, scenario, userName, userRole) {
    const messages = [];
    
    const systemContent = `This is a practice session for ${userName} who is practicing for: "${scenario}".
User Role: ${userRole}

This is a natural conversation practice session. The conversation will flow naturally with agents and the user taking turns. All participants share the same conversation history and can see all previous messages.`;

    messages.push({
      role: 'system',
      content: systemContent,
    });

    this.memories.set(sessionId, messages);
  }

  /**
   * Add a user message to the conversation
   * @param {string} sessionId - Session identifier
   * @param {string} content - Message content
   */
  addUserMessage(sessionId, content) {
    const messages = this.memories.get(sessionId) || [];
    messages.push({
      role: 'user',
      content: content,
      timestamp: new Date().toISOString(),
    });
    this.memories.set(sessionId, messages);
  }

  /**
   * Add an AI assistant message to the conversation
   * @param {string} sessionId - Session identifier
   * @param {string} content - Message content
   * @param {string} aiId - AI instance identifier
   */
  addAssistantMessage(sessionId, content, aiId) {
    const messages = this.memories.get(sessionId) || [];
    messages.push({
      role: 'assistant',
      content: content,
      aiId: aiId,
      timestamp: new Date().toISOString(),
    });
    this.memories.set(sessionId, messages);
  }

  /**
   * Get all messages for a session
   * @param {string} sessionId - Session identifier
   * @returns {Array} Array of message objects
   */
  getMessages(sessionId) {
    return this.memories.get(sessionId) || [];
  }

  /**
   * Get messages formatted for OpenAI API (without metadata)
   * @param {string} sessionId - Session identifier
   * @returns {Array} Array of message objects with role and content only
   */
  getFormattedMessages(sessionId) {
    const messages = this.getMessages(sessionId);
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Clear memory for a session
   * @param {string} sessionId - Session identifier
   */
  clearSession(sessionId) {
    this.memories.delete(sessionId);
  }

  /**
   * Check if session exists
   * @param {string} sessionId - Session identifier
   * @returns {boolean}
   */
  hasSession(sessionId) {
    return this.memories.has(sessionId);
  }

  /**
   * Get all active session IDs
   * @returns {Array} Array of session IDs
   */
  getActiveSessions() {
    return Array.from(this.memories.keys());
  }
}

export default new ConversationMemory();
