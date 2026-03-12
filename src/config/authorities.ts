// Agent-specific authority references for no-context fallback messages
export const AGENT_AUTHORITIES: Record<string, string> = {
  procurement: 'the Public Procurement Authority of Ghana at ppaghana.org or +233-302-664-141',
  legal: 'the Ghana Legal Service at legalservice.gov.gh or a licensed Ghanaian solicitor',
  hr: 'the Office of the Head of Civil Service at ohcs.gov.gh',
  it: 'your department IT officer or NITA (National Information Technology Agency)',
  wassce: 'WAEC Ghana directly at waecgh.org',
  bece: 'WAEC Ghana directly at waecgh.org',
  finance: 'the Ministry of Finance at mofep.gov.gh or the CAGD',
  governance: 'the Office of the Head of Civil Service at ohcs.gov.gh',
  translation: 'a certified translator or the Ghana Institute of Linguistics, Literacy and Bible Translation (GILLBT)',
  citizen: 'the relevant Metropolitan, Municipal, or District Assembly or Ghana.gov.gh',
  research: 'the Ghana Statistical Service at statsghana.gov.gh or relevant academic institutions',
  general: 'the relevant official authority',
};

export function getAuthorityForAgent(knowledgeCategory: string): string {
  return AGENT_AUTHORITIES[knowledgeCategory] || AGENT_AUTHORITIES.general;
}
