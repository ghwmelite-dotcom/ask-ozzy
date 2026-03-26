export type AcademicLevel = 'jhs' | 'shs' | 'university';

export interface Lesson {
  id: string;
  teacher_id: string;
  subject: string;
  level: AcademicLevel;
  topic: string;
  steps: LessonStep[];
  estimated_minutes: number;
  xp_reward: number;
}

export interface LessonStep {
  step: number;
  voice_script: string;
  board_actions: BoardAction[];
  checkpoint: Checkpoint | null;
}

export type BoardAction =
  | DrawShapeAction
  | AddLabelAction
  | DrawLineAction
  | ClearBoardAction;

interface DrawShapeAction {
  action: 'drawShape';
  type: string;
  points?: number[][];
  position?: [number, number];
  width?: number;
  height?: number;
  delay_ms: number;
}

interface AddLabelAction {
  action: 'addLabel';
  text: string;
  position: [number, number];
  color?: string;
  delay_ms: number;
}

interface DrawLineAction {
  action: 'drawLine';
  points: [number, number][];
  color?: string;
  delay_ms: number;
}

interface ClearBoardAction {
  action: 'clearBoard';
  delay_ms: number;
}

export interface Checkpoint {
  type: 'mcq' | 'text_input' | 'drag_drop';
  question: string;
  correct_answer: string;
  accept_variations?: string[];
  options?: string[];
  hint?: string;
  xp_reward: number;
}

export interface StudentProgress {
  id: string;
  student_id: string;
  lesson_id: string;
  current_step: number;
  status: 'in_progress' | 'completed' | 'abandoned';
  score: number;
  xp_earned: number;
}
