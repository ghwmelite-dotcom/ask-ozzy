#!/usr/bin/env node

/**
 * Scrape WASSCE/BECE past questions from kuulchat.com
 * Questions are rendered as structured HTML with MCQ options and solutions.
 * This is more reliable than PDF + AI parsing.
 */

const fs = require("fs");
const path = require("path");

// ─── Configuration ───────────────────────────────────────────────────

const API_URL = process.env.ASKOZZY_URL || "https://askozzy.ghwmelite.workers.dev";
const SECRET = process.env.BOOTSTRAP_SECRET;
const DOCS_DIR = path.join(__dirname, "..", "knowledge-docs", "education");
const UPLOAD_DELAY_MS = 2000;

// ─── URL Registry ────────────────────────────────────────────────────

const WASSCE_PAGES = [];
const BECE_PAGES = [];

const CORE_SUBJECTS = [
  { slug: "mathematics", name: "Core Mathematics", wassce_slug: "mathematics", bece_slug: "mathematics" },
  { slug: "english", name: "English Language", wassce_slug: "english", bece_slug: "english" },
  { slug: "science", name: "Integrated Science", wassce_slug: "science", bece_slug: "science" },
  { slug: "social-studies", name: "Social Studies", wassce_slug: "social-studies", bece_slug: "social-studies" },
];

const YEARS = [2020, 2021, 2022, 2023, 2024];

for (const subject of CORE_SUBJECTS) {
  for (const year of YEARS) {
    WASSCE_PAGES.push({
      url: `https://kuulchat.com/wassce/questions/june-${year}-${subject.wassce_slug}/`,
      exam_type: "wassce",
      subject: subject.name,
      year,
      paper: "1",
    });
    BECE_PAGES.push({
      url: `https://kuulchat.com/bece/questions/${subject.bece_slug}-${year}/`,
      exam_type: "bece",
      subject: subject.name,
      year,
      paper: "1",
    });
  }
}

// Handle kuulchat URL quirks
// BECE Social Studies 2021 uses "socialstudies-2021" (no hyphen)
const beceSSIdx = BECE_PAGES.findIndex(p => p.subject === "Social Studies" && p.year === 2021);
if (beceSSIdx !== -1) {
  BECE_PAGES[beceSSIdx].url = "https://kuulchat.com/bece/questions/socialstudies-2021/";
}

const ALL_PAGES = [...WASSCE_PAGES, ...BECE_PAGES];

// ─── Parse CLI flags ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const parseOnlyFlag = args.includes("--parse-only");
const onlyIndex = args.indexOf("--only");
const onlyId = onlyIndex !== -1 ? args[onlyIndex + 1] : null;
const examTypeFilter = args.includes("--wassce") ? "wassce" : args.includes("--bece") ? "bece" : null;

// ─── Helpers ─────────────────────────────────────────────────────────

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pageId(page) {
  const subjectSlug = page.subject.toLowerCase().replace(/\s+/g, "-");
  return `${page.exam_type}-${subjectSlug}-${page.year}`;
}

/**
 * Parse questions from kuulchat HTML.
 * Questions follow a pattern:
 * - Question number as heading or bold text
 * - Question text
 * - Options A-D as list items or labeled lines
 * - Solution section with correct answer explanation
 */
function parseQuestionsFromHTML(html, examType, subject) {
  const questions = [];

  // Remove HTML tags but keep structure markers
  // First, extract solution blocks to find correct answers
  const solutionBlocks = [];
  const solutionRegex = /(?:Solution|SOLUTION|solution)[:\s]*(?:<[^>]*>)*\s*([\s\S]*?)(?=(?:\d+[\.\)]\s|$|Question\s+\d|<h[2-4]))/gi;

  // Strategy: Split by question numbers and parse each block
  // Clean HTML to text while preserving structure
  let text = html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Convert <br> and block elements to newlines
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<(?:p|div|h[1-6]|li|tr)[^>]*>/gi, "\n")
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&times;/g, "\u00D7")
    .replace(/&divide;/g, "\u00F7")
    .replace(/&frac12;/g, "\u00BD")
    .replace(/&frac14;/g, "\u00BC")
    .replace(/&frac34;/g, "\u00BE")
    .replace(/&deg;/g, "\u00B0")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    // Normalize whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();

  // Split into question blocks by question numbers (1. or 1) or "Question 1")
  const questionBlockRegex = /(?:^|\n)\s*(?:Question\s+)?(\d{1,3})\s*[\.\)]\s*/gi;
  const splits = [];
  let match;

  while ((match = questionBlockRegex.exec(text)) !== null) {
    splits.push({ index: match.index, number: parseInt(match[1]), matchEnd: match.index + match[0].length });
  }

  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].matchEnd;
    const end = i + 1 < splits.length ? splits[i + 1].index : text.length;
    const block = text.slice(start, end).trim();
    const qNum = splits[i].number;

    if (!block || block.length < 10) continue;

    // Extract options A-D
    const optionRegex = /(?:^|\n)\s*([A-D])[\.\):\s]+(.+?)(?=(?:\n\s*[A-D][\.\):\s]|\n\s*(?:Solution|Mark|Explanation)|\n\s*$))/gis;
    const options = {};
    let optMatch;
    let firstOptionIndex = block.length;

    const optMatches = [];
    while ((optMatch = optionRegex.exec(block)) !== null) {
      optMatches.push({ letter: optMatch[1].toUpperCase(), text: optMatch[2].trim(), index: optMatch.index });
    }

    for (const om of optMatches) {
      options[om.letter] = om.text;
      if (om.index < firstOptionIndex) firstOptionIndex = om.index;
    }

    // Question text is everything before the first option
    let questionText = block.slice(0, firstOptionIndex).trim();

    // Extract solution/answer section
    const solutionMatch = block.match(/(?:Solution|SOLUTION|Explanation|Answer)[:\s]*([\s\S]*)/i);
    let explanation = "";
    let correctAnswer = null;

    if (solutionMatch) {
      explanation = solutionMatch[1].trim().slice(0, 500); // Cap explanation length

      // Strategy 1: Look for explicit answer patterns
      const answerPatterns = [
        /(?:answer|correct|option)\s*(?:is|=|:)\s*([A-D])\b/i,
        /\b([A-D])\s*(?:is the (?:correct )?answer)/i,
        /(?:∴|therefore|hence|so|thus)[,\s]*(?:the answer is\s*)?([A-D])\b/i,
        /(?:Option|Choice)\s+([A-D])/i,
      ];
      for (const pat of answerPatterns) {
        const m = explanation.match(pat);
        if (m) {
          correctAnswer = m[1].toUpperCase();
          break;
        }
      }

      // Strategy 2: Match solution's final value against options
      if (!correctAnswer && Object.keys(options).length >= 2) {
        // Normalize text for comparison (remove spaces, lowercase)
        const normalize = (s) => s.replace(/[\s,₵$]+/g, "").replace(/\.00$/,"").toLowerCase();

        // Look for the last meaningful value in the solution
        // Try matching option text against solution content
        for (const [letter, optText] of Object.entries(options)) {
          const normOpt = normalize(optText);
          if (normOpt.length >= 1) {
            // Check if this option's value appears at the end of solution lines
            const normExpl = normalize(explanation);
            // Count occurrences — the answer typically appears more
            const escapedOpt = normOpt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const occurrences = (normExpl.match(new RegExp(escapedOpt, "g")) || []).length;
            if (occurrences >= 2) {
              // Option value appears multiple times in solution (in working + as answer)
              correctAnswer = letter;
              break;
            }
          }
        }
      }
    }

    // Clean up question text - remove solution text if it leaked in
    const solIdx = questionText.search(/(?:Solution|SOLUTION|Mark\s|Explanation)/i);
    if (solIdx > 0) {
      questionText = questionText.slice(0, solIdx).trim();
    }

    if (questionText.length < 5) continue;

    const hasOptions = Object.keys(options).length >= 2;

    // Only keep questions that have at least 3 MCQ options (A, B, C minimum)
    // This filters out theory sub-questions and solution step numbers
    if (!hasOptions || Object.keys(options).length < 3) continue;

    // Skip if question number is 0 (parsing artifact)
    if (qNum === 0) continue;

    questions.push({
      question_number: qNum,
      question_text: questionText,
      options: options,
      correct_answer: correctAnswer,
      explanation: explanation.slice(0, 300),
      difficulty: "medium",
      marks: null,
      topic: null,
    });
  }

  // Deduplicate by question number (keep first occurrence)
  const seen = new Set();
  const deduped = questions.filter((q) => {
    if (seen.has(q.question_number)) return false;
    seen.add(q.question_number);
    return true;
  });

  return deduped;
}

async function fetchPage(url) {
  log("\u2B07\uFE0F", `Fetching: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      log("\u274C", `HTTP ${res.status}: ${url}`);
      return null;
    }

    return await res.text();
  } catch (err) {
    log("\u274C", `Fetch error: ${err.message}`);
    return null;
  }
}

async function uploadQuestions(page, questions) {
  const body = {
    exam_type: page.exam_type,
    subject: page.subject,
    year: page.year,
    paper: page.paper,
    questions,
  };

  const res = await fetch(`${API_URL}/api/admin/exam-questions/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": SECRET,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return await res.json();
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!SECRET && !parseOnlyFlag) {
    console.error("ERROR: Set BOOTSTRAP_SECRET environment variable (or use --parse-only)");
    process.exit(1);
  }

  // Filter pages
  let pages = ALL_PAGES;
  if (onlyId) {
    pages = pages.filter((p) => pageId(p) === onlyId);
    if (pages.length === 0) {
      console.error(`No page found with id: ${onlyId}`);
      console.error("Available IDs:", ALL_PAGES.map(pageId).join(", "));
      process.exit(1);
    }
  }
  if (examTypeFilter) {
    pages = pages.filter((p) => p.exam_type === examTypeFilter);
  }

  log("\uD83D\uDE80", `Scraping ${pages.length} page(s) from kuulchat.com`);
  console.log("");

  const results = { success: 0, skipped: 0, failed: 0, totalQuestions: 0 };

  for (const page of pages) {
    const id = pageId(page);
    console.log(`\u2500\u2500\u2500 ${page.exam_type.toUpperCase()} ${page.subject} ${page.year} \u2500\u2500\u2500`);

    // Check if already parsed
    const jsonDir = path.join(DOCS_DIR, page.exam_type);
    const subjectSlug = page.subject.toLowerCase().replace(/\s+/g, "-");
    const jsonPath = path.join(jsonDir, `${subjectSlug}-${page.year}.json`);

    if (!forceFlag && fs.existsSync(jsonPath)) {
      log("\u23ED\uFE0F", `Already parsed: ${path.relative(path.join(__dirname, ".."), jsonPath)} (use --force to re-scrape)`);
      // Still upload if not parse-only
      if (!parseOnlyFlag) {
        const existing = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        if (existing.questions && existing.questions.length > 0) {
          try {
            const result = await uploadQuestions(page, existing.questions);
            log("\u2705", `Uploaded: ${result.inserted} inserted, ${result.skipped} skipped`);
            results.totalQuestions += result.inserted;
          } catch (err) {
            log("\u274C", `Upload failed: ${err.message}`);
          }
        }
      }
      results.skipped++;
      console.log("");
      continue;
    }

    // Fetch the page
    const html = await fetchPage(page.url);
    if (!html) {
      results.failed++;
      console.log("");
      await sleep(1000);
      continue;
    }

    log("\uD83D\uDCC4", `Fetched: ${(html.length / 1024).toFixed(0)} KB`);

    // Parse questions
    const questions = parseQuestionsFromHTML(html, page.exam_type, page.subject);
    log("\uD83D\uDD0D", `Parsed: ${questions.length} questions`);

    if (questions.length === 0) {
      log("\u26A0\uFE0F", `No questions found — page may have different structure`);
      results.failed++;
      console.log("");
      await sleep(1000);
      continue;
    }

    // Log answer coverage
    const withAnswers = questions.filter((q) => q.correct_answer).length;
    log("\uD83D\uDCCA", `MCQ questions: ${questions.length}, With answers: ${withAnswers}`);

    // Save JSON
    fs.mkdirSync(jsonDir, { recursive: true });
    const output = {
      exam_type: page.exam_type,
      subject: page.subject,
      year: page.year,
      paper: parseInt(page.paper),
      source: "kuulchat.com",
      questions,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
    log("\uD83D\uDCBE", `Saved: ${path.relative(path.join(__dirname, ".."), jsonPath)}`);

    // Upload to DB
    if (!parseOnlyFlag && SECRET) {
      try {
        const result = await uploadQuestions(page, questions);
        log("\u2705", `Uploaded: ${result.inserted} inserted, ${result.skipped} skipped`);
        results.totalQuestions += result.inserted;
      } catch (err) {
        log("\u26A0\uFE0F", `Upload failed: ${err.message} — retrying...`);
        await sleep(3000);
        try {
          const result = await uploadQuestions(page, questions);
          log("\u2705", `Retry succeeded: ${result.inserted} inserted`);
          results.totalQuestions += result.inserted;
        } catch (retryErr) {
          log("\u274C", `Retry failed: ${retryErr.message}`);
        }
      }
    }

    results.success++;
    console.log("");

    // Rate limit
    await sleep(1500);
  }

  // Summary
  console.log("\u2550".repeat(50));
  log("\uD83D\uDCCA", `Results: ${results.success} scraped, ${results.skipped} skipped, ${results.failed} failed`);
  log("\uD83D\uDCDD", `Total questions: ${results.totalQuestions} inserted into DB`);
  console.log("\u2550".repeat(50));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
