import { Routes, Route } from 'react-router-dom';
import { Home } from '@/pages/Home';
import { LessonPage } from '@/pages/LessonPage';

export function App() {
  return (
    <>
      <div className="flag-stripe" />
      <div className="min-h-screen" style={{ background: 'var(--bg-primary)', paddingTop: 3 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lesson/:id" element={<LessonPage />} />
        </Routes>
      </div>
    </>
  );
}
