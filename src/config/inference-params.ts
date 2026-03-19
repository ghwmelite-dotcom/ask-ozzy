// Centralized inference parameters for all AskOzzy agents
// Lower temperature = more deterministic = fewer creative fabrications

export interface InferenceParams {
  temperature: number;
  top_p: number;
  top_k: number;
  max_tokens: number;
  model: string;
  response_format?: { type: 'json_object' };
}

export const AGENT_PARAMS: Record<string, InferenceParams> = {
  procurement: {
    temperature: 0.1, top_p: 0.85, top_k: 30, max_tokens: 800,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  legal: {
    temperature: 0.1, top_p: 0.85, top_k: 30, max_tokens: 800,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  hr: {
    temperature: 0.15, top_p: 0.88, top_k: 35, max_tokens: 600,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  it: {
    temperature: 0.2, top_p: 0.9, top_k: 40, max_tokens: 600,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  finance: {
    temperature: 0.1, top_p: 0.85, top_k: 30, max_tokens: 600,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  governance: {
    temperature: 0.2, top_p: 0.9, top_k: 40, max_tokens: 700,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  wassce: {
    temperature: 0.15, top_p: 0.88, top_k: 35, max_tokens: 700,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  bece: {
    temperature: 0.15, top_p: 0.88, top_k: 35, max_tokens: 600,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  exam_marker: {
    temperature: 0.05, top_p: 0.8, top_k: 20, max_tokens: 400,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  study_coach: {
    temperature: 0.3, top_p: 0.92, top_k: 50, max_tokens: 600,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  research: {
    temperature: 0.25, top_p: 0.92, top_k: 45, max_tokens: 1000,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  translation: {
    temperature: 0.3, top_p: 0.92, top_k: 50, max_tokens: 500,
    model: '@cf/meta/llama-3.1-8b-instruct'
    // No JSON mode for translation — free-form text
  },
  document_drafter: {
    temperature: 0.35, top_p: 0.93, top_k: 55, max_tokens: 1200,
    model: '@cf/meta/llama-3.1-8b-instruct'
    // No JSON mode for document drafting
  },
  citizen: {
    temperature: 0.2, top_p: 0.9, top_k: 40, max_tokens: 500,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  general: {
    temperature: 0.2, top_p: 0.9, top_k: 40, max_tokens: 700,
    model: '@cf/meta/llama-3.1-8b-instruct',
    response_format: { type: 'json_object' }
  },
  verifier: {
    temperature: 0.05, top_p: 0.8, top_k: 20, max_tokens: 600,
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    response_format: { type: 'json_object' }
  }
};

// Map agent names to knowledge_category keys for param lookup
const AGENT_NAME_TO_CATEGORY: Record<string, string> = {
  'Procurement Specialist': 'procurement',
  'IT Helpdesk': 'it',
  'HR & Admin Officer': 'hr',
  'Study Coach': 'study_coach',
  'Essay Writing Tutor': 'general',
  'WASSCE Prep': 'wassce',
  'Research Assistant': 'research',
  'Memo & Correspondence Officer': 'document_drafter',
  'Budget & Finance Analyst': 'finance',
  'Legal Compliance Advisor': 'legal',
  'Meeting Minutes Secretary': 'document_drafter',
  'Report Writer': 'document_drafter',
  'M&E Officer': 'governance',
  'Translation Assistant': 'translation',
};

export function getParams(agentTypeOrName: string): InferenceParams {
  // Try direct lookup first (by knowledge_category)
  if (AGENT_PARAMS[agentTypeOrName]) {
    return AGENT_PARAMS[agentTypeOrName];
  }
  // Try mapping from agent name
  const category = AGENT_NAME_TO_CATEGORY[agentTypeOrName];
  if (category && AGENT_PARAMS[category]) {
    return AGENT_PARAMS[category];
  }
  return AGENT_PARAMS.general;
}

// Get the agent category from either knowledge_category or agent name
export function resolveAgentCategory(knowledgeCategory: string | null, agentName?: string): string {
  if (knowledgeCategory && AGENT_PARAMS[knowledgeCategory]) {
    return knowledgeCategory;
  }
  if (agentName) {
    return AGENT_NAME_TO_CATEGORY[agentName] || 'general';
  }
  return 'general';
}
