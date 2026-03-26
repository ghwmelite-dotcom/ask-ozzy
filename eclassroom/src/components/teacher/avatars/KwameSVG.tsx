import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function KwameSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#6B4226';
  const skinShadow = '#5A3820';
  const shirtColor = '#EAEAEA';
  const tieColor = '#1a3a5c';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes kwame-blink {
          0%, 90%, 100% { transform: scaleY(1); }
          93% { transform: scaleY(0.1); }
        }
        .kwame-eyes { animation: kwame-blink 4s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes kwame-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.4px); }
        }
        .kwame-head { animation: kwame-idle 5s ease-in-out infinite; }
      `}</style>

      {/* Shirt collar */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={shirtColor} />
      {/* Collar V */}
      <path d="M32 64 L40 74 L48 64" stroke="#ccc" strokeWidth="1" fill="none" />
      {/* Tie */}
      <path d="M38 66 L40 78 L42 66 Z" fill={tieColor} />
      <rect x="38.5" y="64" width="3" height="3" rx="0.5" fill={tieColor} />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />

      <g className="kwame-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />

        {/* Low fade hair */}
        <path d="M22 24 Q22 10 40 8 Q58 10 58 24 L56 22 Q54 14 40 12 Q26 14 24 22Z" fill="#0d0d0d" />

        {/* Eyes */}
        <g className="kwame-eyes">
          <ellipse cx="33" cy="26" rx="3" ry="3.5" fill="white" />
          <ellipse cx="47" cy="26" rx="3" ry="3.5" fill="white" />
          <circle cx="33" cy="26" r="1.8" fill="#1a1208" />
          <circle cx="47" cy="26" r="1.8" fill="#1a1208" />
          <circle cx="33.5" cy="25.5" r="0.6" fill="white" />
          <circle cx="47.5" cy="25.5" r="0.6" fill="white" />
        </g>

        {/* Eyebrows */}
        <path d="M29 22 Q33 20.5 37 22.5" stroke="#0d0d0d" strokeWidth="1.4" fill="none" />
        <path d="M43 22.5 Q47 20.5 51 22" stroke="#0d0d0d" strokeWidth="1.4" fill="none" />

        {/* Nose */}
        <path d="M38 30 Q40 33 42 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth */}
        <path d={MOUTH_PATHS[mouth]} stroke="#4A2A1A" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#6B3030'} />

        {/* Focused expression for explaining */}
        {mood === 'explaining' && (
          <path d="M36 20 Q40 18.5 44 20" stroke="#0d0d0d" strokeWidth="0.6" fill="none" opacity="0.3" />
        )}
      </g>
    </svg>
  );
}
