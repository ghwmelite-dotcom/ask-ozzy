export type TeacherId = 'abena' | 'kwame' | 'esi' | 'mensah';

export type Mood = 'explaining' | 'asking' | 'encouraging' | 'correcting' | 'celebrating';

export type MouthShape = 'closed' | 'slight' | 'open' | 'wide' | 'o';

export interface Teacher {
  id: TeacherId;
  name: string;
  subject: string;
  personality_prompt: string;
  avatar_config: AvatarConfig;
  voice_config: VoiceConfig;
}

export interface AvatarConfig {
  skinTone: string;
  hairstyle: string;
  attire: string;
}

export interface VoiceConfig {
  speed: number;
  pitch: number;
}

export const SKIN_TONES: Record<TeacherId, string> = {
  abena: '#8B5E3C',
  kwame: '#6B4226',
  esi: '#A0714F',
  mensah: '#3D2B1F',
} as const;

export const MOUTH_PATHS: Record<MouthShape, string> = {
  closed: 'M36 33 Q40 35 44 33',
  slight: 'M36 33 Q40 36 44 33',
  open:   'M36 33 Q40 38 44 33 Q40 35 36 33',
  wide:   'M35 32 Q40 40 45 32 Q40 34 35 32',
  o:      'M37 32 Q40 38 43 32 Q40 34 37 32',
} as const;
