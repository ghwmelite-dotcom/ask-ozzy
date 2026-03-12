export type StudentLevel = 'jhs1' | 'jhs2' | 'jhs3' | 'shs1' | 'shs2' | 'shs3' | 'adult_learner';
export type SubjectTrack = 'science' | 'arts' | 'business' | 'general' | 'technical' | 'home_economics';
export type ConfidenceLevel = 'struggling' | 'developing' | 'proficient' | 'advanced';

export interface StudentProfile {
  level: StudentLevel;
  track?: SubjectTrack;
  confidence: ConfidenceLevel;
  weak_topics: string[];
  strong_topics: string[];
  target_exam: 'bece' | 'wassce' | 'none';
  session_score: number;
  interaction_count?: number;
}
