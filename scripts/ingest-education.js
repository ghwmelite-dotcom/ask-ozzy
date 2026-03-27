/**
 * eClassroom Knowledge Base Ingestion Script
 * Reads local education documents and POSTs them to the ingest endpoint.
 *
 * Usage: node scripts/ingest-education.js
 *
 * This logs into AskOzzy as super_admin first to get a session token,
 * then uses it to call the admin-protected ingest endpoint.
 */

const fs = require('fs');
const path = require('path');

const API = 'https://askozzy.work';
const DOCS_DIR = path.join(__dirname, '..', 'knowledge-docs', 'education');

async function ingestExamFile(filepath, token) {
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  const payload = {
    type: 'exam',
    exam_type: data.exam_type || (filepath.includes('bece') ? 'bece' : 'wassce'),
    subject: data.subject || '',
    year: data.year || 2024,
    paper: data.paper || 1,
    questions: data.questions || [],
  };

  const res = await fetch(`${API}/api/eclassroom/rag/ingest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

async function ingestSyllabusFile(filepath, token) {
  const text = fs.readFileSync(filepath, 'utf-8');
  const fname = path.basename(filepath, '.txt');
  // waec-core-mathematics-syllabus -> Core Mathematics
  const subject = fname
    .replace(/^waec-syllabus-/, '')
    .replace(/^waec-/, '')
    .replace(/-syllabus$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  const payload = {
    type: 'syllabus',
    subject,
    year: 2024,
    text,
  };

  const res = await fetch(`${API}/api/eclassroom/rag/ingest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

async function login() {
  // Login as super_admin to get a session token
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ohcselibrary@gmail.com',
      password: process.env.ADMIN_PASSWORD,
    }),
  });

  if (!res.ok) {
    console.error('Login failed:', res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  return data.token;
}

async function main() {
  if (!process.env.ADMIN_PASSWORD) {
    console.error('Set ADMIN_PASSWORD environment variable first:');
    console.error('  ADMIN_PASSWORD=yourpassword node scripts/ingest-education.js');
    process.exit(1);
  }

  console.log('=== eClassroom Knowledge Base Ingestion ===\n');
  console.log('Logging in as admin...');
  const token = await login();
  console.log('Authenticated.\n');

  let success = 0, failed = 0, totalChunks = 0;

  // WASSCE exam papers
  const wassceDir = path.join(DOCS_DIR, 'wassce');
  if (fs.existsSync(wassceDir)) {
    const files = fs.readdirSync(wassceDir).filter(f => f.endsWith('.json'));
    console.log(`--- WASSCE Past Papers (${files.length} files) ---`);
    for (const f of files) {
      process.stdout.write(`  ${f}... `);
      try {
        const result = await ingestExamFile(path.join(wassceDir, f), token);
        if (result.error) {
          console.log(`FAILED: ${result.error}`);
          failed++;
        } else {
          console.log(`OK (${result.ingested} chunks)`);
          success++;
          totalChunks += result.ingested || 0;
        }
      } catch (e) {
        console.log(`ERROR: ${e.message}`);
        failed++;
      }
    }
  }

  // BECE exam papers
  const beceDir = path.join(DOCS_DIR, 'bece');
  if (fs.existsSync(beceDir)) {
    const files = fs.readdirSync(beceDir).filter(f => f.endsWith('.json'));
    console.log(`\n--- BECE Past Papers (${files.length} files) ---`);
    for (const f of files) {
      process.stdout.write(`  ${f}... `);
      try {
        const result = await ingestExamFile(path.join(beceDir, f), token);
        if (result.error) {
          console.log(`FAILED: ${result.error}`);
          failed++;
        } else {
          console.log(`OK (${result.ingested} chunks)`);
          success++;
          totalChunks += result.ingested || 0;
        }
      } catch (e) {
        console.log(`ERROR: ${e.message}`);
        failed++;
      }
    }
  }

  // WAEC Syllabi
  const syllabi = fs.readdirSync(DOCS_DIR).filter(f => f.startsWith('waec') && f.endsWith('.txt'));
  if (syllabi.length > 0) {
    console.log(`\n--- WAEC Syllabi (${syllabi.length} files) ---`);
    for (const f of syllabi) {
      process.stdout.write(`  ${f}... `);
      try {
        const result = await ingestSyllabusFile(path.join(DOCS_DIR, f), token);
        if (result.error) {
          console.log(`FAILED: ${result.error}`);
          failed++;
        } else {
          console.log(`OK (${result.ingested} chunks)`);
          success++;
          totalChunks += result.ingested || 0;
        }
      } catch (e) {
        console.log(`ERROR: ${e.message}`);
        failed++;
      }
    }
  }

  console.log('\n=== Ingestion Complete ===');
  console.log(`  Files: ${success + failed} (${success} ok, ${failed} failed)`);
  console.log(`  Total chunks: ${totalChunks}`);
}

main().catch(console.error);
