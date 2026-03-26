import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function MensahSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#3D2B1F';
  const skinShadow = '#322318';
  const blazerColor = '#2C3E50';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes mensah-blink {
          0%, 91%, 100% { transform: scaleY(1); }
          94% { transform: scaleY(0.1); }
        }
        .mensah-eyes { animation: mensah-blink 4.2s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes mensah-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.4px); }
        }
        .mensah-head { animation: mensah-idle 5.5s ease-in-out infinite; }
      `}</style>

      {/* Blazer */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={blazerColor} />
      {/* Lapels */}
      <path d="M32 64 L38 72 L40 66" stroke="#3D5166" strokeWidth="0.8" fill="none" />
      <path d="M48 64 L42 72 L40 66" stroke="#3D5166" strokeWidth="0.8" fill="none" />
      {/* Shirt collar peek */}
      <path d="M37 65 L40 69 L43 65" fill="#F5F5F5" />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />

      <g className="mensah-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />

        {/* Grey-touched short hair */}
        <path d="M22 24 Q22 10 40 8 Q58 10 58 24 L56 22 Q54 14 40 12 Q26 14 24 22Z" fill="#2a2a2a" />
        {/* Grey touches */}
        <path d="M26 18 Q28 14 32 13" stroke="#888" strokeWidth="1.5" fill="none" opacity="0.6" />
        <path d="M54 18 Q52 14 48 13" stroke="#888" strokeWidth="1.5" fill="none" opacity="0.6" />
        <path d="M36 11 Q40 10 44 11" stroke="#999" strokeWidth="1" fill="none" opacity="0.4" />

        {/* Glasses */}
        <rect x="27" y="22" width="12" height="9" rx="3" stroke="#8B8000" strokeWidth="1.2" fill="none" />
        <rect x="41" y="22" width="12" height="9" rx="3" stroke="#8B8000" strokeWidth="1.2" fill="none" />
        <path d="M39 26 L41 26" stroke="#8B8000" strokeWidth="1" />
        <path d="M27 26 L22 24" stroke="#8B8000" strokeWidth="0.8" />
        <path d="M53 26 L58 24" stroke="#8B8000" strokeWidth="0.8" />

        {/* Eyes (behind glasses) */}
        <g className="mensah-eyes">
          <ellipse cx="33" cy="26" rx="2.8" ry="3" fill="white" />
          <ellipse cx="47" cy="26" rx="2.8" ry="3" fill="white" />
          <circle cx="33" cy="26" r="1.6" fill="#1a1208" />
          <circle cx="47" cy="26" r="1.6" fill="#1a1208" />
          <circle cx="33.3" cy="25.5" r="0.5" fill="white" />
          <circle cx="47.3" cy="25.5" r="0.5" fill="white" />
        </g>

        {/* Distinguished eyebrows */}
        <path d="M28 21 Q33 19 38 21.5" stroke="#2a2a2a" strokeWidth="1.3" fill="none" />
        <path d="M42 21.5 Q47 19 52 21" stroke="#2a2a2a" strokeWidth="1.3" fill="none" />

        {/* Nose */}
        <path d="M38 30 Q40 33 42 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth */}
        <path d={MOUTH_PATHS[mouth]} stroke="#2A1A10" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#4A2A2A'} />

        {/* Scholarly expression lines */}
        {mood === 'explaining' && (
          <path d="M35 19 Q40 17.5 45 19" stroke="#2a2a2a" strokeWidth="0.5" fill="none" opacity="0.3" />
        )}
      </g>
    </svg>
  );
}
