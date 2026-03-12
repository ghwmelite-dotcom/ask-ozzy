// Central tool registry for AskOzzy agents
// Defines available tools and which agents can use them

export interface AITool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const ASKOZZY_TOOLS: AITool[] = [
  {
    name: 'calculate',
    description:
      'Perform precise arithmetic, percentage calculations, currency conversions, or budget computations. Use this for ANY numerical calculation — never compute math in your response text.',
    input_schema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'Mathematical expression to evaluate. Examples: "2500000 * 0.075", "(450000 / 12) * 3", "1200000 + (1200000 * 0.125)"',
        },
        currency: {
          type: 'string',
          enum: ['GHS', 'USD', 'EUR', 'GBP'],
          description: 'Optional: currency context for formatting output',
        },
        context: {
          type: 'string',
          description: 'What is being calculated (for display purposes)',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'lookup_statute_section',
    description:
      "Retrieve the exact text of a specific section, article, or provision from Ghana's legislation. Use this when a user asks about a specific section number.",
    input_schema: {
      type: 'object',
      properties: {
        document: {
          type: 'string',
          enum: [
            'act_663',
            'act_914',
            'constitution_1992',
            'civil_service_act',
            'data_protection_act_843',
            'financial_administration_act_654',
          ],
          description: 'The document to look up',
        },
        section: {
          type: 'string',
          description:
            'Section/Article number. Examples: "40", "40(3)", "Article 24", "Part III"',
        },
      },
      required: ['document', 'section'],
    },
  },
  {
    name: 'get_exam_question',
    description:
      'Retrieve a specific WASSCE or BECE exam question with its official marking scheme.',
    input_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Subject name, e.g. "Core Mathematics", "English Language"',
        },
        year: { type: 'number', description: 'Exam year, e.g. 2023' },
        paper: { type: 'string', enum: ['1', '2', '3'], description: 'Paper number' },
        question_number: { type: 'number', description: 'Question number' },
      },
      required: ['subject', 'year', 'paper', 'question_number'],
    },
  },
  {
    name: 'score_student_answer',
    description:
      "Score a student's answer against the official WAEC marking scheme. Returns marks awarded, max marks, and marking breakdown.",
    input_schema: {
      type: 'object',
      properties: {
        question_id: {
          type: 'string',
          description: 'Question ID from get_exam_question',
        },
        student_answer: {
          type: 'string',
          description: "The student's answer to evaluate",
        },
      },
      required: ['question_id', 'student_answer'],
    },
  },
  {
    name: 'convert_currency',
    description:
      'Convert amounts between GHS and other currencies using cached exchange rates.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Amount to convert' },
        from_currency: {
          type: 'string',
          enum: ['GHS', 'USD', 'EUR', 'GBP'],
          description: 'Source currency',
        },
        to_currency: {
          type: 'string',
          enum: ['GHS', 'USD', 'EUR', 'GBP'],
          description: 'Target currency',
        },
      },
      required: ['amount', 'from_currency', 'to_currency'],
    },
  },
];

// Which tools each agent type can access
const AGENT_TOOL_MAP: Record<string, string[]> = {
  procurement: ['calculate', 'lookup_statute_section'],
  finance: ['calculate', 'convert_currency', 'lookup_statute_section'],
  legal: ['lookup_statute_section'],
  wassce: ['calculate', 'get_exam_question', 'score_student_answer'],
  bece: ['calculate', 'get_exam_question', 'score_student_answer'],
  exam_marker: ['get_exam_question', 'score_student_answer'],
  hr: ['lookup_statute_section'],
  governance: ['lookup_statute_section'],
  general: ['calculate'],
  study_coach: ['calculate', 'get_exam_question'],
  it: [],
  translation: [],
  document_drafter: [],
  citizen: ['calculate'],
  research: ['calculate'],
};

export function getToolsForAgent(agentType: string): AITool[] {
  const toolNames = AGENT_TOOL_MAP[agentType] ?? AGENT_TOOL_MAP.general;
  if (toolNames.length === 0) return [];
  return ASKOZZY_TOOLS.filter((t) => toolNames.includes(t.name));
}

// System prompt addition for tool-enabled agents
export const TOOL_USE_RULES = `## Tool Use Rules
You have access to tools for deterministic operations. You MUST use these tools instead of computing in your response text:

- Any arithmetic → use \`calculate\` tool
- Any section/article number lookup → use \`lookup_statute_section\` tool
- Any exam question retrieval → use \`get_exam_question\` tool
- Any student answer scoring → use \`score_student_answer\` tool
- Any currency conversion → use \`convert_currency\` tool

NEVER state a calculated value, section text, or exam answer without first calling the appropriate tool.
If a tool returns { "found": false }, inform the user that the resource is not in the database.`;
