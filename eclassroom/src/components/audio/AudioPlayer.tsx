import { useRef, useState, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  src: string;
  topic: string;
  teacher?: string;
  subject?: string;
  onClose?: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ src, topic, teacher, subject, onClose }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const [_loading, setLoading] = useState(true);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
    setPlaying(!playing);
  }, [playing]);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    setSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
  }, [duration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      setDuration(audio.duration);
      setLoading(false);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setPlaying(false);

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  // Generate waveform bars
  const barCount = 40;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const barProgress = (i / barCount) * 100;
    const isPlayed = barProgress <= progress;
    // Pseudo-random height based on index
    const height = 12 + ((i * 7 + 13) % 20);
    return { height, isPlayed };
  });

  return (
    <div
      className="rounded-2xl p-5 animate-in"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Lesson info */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 flex-1">
          {subject && (
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--accent)' }}>
              {subject.replace(/_/g, ' ')}
            </p>
          )}
          <h3 className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            {topic}
          </h3>
          {teacher && (
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {teacher}
            </p>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-lg ml-3"
            style={{
              width: 32,
              height: 32,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label="Close player"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Waveform visualization */}
      <div
        className="flex items-end gap-[2px] mb-3 rounded-lg px-2 py-2"
        style={{
          height: 48,
          background: 'var(--bg-tertiary)',
          cursor: 'pointer',
        }}
        onClick={handleSeek}
        role="slider"
        aria-label="Audio progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        {bars.map((bar, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: bar.height,
              background: bar.isPlayed ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
              transition: 'background 0.1s',
              minWidth: 2,
            }}
          />
        ))}
      </div>

      {/* Time display */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {formatTime(currentTime)}
        </span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {duration ? formatTime(duration) : '--:--'}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        {/* Speed buttons */}
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              className="px-2 py-1 rounded-md text-[11px] font-bold"
              style={{
                background: speed === s ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: speed === s ? '#000' : 'var(--text-muted)',
                border: `1px solid ${speed === s ? 'var(--accent)' : 'var(--border-color)'}`,
                cursor: 'pointer',
                minWidth: 44,
                minHeight: 32,
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="flex items-center justify-center rounded-full"
          style={{
            width: 52,
            height: 52,
            background: 'var(--accent)',
            color: '#000',
            border: 'none',
            cursor: 'pointer',
            boxShadow: 'var(--gold-glow)',
            transition: 'transform 0.15s',
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor">
              <rect x={6} y={4} width={4} height={16} rx={1} />
              <rect x={14} y={4} width={4} height={16} rx={1} />
            </svg>
          ) : (
            <svg width={22} height={22} viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
