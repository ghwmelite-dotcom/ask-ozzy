import { useNavigate } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header
      className="sticky top-[3px] z-40 flex items-center gap-3 px-5 py-3.5"
      style={{
        background: 'rgba(15, 17, 23, 0.85)',
        backdropFilter: 'blur(12px) saturate(180%)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <button
        onClick={() => navigate('/')}
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 36, height: 36, borderRadius: 10,
          border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)', cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        title="Back to home"
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
      <div>
        <h1 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h1>
        {subtitle && <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
    </header>
  );
}
