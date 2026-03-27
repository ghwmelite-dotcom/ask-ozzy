import { useState } from 'react';

interface JoinRoomProps {
  onJoin: (code: string) => void;
  onCreate: (title: string, type: string) => void;
  error?: string;
  loading?: boolean;
}

const ROOM_TYPES = [
  { id: 'lesson', label: 'Lesson Review' },
  { id: 'study', label: 'Study Group' },
  { id: 'exam_prep', label: 'Exam Prep' },
];

export function JoinRoom({ onJoin, onCreate, error, loading }: JoinRoomProps) {
  const [code, setCode] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('lesson');

  const handleCodeInput = (value: string) => {
    setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  };

  const handleJoin = () => {
    if (code.length === 6) onJoin(code);
  };

  const handleCreate = () => {
    if (newTitle.trim()) onCreate(newTitle.trim(), newType);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-primary)' }}>
      <div
        className="w-full max-w-md animate-in"
        style={{ animationDelay: '100ms' }}
      >
        {/* Join Section */}
        <div
          className="rounded-2xl p-6 mb-4"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div className="text-center mb-6">
            <div
              className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl"
              style={{
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent-border)',
              }}
            >
              <svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Join Live Classroom
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Enter the 6-character room code
            </p>
          </div>

          <div className="mb-4">
            <input
              type="text"
              value={code}
              onChange={(e) => handleCodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoin();
              }}
              placeholder="ABC123"
              maxLength={6}
              className="w-full text-center text-3xl tracking-[0.4em] rounded-xl px-4"
              style={{
                height: 64,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                color: 'var(--accent)',
                fontFamily: "'SF Mono', 'Fira Code', 'Courier New', monospace",
                fontWeight: 700,
                outline: 'none',
              }}
              autoFocus
            />
          </div>

          {error && (
            <p
              className="text-xs text-center mb-4 px-3 py-2 rounded-lg"
              style={{
                background: 'rgba(206, 17, 38, 0.1)',
                border: '1px solid rgba(206, 17, 38, 0.2)',
                color: '#CE1126',
              }}
            >
              {error}
            </p>
          )}

          <button
            onClick={handleJoin}
            disabled={code.length !== 6 || loading}
            className="w-full rounded-xl text-sm font-bold"
            style={{
              height: 48,
              background: code.length === 6 ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: code.length === 6 ? '#000' : 'var(--text-muted)',
              border: 'none',
              cursor: code.length === 6 && !loading ? 'pointer' : 'default',
              boxShadow: code.length === 6 ? 'var(--gold-glow-soft)' : 'none',
              transition: 'all 0.2s',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Joining...' : 'Join Classroom'}
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
        </div>

        {/* Create Section */}
        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="card-hover w-full rounded-2xl p-5 text-center"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              cursor: 'pointer',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <p className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Create a Room
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Start a new live classroom session
            </p>
          </button>
        ) : (
          <div
            className="rounded-2xl p-6 animate-in"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <h3 className="text-sm font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Create Room
            </h3>

            <div className="mb-3">
              <label className="text-[11px] font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Room Title
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. BECE Math Revision"
                className="w-full rounded-lg px-3 text-sm"
                style={{
                  height: 44,
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
            </div>

            <div className="mb-4">
              <label className="text-[11px] font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Type
              </label>
              <div className="flex gap-2 flex-wrap">
                {ROOM_TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setNewType(t.id)}
                    className="px-3 rounded-lg text-xs font-semibold"
                    style={{
                      height: 36,
                      background: newType === t.id ? 'var(--accent)' : 'var(--bg-tertiary)',
                      color: newType === t.id ? '#000' : 'var(--text-secondary)',
                      border: `1px solid ${newType === t.id ? 'var(--accent)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-xl text-sm font-semibold"
                style={{
                  height: 44,
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || loading}
                className="flex-1 rounded-xl text-sm font-bold"
                style={{
                  height: 44,
                  background: newTitle.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: newTitle.trim() ? '#000' : 'var(--text-muted)',
                  border: 'none',
                  cursor: newTitle.trim() && !loading ? 'pointer' : 'default',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Creating...' : 'Create Room'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
