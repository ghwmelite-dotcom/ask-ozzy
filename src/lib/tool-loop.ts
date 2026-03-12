// Agentic tool loop — model calls tools, results returned, model generates final response
// Workers AI function calling: model → tool call → tool result → model (repeat up to maxIterations)
import type { Env } from '../types';
import { getParams } from '../config/inference-params';
import { getToolsForAgent, TOOL_USE_RULES } from '../config/tools';
import { executeTool } from './tool-executor';

interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export async function runWithTools(
  messages: AIMessage[],
  agentType: string,
  env: Env,
  requestId?: string,
  maxIterations = 3
): Promise<{ response: string; toolsUsed: string[] }> {
  const params = getParams(agentType);
  const agentTools = getToolsForAgent(agentType);

  // No tools for this agent type — just run normally
  if (agentTools.length === 0) {
    const result = await env.AI.run(params.model as any, {
      messages: messages as any,
      temperature: params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      max_tokens: params.max_tokens,
    } as any);
    const text = typeof result === 'string' ? result : (result as any)?.response || '';
    return { response: text, toolsUsed: [] };
  }

  // Inject tool use rules into system prompt if not already present
  const currentMessages = messages.map((m) => {
    if (m.role === 'system' && !m.content.includes('Tool Use Rules')) {
      return { ...m, content: m.content + '\n\n' + TOOL_USE_RULES };
    }
    return { ...m };
  });

  const toolsUsed: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const response = await env.AI.run(params.model as any, {
      messages: currentMessages as any,
      tools: agentTools as any,
      temperature: params.temperature,
      top_p: params.top_p,
      top_k: params.top_k,
      max_tokens: params.max_tokens,
    } as any);

    const resp = response as any;

    // If no tool calls, model is done — return final response
    if (!resp.tool_calls || resp.tool_calls.length === 0) {
      const text = typeof resp === 'string' ? resp : resp.response || '';
      return { response: text, toolsUsed };
    }

    // Execute each tool call in parallel
    const toolResults = await Promise.all(
      resp.tool_calls.map(async (call: ToolCall) => {
        toolsUsed.push(call.name);
        // Inject request metadata for logging
        const enrichedInput = {
          ...call.arguments,
          _request_id: requestId || 'unknown',
          _agent_type: agentType,
        };
        const output = await executeTool(call.name, enrichedInput, env);
        return {
          role: 'tool' as const,
          tool_call_id: call.id,
          content: output,
        };
      })
    );

    // Add assistant's tool call message + results to conversation
    currentMessages.push({
      role: 'assistant',
      content: resp.response || '',
      tool_calls: resp.tool_calls,
    });
    for (const tr of toolResults) {
      currentMessages.push(tr);
    }
  }

  // If we exhausted iterations, return what we have
  return {
    response: 'I attempted to process your request but reached the maximum number of tool iterations. Please try rephrasing your question.',
    toolsUsed,
  };
}

// Check if an agent type has tools available
export function agentHasTools(agentType: string): boolean {
  return getToolsForAgent(agentType).length > 0;
}
