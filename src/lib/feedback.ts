import type { Env } from '../types';
import { hashQuery } from './known-errors';

export interface FeedbackPayload {
  request_id: string;
  session_id?: string;
  agent_type: string;
  query: string;
  response_text: string;
  confidence_level?: string;
  rating: 1 | -1;
  issue_type?: 'hallucination' | 'incomplete' | 'confusing' | 'wrong_citation' | 'outdated' | 'off_topic' | 'other';
  user_correction?: string;
  channel?: 'web' | 'whatsapp' | 'ussd';
}

export async function handleFeedback(body: FeedbackPayload, env: Env): Promise<void> {
  // Store feedback
  await env.DB.prepare(`
    INSERT INTO response_feedback
    (request_id, session_id, agent_type, query, response_text, confidence_level,
     rating, issue_type, user_correction, channel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.request_id,
    body.session_id ?? null,
    body.agent_type,
    body.query.slice(0, 500),
    body.response_text.slice(0, 2000),
    body.confidence_level ?? null,
    body.rating,
    body.issue_type ?? null,
    body.user_correction ?? null,
    body.channel ?? 'web'
  ).run();

  // Track KB gaps from negative feedback
  if (body.rating === -1 && ['incomplete', 'off_topic', 'hallucination'].includes(body.issue_type ?? '')) {
    await trackKbGap(body.query, body.agent_type, env);
  }
}

async function trackKbGap(query: string, agentType: string, env: Env): Promise<void> {
  const topic = extractTopic(query);
  try {
    const existing = await env.DB.prepare(
      'SELECT id, frequency FROM kb_gaps WHERE agent_type = ? AND topic = ? AND status = "open"'
    ).bind(agentType, topic).first<{ id: number; frequency: number }>();

    if (existing) {
      await env.DB.prepare(
        'UPDATE kb_gaps SET frequency = frequency + 1 WHERE id = ?'
      ).bind(existing.id).run();
    } else {
      await env.DB.prepare(
        'INSERT INTO kb_gaps (agent_type, topic, query_examples) VALUES (?, ?, ?)'
      ).bind(agentType, topic, JSON.stringify([query.slice(0, 200)])).run();
    }
  } catch (e) {
    console.error('Failed to track KB gap:', e);
  }
}

function extractTopic(query: string): string {
  // Simple keyword extraction — take first 3 significant words
  const stopWords = new Set(['what', 'how', 'when', 'where', 'which', 'who', 'the', 'is', 'are', 'was', 'were', 'can', 'could', 'would', 'should', 'does', 'did', 'about', 'for', 'with', 'this', 'that', 'from', 'and', 'but', 'not']);
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 3).join(' ') || 'general';
}
