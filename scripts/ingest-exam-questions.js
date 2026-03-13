#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

// ─── Configuration ───────────────────────────────────────────────────

const API_URL = process.env.ASKOZZY_URL || "https://askozzy.ghwmelite.workers.dev";
const SECRET = process.env.BOOTSTRAP_SECRET;
const CACHE_DIR = path.join(__dirname, ".cache", "exams");
const DOCS_DIR = path.join(__dirname, "..", "knowledge-docs", "education");
const REGISTRY = path.join(__dirname, "exam-papers.json");
const UPLOAD_DELAY_MS = 2000;

// ─── Parse CLI flags ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const parseOnlyFlag = args.includes("--parse-only");
const onlyIndex = args.indexOf("--only");
const onlyId = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

// ─── Helpers ─────────────────────────────────────────────────────────

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadPdf(url, destPath) {
  if (url === "local") {
    if (fs.existsSync(destPath)) {
      log("📁", `Local: ${path.basename(destPath)}`);
      return true;
    }
    log("❌", `Missing local PDF: ${destPath}`);
    log("💡", `Download the past paper and place it at: ${destPath}`);
    return false;
  }

  if (fs.existsSync(destPath)) {
    log("⏭️", `Cached: ${path.basename(destPath)}`);
    return true;
  }

  log("⬇️", `Downloading: ${url}`);
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      log("❌", `Download failed (${res.status}): ${url}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    log("✅", `Downloaded: ${path.basename(destPath)} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    log("❌", `Download error: ${err.message}`);
    return false;
  }
}

async function extractText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);

  const pages = data.numpages;
  const text = data.text.trim();
  const chars = text.length;
  const charsPerPage = pages > 0 ? Math.round(chars / pages) : 0;

  log("📄", `Extracted: ${pages} pages, ${chars.toLocaleString()} chars (${charsPerPage} chars/page)`);

  if (charsPerPage < 100 && pages > 2) {
    log("⚠️", `WARNING: Very low text density — this PDF may be scanned/image-based`);
  }

  if (chars < 50) {
    log("❌", `Text too short (${chars} chars) — skipping`);
    return null;
  }

  return text;
}

async function aiParse(text, examType, subject, year) {
  log("🤖", `AI parsing ${examType.toUpperCase()} ${subject} ${year}...`);

  const res = await fetch(`${API_URL}/api/admin/parse-exam-paper`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": SECRET,
    },
    body: JSON.stringify({ text, exam_type: examType, subject, year }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI parse failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  log("✅", `Parsed: ${data.question_count} questions extracted`);
  return data;
}

async function uploadQuestions(examType, subject, year, paper, questions) {
  const res = await fetch(`${API_URL}/api/admin/exam-questions/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": SECRET,
    },
    body: JSON.stringify({ exam_type: examType, subject, year, paper, questions }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bulk insert failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!SECRET) {
    console.error("ERROR: Set BOOTSTRAP_SECRET environment variable");
    process.exit(1);
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const papers = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  const toProcess = onlyId ? papers.filter((p) => p.id === onlyId) : papers;

  if (toProcess.length === 0) {
    console.error(onlyId ? `No paper found with id: ${onlyId}` : "No papers in registry");
    process.exit(1);
  }

  log("🚀", `Processing ${toProcess.length} exam paper(s) → ${API_URL}`);
  if (parseOnlyFlag) log("📋", "Parse-only mode — skipping DB upload");
  console.log("");

  const results = { success: 0, skipped: 0, failed: 0, totalQuestions: 0 };

  for (const paper of toProcess) {
    console.log(`─── ${paper.exam_type.toUpperCase()} ${paper.subject} ${paper.year} ───`);

    // Stage 1: Download/locate PDF
    const pdfPath = path.join(CACHE_DIR, `${paper.id}.pdf`);
    const available = await downloadPdf(paper.url, pdfPath);
    if (!available) {
      results.skipped++;
      console.log("");
      continue;
    }

    // Stage 2: Extract text
    let text;
    try {
      text = await extractText(pdfPath);
    } catch (err) {
      log("❌", `PDF parse error: ${err.message}`);
      results.failed++;
      console.log("");
      continue;
    }

    if (!text) {
      results.failed++;
      console.log("");
      continue;
    }

    // Check for existing parsed JSON (skip AI parse unless --force)
    const typeDir = path.join(DOCS_DIR, paper.exam_type);
    fs.mkdirSync(typeDir, { recursive: true });
    const jsonPath = path.join(typeDir, `${paper.subject.toLowerCase().replace(/\s+/g, "-")}-${paper.year}.json`);

    let parsed;

    if (!forceFlag && fs.existsSync(jsonPath)) {
      log("⏭️", `Already parsed — loading from ${path.basename(jsonPath)}`);
      parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } else {
      // Stage 3: AI Parse
      try {
        parsed = await aiParse(text, paper.exam_type, paper.subject, paper.year);
      } catch (err) {
        log("⚠️", `AI parse failed: ${err.message} — retrying in 3s...`);
        await sleep(3000);
        try {
          parsed = await aiParse(text, paper.exam_type, paper.subject, paper.year);
        } catch (retryErr) {
          log("❌", `AI parse retry failed: ${retryErr.message}`);
          results.failed++;
          console.log("");
          continue;
        }
      }

      // Save parsed JSON for review
      fs.writeFileSync(jsonPath, JSON.stringify(parsed, null, 2));
      log("💾", `Saved: ${path.relative(path.join(__dirname, ".."), jsonPath)}`);
    }

    const questions = parsed.questions || [];
    if (questions.length === 0) {
      log("⚠️", "No questions parsed — skipping upload");
      results.failed++;
      console.log("");
      continue;
    }

    // Stage 4: Upload to DB
    if (parseOnlyFlag) {
      log("📋", `Parse-only: ${questions.length} questions ready for review`);
      results.success++;
      results.totalQuestions += questions.length;
      console.log("");
      continue;
    }

    try {
      const result = await uploadQuestions(paper.exam_type, paper.subject, paper.year, paper.paper, questions);
      log("✅", `Inserted: ${result.inserted}, Skipped: ${result.skipped}`);
      results.success++;
      results.totalQuestions += result.inserted;
    } catch (err) {
      log("❌", `Upload failed: ${err.message}`);
      results.failed++;
    }

    await sleep(UPLOAD_DELAY_MS);
    console.log("");
  }

  // Summary
  console.log("═══════════════════════════════════════");
  log("📊", `Results: ${results.success} succeeded, ${results.skipped} skipped (no PDF), ${results.failed} failed`);
  log("📝", `Total questions: ${results.totalQuestions}`);
  console.log("═══════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
