// ─── Humanizer Post-Processor ───────────────────────────────────────
// Catches mechanical AI-writing patterns that survive prompt-level rules.
// Pure string manipulation — sub-millisecond, no API calls.

/**
 * Post-process AI response to remove mechanical AI-writing tells.
 * Run BEFORE citation parsing and verification (preserves [SOURCE_N] refs).
 */
export function humanizeResponse(text: string): string {
  let result = text;

  // 1. Remove chatbot artifacts
  result = removeChatbotArtifacts(result);

  // 2. Replace curly quotes with straight quotes
  result = result.replace(/[\u201C\u201D]/g, '"');
  result = result.replace(/[\u2018\u2019]/g, "'");

  // 3. Reduce em dash overuse (keep max 1, replace rest with comma or period)
  result = reduceEmDashes(result);

  // 4. Remove emoji decorations from headings/bullets
  result = removeEmojiDecorations(result);

  // 5. Flatten inline-header bold lists to plain prose where possible
  result = flattenBoldHeaderLists(result);

  // 6. Strip excessive bold formatting
  result = reduceExcessiveBold(result);

  // 7. Remove filler phrases
  result = removeFiller(result);

  // 8. Remove sycophantic openers
  result = removeSycophancy(result);

  return result.trim();
}

// ─── Pattern Handlers ───────────────────────────────────────────────

function removeChatbotArtifacts(text: string): string {
  const artifacts = [
    /^I hope this helps!?\s*/gim,
    /Let me know if you('d like| need| want) (me to |any )?(expand|help|clarify|more|anything)[^.!]*[.!]?\s*/gi,
    /^(Of course|Certainly|Absolutely)[!.,]\s*/gim,
    /^Here is (a|an|the) [^.]+[.:]\s*/gim,
    /Feel free to (ask|reach out|let me know)[^.]*[.!]?\s*/gi,
    /I('m| am) happy to help[^.]*[.!]?\s*/gi,
    /Don't hesitate to[^.]*[.!]?\s*/gi,
  ];

  let result = text;
  for (const pattern of artifacts) {
    result = result.replace(pattern, '');
  }
  return result;
}

function reduceEmDashes(text: string): string {
  const emDashCount = (text.match(/\u2014/g) || []).length;
  if (emDashCount <= 1) return text;

  // Keep the first em dash, replace subsequent ones
  let count = 0;
  return text.replace(/\u2014/g, (match) => {
    count++;
    if (count === 1) return match;
    return ',';
  });
}

function removeEmojiDecorations(text: string): string {
  // Remove emojis at start of lines (headings, bullets)
  // Matches common decorative emoji patterns: 🚀 **Label**, ✅ Step 1, etc.
  return text.replace(/^(\s*[-*]?\s*)[^\w\s#\[(*`]{1,2}\s+/gm, '$1');
}

function flattenBoldHeaderLists(text: string): string {
  // Detect "- **Label:** description" pattern (3+ consecutive = AI list)
  const lines = text.split('\n');
  const boldHeaderPattern = /^\s*[-*]\s*\*\*[^*]+\*\*[:\s]/;

  // Find runs of bold-header list items
  let i = 0;
  while (i < lines.length) {
    let runStart = -1;
    let runEnd = -1;

    // Find start of a bold-header run
    if (boldHeaderPattern.test(lines[i])) {
      runStart = i;
      while (i < lines.length && boldHeaderPattern.test(lines[i])) {
        runEnd = i;
        i++;
      }
    } else {
      i++;
      continue;
    }

    // Only flatten runs of 3+ items (strong AI signal)
    const runLength = runEnd - runStart + 1;
    if (runLength >= 3) {
      for (let j = runStart; j <= runEnd; j++) {
        // Convert "- **Label:** description" to "- Label: description"
        lines[j] = lines[j].replace(/\*\*([^*]+)\*\*/, '$1');
      }
    }
  }

  return lines.join('\n');
}

function reduceExcessiveBold(text: string): string {
  // Count bold instances in the text
  const boldMatches = text.match(/\*\*[^*]+\*\*/g) || [];
  const wordCount = text.split(/\s+/).length;

  // If more than 1 bold per 40 words, it's excessive — strip all inline bold
  // (preserve heading-level bold and [SOURCE_N] formatting)
  if (boldMatches.length > 1 && wordCount / boldMatches.length < 40) {
    // Only strip bold that isn't at the start of a line (preserve headings)
    return text.replace(/(?<!^|\n)\*\*([^*]+)\*\*/g, '$1');
  }

  return text;
}

function removeFiller(text: string): string {
  const fillers: [RegExp, string][] = [
    [/\bIn order to\b/g, 'To'],
    [/\bin order to\b/g, 'to'],
    [/\bDue to the fact that\b/g, 'Because'],
    [/\bdue to the fact that\b/g, 'because'],
    [/\bAt this point in time\b/g, 'Now'],
    [/\bat this point in time\b/g, 'now'],
    [/\bIn the event that\b/g, 'If'],
    [/\bin the event that\b/g, 'if'],
    [/\bhas the ability to\b/g, 'can'],
    [/\bhave the ability to\b/g, 'can'],
    [/\bIt is important to note that\b/gi, ''],
    [/\bIt('s| is) worth noting that\b/gi, ''],
    [/\bIt should be noted that\b/gi, ''],
  ];

  let result = text;
  for (const [pattern, replacement] of fillers) {
    result = result.replace(pattern, replacement);
  }

  // Clean up double spaces from removals
  result = result.replace(/  +/g, ' ');
  // Clean up sentences starting with lowercase after removal
  result = result.replace(/\.\s+([a-z])/g, (_, c) => '. ' + c.toUpperCase());

  return result;
}

function removeSycophancy(text: string): string {
  const openers = [
    /^(That's (a |an )?(great|excellent|wonderful|fantastic|good) (question|point|observation)[!.]?\s*)/im,
    /^(You('re| are) (absolutely |completely )?(right|correct)[!.]?\s*)/im,
    /^(What a (great|excellent|wonderful|fantastic) (question|point)[!.]?\s*)/im,
  ];

  let result = text;
  for (const pattern of openers) {
    result = result.replace(pattern, '');
  }

  return result;
}
