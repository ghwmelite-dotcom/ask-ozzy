import { Routes, Route } from 'react-router-dom';
import { Home } from '@/pages/Home';
import { LessonPage } from '@/pages/LessonPage';
import { StudyToolsPage } from '@/pages/StudyToolsPage';
import { ClassroomPage } from '@/pages/ClassroomPage';
import { AudioPage } from '@/pages/AudioPage';

export function App() {
  return (
    <>
      <div className="flag-stripe" />
      <div className="min-h-screen" style={{ background: 'var(--bg-primary)', paddingTop: 3 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lesson/:id" element={<LessonPage />} />
          <Route path="/study-tools" element={<StudyToolsPage />} />
          <Route path="/leaderboard" element={<StudyToolsPage />} />
          <Route path="/live/:code?" element={<ClassroomPage />} />
          <Route path="/audio" element={<AudioPage />} />
        </Routes>
      </div>
    </>
  );
}
