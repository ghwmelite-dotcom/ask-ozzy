#!/usr/bin/env node

/**
 * Download and extract text from WAEC elective subject syllabuses.
 * Filters documents.json to only process waec-syllabus-* entries.
 * Saves extracted text to knowledge-docs/education/ for review.
 */

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const CACHE_DIR = path.join(__dirname, ".cache");
const DOCS_DIR = path.join(__dirname, "..", "knowledge-docs");
const REGISTRY = path.join(__dirname, "documents.json");

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const onlyIndex = args.indexOf("--only");
const onlyId = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadPdf(url, destPath) {
  if (!forceFlag && fs.existsSync(destPath)) {
    const stats = fs.statSync(destPath);
    if (stats.size > 1000) {
      log("📦", `Cached: ${path.basename(destPath)} (${(stats.size / 1024).toFixed(0)} KB)`);
      return true;
    }
  }

  log("⬇️", `Downloading: ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/pdf,*/*",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      log("❌", `HTTP ${res.status}: ${url}`);
      return false;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    log("✅", `Downloaded: ${(buffer.length / 1024).toFixed(0)} KB`);
    return true;
  } catch (err) {
    log("❌", `Download error: ${err.message}`);
    return false;
  }
}

async function extractText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);

  if (!data.text || data.text.trim().length < 100) {
    log("⚠️", `Very little text extracted (${data.text?.length || 0} chars) — may be scanned/image PDF`);
    return null;
  }

  log("📄", `Extracted: ${data.numpages} pages, ${(data.text.length / 1024).toFixed(0)} KB text`);
  return data.text;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const documents = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));

  // Filter to only elective syllabuses
  let toProcess = documents.filter((d) => d.id.startsWith("waec-syllabus-"));

  if (onlyId) {
    toProcess = toProcess.filter((d) => d.id === onlyId);
  }

  if (toProcess.length === 0) {
    console.error("No syllabus documents found to process");
    process.exit(1);
  }

  log("🚀", `Downloading ${toProcess.length} WAEC elective syllabus(es)`);
  console.log("");

  const results = { success: 0, failed: 0 };

  for (const doc of toProcess) {
    console.log(`─── ${doc.title} ───`);

    // Download PDF
    const pdfPath = path.join(CACHE_DIR, `${doc.id}.pdf`);
    const downloaded = await downloadPdf(doc.url, pdfPath);
    if (!downloaded) {
      results.failed++;
      console.log("");
      await sleep(1000);
      continue;
    }

    // Extract text
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

    // Save extracted text
    const categoryDir = path.join(DOCS_DIR, doc.category);
    fs.mkdirSync(categoryDir, { recursive: true });
    const textPath = path.join(categoryDir, `${doc.id}.txt`);
    fs.writeFileSync(textPath, text);
    log("💾", `Saved: ${path.relative(path.join(__dirname, ".."), textPath)}`);

    results.success++;
    console.log("");

    // Rate limit
    await sleep(1500);
  }

  // Summary
  console.log("═".repeat(50));
  log("📊", `Results: ${results.success} extracted, ${results.failed} failed`);
  console.log("═".repeat(50));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
