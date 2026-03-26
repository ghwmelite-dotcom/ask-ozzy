import type { TeacherId, Mood, MouthShape } from '@/types/teacher';
import { AbenaSVG } from './avatars/AbenaSVG';
import { KwameSVG } from './avatars/KwameSVG';
import { EsiSVG } from './avatars/EsiSVG';
import { MensahSVG } from './avatars/MensahSVG';

interface TeacherAvatarProps {
  teacher: TeacherId;
  mood: Mood;
  mouth: MouthShape;
  size?: number;
}

const AVATAR_MAP = {
  abena: AbenaSVG,
  kwame: KwameSVG,
  esi: EsiSVG,
  mensah: MensahSVG,
} as const;

export function TeacherAvatar({ teacher, mood, mouth, size = 200 }: TeacherAvatarProps) {
  const AvatarComponent = AVATAR_MAP[teacher];
  return (
    <div
      className="flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Teacher avatar: ${teacher}, mood: ${mood}`}
    >
      <AvatarComponent mouth={mouth} mood={mood} size={size} />
    </div>
  );
}
