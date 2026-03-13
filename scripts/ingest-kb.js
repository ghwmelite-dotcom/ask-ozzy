#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

// ─── Configuration ───────────────────────────────────────────────────

const API_URL = process.env.ASKOZZY_URL || "https://askozzy.ghwmelite.workers.dev";
const SECRET = process.env.BOOTSTRAP_SECRET;
const CACHE_DIR = path.join(__dirname, ".cache");
const DOCS_DIR = path.join(__dirname, "..", "knowledge-docs");
const REGISTRY = path.join(__dirname, "documents.json");
const MAX_CONTENT_LENGTH = 80000; // Split docs larger than this
const UPLOAD_DELAY_MS = 2000; // Delay between uploads for rate limiting

// ─── Parse CLI flags ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
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

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      log("⚠️", `Unexpected content-type: ${contentType} — downloading anyway`);
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

  if (charsPerPage < 100 && pages > 5) {
    log("⚠️", `WARNING: Very low text density — this PDF may be scanned/image-based`);
  }

  if (chars < 100) {
    log("❌", `Text too short (${chars} chars) — skipping`);
    return null;
  }

  return text;
}

function splitContent(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const parts = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLen;

    // Try to split at a paragraph boundary
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      if (lastParagraph > start + maxLen * 0.5) {
        end = lastParagraph;
      }
    }

    parts.push(text.slice(start, end).trim());
    start = end;
  }

  return parts;
}

async function checkExists(title) {
  try {
    const res = await fetch(`${API_URL}/api/admin/documents?search=${encodeURIComponent(title)}`, {
      headers: { "X-Bootstrap-Secret": SECRET },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.documents && data.documents.some((d) => d.title === title);
  } catch {
    return false;
  }
}

async function uploadDocument(title, content, source, category) {
  const res = await fetch(`${API_URL}/api/admin/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": SECRET,
    },
    body: JSON.stringify({ title, content, source, category }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  return await res.json();
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!SECRET) {
    console.error("ERROR: Set BOOTSTRAP_SECRET environment variable");
    process.exit(1);
  }

  // Ensure directories exist
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Load registry
  const documents = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  const toProcess = onlyId ? documents.filter((d) => d.id === onlyId) : documents;

  if (toProcess.length === 0) {
    console.error(onlyId ? `No document found with id: ${onlyId}` : "No documents in registry");
    process.exit(1);
  }

  log("🚀", `Processing ${toProcess.length} document(s) → ${API_URL}`);
  console.log("");

  const results = { success: 0, skipped: 0, failed: 0 };

  for (const doc of toProcess) {
    console.log(`─── ${doc.title} ───`);

    // Stage 1: Download
    const pdfPath = path.join(CACHE_DIR, `${doc.id}.pdf`);
    const downloaded = await downloadPdf(doc.url, pdfPath);
    if (!downloaded) {
      results.failed++;
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

    // Save extracted text for human review
    const categoryDir = path.join(DOCS_DIR, doc.category);
    fs.mkdirSync(categoryDir, { recursive: true });
    const textPath = path.join(categoryDir, `${doc.id}.txt`);
    fs.writeFileSync(textPath, text);
    log("💾", `Saved text: ${path.relative(path.join(__dirname, ".."), textPath)}`);

    // Stage 3: Upload
    if (!forceFlag) {
      const exists = await checkExists(doc.title);
      if (exists) {
        log("⏭️", `Already ingested — skipping (use --force to re-upload)`);
        results.skipped++;
        console.log("");
        continue;
      }
    }

    const parts = splitContent(text, MAX_CONTENT_LENGTH);
    log("📤", `Uploading${parts.length > 1 ? ` (${parts.length} parts)` : ""}...`);

    let uploadOk = true;
    for (let i = 0; i < parts.length; i++) {
      const partTitle = parts.length > 1 ? `${doc.title} (Part ${i + 1})` : doc.title;

      try {
        const result = await uploadDocument(partTitle, parts[i], doc.source, doc.category);
        log("✅", `Uploaded: ${partTitle} → id: ${result.id}, status: ${result.status}`);
      } catch (err) {
        log("⚠️", `Upload failed: ${err.message} — retrying...`);
        await sleep(3000);
        try {
          const result = await uploadDocument(partTitle, parts[i], doc.source, doc.category);
          log("✅", `Retry succeeded: ${partTitle} → id: ${result.id}`);
        } catch (retryErr) {
          log("❌", `Retry failed: ${retryErr.message}`);
          uploadOk = false;
        }
      }

      if (i < parts.length - 1) await sleep(UPLOAD_DELAY_MS);
    }

    if (uploadOk) {
      results.success++;
    } else {
      results.failed++;
    }

    // Rate limit delay between documents
    await sleep(UPLOAD_DELAY_MS);
    console.log("");
  }

  // Summary
  console.log("═══════════════════════════════════════");
  log("📊", `Results: ${results.success} succeeded, ${results.skipped} skipped, ${results.failed} failed`);
  console.log("═══════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
