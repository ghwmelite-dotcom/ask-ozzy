// Section-boundary chunking for legal/regulatory documents

export interface Chunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  document: string;
  section: string;
  year: number;
  agent_tags: string[];
  difficulty?: string;
  subject?: string;
  chunk_type: string;
  source_url?: string;
}

export function chunkLegalDocument(fullText: string, docName: string, year: number, agentTags: string[]): Chunk[] {
  const sectionRegex = /(?=(?:Section|Article|Part|Chapter)\s+\d+)/gi;
  const sections = fullText.split(sectionRegex).filter(s => s.trim().length > 50);

  return sections.map((text, i) => {
    const sectionMatch = text.match(/^((?:Section|Article|Part|Chapter)\s+[\d\w()+\-.]+)/i);
    const sectionId = sectionMatch ? sectionMatch[1] : `chunk_${i}`;
    return {
      id: `${docName.replace(/\s+/g, '_')}_${sectionId.replace(/\s+/g, '_')}`,
      text: text.trim().slice(0, 1500),
      metadata: {
        document: docName,
        section: sectionId,
        year,
        agent_tags: agentTags,
        chunk_type: 'statute',
      }
    };
  });
}

export function chunkExamQuestion(question: string, meta: { subject: string; year: number; section: string; difficulty?: string }): Chunk {
  return {
    id: `exam_${meta.subject.replace(/\s+/g, '_')}_${meta.year}_${meta.section}`,
    text: question,
    metadata: {
      document: `${meta.subject} ${meta.year}`,
      section: meta.section,
      year: meta.year,
      agent_tags: ['wassce', 'bece'],
      difficulty: meta.difficulty,
      subject: meta.subject,
      chunk_type: 'exam_question',
    }
  };
}
