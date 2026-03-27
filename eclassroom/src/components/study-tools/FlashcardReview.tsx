import { useState } from 'react';
import type { Flashcard } from '@/types/gamification';

interface FlashcardReviewProps {
  flashcards: Flashcard[];
  onReview: (id: string, quality: number) => Promise<void>;
  onComplete: () => void;
}

export function FlashcardReview({ flashcards, onReview, onComplete }: FlashcardReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  if (flashcards.length === 0) {
    return (
      <div className="animate-in text-center py-16">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
        >
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none">
            <path d="M9 12l2 2 4-4" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={12} cy={12} r={9} stroke="var(--accent)" strokeWidth={1.5} />
          </svg>
        </div>
        <p className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
          No cards due for review!
        </p>
        <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
          Come back later.
        </p>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="animate-in text-center py-16">
        <div
          className="w-20 h-20 rounded-2xl mx-auto mb-5 flex items-center justify-center text-4xl"
          style={{
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent-border)',
            boxShadow: 'var(--gold-glow-soft)',
          }}
        >
          <svg width={36} height={36} viewBox="0 0 24 24" fill="none">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="var(--accent)" />
          </svg>
        </div>
        <p className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Session Complete!
        </p>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {reviewedCount} card{reviewedCount !== 1 ? 's' : ''} reviewed
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--accent)' }}>
          +{reviewedCount * 5} XP earned
        </p>
        <button
          onClick={onComplete}
          className="mt-6 px-6 py-2.5 rounded-xl text-sm font-bold"
          style={{
            background: 'var(--accent)',
            color: '#000',
            cursor: 'pointer',
            border: 'none',
            boxShadow: 'var(--gold-glow-soft)',
            transition: 'all 0.2s',
          }}
        >
          Done
        </button>
      </div>
    );
  }

  // Safe: we already returned early if flashcards.length === 0, and currentIndex < length
  const card = flashcards[currentIndex]!;
  const progress = (currentIndex / flashcards.length) * 100;

  const handleRate = async (quality: number) => {
    if (reviewing) return;
    setReviewing(true);
    try {
      await onReview(card.id, quality);
    } catch {
      // continue anyway
    }
    setReviewedCount((c) => c + 1);
    setFlipped(false);
    setReviewing(false);
    if (currentIndex + 1 >= flashcards.length) {
      setCompleted(true);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  return (
    <div className="animate-in">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: 'var(--accent)',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          {currentIndex + 1}/{flashcards.length}
        </span>
      </div>

      {/* Subject + level tag */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          {card.subject.replace(/_/g, ' ')}
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md"
          style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
        >
          {card.level}
        </span>
      </div>

      {/* Flashcard with 3D flip */}
      <div
        className="flashcard-container mb-6"
        onClick={() => !flipped && setFlipped(true)}
        style={{ perspective: 1000, cursor: flipped ? 'default' : 'pointer' }}
      >
        <div
          className="flashcard-inner"
          style={{
            position: 'relative',
            width: '100%',
            minHeight: 220,
            transformStyle: 'preserve-3d',
            transition: 'transform 0.5s ease',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0)',
          }}
        >
          {/* Front */}
          <div
            className="rounded-2xl p-6 flex items-center justify-center"
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Question
              </p>
              <p
                className="text-lg font-semibold leading-relaxed"
                style={{ color: 'var(--text-primary)' }}
              >
                {card.front}
              </p>
              <p className="text-[11px] mt-4" style={{ color: 'var(--text-muted)' }}>
                Tap to reveal answer
              </p>
            </div>
          </div>

          {/* Back */}
          <div
            className="rounded-2xl p-6 flex items-center justify-center"
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--accent-border)',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider mb-3" style={{ color: 'var(--accent)' }}>
                Answer
              </p>
              <p
                className="text-lg font-semibold leading-relaxed"
                style={{ color: 'var(--text-primary)' }}
              >
                {card.back}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Rating buttons — only show when flipped */}
      {flipped && (
        <div className="animate-in flex gap-3">
          <button
            onClick={() => handleRate(1)}
            disabled={reviewing}
            className="flex-1 py-3 rounded-xl text-sm font-bold"
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              cursor: reviewing ? 'not-allowed' : 'pointer',
              opacity: reviewing ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            Again
          </button>
          <button
            onClick={() => handleRate(3)}
            disabled={reviewing}
            className="flex-1 py-3 rounded-xl text-sm font-bold"
            style={{
              background: 'rgba(234, 179, 8, 0.12)',
              color: '#eab308',
              border: '1px solid rgba(234, 179, 8, 0.25)',
              cursor: reviewing ? 'not-allowed' : 'pointer',
              opacity: reviewing ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            Good
          </button>
          <button
            onClick={() => handleRate(5)}
            disabled={reviewing}
            className="flex-1 py-3 rounded-xl text-sm font-bold"
            style={{
              background: 'rgba(34, 197, 94, 0.12)',
              color: '#22c55e',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              cursor: reviewing ? 'not-allowed' : 'pointer',
              opacity: reviewing ? 0.5 : 1,
              transition: 'all 0.2s',
            }}
          >
            Easy
          </button>
        </div>
      )}
    </div>
  );
}
