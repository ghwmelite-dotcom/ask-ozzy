import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@/services/api';

interface AskTeacherProps {
  teacherId: string;
  teacherName: string;
  subject: string;
  level: string;
  isOpen: boolean;
  onClose: () => void;
}

interface Citation {
  source: string;
  score: number;
}

interface AnswerState {
  answer: string;
  citations: Citation[];
  confidence: string;
}

type Status = 'idle' | 'loading' | 'success' | 'error';

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#22c55e',
  medium: '#f59e0b',
  low: '#ef4444',
};

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

function ConfidenceDot({ confidence }: { confidence: string }) {
  const key = confidence.toLowerCase();
  const color = CONFIDENCE_COLORS[key] ?? CONFIDENCE_COLORS.medium;
  const label = CONFIDENCE_LABELS[key] ?? confidence;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      style={{ color: 'var(--text-secondary)' }}
      aria-label={`Confidence: ${label}`}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          boxShadow: `0 0 6px ${color}88`,
        }}
      />
      {label}
    </span>
  );
}

function LoadingDots() {
  return (
    <span
      className="inline-flex items-center gap-1"
      role="status"
      aria-label="Loading answer"
      style={{ padding: '4px 0' }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--accent)',
            animation: 'askTeacherDotPulse 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </span>
  );
}

export function AskTeacher({
  teacherId,
  teacherName,
  subject,
  level,
  isOpen,
  onClose,
}: AskTeacherProps) {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setQuestion('');
      setStatus('idle');
      setAnswer(null);
      setErrorMsg('');
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    const q = question.trim();
    if (!q || status === 'loading') return;

    setStatus('loading');
    setAnswer(null);
    setErrorMsg('');

    try {
      const result = await api.askTeacher({
        question: q,
        subject,
        level,
        teacher_id: teacherId,
      });
      setAnswer(result);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }, [question, status, subject, level, teacherId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = question.trim().length > 0 && status !== 'loading';

  if (!isOpen) return null;

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes askTeacherSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes askTeacherDotPulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1;   }
        }
        @media (prefers-reduced-motion: reduce) {
          .ask-teacher-panel { animation: none !important; }
          .ask-teacher-dot   { animation: none !important; }
        }
      `}</style>

      {/* Panel */}
      <div
        className="ask-teacher-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Ask ${teacherName} a question`}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-color)',
          borderTopLeftRadius: 'var(--radius)',
          borderTopRightRadius: 'var(--radius)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
          animation: 'askTeacherSlideUp 0.25s cubic-bezier(0.4,0,0.2,1) both',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '55%',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Chat icon */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              Ask {teacherName}
            </span>
          </div>

          <button
            onClick={onClose}
            aria-label="Close Ask Teacher panel"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              transition: 'color 0.15s ease, background 0.15s ease',
              minWidth: 44,
              minHeight: 44,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tertiary)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable response area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Loading state */}
          {status === 'loading' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
              }}
            >
              <LoadingDots />
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {teacherName} is thinking…
              </span>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div
              role="alert"
              style={{
                padding: '12px 16px',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 8,
                fontSize: 13,
                color: '#fca5a5',
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Answer */}
          {status === 'success' && answer && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* Answer text */}
              <div
                style={{
                  padding: '14px 16px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                }}
              >
                {answer.answer === 'I don\'t have verified information on this topic.' ||
                answer.answer.toLowerCase().includes("i don't have verified") ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      fontStyle: 'italic',
                      lineHeight: 1.6,
                    }}
                  >
                    {answer.answer}
                  </p>
                ) : (
                  answer.answer
                    .split('\n')
                    .filter((p) => p.trim())
                    .map((paragraph, i) => (
                      <p
                        key={i}
                        style={{
                          margin: 0,
                          marginTop: i > 0 ? 10 : 0,
                          fontSize: 13,
                          color: 'var(--text-primary)',
                          lineHeight: 1.7,
                        }}
                      >
                        {paragraph}
                      </p>
                    ))
                )}
              </div>

              {/* Confidence + Citations footer */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <ConfidenceDot confidence={answer.confidence} />

                {answer.citations.length > 0 && (
                  <>
                    <span
                      style={{
                        width: 1,
                        height: 14,
                        background: 'var(--border-color)',
                        display: 'inline-block',
                      }}
                    />
                    {answer.citations.map((c, i) => (
                      <button
                        key={i}
                        title={`Source: ${c.source} — ${Math.round(c.score * 100)}% relevance`}
                        aria-label={`Citation: ${c.source}, ${Math.round(c.score * 100)}% relevant`}
                        style={{
                          background: 'var(--accent-dim)',
                          border: '1px solid var(--accent-border)',
                          borderRadius: 6,
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--accent)',
                          cursor: 'pointer',
                          transition: 'background 0.15s ease',
                          whiteSpace: 'nowrap',
                          maxWidth: 180,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background =
                            'rgba(252,209,22,0.2)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background =
                            'var(--accent-dim)';
                        }}
                      >
                        {c.source} · {Math.round(c.score * 100)}%
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            flexShrink: 0,
            background: 'var(--bg-secondary)',
          }}
        >
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask ${teacherName} a question…`}
            rows={2}
            aria-label="Your question"
            disabled={status === 'loading'}
            style={{
              flex: 1,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 13,
              color: 'var(--text-primary)',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5,
              fontFamily: 'inherit',
              transition: 'border-color 0.15s ease',
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLTextAreaElement).style.borderColor =
                'var(--accent-border)';
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLTextAreaElement).style.borderColor =
                'var(--border-color)';
            }}
          />

          <button
            onClick={handleSubmit}
            disabled={!canSend}
            aria-label="Send question"
            style={{
              background: canSend ? 'var(--accent)' : 'var(--bg-elevated)',
              border: 'none',
              borderRadius: 8,
              padding: '0 16px',
              height: 44,
              minWidth: 44,
              cursor: canSend ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s ease, transform 0.1s ease',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (canSend) {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (canSend) {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
              }
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={canSend ? '#0f1117' : 'var(--text-muted)'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
