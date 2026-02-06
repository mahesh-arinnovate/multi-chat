import openaiService from './openaiService.js';
import { logger } from '../../utils/logger.js';

/**
 * Agent Generator - Dynamically generates agents based on scenario
 */
class AgentGenerator {
  /**
   * Generate agents from scenario
   * @param {string} scenario - The practice scenario
   * @param {string} userName - User's name
   * @param {string} userRole - User's role
   * @returns {Promise<Array>} Array of agent objects with name, designation, personalities
   */
  async generateAgents(scenario, userName, userRole) {
    try {
      const prompt = `You are analyzing a practice scenario. Based on the scenario provided, determine:
1. How many agents/participants are needed (NOT including the user)
2. For each agent, provide:
   - name: A realistic human name (e.g., "Sarah Johnson")
   - designation: Their role in this scenario (e.g., "Scrum Master", "Product Manager")
   - personalities: A brief description of their personality and communication style
   - gender: The gender of the agent based on their name (e.g., "male", "female")

IMPORTANT: 
- The user's name is "${userName}" - DO NOT create any agent with this name
- Only generate agents that the user will interact with (not the user themselves)
- Generate agents with DIFFERENT names from the user
- Determine gender based on the name you assign (e.g., "Sarah" -> "female", "James" -> "male")

Scenario: ${scenario}
User Name: ${userName}
User Role: ${userRole}

Return ONLY a valid JSON array of agent objects. No other text. Format:
[{"name": "Agent Name", "designation": "Role", "personalities": "Description", "gender": "male/female"}]`;

      const messages = [
        {
          role: 'system',
          content: 'You are an expert at analyzing scenarios and determining the appropriate participants. Return only valid JSON arrays.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];

      const response = await openaiService.createChatCompletion(messages);
      
      // Parse the JSON response
      let agents;
      try {
        // Try to extract JSON from response (in case there's extra text)
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          agents = JSON.parse(jsonMatch[0]);
        } else {
          agents = JSON.parse(response);
        }
      } catch (parseError) {
        logger.error('Failed to parse agent generation response:', parseError);
        logger.error('Response was:', response);
        throw new Error('Failed to parse agent generation response');
      }

      // Validate and format agents
      if (!Array.isArray(agents)) {
        throw new Error('Agent generation did not return an array');
      }

      // Add IDs to agents using name + role format for easier tracking
      let formattedAgents = agents.map((agent, index) => {
        if (!agent.name || !agent.designation) {
          throw new Error(`Agent at index ${index} is missing required fields (name, designation)`);
        }
        // Create ID from name and role: "Emily_Carter_ProductManager"
        const cleanName = agent.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        const cleanRole = agent.designation.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        const agentId = `${cleanName}_${cleanRole}`;
        
        return {
          id: agentId,
          name: agent.name,
          designation: agent.designation,
          personalities: agent.personalities || agent.personality || 'Natural conversational style',
          gender: agent.gender || 'female', // Default to female if not provided
        };
      });

      // Filter out any agents that have the same name as the user (case-insensitive)
      const userNameLower = userName.toLowerCase().trim();
      formattedAgents = formattedAgents.filter(agent => {
        const agentNameLower = agent.name.toLowerCase().trim();
        if (agentNameLower === userNameLower) {
          logger.warn(`Filtered out agent with same name as user: ${agent.name}`);
          return false;
        }
        return true;
      });

      // Re-assign IDs after filtering (maintain name_role format)
      formattedAgents = formattedAgents.map((agent) => {
        const cleanName = agent.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        const cleanRole = agent.designation.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        return {
          ...agent,
          id: `${cleanName}_${cleanRole}`,
        };
      });

      if (formattedAgents.length === 0) {
        throw new Error('No valid agents generated (all agents had the same name as user)');
      }

      logger.info(`Generated ${formattedAgents.length} agents for scenario`);
      return formattedAgents;
    } catch (error) {
      logger.error('Error generating agents:', error);
      throw error;
    }
  }
}

export default new AgentGenerator();
