// Translation agent — safeguards, back-translation verification, Tier 4 hard block
import type { Env } from '../types';
import {
  classifyTranslationRisk,
  CERTIFIED_TRANSLATOR_RESOURCES,
  type TranslationUseCase,
  type LanguageTier,
} from '../config/translation-resources';

interface TranslationResult {
  translated: boolean;
  text: string;
  disclaimer: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  backTranslationScore?: number;
  blocked: boolean;
}

// ─── Main Entry Point ────────────────────────────────────────────────
// Full pipeline: risk gate → translate → back-check → response

export async function translateWithSafeguards(
  sourceText: string,
  targetLanguage: string,
  useCase: TranslationUseCase,
  env: Env
): Promise<TranslationResult> {
  // Step 1: Classify risk
  const risk = classifyTranslationRisk(targetLanguage, useCase);

  // Step 2: HARD BLOCK — Tier 4 languages + official documents
  if (shouldHardBlock(risk.tier, useCase)) {
    return {
      translated: false,
      text: buildRefusalMessage(targetLanguage, useCase),
      disclaimer: risk.disclaimer,
      riskLevel: risk.riskLevel,
      blocked: true,
    };
  }

  // Step 3: Translate
  const translation = await performTranslation(sourceText, targetLanguage, env);
  if (!translation) {
    return {
      translated: false,
      text: `Translation to ${targetLanguage} failed. ${CERTIFIED_TRANSLATOR_RESOURCES}`,
      disclaimer: risk.disclaimer,
      riskLevel: risk.riskLevel,
      blocked: false,
    };
  }

  // Step 4: Back-translation verification for medium/high risk
  let backTranslationScore: number | undefined;
  if (risk.riskLevel === 'medium' || risk.riskLevel === 'high') {
    backTranslationScore = await backTranslationCheck(translation, sourceText, targetLanguage, env);
  }

  // Step 5: If back-translation score is very low, add warning
  let finalDisclaimer = risk.disclaimer;
  if (backTranslationScore !== undefined && backTranslationScore < 0.5) {
    finalDisclaimer += '\n\n🔴 QUALITY WARNING: Back-translation verification shows low confidence in this translation. Strongly recommend human review.';
  }

  return {
    translated: true,
    text: translation,
    disclaimer: finalDisclaimer,
    riskLevel: risk.riskLevel,
    backTranslationScore,
    blocked: false,
  };
}

// ─── Hard Block Logic ────────────────────────────────────────────────
// Tier 4 (Nzema/Gonja) + any use case = block
// Any tier + official_document = block
// Tier 3+ (Ga/Dagbani) + health_information = block

function shouldHardBlock(tier: LanguageTier, useCase: TranslationUseCase): boolean {
  // Tier 4 always blocked
  if (tier === 4) return true;
  // Official documents always blocked
  if (useCase === 'official_document') return true;
  // Tier 3 + health = blocked
  if (tier >= 3 && useCase === 'health_information') return true;
  return false;
}

// ─── Refusal Message ─────────────────────────────────────────────────

function buildRefusalMessage(targetLanguage: string, useCase: TranslationUseCase): string {
  const langName = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);
  const useCaseLabel = useCase.replace(/_/g, ' ');

  return `I cannot provide an AI translation to ${langName} for ${useCaseLabel} purposes.

**Why:** AI translations of Ghanaian languages have significant limitations, especially for ${useCaseLabel}. Errors in this context could cause harm — inaccurate legal terms in official documents, incorrect medical instructions in health information, or misrepresented government communications.

**What to do instead:**

${CERTIFIED_TRANSLATOR_RESOURCES}

These organizations can provide certified, human-verified translations that are suitable for ${useCaseLabel}.

If this is for casual, personal use (not official/health/legal), you can ask me again with "casual_communication" as the use case, and I'll provide a best-effort translation with appropriate disclaimers.`;
}

// ─── Perform Translation ─────────────────────────────────────────────

async function performTranslation(
  text: string,
  targetLanguage: string,
  env: Env
): Promise<string | null> {
  try {
    const langName = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast' as any, {
      messages: [
        {
          role: 'system',
          content: `You are a translator specializing in Ghanaian languages. Translate the following English text to ${langName}.
Rules:
1. Translate as accurately as possible
2. For words/phrases you are uncertain about, include the original English in parentheses
3. Preserve the meaning and tone
4. If you cannot translate a specific term, keep it in English with a note
5. Return ONLY the translation, no explanations or meta-commentary`,
        },
        { role: 'user', content: text.substring(0, 2000) },
      ],
      max_tokens: 1000,
    });

    const result = (response as any)?.response;
    return result && result.trim().length > 0 ? result.trim() : null;
  } catch {
    return null;
  }
}

// ─── Back-Translation Check ──────────────────────────────────────────
// Translate → back-translate to English → compare with original
// Returns similarity score 0-1

export async function backTranslationCheck(
  translatedText: string,
  originalEnglish: string,
  targetLanguage: string,
  env: Env
): Promise<number> {
  try {
    const langName = targetLanguage.charAt(0).toUpperCase() + targetLanguage.slice(1);

    // Back-translate to English
    const backResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast' as any, {
      messages: [
        {
          role: 'system',
          content: `Translate the following ${langName} text back to English. Return ONLY the English translation, nothing else.`,
        },
        { role: 'user', content: translatedText.substring(0, 2000) },
      ],
      max_tokens: 1000,
    });

    const backTranslated = (backResponse as any)?.response || '';
    if (!backTranslated.trim()) return 0;

    // Compute word-overlap similarity (Jaccard)
    const originalWords = new Set(originalEnglish.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2));
    const backWords = new Set(backTranslated.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2));

    const intersection = new Set([...originalWords].filter((w: string) => backWords.has(w)));
    const union = new Set([...originalWords, ...backWords]);

    return union.size > 0 ? intersection.size / union.size : 0;
  } catch {
    return 0;
  }
}
