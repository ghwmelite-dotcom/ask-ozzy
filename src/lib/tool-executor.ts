// Tool executor — runs deterministic tool calls for AskOzzy agents
// Uses safe math evaluation (no eval/Function) for Workers compatibility
import type { Env } from '../types';

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  env: Env
): Promise<string> {
  const start = Date.now();
  let result: string;
  let success = true;

  try {
    switch (toolName) {
      case 'calculate':
        result = executeCalculate(toolInput);
        break;
      case 'lookup_statute_section':
        result = await executeStatuteLookup(toolInput, env);
        break;
      case 'get_exam_question':
        result = await executeExamLookup(toolInput, env);
        break;
      case 'score_student_answer':
        result = await executeScoring(toolInput, env);
        break;
      case 'convert_currency':
        result = await executeCurrencyConversion(toolInput, env);
        break;
      default:
        result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
        success = false;
    }
  } catch (e: any) {
    result = JSON.stringify({ error: `Tool execution failed: ${e?.message}` });
    success = false;
  }

  // Log tool invocation (non-blocking)
  const latency = Date.now() - start;
  try {
    await env.DB.prepare(
      `INSERT INTO tool_invocations (request_id, agent_type, tool_name, tool_input, tool_output, success, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      (toolInput as any)._request_id || 'unknown',
      (toolInput as any)._agent_type || 'unknown',
      toolName,
      JSON.stringify(toolInput).slice(0, 1000),
      result.slice(0, 2000),
      success ? 1 : 0,
      latency
    ).run();
  } catch {
    // Non-critical — don't fail the tool call
  }

  return result;
}

// ─── Safe Math Evaluator ─────────────────────────────────────────────
// Tokenize + recursive descent parser — no eval(), no Function(), Workers-safe

function executeCalculate(input: Record<string, unknown>): string {
  try {
    const expr = String(input.expression || '');
    const result = safeEvaluate(expr);
    const currency = input.currency as string | undefined;

    let formatted: string;
    if (currency === 'GHS') {
      formatted = `GH₵ ${result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (currency) {
      formatted = `${currency} ${result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      formatted = String(result);
    }

    return JSON.stringify({
      expression: input.expression,
      result,
      formatted,
      context: input.context ?? null,
    });
  } catch (e: any) {
    return JSON.stringify({ error: `Calculation failed: ${e?.message}` });
  }
}

// Recursive descent parser for safe math evaluation
// Supports: +, -, *, /, %, ^, parentheses, unary minus
export function safeEvaluate(expr: string): number {
  const tokens = tokenize(expr);
  let pos = 0;

  function peek(): string | null {
    return pos < tokens.length ? tokens[pos] : null;
  }
  function consume(): string {
    return tokens[pos++];
  }

  // expression = term (('+' | '-') term)*
  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  // term = power (('*' | '/' | '%') power)*
  function parseTerm(): number {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else left %= right;
    }
    return left;
  }

  // power = unary ('^' unary)*
  function parsePower(): number {
    let base = parseUnary();
    while (peek() === '^') {
      consume();
      const exp = parseUnary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  // unary = ('-' unary) | primary
  function parseUnary(): number {
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  }

  // primary = NUMBER | '(' expression ')'
  function parsePrimary(): number {
    const tok = peek();
    if (tok === '(') {
      consume(); // '('
      const val = parseExpression();
      if (peek() !== ')') throw new Error('Missing closing parenthesis');
      consume(); // ')'
      return val;
    }
    if (tok !== null && /^[\d.]+$/.test(tok)) {
      consume();
      return parseFloat(tok);
    }
    throw new Error(`Unexpected token: ${tok}`);
  }

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: ${tokens[pos]}`);
  }
  if (!isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = expr.replace(/\s/g, ''); // strip whitespace
  while (i < s.length) {
    if ('+-*/%^()'.includes(s[i])) {
      tokens.push(s[i]);
      i++;
    } else if (/[\d.]/.test(s[i])) {
      let num = '';
      while (i < s.length && /[\d.]/.test(s[i])) {
        num += s[i];
        i++;
      }
      tokens.push(num);
    } else {
      throw new Error(`Invalid character in expression: ${s[i]}`);
    }
  }
  return tokens;
}

// ─── Statute Lookup ──────────────────────────────────────────────────

async function executeStatuteLookup(
  input: Record<string, unknown>,
  env: Env
): Promise<string> {
  const docId = String(input.document || '');
  const section = String(input.section || '');

  // Search knowledge_documents for matching content
  const row = await env.DB.prepare(
    `SELECT content, source, metadata FROM knowledge_documents
     WHERE source LIKE ? AND content LIKE ? LIMIT 1`
  ).bind(`%${docId.replace(/_/g, '%')}%`, `%${section}%`).first();

  if (!row) {
    return JSON.stringify({
      found: false,
      message: `Section ${section} of ${docId.replace(/_/g, ' ')} is not in the current knowledge base. Please consult the official document directly.`,
    });
  }

  return JSON.stringify({
    found: true,
    document: row.source,
    section,
    text: (row.content as string).slice(0, 2000),
  });
}

// ─── Exam Question Lookup ────────────────────────────────────────────

async function executeExamLookup(
  input: Record<string, unknown>,
  env: Env
): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT * FROM exam_questions
     WHERE subject = ? AND year = ? AND paper = ? AND question_number = ?`
  ).bind(input.subject, input.year, input.paper, input.question_number).first();

  if (!row) {
    return JSON.stringify({
      found: false,
      message: `${input.subject} ${input.year} Paper ${input.paper} Q${input.question_number} is not in the database.`,
    });
  }
  return JSON.stringify({ found: true, ...row });
}

// ─── Student Answer Scoring ──────────────────────────────────────────

async function executeScoring(
  input: Record<string, unknown>,
  env: Env
): Promise<string> {
  const questionId = String(input.question_id || '');
  const studentAnswer = String(input.student_answer || '');

  // Look up the question and marking scheme
  const question = await env.DB.prepare(
    'SELECT * FROM exam_questions WHERE id = ?'
  ).bind(questionId).first();

  if (!question) {
    return JSON.stringify({
      found: false,
      message: 'Question not found. Cannot score without the official marking scheme.',
    });
  }

  // Return question + answer for the LLM to score using the marking scheme
  return JSON.stringify({
    found: true,
    question: question.question_text,
    marking_scheme: question.marking_scheme,
    max_marks: question.marks,
    student_answer: studentAnswer,
    instruction: 'Score the student answer against the marking scheme. Award marks for each correct point.',
  });
}

// ─── Currency Conversion ─────────────────────────────────────────────

async function executeCurrencyConversion(
  input: Record<string, unknown>,
  env: Env
): Promise<string> {
  const amount = Number(input.amount);
  const from = String(input.from_currency);
  const to = String(input.to_currency);

  if (from === to) {
    return JSON.stringify({ amount, from, to, result: amount, rate: 1 });
  }

  // Check KV cache for exchange rates (refreshed daily by cron)
  const ratesRaw = await env.SESSIONS.get('exchange_rates:latest');

  // Fallback approximate rates if no cached rates available
  const defaultRates: Record<string, number> = {
    GHS_USD: 0.065, USD_GHS: 15.4,
    GHS_EUR: 0.059, EUR_GHS: 16.9,
    GHS_GBP: 0.051, GBP_GHS: 19.6,
    USD_EUR: 0.91, EUR_USD: 1.10,
    USD_GBP: 0.79, GBP_USD: 1.27,
    EUR_GBP: 0.86, GBP_EUR: 1.16,
  };

  let rates = defaultRates;
  if (ratesRaw) {
    try {
      rates = { ...defaultRates, ...JSON.parse(ratesRaw) };
    } catch {}
  }

  const rateKey = `${from}_${to}`;
  const rate = rates[rateKey];

  if (!rate) {
    return JSON.stringify({
      error: `No exchange rate available for ${from} → ${to}`,
    });
  }

  const result = amount * rate;
  return JSON.stringify({
    amount,
    from,
    to,
    rate,
    result: Math.round(result * 100) / 100,
    formatted: to === 'GHS'
      ? `GH₵ ${result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${to} ${result.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    note: ratesRaw ? 'Using cached exchange rates' : 'Using approximate fallback rates — actual rates may differ',
  });
}
