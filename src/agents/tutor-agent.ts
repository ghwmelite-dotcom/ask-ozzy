// Tutor agent — adaptive difficulty scaffolding for WASSCE/BECE/Study Coach
// Implements: assessStudentLevel, buildScaffoldingPrompt, generateOrientationBrief
import type { Env } from '../types';
import type { StudentProfile, StudentLevel, ConfidenceLevel } from '../types/student-profile';
import { loadStudentProfile, saveStudentProfile, updateSessionScore } from '../lib/session-tracker';

// ─── Assess Student Level ────────────────────────────────────────────
// Quick Llama assessment on first message to determine student's level

export async function assessStudentLevel(
  firstMessage: string,
  env: Env
): Promise<{ level: StudentLevel; confidence: ConfidenceLevel }> {
  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast' as any, {
      messages: [
        {
          role: 'system',
          content: `You are an educational assessment specialist for Ghana's education system.
Based on the student's message, assess their likely academic level and confidence.
Return ONLY valid JSON: {"level": "jhs1"|"jhs2"|"jhs3"|"shs1"|"shs2"|"shs3"|"adult_learner", "confidence": "struggling"|"developing"|"proficient"|"advanced"}

Clues to look for:
- Vocabulary complexity and grammar → level indicator
- Subject matter (integrated science = JHS, elective subjects = SHS)
- Mention of BECE → JHS level, WASSCE → SHS level
- "I don't understand" / basic questions → struggling
- Specific detailed questions → proficient/advanced
- University students → adult_learner`,
        },
        { role: 'user', content: firstMessage.substring(0, 500) },
      ],
      max_tokens: 100,
    });

    const raw = (response as any)?.response || '';
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.level && parsed.confidence) {
        return { level: parsed.level, confidence: parsed.confidence };
      }
    }
  } catch {}

  // Default: SHS1, developing
  return { level: 'shs1', confidence: 'developing' };
}

// ─── Build Scaffolding Prompt ────────────────────────────────────────
// Constructs a pedagogically-structured prompt using C→S→M→E→C² framework
// Connect → Scaffold → Model → Extend → Check²

export function buildScaffoldingPrompt(
  profile: StudentProfile,
  agentType: string
): string {
  const levelDescriptions: Record<StudentLevel, string> = {
    jhs1: 'JHS 1 student (ages 12-13). Use very simple English, short sentences, relatable examples from daily life in Ghana.',
    jhs2: 'JHS 2 student (ages 13-14). Simple English with some subject-specific terms introduced gradually.',
    jhs3: 'JHS 3 student preparing for BECE (ages 14-15). Build exam readiness, practice past paper format, introduce exam technique.',
    shs1: 'SHS 1 student (ages 15-16). Introduce elective-level concepts, build foundations for WASSCE.',
    shs2: 'SHS 2 student (ages 16-17). Deepen understanding, tackle medium-difficulty problems, connect topics.',
    shs3: 'SHS 3 student preparing for WASSCE (ages 17-18). Focus on exam technique, past paper mastery, time management.',
    adult_learner: 'Adult learner (university or professional). Assume mature comprehension, focus on application and critical thinking.',
  };

  const confidenceAdapt: Record<ConfidenceLevel, string> = {
    struggling: 'Break down into the SMALLEST possible steps. Give ONE step at a time. Use encouragement. Never assume prior knowledge. Start from first principles.',
    developing: 'Provide clear step-by-step explanations. Include worked examples before asking the student to try. Highlight key terms.',
    proficient: 'Give concise explanations with worked examples. Challenge with extension questions. Connect to related topics.',
    advanced: 'Be concise. Focus on edge cases, deeper reasoning, and exam-level difficulty. Challenge with "what if" questions.',
  };

  const weakTopics = profile.weak_topics.length > 0
    ? `\nThe student is weak in: ${profile.weak_topics.join(', ')}. Provide extra scaffolding for these topics.`
    : '';
  const strongTopics = profile.strong_topics.length > 0
    ? `\nThe student is strong in: ${profile.strong_topics.join(', ')}. You can reference these to build bridges to new concepts.`
    : '';

  return `## PEDAGOGICAL RULES — ADAPTIVE DIFFICULTY

STUDENT PROFILE:
- Level: ${levelDescriptions[profile.level]}
- Confidence: ${profile.confidence} — ${confidenceAdapt[profile.confidence]}
- Session score: ${profile.session_score}/100${weakTopics}${strongTopics}

TEACHING FRAMEWORK (C→S→M→E→C²):
1. **CONNECT**: Start by linking to something the student already knows or has experienced
2. **SCAFFOLD**: Break the concept into digestible pieces appropriate to their level
3. **MODEL**: Show a worked example with clear step-by-step reasoning
4. **EXTEND**: Ask the student a practice question at their level
5. **CHECK²**: After the student responds, verify understanding and adjust difficulty

EDUCATIONAL DOS:
- Use Ghana-relevant examples (cedis, local geography, Ghanaian names)
- Encourage and praise effort, not just correctness
- If the student is stuck, give a hint before the full answer
- Reference WAEC marking schemes when relevant
- For BECE/WASSCE prep: practise exam-style questions with mark allocations

EDUCATIONAL DON'TS:
- NEVER give just the answer without explanation
- NEVER skip steps (even if you think the student can handle it)
- NEVER use sarcasm or discouraging language
- NEVER assume knowledge that hasn't been demonstrated
- NEVER say "this is easy" — it invalidates the student's difficulty`;
}

// ─── Generate Orientation Brief ──────────────────────────────────────
// OpenPaper-style brief when starting a new topic

export async function generateOrientationBrief(
  topic: string,
  profile: StudentProfile,
  agentType: string,
  env: Env
): Promise<{
  topic_title: string;
  key_concepts: string[];
  prerequisites: string[];
  starter_questions: string[];
  estimated_difficulty: string;
}> {
  try {
    const levelLabel = profile.level.toUpperCase().replace('_', ' ');
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast' as any, {
      messages: [
        {
          role: 'system',
          content: `You are a Ghana ${agentType === 'wassce' ? 'WASSCE' : agentType === 'bece' ? 'BECE' : 'education'} tutor.
Generate an orientation brief for a ${levelLabel} student starting a new topic.
Return ONLY valid JSON:
{
  "topic_title": "clear title",
  "key_concepts": ["concept 1", "concept 2", "concept 3"],
  "prerequisites": ["what they should already know"],
  "starter_questions": ["easy warm-up question 1", "warm-up question 2"],
  "estimated_difficulty": "easy|medium|hard"
}`,
        },
        { role: 'user', content: `Generate orientation brief for: ${topic}` },
      ],
      max_tokens: 400,
    });

    const raw = (response as any)?.response || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        topic_title: parsed.topic_title || topic,
        key_concepts: Array.isArray(parsed.key_concepts) ? parsed.key_concepts : [],
        prerequisites: Array.isArray(parsed.prerequisites) ? parsed.prerequisites : [],
        starter_questions: Array.isArray(parsed.starter_questions) ? parsed.starter_questions : [],
        estimated_difficulty: parsed.estimated_difficulty || 'medium',
      };
    }
  } catch {}

  return {
    topic_title: topic,
    key_concepts: [],
    prerequisites: [],
    starter_questions: [],
    estimated_difficulty: 'medium',
  };
}

// ─── Get or Create Student Profile ───────────────────────────────────

export async function getOrCreateStudentProfile(
  sessionId: string,
  firstMessage: string,
  env: Env
): Promise<StudentProfile> {
  // Try loading existing profile from KV
  const existing = await loadStudentProfile(sessionId, env);
  if (existing) return existing;

  // Assess level from first message
  const { level, confidence } = await assessStudentLevel(firstMessage, env);

  const profile: StudentProfile = {
    level,
    track: 'general',
    target_exam: 'none',
    confidence: confidence,
    session_score: 50, // Start at midpoint
    weak_topics: [],
    strong_topics: [],
  };

  await saveStudentProfile(sessionId, profile, env);
  return profile;
}

// ─── Detect if this is a new topic ───────────────────────────────────

export function isNewTopic(messageCount: number): boolean {
  // First message or very early in conversation suggests a new topic
  return messageCount <= 2;
}
