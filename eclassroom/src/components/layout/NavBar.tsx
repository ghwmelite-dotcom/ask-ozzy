import { useNavigate, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/', label: 'Lessons', icon: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' },
  { path: '/study-tools', label: 'Study', icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' },
  { path: '/audio', label: 'Audio', icon: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  { path: '/live', label: 'Live', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
];

export function NavBar() {
  const navigate = useNavigate();
  const location = useLocation();

  // Hide on lesson pages
  if (location.pathname.startsWith('/lesson/')) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
      style={{
        background: 'rgba(15, 17, 23, 0.92)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border-color)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = location.pathname === item.path ||
          (item.path !== '/' && location.pathname.startsWith(item.path));
        const isHome = item.path === '/' && location.pathname === '/';

        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="flex flex-col items-center gap-1 py-2.5 px-4"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: isActive || isHome ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'color 0.15s',
              minWidth: 64,
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill={isActive || isHome ? 'var(--accent)' : 'none'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={item.icon} />
            </svg>
            <span
              className="text-[10px] font-semibold"
              style={{ letterSpacing: '0.02em' }}
            >
              {item.label}
            </span>
            {(isActive || isHome) && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  width: 24,
                  height: 2,
                  borderRadius: 1,
                  background: 'var(--accent)',
                }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
