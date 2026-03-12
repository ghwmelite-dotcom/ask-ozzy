export const CERTIFIED_TRANSLATOR_RESOURCES = `**Certified Ghanaian Language Translation Resources:**
- Ghana Institute of Linguistics, Literacy and Bible Translation (GILLBT): gillbt.org
- Department of Ghanaian Languages, University of Ghana: ug.edu.gh/linguistics
- Ghana Institute of Languages: ghanalanguages.gov.gh
- National Language Centre, Ministry of Education`;

export type TranslationUseCase =
  | 'casual_communication'
  | 'civic_information'
  | 'official_document'
  | 'educational_content'
  | 'health_information';

export type LanguageTier = 1 | 2 | 3 | 4;

const TIER_MAP: Record<string, LanguageTier> = {
  hausa: 1, ha: 1,
  twi: 2, asante_twi: 2, akuapem_twi: 2, tw: 2,
  ewe: 2, ee: 2,
  ga: 3,
  dagbani: 3, dag: 3,
  nzema: 4,
  gonja: 4,
};

const USE_CASE_RISK: Record<TranslationUseCase, number> = {
  casual_communication: 0,
  educational_content: 1,
  civic_information: 1,
  health_information: 2,
  official_document: 3,
};

export function classifyTranslationRisk(
  targetLanguage: string,
  useCase: TranslationUseCase
): { tier: LanguageTier; riskLevel: 'low' | 'medium' | 'high' | 'critical'; disclaimer: string } {
  const tier = TIER_MAP[targetLanguage.toLowerCase()] ?? 3;
  const combinedRisk = tier + USE_CASE_RISK[useCase];
  const riskLevel = combinedRisk <= 1 ? 'low' : combinedRisk <= 3 ? 'medium' : combinedRisk <= 5 ? 'high' : 'critical';

  const disclaimers: Record<string, string> = {
    low: '⚠️ AI-generated translation. Review before publishing.',
    medium: '⚠️ AI translation for review purposes only. Have a fluent speaker verify before use.',
    high: '🚨 This AI translation has high error risk. Do NOT use without review by a certified speaker of this language.',
    critical: '🚨 AI translation of official documents in this language is unreliable. Please engage a certified translator (contact GILLBT or the University of Ghana Linguistics Department).',
  };

  return { tier, riskLevel, disclaimer: disclaimers[riskLevel] };
}
