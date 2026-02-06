import openaiService from '../ai/openaiService.js';
import conversationMemory from './conversationMemory.js';
import { logger } from '../../utils/logger.js';

/**
 * Orchestrator - Single AI Brain that manages multi-agent conversation
 * Decides who speaks next AND generates what they say
 * Has access to full conversation history
 */
class Orchestrator {
  /**
   * Decide who speaks next AND generate their response (single brain approach)
   * @param {string} sessionId - Session identifier
   * @param {Array} agents - Array of agent objects {id, name, designation, personalities}
   * @param {string} scenario - Practice scenario
   * @param {string} userName - User's name
   * @param {string} userRole - User's role
   * @returns {Promise<Object>} {speaker: "Name_Role" or "user", response: "..." or null}
   */
  async decideAndGenerateResponse(sessionId, agents, scenario, userName, userRole) {
    try {
      // Get FULL conversation history (raw content, no format markers)
      const fullHistory = conversationMemory.getMessages(sessionId);
      
      // Format history ONLY for AI context - add agent name/ID prefix for tracking
      // This is NOT stored in memory, only used when sending to AI
      const formattedHistoryForAI = fullHistory.map(msg => {
        if (msg.role === 'assistant' && msg.aiId) {
          const agent = agents.find(a => a.id === msg.aiId);
          if (agent) {
            return {
              role: msg.role,
              content: `[${agent.name} - ${agent.id}]: ${msg.content}`,
            };
          }
        }
        return {
          role: msg.role,
          content: msg.content,
        };
      });
      
      // Build agent information string (ID is now name_role format)
      const agentsInfo = agents.map(agent => 
        `- ${agent.name} (ID: ${agent.id}): ${agent.designation} - ${agent.personalities}`
      ).join('\n');

      // Build system prompt
      const systemPrompt = `You are orchestrating a realistic practice conversation for ${userName} regarding: "${scenario}".

Available Agents:
${agentsInfo}

### CONVERSATION STYLE (CRITICAL):
- You are REAL HUMANS, NOT AI agents. Act like real people having a real conversation
- You have EMOTIONS and LOGICAL THINKING like humans - show frustration, concern, satisfaction, skepticism, etc.
- Use logical reasoning and emotional responses naturally - like real people do
- This is a REAL conversation between real people, NOT a scripted meeting
- Speak naturally and casually - like colleagues talking, not formal presentations
- NO greetings like "Hey team! Good morning, everyone!" - just start naturally
- NO phrases like "Hope you all are doing well" - too formal/bot-like
- NO repetitive closing phrases - just speak naturally
- Example: Instead of "Hey team! Good morning! Let's get started. Mahesh, would you like to kick things off?"
  Say: "Mahesh, what have you been working on?"
- Be direct, natural, professional but casual
- Remember: You are humans with emotions and logic, not AI - speak like real people do

### ***Strict Rules***: FEEDBACK MIX (REALISTIC):
- Mix positive AND negative feedback naturally - real meetings have both
- Negative: Point out flaws, ask about previous issues/mistakes, blame/criticize work, challenge decisions, say "it might not work", "this could fail", "I'm concerned about..."
- Positive: Acknowledge good work, ask about successes, show appreciation
- Careless responses: If ${userName} gives vague/careless/evasive answers, agents should scold, apply pressure, ask for specifics, demand better answers (e.g., "That's not specific enough", "You need to be more clear", "I need actual details, not vague answers")
- Scenario-specific: Appraisals (point out flaws to justify lower increment), Presentations (tactical questions to break confidence), Standups (challenge blockers/issues)
- Balance: Don't be only supportive or only critical

### CRITICAL RULES - USER-FOCUSED CONVERSATION (60% USER, 40% AGENTS):
1. STARTING: If the history is empty, an agent MUST start. Choose the logical lead (e.g., Scrum Master for Standups).
2. THE "ONLY ONE" RULE: If the last message was from ${userName}, exactly ONE agent speaks next.
3. USER-FOCUSED: This is a PRACTICE SESSION for ${userName}. The goal is for ${userName} to speak 60% of the time, agents 40%.
4. AGENT BEHAVIOR: Agents should ask questions, seek ${userName}'s input, and give ${userName} opportunities to respond. Limit agent-to-agent discussions - they should primarily interact with ${userName}.
5. NO DOUBLE-QUESTIONING: If an agent asks ${userName} a question, no other agent may ask ${userName} until ${userName} responds.
6. TURN TAKING: Do not repeat the same agent twice in a row. Check last message - if Agent X spoke, next MUST be different Agent Y/Z or ${userName}.
7. STRICT AGENT-TO-AGENT LIMIT: MAXIMUM 3 consecutive agent messages allowed. After 3 agents have spoken in a row, you MUST return "USER:" - it is ${userName}'s turn. Count agent messages: if the last 3 messages in history are all from agents, output "USER:".
8. AGENT-TO-AGENT DISCUSSIONS: Agents can briefly discuss among themselves (MAX 2-3 exchanges), but MUST quickly bring ${userName} back into the conversation with a question or request for input. Never exceed 3 agent messages in a row.
9. USER TURN PRIORITY: After an agent speaks, count how many agents have spoken consecutively. If 2 or more agents have spoken, strongly prefer ${userName}'s turn next. After 3 agents, it is MANDATORY to return "USER:".

### FORMATTING (STRICT):
- Agent speaking: "AGENT:[agent_id]" (e.g., AGENT:Emily_Carter_ProductManager) followed by a newline and their NATURAL response.
- User's turn: Return ONLY "USER:" (nothing else, no text, no explanation, no agent response).
- CRITICAL: "USER:" is an internal signal only - it means "wait for user input". Do NOT include "USER:" in any agent's spoken response text.
- NEVER write "USER:" as part of an agent's dialogue. If you want to indicate the user should speak, have the agent ask a question naturally instead.
- When ending session: After lead agent says "Thank you everyone" or "Thanks everyone", return "END:" to signal conversation is complete.
- Agent IDs are in format: Name_Role (e.g., Emily_Carter_ProductManager, James_Thompson_ScrumMaster)
- IMPORTANT: The conversation history shows "[Name - ID]: message" format - this is ONLY for tracking. Do NOT include this format in your response. Just write the natural dialogue.

### EVALUATION STEP (USER-FOCUSED):
Before responding, check: 
- Was the last message from ${userName}? If YES, output ONLY one agent (brief response, then ask ${userName} a question).
- Did the previous agent ask ${userName} a question? If YES, output "USER:" (it's ${userName}'s turn).
- Did an agent just speak? If YES, strongly prefer "USER:" next (give ${userName} the turn). Only output another agent if absolutely necessary (brief agent clarification), then immediately return to ${userName}.
- Who spoke last? Extract agent_id from history. If Agent X spoke, next MUST be ${userName} (USER:) or a different Agent Y/Z only if brief clarification needed.

CONVERSATION LOGIC (60% USER, 40% AGENTS):
- History empty -> AGENT:[id] starts (natural, direct opening with a question for ${userName}).
- User just spoke -> AGENT:[id] responds (One only, brief response, then ask ${userName} a question).
- Agent spoke -> USER: (${userName}'s turn - agents should ask questions to keep ${userName} engaged).
- Agent-to-agent discussion -> Limit to 1-2 exchanges, then immediately return to ${userName} with a question.
- When everything is done from everyone -> Lead agent (Scrum Master/Manager) says "Thank you everyone" or "Thanks everyone" to end the session.

REMEMBER: This is ${userName}'s practice session. Agents should facilitate ${userName}'s practice, not dominate the conversation. Keep ${userName} speaking 60% of the time.`;

      const messages = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...formattedHistoryForAI, // Use formatted history only for AI
      ];

      // Get decision and response from single brain
      const response = await openaiService.createChatCompletion(messages);
      
      // Parse the response
      const trimmedResponse = response.trim();
      
      // Check if conversation should end
      if (trimmedResponse.startsWith('END:') || trimmedResponse === 'END') {
        logger.info('Single brain decided: Conversation ended gracefully');
        return { speaker: 'end', response: null };
      }
      
      // Check if it's a user turn
      // Check for USER: signal (case-insensitive, with or without colon)
      const userTurnPattern = /^USER:?\s*$/i;
      if (userTurnPattern.test(trimmedResponse)) {
        logger.info('Single brain decided: User turn');
        return { speaker: 'user', response: null };
      }
      
      // Also check if response contains only "USER:" (might have whitespace)
      if (trimmedResponse.trim().toUpperCase() === 'USER' || trimmedResponse.trim().toUpperCase() === 'USER:') {
        logger.info('Single brain decided: User turn (alternative format)');
        return { speaker: 'user', response: null };
      }
      
      // Check if it's an agent response - handle both single line and multi-line formats
      const agentMatch = trimmedResponse.match(/^AGENT:([\w_]+)[\s\n]*(.*)$/s);
      if (agentMatch) {
        const agentId = agentMatch[1].trim();
        let agentResponse = agentMatch[2].trim();
        
        // Remove leading newlines and whitespace
        agentResponse = agentResponse.replace(/^\s*\n+/, '').trim();
        
        // Remove any format markers that might have leaked in (e.g., "[Name - ID]:")
        // Remove all occurrences, not just at the start
        agentResponse = agentResponse.replace(/\[[^\]]+\]:\s*/g, '').trim();
        
        // CRITICAL: Remove "USER:" if it somehow got included in the agent response
        // This should never happen, but we filter it out as a safety measure
        agentResponse = agentResponse.replace(/^USER:\s*/i, '').trim();
        agentResponse = agentResponse.replace(/\s*USER:\s*$/i, '').trim();
        agentResponse = agentResponse.replace(/\bUSER:\s*/gi, '').trim();
        
        // If after cleaning, the response is empty or only contains "USER:", something went wrong
        if (!agentResponse || agentResponse.toUpperCase().trim() === 'USER' || agentResponse.toUpperCase().trim() === 'USER:') {
          logger.warn(`Agent response was empty or only contained USER:, using fallback`);
          return this.fallbackDecision(agents, fullHistory);
        }
        
        // Check if response contains END: (AI decided to end)
        if (agentResponse.includes('END:') || trimmedResponse.includes('\nEND:')) {
          // Extract the message before END:
          const messageMatch = agentResponse.match(/^(.*?)(?:\n?END:.*)?$/s);
          const cleanResponse = messageMatch ? messageMatch[1].trim() : agentResponse.replace(/\n?END:.*$/, '').trim();
          logger.info(`Agent ${agentId} ended conversation gracefully`);
          return { speaker: agentId, response: cleanResponse, shouldEnd: true };
        }
        
        // Validate agent ID
        const validAgentIds = agents.map(a => a.id);
        if (validAgentIds.includes(agentId)) {
          const agent = agents.find(a => a.id === agentId);
          logger.info(`Single brain decided: ${agentId} (${agent.name}) should speak`);
          return { speaker: agentId, response: agentResponse };
        } else {
          logger.warn(`Invalid agent ID in response: ${agentId}, using fallback`);
          return this.fallbackDecision(agents, fullHistory);
        }
      }
      
      // If format doesn't match, try to extract agent ID from response
      // Sometimes AI might respond differently
      for (const agent of agents) {
        if (trimmedResponse.toLowerCase().includes(agent.id.toLowerCase()) || 
            trimmedResponse.toLowerCase().includes(agent.name.toLowerCase())) {
          logger.info(`Single brain decided (fallback): ${agent.id} (${agent.name}) should speak`);
          // Clean response - remove any format markers
          let cleanResponse = trimmedResponse.replace(/\[[^\]]+\]:\s*/g, '').trim();
          return { speaker: agent.id, response: cleanResponse };
        }
      }
      
      // Default: assume it's an agent response (first agent)
      logger.warn('Could not parse response format, using first agent as fallback');
      return this.fallbackDecision(agents, fullHistory);
    } catch (error) {
      logger.error('Orchestrator error:', error);
      const fullHistory = conversationMemory.getMessages(sessionId) || [];
      return this.fallbackDecision(agents, fullHistory);
    }
  }
  
  /**
   * Fallback decision if parsing fails
   * @param {Array} agents - Array of agent objects
   * @param {Array} history - Conversation history
   * @returns {Object} {speaker, response}
   */
  fallbackDecision(agents, history) {
    if (agents.length === 0) {
      return { speaker: 'user', response: null };
    }
    
    // Simple round-robin: find last agent who spoke
    const lastAgentId = history
      .slice()
      .reverse()
      .find(msg => msg.role === 'assistant' && msg.aiId)?.aiId;
    
    if (lastAgentId) {
      const lastIndex = agents.findIndex(a => a.id === lastAgentId);
      const nextIndex = (lastIndex + 1) % agents.length;
      return { speaker: agents[nextIndex].id, response: null }; // Response will be generated separately
    }
    
    // Default to first agent
    return { speaker: agents[0].id, response: null };
  }

}

export default new Orchestrator();
