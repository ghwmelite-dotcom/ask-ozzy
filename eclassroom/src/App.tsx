import { Routes, Route } from 'react-router-dom';
import { Home } from '@/pages/Home';
import { LessonPage } from '@/pages/LessonPage';

export function App() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lesson/:id" element={<LessonPage />} />
      </Routes>
    </div>
  );
}
