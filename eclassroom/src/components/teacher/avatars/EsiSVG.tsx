import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function EsiSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#A0714F';
  const skinShadow = '#8F6445';
  const dressColor = '#5B2E91';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes esi-blink {
          0%, 94%, 100% { transform: scaleY(1); }
          96.5% { transform: scaleY(0.1); }
        }
        .esi-eyes { animation: esi-blink 3.2s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes esi-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.3px); }
        }
        .esi-head { animation: esi-idle 4.5s ease-in-out infinite; }
      `}</style>

      {/* Professional dress */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={dressColor} />
      {/* Neckline */}
      <path d="M34 64 Q40 68 46 64" stroke="#4A2578" strokeWidth="1" fill="none" />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />
      {/* Earrings */}
      <circle cx="22" cy="34" r="2" fill="#FCD116" />
      <circle cx="58" cy="34" r="2" fill="#FCD116" />

      <g className="esi-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />

        {/* TWA hairstyle (short textured) */}
        <ellipse cx="40" cy="18" rx="19" ry="14" fill="#1a1a1a" />
        <ellipse cx="40" cy="20" rx="17" ry="10" fill="#2a2a2a" opacity="0.5" />

        {/* Eyes */}
        <g className="esi-eyes">
          <ellipse cx="33" cy="26" rx="3.2" ry="3.5" fill="white" />
          <ellipse cx="47" cy="26" rx="3.2" ry="3.5" fill="white" />
          <circle cx="33" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="47" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="33.5" cy="25.5" r="0.6" fill="white" />
          <circle cx="47.5" cy="25.5" r="0.6" fill="white" />
        </g>

        {/* Eyelashes */}
        <path d="M29.5 24 L28.5 22.5" stroke="#1a1a1a" strokeWidth="0.6" />
        <path d="M50.5 24 L51.5 22.5" stroke="#1a1a1a" strokeWidth="0.6" />

        {/* Gentle eyebrows */}
        <path d="M29 22.5 Q33 21 37 23" stroke="#2a1a10" strokeWidth="1" fill="none" />
        <path d="M43 23 Q47 21 51 22.5" stroke="#2a1a10" strokeWidth="1" fill="none" />

        {/* Nose */}
        <path d="M39 30 Q40 32 41 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth */}
        <path d={MOUTH_PATHS[mouth]} stroke="#7A4A3A" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#9A5050'} />

        {/* Warm smile for encouraging */}
        {(mood === 'encouraging' || mood === 'celebrating') && (
          <>
            <path d="M29 33 Q30 35 29 36" stroke={skinShadow} strokeWidth="0.4" fill="none" opacity="0.3" />
            <path d="M51 33 Q50 35 51 36" stroke={skinShadow} strokeWidth="0.4" fill="none" opacity="0.3" />
          </>
        )}
      </g>
    </svg>
  );
}
