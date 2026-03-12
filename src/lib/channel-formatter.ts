import type { AskOzzyResponse } from '../types/agent-response';

export function formatForChannel(
  response: AskOzzyResponse,
  channel: 'web' | 'whatsapp' | 'ussd'
): string {
  switch (channel) {
    case 'web':
      return JSON.stringify(response);

    case 'whatsapp': {
      const citations = response.citations.map(c =>
        `[${c.index}] ${c.source_label}`
      ).join('\n');
      const confidenceEmoji: Record<string, string> = { high: '✅', medium: '⚠️', low: '❌', none: '🚫' };
      const emoji = confidenceEmoji[response.confidence] || '🚫';
      return `${emoji} *${response.summary || response.answer.slice(0, 80)}*\n\n${response.answer}\n\n_Sources:_\n${citations}`;
    }

    case 'ussd':
      return response.summary ?? response.answer.slice(0, 160) + '...';
  }
}
