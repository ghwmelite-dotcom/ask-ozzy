// Master response schema for all AskOzzy agents

export interface AskOzzyResponse {
  answer: string;
  summary?: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  confidence_breakdown: ConfidenceBreakdown;
  verified: boolean;
  sources_available: boolean;
  knowledge_gap?: string;
  reasoning_steps?: string[];
  agent_type: string;
  response_language: string;
  caveats?: string[];
  suggested_followups?: string[];
  request_id: string;
  response_time_ms: number;
  model_used: string;
}

export interface Citation {
  index: number;
  source_label: string;
  chunk_id: string;
  relevance_score: number;
  excerpt: string;
}

export interface ConfidenceBreakdown {
  retrieval_score: number;
  verification_verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'SKIPPED';
  self_consistency_score: number;
  final_confidence: 'high' | 'medium' | 'low' | 'none';
}
