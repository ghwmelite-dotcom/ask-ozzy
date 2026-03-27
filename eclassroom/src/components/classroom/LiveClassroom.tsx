import { useEffect, useRef, useState, useCallback } from 'react';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  type: 'chat' | 'system';
  timestamp: number;
}

interface Student {
  id: string;
  name: string;
  handRaised: boolean;
}

interface LiveClassroomProps {
  classroomId: string;
  studentId: string;
  studentName: string;
  title: string;
  onLeave: () => void;
}

export function LiveClassroom({ classroomId, studentId, studentName, title, onLeave }: LiveClassroomProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [input, setInput] = useState('');
  const [handRaised, setHandRaised] = useState(false);
  const [connected, setConnected] = useState(false);
  const [showStudents, setShowStudents] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const wsUrl = `wss://askozzy.work/api/eclassroom/classroom/${classroomId}/ws?studentId=${encodeURIComponent(studentId)}&name=${encodeURIComponent(studentName)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener('open', () => setConnected(true));
    ws.addEventListener('close', () => setConnected(false));

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string;
          sender?: string;
          text?: string;
          name?: string;
          students?: Student[];
          studentId?: string;
          raised?: boolean;
        };

        switch (data.type) {
          case 'chat':
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender: data.sender ?? 'Unknown',
                text: data.text ?? '',
                type: 'chat',
                timestamp: Date.now(),
              },
            ]);
            break;

          case 'join':
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender: 'system',
                text: `${data.name ?? 'Someone'} joined the classroom`,
                type: 'system',
                timestamp: Date.now(),
              },
            ]);
            break;

          case 'leave':
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender: 'system',
                text: `${data.name ?? 'Someone'} left the classroom`,
                type: 'system',
                timestamp: Date.now(),
              },
            ]);
            break;

          case 'students':
            if (data.students) setStudents(data.students);
            break;

          case 'hand':
            setStudents((prev) =>
              prev.map((s) =>
                s.id === data.studentId ? { ...s, handRaised: !!data.raised } : s
              )
            );
            break;
        }
      } catch {
        // ignore malformed messages
      }
    });

    return () => {
      ws.close();
    };
  }, [classroomId, studentId, studentName]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'chat', text }));
    setInput('');
  };

  const toggleHand = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const newState = !handRaised;
    wsRef.current.send(JSON.stringify({ type: 'hand', raised: newState }));
    setHandRaised(newState);
  };

  const studentCount = students.length;

  return (
    <div
      className="flex flex-col"
      style={{
        height: 'calc(100vh - 3px)',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <button
          onClick={onLeave}
          className="flex items-center justify-center rounded-lg"
          style={{
            width: 44,
            height: 44,
            background: 'rgba(206, 17, 38, 0.12)',
            border: '1px solid rgba(206, 17, 38, 0.3)',
            color: '#CE1126',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          aria-label="Leave room"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: connected ? '#22c55e' : '#ef4444' }}
            />
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {connected ? 'Connected' : 'Reconnecting...'}
            </span>
          </div>
        </div>

        <button
          onClick={() => setShowStudents(!showStudents)}
          className="flex items-center gap-1.5 px-3 rounded-lg"
          style={{
            height: 44,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
          }}
          aria-label={`${studentCount} students`}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-semibold">{studentCount}</span>
        </button>

        <button
          onClick={toggleHand}
          className="flex items-center justify-center rounded-lg"
          style={{
            width: 44,
            height: 44,
            background: handRaised ? 'var(--accent)' : 'var(--bg-tertiary)',
            border: `1px solid ${handRaised ? 'var(--accent)' : 'var(--border-color)'}`,
            color: handRaised ? '#000' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 20,
            boxShadow: handRaised ? 'var(--gold-glow)' : 'none',
            transition: 'all 0.2s var(--transition-ease)',
            flexShrink: 0,
          }}
          aria-label={handRaised ? 'Lower hand' : 'Raise hand'}
        >
          {handRaised ? '✋' : '🤚'}
        </button>
      </div>

      {/* Student list panel (collapsible) */}
      {showStudents && (
        <div
          className="px-4 py-3 flex-shrink-0 animate-in"
          style={{
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
            Students ({studentCount})
          </p>
          <div className="flex flex-wrap gap-2">
            {students.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                }}
              >
                {s.handRaised && <span>✋</span>}
                {s.name}
                {s.id === studentId && (
                  <span className="text-[9px] font-bold" style={{ color: 'var(--accent)' }}>(you)</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No messages yet. Say hello!
            </p>
          </div>
        )}
        {messages.map((msg) =>
          msg.type === 'system' ? (
            <div key={msg.id} className="text-center py-2">
              <span
                className="text-[11px] px-3 py-1 rounded-full"
                style={{
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                }}
              >
                {msg.text}
              </span>
            </div>
          ) : (
            <div
              key={msg.id}
              className="mb-3"
              style={{
                textAlign: msg.sender === studentName ? 'right' : 'left',
              }}
            >
              <div
                className="inline-block max-w-[80%] rounded-2xl px-4 py-2.5 text-sm"
                style={{
                  background: msg.sender === studentName ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                  border: `1px solid ${msg.sender === studentName ? 'var(--accent-border)' : 'var(--border-color)'}`,
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                {msg.sender !== studentName && (
                  <p className="text-[10px] font-bold mb-1" style={{ color: 'var(--accent)' }}>
                    {msg.sender}
                  </p>
                )}
                <p style={{ lineHeight: 1.5 }}>{msg.text}</p>
              </div>
            </div>
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border-color)',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage();
          }}
          placeholder="Type a message..."
          className="flex-1 rounded-xl px-4 text-sm"
          style={{
            height: 44,
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim()}
          className="flex items-center justify-center rounded-xl"
          style={{
            width: 44,
            height: 44,
            background: input.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: input.trim() ? '#000' : 'var(--text-muted)',
            border: 'none',
            cursor: input.trim() ? 'pointer' : 'default',
            flexShrink: 0,
            transition: 'all 0.2s',
          }}
          aria-label="Send message"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
