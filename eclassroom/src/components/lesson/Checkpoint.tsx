import { useState } from 'react';
import type { Checkpoint as CheckpointType } from '@/types/lesson';

interface CheckpointProps {
  checkpoint: CheckpointType;
  onAnswer: (correct: boolean, xpEarned: number) => void;
}

export function Checkpoint({ checkpoint, onAnswer }: CheckpointProps) {
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const checkAnswer = () => {
    let correct = false;

    if (checkpoint.type === 'mcq') {
      correct = selectedOption === checkpoint.correct_answer;
    } else {
      const normalized = answer.trim().toLowerCase();
      const correctNormalized = checkpoint.correct_answer.toLowerCase();
      const variations = (checkpoint.accept_variations ?? []).map(v => v.toLowerCase());
      correct = normalized === correctNormalized || variations.includes(normalized);
    }

    setIsCorrect(correct);
    setSubmitted(true);
  };

  const handleContinue = () => {
    onAnswer(isCorrect, isCorrect ? checkpoint.xp_reward : 0);
  };

  const isSubmitDisabled = checkpoint.type === 'mcq' ? !selectedOption : !answer.trim();

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(15, 20, 25, 0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-md mx-4 p-6 rounded-2xl"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        {/* Question */}
        <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
          {checkpoint.question}
        </h3>

        {!submitted ? (
          <>
            {/* MCQ Options */}
            {checkpoint.type === 'mcq' && checkpoint.options && (
              <div className="flex flex-col gap-2 mb-4">
                {checkpoint.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setSelectedOption(opt)}
                    className="text-left px-4 py-3 rounded-xl text-sm font-medium transition-all"
                    style={{
                      background: selectedOption === opt ? 'rgba(252,209,22,0.15)' : 'var(--bg-tertiary)',
                      border: `2px solid ${selectedOption === opt ? 'var(--accent)' : 'var(--border)'}`,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {/* Text Input */}
            {checkpoint.type === 'text_input' && (
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer..."
                className="w-full px-4 py-3 rounded-xl text-sm mb-4"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '2px solid var(--border)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && answer.trim()) checkAnswer();
                }}
                autoFocus
              />
            )}

            {/* Hint */}
            {checkpoint.hint && (
              <button
                onClick={() => setShowHint(true)}
                className="text-xs mb-4 block"
                style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {showHint ? checkpoint.hint : 'Show hint'}
              </button>
            )}

            {/* Submit */}
            <button
              onClick={checkAnswer}
              disabled={isSubmitDisabled}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all"
              style={{
                background: 'var(--accent)',
                color: '#000',
                border: 'none',
                cursor: isSubmitDisabled ? 'default' : 'pointer',
                opacity: isSubmitDisabled ? 0.5 : 1,
              }}
            >
              Check Answer
            </button>
          </>
        ) : (
          <>
            {/* Result */}
            <div
              className="p-4 rounded-xl mb-4 text-center"
              style={{
                background: isCorrect ? 'rgba(0,200,83,0.1)' : 'rgba(255,82,82,0.1)',
                border: `1px solid ${isCorrect ? 'var(--success)' : 'var(--error)'}`,
              }}
            >
              <p className="text-2xl mb-1">{isCorrect ? '\u{1F389}' : '\u{1F4A1}'}</p>
              <p className="font-bold" style={{ color: isCorrect ? 'var(--success)' : 'var(--error)' }}>
                {isCorrect ? 'Correct!' : 'Not quite!'}
              </p>
              {isCorrect && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>
                  +{checkpoint.xp_reward} XP
                </p>
              )}
              {!isCorrect && (
                <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                  The answer is: <strong style={{ color: 'var(--text-primary)' }}>{checkpoint.correct_answer}</strong>
                </p>
              )}
            </div>

            <button
              onClick={handleContinue}
              className="w-full py-3 rounded-xl text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer' }}
            >
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
