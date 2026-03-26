import type { MouthShape, Mood } from '@/types/teacher';
import { MOUTH_PATHS } from '@/types/teacher';

interface Props {
  mouth: MouthShape;
  mood: Mood;
  size?: number;
}

export function AbenaSVG({ mouth, mood, size = 200 }: Props) {
  const skin = '#8B5E3C';
  const skinShadow = '#7A5234';
  const blouseBase = '#2D5016';
  const kenteAccent = '#FCD116';
  const kenteRed = '#CE1126';

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <style>{`
        @keyframes abena-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          95% { transform: scaleY(0.1); }
        }
        .abena-eyes { animation: abena-blink 3.5s ease-in-out infinite; transform-origin: 40px 26px; }
        @keyframes abena-idle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-0.5px); }
        }
        .abena-head { animation: abena-idle 4s ease-in-out infinite; }
      `}</style>

      {/* Body / Blouse */}
      <ellipse cx="40" cy="72" rx="22" ry="12" fill={blouseBase} />
      {/* Kente accent stripes */}
      <rect x="28" y="64" width="24" height="2" rx="1" fill={kenteAccent} />
      <rect x="30" y="67" width="20" height="1.5" rx="0.75" fill={kenteRed} />
      <rect x="28" y="70" width="24" height="2" rx="1" fill={kenteAccent} />

      {/* Neck */}
      <rect x="36" y="52" width="8" height="10" rx="2" fill={skin} />

      <g className="abena-head">
        {/* Face */}
        <ellipse cx="40" cy="32" rx="18" ry="22" fill={skin} />
        <ellipse cx="40" cy="33" rx="16" ry="19" fill={skinShadow} opacity="0.15" />

        {/* Braids (hair) */}
        <path d="M22 28 Q22 10 30 8 Q34 7 38 8 L38 14 Q30 14 26 20 Q24 24 22 28Z" fill="#1a1a1a" />
        <path d="M58 28 Q58 10 50 8 Q46 7 42 8 L42 14 Q50 14 54 20 Q56 24 58 28Z" fill="#1a1a1a" />
        <path d="M38 8 Q40 6 42 8 L42 14 L38 14Z" fill="#1a1a1a" />
        {/* Braid strands */}
        <path d="M24 28 Q20 34 18 42" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M22 26 Q17 32 14 40" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M56 28 Q60 34 62 42" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M58 26 Q63 32 66 40" stroke="#1a1a1a" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* Eyes */}
        <g className="abena-eyes">
          <ellipse cx="33" cy="26" rx="3" ry="3.5" fill="white" />
          <ellipse cx="47" cy="26" rx="3" ry="3.5" fill="white" />
          <circle cx="33" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="47" cy="26" r="1.8" fill="#2d1810" />
          <circle cx="33.5" cy="25.5" r="0.6" fill="white" />
          <circle cx="47.5" cy="25.5" r="0.6" fill="white" />
        </g>

        {/* Eyebrows — mood-driven */}
        {mood === 'asking' ? (
          <>
            <path d="M29 22 Q33 19 37 22" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
            <path d="M43 22 Q47 19 51 22" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
          </>
        ) : (
          <>
            <path d="M29 23 Q33 21 37 23" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
            <path d="M43 23 Q47 21 51 23" stroke="#1a1a1a" strokeWidth="1.2" fill="none" />
          </>
        )}

        {/* Nose */}
        <path d="M39 30 Q40 32 41 30" stroke={skinShadow} strokeWidth="0.8" fill="none" />

        {/* Mouth — driven by lip-sync */}
        <path d={MOUTH_PATHS[mouth]} stroke="#6B3A2A" strokeWidth="1.2" fill={mouth === 'closed' ? 'none' : '#8B4040'} />

        {/* Smile lines for encouraging/celebrating */}
        {(mood === 'encouraging' || mood === 'celebrating') && (
          <>
            <path d="M28 32 Q30 35 28 37" stroke={skinShadow} strokeWidth="0.5" fill="none" opacity="0.4" />
            <path d="M52 32 Q50 35 52 37" stroke={skinShadow} strokeWidth="0.5" fill="none" opacity="0.4" />
          </>
        )}
      </g>
    </svg>
  );
}
