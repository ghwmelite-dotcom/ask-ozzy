// ═══════════════════════════════════════════════════════════════════
//  AskOzzy — Enhanced Service Worker v5
//  Cache-first for static, network-first for API, offline queue for messages
//  IndexedDB template cache + response cache + conversation cache for offline-first AI
//  Push notifications, content indexing, background conversation sync
// ═══════════════════════════════════════════════════════════════════

const CACHE_NAME = "askozzy-v10";
const OFFLINE_QUEUE_KEY = "askozzy_offline_queue";

// IndexedDB configuration
const IDB_NAME = "ozzy-offline";
const IDB_VERSION = 2;
const STORE_TEMPLATE_CACHE = "template_cache";
const STORE_RESPONSE_CACHE = "response_cache";
const STORE_CONVERSATIONS = "conversation_cache";
const STORE_MESSAGES = "message_cache";
const RESPONSE_CACHE_MAX = 50;
const RESPONSE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CONVERSATION_CACHE_MAX = 200;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/css/app.css",
  "/js/app.js",
  "/js/templates.js",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/manifest.json",
];

// API paths that should cache GET responses for offline reading
const CACHEABLE_API_PATHS = [
  "/api/conversations",
  "/api/pricing",
  "/api/announcements",
];

// ═══════════════════════════════════════════════════════════════════
//  IndexedDB Helpers (raw API, no library)
// ═══════════════════════════════════════════════════════════════════

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_TEMPLATE_CACHE)) {
        db.createObjectStore(STORE_TEMPLATE_CACHE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_RESPONSE_CACHE)) {
        const store = db.createObjectStore(STORE_RESPONSE_CACHE, { keyPath: "hash" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        const convStore = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
        convStore.createIndex("updated_at", "updated_at", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
        msgStore.createIndex("conversation_id", "conversation_id", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(storeName, key) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

function idbPut(storeName, value) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

function idbGetAll(storeName) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function idbDelete(storeName, key) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

function idbCount(storeName) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function idbGetAllByIndex(storeName, indexName, indexValue) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.getAll(indexValue);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function idbClear(storeName) {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Prompt hashing for response cache keys
// ═══════════════════════════════════════════════════════════════════

async function hashPrompt(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ═══════════════════════════════════════════════════════════════════
//  Template matching for offline serving
// ═══════════════════════════════════════════════════════════════════

// Keywords extracted from each template category for fuzzy matching
const TEMPLATE_KEYWORDS = {
  "memo-internal": ["internal memo", "memo to", "draft memo", "memo draft", "write a memo", "write memo"],
  "memo-cabinet": ["cabinet memo", "cabinet memorandum", "ministerial memo", "cabinet approval"],
  "memo-briefing": ["briefing note", "briefing", "brief for minister", "brief for director"],
  "letter-official": ["official letter", "formal letter", "draft letter", "write letter", "official correspondence"],
  "letter-response": ["response letter", "reply letter", "respond to letter", "reply to correspondence"],
  "letter-circular": ["circular", "directive", "circular letter", "issue circular", "draft circular"],
  "report-annual": ["annual report", "quarterly report", "mid-year review", "department report"],
  "report-activity": ["activity report", "trip report", "workshop report", "conference report", "training report"],
  "report-investigation": ["investigation report", "inquiry report", "committee report", "investigation findings"],
  "minutes-formal": ["meeting minutes", "formal minutes", "minutes of meeting", "write minutes", "draft minutes"],
  "minutes-quick": ["quick minutes", "meeting summary", "summarize meeting", "rough notes to minutes"],
  "research-policy": ["policy research", "policy analysis", "policy brief", "research brief", "policy recommendation"],
  "research-proposal": ["project proposal", "concept note", "funding proposal", "draft proposal"],
  "research-data": ["data analysis", "analyse data", "analyze data", "data summary", "statistics analysis"],
  "promo-interview": ["promotion interview", "interview preparation", "promotion prep", "civil service interview"],
  "promo-cv": ["cv", "resume", "curriculum vitae", "professional cv", "update cv"],
  "promo-appraisal": ["performance appraisal", "staff appraisal", "self appraisal", "appraisal comments"],
  "it-troubleshoot": ["it troubleshoot", "computer problem", "it issue", "tech support", "it help"],
  "it-maintenance": ["it maintenance", "maintenance plan", "computer maintenance", "it schedule"],
  "it-procurement": ["it procurement", "computer procurement", "buy computers", "it specification", "it specs"],
  "it-upgrade": ["system upgrade", "it upgrade", "upgrade proposal", "infrastructure upgrade"],
  "web-design": ["website design", "web design brief", "website specification", "design brief"],
  "web-code": ["code help", "coding", "programming", "write code", "debug code", "code assistant"],
  "web-database": ["database design", "database schema", "design database", "create database"],
  "general-speech": ["speech", "keynote", "address", "draft speech", "write speech"],
  "general-presentation": ["presentation", "slides", "powerpoint", "create presentation", "slide deck"],
  "general-tender": ["procurement", "tender", "tender document", "bid evaluation", "terms of reference"],
  "general-training": ["training programme", "training plan", "capacity building", "training design"],
  "general-translate": ["simplify", "plain language", "simplify document", "make simple", "document simplifier"],
};

function findMatchingTemplate(message) {
  const lower = message.toLowerCase().trim();

  let bestMatch = null;
  let bestScore = 0;

  for (const [templateId, keywords] of Object.entries(TEMPLATE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        // Longer keyword matches are more specific and score higher
        const score = keyword.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = templateId;
        }
      }
    }
  }

  return bestMatch;
}

// ═══════════════════════════════════════════════════════════════════
//  Default offline responses for each template category
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_TEMPLATE_RESPONSES = {
  "memo-internal": `**Internal Memo Template** (Offline Mode)

You are currently offline. Here is a standard internal memo structure you can use:

---

**MEMORANDUM**

**TO:** [Recipient Name / Department]
**FROM:** [Your Name / Department]
**DATE:** [Today's Date]
**REF NO:** MDA/DEPT/VOL.X/XX
**SUBJECT:** [Subject]

---

1. **Introduction** — State the purpose of the memo clearly.
2. **Background** — Provide context for the issue.
3. **Key Points** — Present your main arguments or information in numbered paragraphs.
4. **Recommendation / Action Required** — Clearly state what action you need from the recipient.
5. **Conclusion** — Summarize and restate urgency if applicable.

**Signed:**
[Your Name]
[Your Title]
for: Chief Director

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "memo-cabinet": `**Cabinet Memorandum Template** (Offline Mode)

You are currently offline. Here is the standard Ghana Cabinet Memo format:

---

**MEMORANDUM FOR CABINET**

**MINISTRY:** [Ministry Name]
**SUBJECT:** [Subject Matter]
**CABINET MEMO NO:** [Reference]

1. **PURPOSE** — What is this memo seeking Cabinet approval for?
2. **BACKGROUND** — History and context of the issue
3. **CURRENT SITUATION** — Present state of affairs
4. **ISSUES FOR CONSIDERATION** — Key issues for Cabinet deliberation
5. **FINANCIAL IMPLICATIONS** — Budget impact, funding source, cost estimates
6. **LEGAL IMPLICATIONS** — Legislative requirements or constitutional considerations
7. **CONSULTATIONS** — Which MDAs, stakeholders, or agencies were consulted
8. **RECOMMENDATIONS** — Specific recommendations for Cabinet approval
9. **CONCLUSION** — Summary and call to action

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "memo-briefing": `**Briefing Note Template** (Offline Mode)

You are currently offline. Here is a standard briefing note structure:

---

**BRIEFING NOTE**

**FOR:** [Hon. Minister / Chief Director / Director]
**FROM:** [Your Name and Title]
**DATE:** [Date]
**RE:** [Subject]

**PURPOSE OF BRIEFING:** [Why is this briefing needed?]

**KEY FACTS:**
- Fact 1
- Fact 2
- Fact 3

**BACKGROUND:** [Brief context]

**CURRENT STATUS:** [Where things stand now]

**OPTIONS / RECOMMENDATIONS:**
- Option A: [Description] — Pros / Cons
- Option B: [Description] — Pros / Cons

**TALKING POINTS:** (if for a meeting/event)
- Key message 1
- Key message 2

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "letter-official": `**Official Letter Template** (Offline Mode)

You are currently offline. Here is a standard official letter format:

---

**[Ministry/Department Letterhead]**

Our Ref: [Your Ref]
Your Ref: [Their Ref]
Date: [Date]

[Recipient's Name]
[Recipient's Title]
[Organization]
[Address]

Dear Sir/Madam,

**RE: [SUBJECT]**

1. I write to [state purpose of letter].

2. [Provide background or context]

3. [Present your main message or request]

4. [State action required and any deadlines]

5. I would be grateful for your prompt attention to this matter.

Yours faithfully,


[Your Name]
[Your Title]
for: Chief Director

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "letter-response": `**Response Letter Template** (Offline Mode)

---

Our Ref: [Your Ref]
Your Ref: [Their Ref]
Date: [Date]

Dear [Recipient],

**RE: [Subject — Reference to Original Letter]**

1. I acknowledge receipt of your letter referenced above dated [date].

2. With regard to your request concerning [topic], I wish to inform you that [response].

3. [Address additional points raised]

4. [State decision or action taken]

5. Please do not hesitate to contact this office for further clarification.

Yours sincerely,

[Name and Title]

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "letter-circular": `**Circular / Directive Template** (Offline Mode)

---

**CIRCULAR NO:** [Reference]
**DATE:** [Date]
**TO:** [All Staff / Specific Departments]
**FROM:** [Issuing Authority]

**SUBJECT: [Subject]**

1. The attention of all staff is drawn to [topic].

2. **Background:** [Why this circular is being issued]

3. **New Directive:** [What is being communicated]

4. **Effective Date:** [When this takes effect]

5. **Action Required:** [What recipients must do]

6. **Timeline for Compliance:** [Deadline]

7. For enquiries, please contact [Name, Extension].

**Distribution:** [List departments/offices]

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "report-annual": `**Annual / Quarterly Report Template** (Offline Mode)

---

**[DEPARTMENT] — [REPORT TYPE]**
**Period: [Start Date] to [End Date]**

**1. EXECUTIVE SUMMARY**
[Brief overview of key achievements and challenges]

**2. INTRODUCTION**
[Mandate, vision, and mission of the department]

**3. ACHIEVEMENTS AND PROGRESS AGAINST TARGETS**
| Target | Status | Remarks |
|--------|--------|---------|
| Target 1 | Achieved/In Progress | Details |

**4. FINANCIAL PERFORMANCE**
| Item | Budget | Actual | Variance |
|------|--------|--------|----------|

**5. HUMAN RESOURCE OVERVIEW**
[Staff strength, recruitment, training]

**6. CHALLENGES AND CONSTRAINTS**
- Challenge 1
- Challenge 2

**7. LESSONS LEARNED**

**8. RECOMMENDATIONS**

**9. OUTLOOK AND PLANS FOR NEXT PERIOD**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "report-activity": `**Activity / Trip Report Template** (Offline Mode)

---

**ACTIVITY REPORT**

**Activity:** [Event Name]
**Date(s):** [Dates]
**Venue:** [Location]
**Organized by:** [Organizer]
**Participants:** [Names]

**1. INTRODUCTION AND BACKGROUND**
[Context for the activity]

**2. OBJECTIVES**
[What the activity aimed to achieve]

**3. SUMMARY OF PROCEEDINGS**
[Key sessions and discussions]

**4. KEY FINDINGS AND OUTCOMES**
[Decisions made and results achieved]

**5. RECOMMENDATIONS**
[Follow-up actions needed]

**6. CONCLUSION**

**Annexes:** Participant list, Agenda

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "report-investigation": `**Investigation Report Template** (Offline Mode)

---

**REPORT OF THE COMMITTEE OF INQUIRY**

**1. PREAMBLE**
[Authority, composition, terms of reference]

**2. METHODOLOGY**
[How the investigation was conducted]

**3. FINDINGS OF FACT**
[What was discovered]

**4. ANALYSIS AND DISCUSSION**
[Interpretation of findings]

**5. CONCLUSIONS**

**6. RECOMMENDATIONS**

**Signed by all committee members:**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "minutes-formal": `**Meeting Minutes Template** (Offline Mode)

---

**MINUTES OF THE [MEETING NAME]**

**Date:** [Date]
**Time:** [Start] - [End]
**Venue:** [Location]
**Chairperson:** [Name and Title]

**PRESENT:**
1. [Name — Title]
2. [Name — Title]

**ABSENT WITH APOLOGY:** [Names]

**1. OPENING / CALL TO ORDER**
The Chairperson called the meeting to order at [time].

**2. CONFIRMATION OF PREVIOUS MINUTES**
The minutes of the previous meeting held on [date] were confirmed.

**3. MATTERS ARISING**
[Follow-up items from previous meeting]

**4. AGENDA ITEMS**
4.1 [Item 1 — Discussion and Decision]
4.2 [Item 2 — Discussion and Decision]

**5. ACTION ITEMS**
| Action | Responsible | Deadline |
|--------|------------|----------|

**6. NEXT MEETING:** [Date, Time, Venue]

**7. ADJOURNMENT**
Meeting adjourned at [time].

**Signed:**
Chairperson: _______________
Secretary: _______________

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "minutes-quick": `**Quick Meeting Summary Template** (Offline Mode)

---

**MEETING SUMMARY**

**Date:** [Date]
**Type:** [Staff meeting / Committee / Ad-hoc]

**Key Discussion Points:**
1. [Topic 1] — [Summary]
2. [Topic 2] — [Summary]

**Decisions Made:**
- Decision 1
- Decision 2

**Action Items:**
| Action | Who | By When |
|--------|-----|---------|

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "research-policy": `**Policy Research Brief Template** (Offline Mode)

---

**POLICY RESEARCH BRIEF**

**Policy Area:** [Topic]
**Prepared for:** [Target Audience]
**Date:** [Date]

**1. EXECUTIVE SUMMARY**

**2. BACKGROUND AND CONTEXT**

**3. CURRENT POLICY LANDSCAPE**

**4. COMPARATIVE ANALYSIS**
[How other countries handle this]

**5. STAKEHOLDER ANALYSIS**

**6. OPTIONS APPRAISAL**
- Option A: [Pros/Cons]
- Option B: [Pros/Cons]
- Option C: [Pros/Cons]

**7. RECOMMENDED OPTION**

**8. IMPLEMENTATION ROADMAP**

**9. RISK ASSESSMENT**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "research-proposal": `**Project Proposal Template** (Offline Mode)

---

**PROJECT PROPOSAL**

**Project Title:** [Name]
**Implementing Agency:** [MDA]
**Duration:** [Timeline]
**Estimated Budget:** [Amount]

**1. EXECUTIVE SUMMARY**
**2. BACKGROUND AND RATIONALE**
**3. PROBLEM STATEMENT**
**4. PROJECT OBJECTIVES** (SMART format)
**5. EXPECTED OUTCOMES AND OUTPUTS**
**6. PROJECT STRATEGY AND METHODOLOGY**
**7. IMPLEMENTATION PLAN**
**8. BUDGET SUMMARY**
**9. MONITORING AND EVALUATION FRAMEWORK**
**10. SUSTAINABILITY PLAN**
**11. RISK MANAGEMENT**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "research-data": `**Data Analysis Template** (Offline Mode)

---

**DATA ANALYSIS REPORT**

**Data Type:** [Survey/Metrics/Budget/Statistics]
**Date:** [Date]

**1. DATA OVERVIEW**
[Description of the dataset]

**2. KEY FINDINGS**
- Finding 1 (with numbers)
- Finding 2

**3. TREND ANALYSIS**

**4. COMPARATIVE ANALYSIS**
[Benchmarks, targets vs actuals]

**5. IMPLICATIONS FOR POLICY**

**6. RECOMMENDATIONS**

**7. LIMITATIONS**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "promo-interview": `**Promotion Interview Prep** (Offline Mode)

---

**COMMON PROMOTION INTERVIEW QUESTIONS:**

1. Tell us about yourself and your career progression.
2. What are your key achievements in your current grade?
3. Why do you believe you are ready for the next level?
4. What is your understanding of the mandate of this Ministry/Department?
5. How would you handle [management scenario]?
6. What do you know about current government flagship programmes?
7. How do you manage budget and resources?
8. What reforms would you propose for your area?

**TIPS:**
- Use the STAR method (Situation, Task, Action, Result)
- Quantify achievements with numbers
- Reference specific policies and programmes
- Demonstrate leadership readiness

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "promo-cv": `**Professional CV Template** (Offline Mode)

---

**CURRICULUM VITAE**

**Personal Information:**
- Full Name:
- Current Position and Grade:
- Ministry/Department:
- Years of Service:
- Contact:

**Education:**
[List qualifications in reverse chronological order]

**Work History:**
[List positions held with dates and key responsibilities]

**Key Achievements:**
[Quantifiable accomplishments]

**Training & Certifications:**
[Relevant professional development]

**Committee Memberships:**

**Referees:**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "promo-appraisal": `**Performance Appraisal Template** (Offline Mode)

---

**STAFF PERFORMANCE APPRAISAL**

**Period:** [Start] to [End]
**Officer:** [Name]
**Grade:** [Grade]
**Department:** [Department]

| Objective | Target | Achievement | Rating |
|-----------|--------|-------------|--------|
| Obj 1 | | | |

**Strengths Demonstrated:**

**Areas for Development:**

**Training Recommendations:**

**Goals for Next Period:**

**Overall Assessment:**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "it-troubleshoot": `**IT Troubleshooting Guide** (Offline Mode)

---

**GENERAL TROUBLESHOOTING STEPS:**

1. **Restart your device** — Many issues resolve with a simple restart.
2. **Check connections** — Ensure all cables, WiFi, and power connections are secure.
3. **Check for error messages** — Note any error codes or messages.
4. **Close and reopen** — Close the problematic application and reopen it.
5. **Clear browser cache** — For web issues, clear cache and cookies.
6. **Update software** — Ensure your OS and applications are up to date.
7. **Scan for viruses** — Run a full antivirus scan.
8. **Check available storage** — Ensure your disk is not full.

**If the issue persists, contact your IT department with:**
- Description of the problem
- When it started
- Any error messages
- Steps you have already tried

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "it-maintenance": `**IT Maintenance Plan Template** (Offline Mode)

---

**IT MAINTENANCE SCHEDULE**

**Daily:** Backup verification, antivirus log check
**Weekly:** System updates check, disk space monitoring, temporary file cleanup
**Monthly:** Full antivirus scan, hardware inspection, driver updates
**Quarterly:** Hardware deep clean, network audit, license review

**CHECKLIST:**
- [ ] All computers backed up
- [ ] Antivirus definitions updated
- [ ] OS patches applied
- [ ] Printers serviced
- [ ] UPS batteries tested
- [ ] Network equipment inspected

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "it-procurement": `**IT Procurement Specification Template** (Offline Mode)

---

**TECHNICAL SPECIFICATIONS**

**Desktop Computer (Minimum):**
- Processor: Intel Core i5 (12th Gen+) or AMD Ryzen 5
- RAM: 8GB DDR4/DDR5
- Storage: 256GB SSD
- Display: 21.5" FHD
- OS: Windows 11 Pro
- Warranty: 3 years on-site

**Laptop (Minimum):**
- Processor: Intel Core i5 / Ryzen 5
- RAM: 8GB
- Storage: 256GB SSD
- Display: 14" FHD
- Battery: 8+ hours
- Warranty: 3 years

**Per PPA Act 663 (as amended):**
- Follow proper procurement method for value threshold
- Include evaluation criteria with scoring weights
- Require bidder qualifications and references

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "it-upgrade": `**System Upgrade Proposal Template** (Offline Mode)

---

**IT SYSTEM UPGRADE PROPOSAL**

**1. EXECUTIVE SUMMARY**
**2. CURRENT STATE ASSESSMENT**
**3. GAP ANALYSIS**
**4. PROPOSED SOLUTION**
**5. COST-BENEFIT ANALYSIS**
**6. IMPLEMENTATION TIMELINE**
**7. RISK ASSESSMENT AND MITIGATION**
**8. TRAINING PLAN**
**9. ROI PROJECTION**
**10. RECOMMENDATION**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "web-design": `**Website Design Brief Template** (Offline Mode)

---

**WEBSITE DESIGN BRIEF**

**1. PROJECT OVERVIEW**
**2. SITEMAP** (Recommended page structure)
**3. FUNCTIONAL REQUIREMENTS**
**4. TECHNICAL REQUIREMENTS**
**5. ACCESSIBILITY** (WCAG compliance)
**6. MOBILE RESPONSIVENESS**
**7. SECURITY AND DATA PROTECTION**
**8. MAINTENANCE PLAN**
**9. EVALUATION CRITERIA**

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "web-code": `**Code Assistant** (Offline Mode)

You are currently offline and AI code assistance is unavailable.

**In the meantime, you can:**
- Review your existing code for syntax errors
- Check documentation bookmarks you may have saved
- Outline the logic/pseudocode for your solution
- List the specific questions you want to ask when back online

**Common debugging tips:**
1. Check for typos in variable/function names
2. Verify all brackets and parentheses are matched
3. Check data types and null/undefined values
4. Review the browser console for error messages
5. Test with simple inputs first

---
*Reconnect for AI-powered code assistance.*`,

  "web-database": `**Database Design Template** (Offline Mode)

---

**DATABASE DESIGN DOCUMENT**

**System:** [Name]
**Purpose:** [Description]

**Tables:**

| Table | Primary Key | Description |
|-------|-------------|-------------|
| table_1 | id (INT) | Main entity |
| table_2 | id (INT) | Related entity |

**Relationships:**
- table_1 (1) --- (many) table_2

**Sample CREATE TABLE:**
\`\`\`sql
CREATE TABLE example (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
\`\`\`

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "general-speech": `**Speech Template** (Offline Mode)

---

**SPEECH / ADDRESS**

**Protocol:**
Mr. Chairman,
Hon. Minister,
Nananom,
Distinguished Invited Guests,
Ladies and Gentlemen,

**1. OPENING** — Greetings and acknowledgments
**2. CONTEXT** — Why we are gathered
**3. KEY MESSAGE 1** — [Main point with supporting example]
**4. KEY MESSAGE 2** — [Second point with data/story]
**5. KEY MESSAGE 3** — [Third point]
**6. CALL TO ACTION** — What you want the audience to do
**7. CLOSING** — Thank you and forward-looking statement

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "general-presentation": `**Presentation Template** (Offline Mode)

---

**Slide 1: Title Slide** — Topic, presenter, date
**Slide 2: Agenda** — Overview of sections
**Slide 3: Background** — Context and why this matters
**Slides 4-8: Key Content** — One main point per slide (5-7 bullets max)
**Slide 9: Data/Evidence** — Charts, statistics
**Slide 10: Recommendations** — Clear action items
**Slide 11: Q&A** — Questions and discussion
**Slide 12: Thank You** — Contact information

**Tips:**
- Keep text minimal on slides
- Use visuals where possible
- Prepare speaker notes separately

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "general-tender": `**Procurement Document Template** (Offline Mode)

---

**TERMS OF REFERENCE**

**1. BACKGROUND**
**2. OBJECTIVES**
**3. SCOPE OF WORK**
**4. DELIVERABLES AND TIMELINE**
**5. QUALIFICATION REQUIREMENTS**
**6. EVALUATION CRITERIA**
| Criteria | Weight |
|----------|--------|
| Technical capacity | 30% |
| Experience | 25% |
| Methodology | 25% |
| Financial proposal | 20% |
**7. SUBMISSION REQUIREMENTS**
**8. CONTRACT TERMS**

Per PPA Act 663 (as amended by Act 914).

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "general-training": `**Training Programme Template** (Offline Mode)

---

**TRAINING PROGRAMME**

**Topic:** [Subject]
**Duration:** [Days]
**Participants:** [Target group]

**DAY 1:**
| Time | Session | Activity |
|------|---------|----------|
| 09:00 | Opening | Registration, welcome |
| 09:30 | Session 1 | [Topic] — Lecture |
| 11:00 | Break | |
| 11:15 | Session 2 | [Topic] — Group work |
| 13:00 | Lunch | |
| 14:00 | Session 3 | [Topic] — Case study |
| 15:30 | Wrap-up | Recap and Q&A |

**EVALUATION:** Pre/post assessment, feedback forms

---
*This is an offline template. Reconnect for AI-powered customization.*`,

  "general-translate": `**Document Simplifier Template** (Offline Mode)

---

**When simplifying a document, follow this structure:**

1. **Plain Language Summary** (1-2 paragraphs)
   - Rewrite the main idea in everyday language

2. **Key Points** (bullet list)
   - Extract the 3-5 most important takeaways

3. **"What This Means For You"**
   - Explain the practical impact on the reader

4. **FAQs**
   - Anticipate common questions
   - Provide clear, short answers

5. **Glossary**
   - Define any technical terms that cannot be avoided

6. **Next Steps**
   - What should the reader do?

---
*Reconnect for AI-powered document simplification.*`,
};

// ─── Install: pre-cache static shell + initialize IndexedDB ────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      }),
      // Initialize IndexedDB and pre-populate template cache
      preCacheTemplates(),
    ]).then(() => {
      // Notify all clients that a new SW version is available
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: "SW_UPDATE_AVAILABLE" });
        });
      });
    })
  );
  self.skipWaiting();
});

// ─── Pre-cache default template responses in IndexedDB ─────────────
async function preCacheTemplates() {
  try {
    for (const [templateId, response] of Object.entries(DEFAULT_TEMPLATE_RESPONSES)) {
      await idbPut(STORE_TEMPLATE_CACHE, {
        id: templateId,
        response: response,
        cachedAt: Date.now(),
      });
    }
  } catch (err) {
    console.log("SW: Failed to pre-cache templates:", err);
  }
}

// ─── Activate: clean old caches + enable navigation preload ─────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      ),
      // Enable navigation preload if supported
      self.registration.navigationPreload
        ? self.registration.navigationPreload.enable()
        : Promise.resolve(),
    ])
  );
  self.clients.claim();
});

// ─── Push Notification handling ──────────────────────────────────────
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "AskOzzy";
  const options = {
    body: data.body || "You have a new notification",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "default",
    data: { url: data.url || "/", type: data.type || "general" },
    actions: data.actions || [],
    vibrate: [100, 50, 100],
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click: focus or open window ────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          client.focus();
          client.postMessage({ type: "NAVIGATE", url });
          return;
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});

// ─── Fetch strategy ─────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET for caching (but still handle POST for offline queue)
  if (!url.protocol.startsWith("http")) return;

  // API: POST requests — try network, queue on failure
  if (request.method === "POST" && url.pathname.startsWith("/api/")) {
    event.respondWith(handleAPIPost(request));
    return;
  }

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // API GET: network-first with cache fallback for certain endpoints
  if (url.pathname.startsWith("/api/")) {
    // Intercept conversation list and message GETs for IndexedDB caching
    const conversationListMatch = url.pathname === "/api/conversations";
    const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);

    if (conversationListMatch) {
      event.respondWith(handleConversationListGet(request));
      return;
    }

    if (messageMatch) {
      event.respondWith(handleConversationMessagesGet(request, messageMatch[1]));
      return;
    }

    const isCacheable = CACHEABLE_API_PATHS.some((p) => url.pathname.startsWith(p));

    if (isCacheable) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(async () => {
            const cached = await caches.match(request);
            if (cached) return cached;
            return new Response(
              JSON.stringify({ error: "You are offline. Showing cached data.", offline: true }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            );
          })
      );
    } else {
      event.respondWith(
        fetch(request).catch(() => {
          return new Response(
            JSON.stringify({ error: "You are offline. Please check your connection.", offline: true }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        })
      );
    }
    return;
  }

  // Google Fonts: cache-first
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests: use preload response if available
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // Try navigation preload first (faster SW boot)
          const preloadResponse = event.preloadResponse ? await event.preloadResponse : null;
          if (preloadResponse) return preloadResponse;

          // Then try network
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, clone);
          }
          return networkResponse;
        } catch {
          // Offline: serve cached page or offline.html
          const cached = await caches.match(request);
          if (cached) return cached;
          const offlinePage = await caches.match("/offline.html");
          if (offlinePage) return offlinePage;
          return caches.match("/index.html");
        }
      })()
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// ─── Offline POST handling with template matching + response cache ──
async function handleAPIPost(request) {
  const clonedForBody = request.clone();
  const clonedForFetch = request.clone();

  try {
    const response = await fetch(clonedForFetch);

    // On successful chat response, cache it in IndexedDB
    if (response.ok) {
      const url = new URL(request.url);
      if (url.pathname === "/api/chat") {
        try {
          const body = await clonedForBody.json();
          if (body.message) {
            cacheAPIResponse(body.message, response.clone());
          }
        } catch {
          // Ignore caching errors
        }
      }
    }

    return response;
  } catch (error) {
    // Network failed — try offline strategies
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      try {
        const body = await clonedForBody.json();
        const message = body.message || "";

        // Strategy 1: Check response cache for exact prompt match
        const cachedResponse = await getCachedResponse(message);
        if (cachedResponse) {
          return createSSEResponse(cachedResponse, true);
        }

        // Strategy 2: Match against template keywords and serve offline template
        const matchedTemplate = findMatchingTemplate(message);
        if (matchedTemplate) {
          const templateData = await idbGet(STORE_TEMPLATE_CACHE, matchedTemplate);
          if (templateData) {
            // Notify clients about the offline template match
            notifyClients({
              type: "OFFLINE_TEMPLATE_SERVED",
              templateId: matchedTemplate,
              message: message,
            });
            return createSSEResponse(templateData.response, true);
          }
        }

        // Strategy 3: Queue for later
        await queueOfflineMessage(url.pathname, body, Object.fromEntries(request.headers));

        // Notify clients about queue update
        notifyClients({ type: "QUEUE_UPDATED" });

        return new Response(
          JSON.stringify({
            error: "You are offline. Your message has been saved and will be sent when you reconnect.",
            offline: true,
            queued: true,
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      } catch {
        // Fall through to generic error
      }
    }

    return new Response(
      JSON.stringify({ error: "You are offline. Please check your connection.", offline: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── Create an SSE-like response for offline template/cached responses ─
function createSSEResponse(text, isOffline = false) {
  const prefix = isOffline ? "**[Offline Mode]**\n\n" : "";
  const fullText = prefix + text;

  // Split into chunks to simulate streaming
  const chunks = [];
  const chunkSize = 20;
  for (let i = 0; i < fullText.length; i += chunkSize) {
    chunks.push(fullText.slice(i, i + chunkSize));
  }

  const encoder = new TextEncoder();
  let chunkIndex = 0;

  const stream = new ReadableStream({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        const data = JSON.stringify({ response: chunks[chunkIndex] });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        chunkIndex++;
      } else {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Offline-Response": "true",
    },
  });
}

// ─── Cache API chat responses in IndexedDB ──────────────────────────
async function cacheAPIResponse(prompt, response) {
  try {
    const hash = await hashPrompt(prompt);

    // Read the streamed response to extract the full text
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
          try {
            const data = JSON.parse(line.slice(6));
            let token = data.response || null;
            if (!token && data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              token = data.choices[0].delta.content;
            }
            if (token) fullText += token;
          } catch {
            // Skip malformed chunks
          }
        }
      }
    }

    if (fullText.length > 0) {
      // Enforce max cache size — remove oldest if at limit
      await enforceResponseCacheLimit();

      await idbPut(STORE_RESPONSE_CACHE, {
        hash: hash,
        prompt: prompt.substring(0, 200), // Store truncated prompt for reference
        response: fullText,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    console.log("SW: Failed to cache response:", err);
  }
}

// ─── Get cached response by prompt hash ─────────────────────────────
async function getCachedResponse(prompt) {
  try {
    const hash = await hashPrompt(prompt);
    const cached = await idbGet(STORE_RESPONSE_CACHE, hash);

    if (cached) {
      // Check TTL
      if (Date.now() - cached.timestamp > RESPONSE_CACHE_TTL) {
        await idbDelete(STORE_RESPONSE_CACHE, hash);
        return null;
      }
      return cached.response;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Enforce response cache size limit ──────────────────────────────
async function enforceResponseCacheLimit() {
  try {
    const count = await idbCount(STORE_RESPONSE_CACHE);
    if (count >= RESPONSE_CACHE_MAX) {
      // Get all entries, sort by timestamp, remove oldest
      const all = await idbGetAll(STORE_RESPONSE_CACHE);
      all.sort((a, b) => a.timestamp - b.timestamp);

      // Remove oldest entries to make room
      const toRemove = all.slice(0, count - RESPONSE_CACHE_MAX + 5); // Remove 5 extra for headroom
      for (const entry of toRemove) {
        await idbDelete(STORE_RESPONSE_CACHE, entry.hash);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ─── Conversation list: network-first with IndexedDB fallback ────────
async function handleConversationListGet(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      // Clone for caching, return original
      const clone = response.clone();
      // Also cache in the regular Cache API for CACHEABLE_API_PATHS compat
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));

      // Cache conversations in IndexedDB
      const data = await response.clone().json();
      const conversations = data.conversations || data.data || data || [];
      if (Array.isArray(conversations)) {
        cacheConversationsToIDB(conversations).catch(() => {});
      }
    }
    return response;
  } catch {
    // Offline: serve from IndexedDB
    try {
      const cached = await idbGetAll(STORE_CONVERSATIONS);
      if (cached && cached.length > 0) {
        // Sort by updated_at descending (most recent first)
        cached.sort((a, b) => {
          const aTime = new Date(b.updated_at || 0).getTime();
          const bTime = new Date(a.updated_at || 0).getTime();
          return aTime - bTime;
        });
        return new Response(
          JSON.stringify({ conversations: cached, offline: true }),
          { status: 200, headers: { "Content-Type": "application/json", "X-Offline-Response": "true" } }
        );
      }
    } catch {
      // Fall through
    }
    // Last resort: try the regular Cache API
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    return new Response(
      JSON.stringify({ error: "You are offline. Showing cached data.", offline: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── Conversation messages: network-first with IndexedDB fallback ────
async function handleConversationMessagesGet(request, conversationId) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));

      // Cache messages in IndexedDB
      const data = await response.clone().json();
      const messages = data.messages || data.data || data || [];
      if (Array.isArray(messages)) {
        cacheMessagesToIDB(conversationId, messages).catch(() => {});
      }
    }
    return response;
  } catch {
    // Offline: serve from IndexedDB
    try {
      const cached = await idbGetAllByIndex(STORE_MESSAGES, "conversation_id", conversationId);
      if (cached && cached.length > 0) {
        return new Response(
          JSON.stringify({ messages: cached, offline: true }),
          { status: 200, headers: { "Content-Type": "application/json", "X-Offline-Response": "true" } }
        );
      }
    } catch {
      // Fall through
    }
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    return new Response(
      JSON.stringify({ error: "You are offline. Showing cached data.", offline: true }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── Cache conversations array into IndexedDB ───────────────────────
async function cacheConversationsToIDB(conversations) {
  try {
    // Enforce max cache size
    const currentCount = await idbCount(STORE_CONVERSATIONS);
    if (currentCount > CONVERSATION_CACHE_MAX) {
      const all = await idbGetAll(STORE_CONVERSATIONS);
      all.sort((a, b) => new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime());
      const toRemove = all.slice(0, currentCount - CONVERSATION_CACHE_MAX + 10);
      for (const entry of toRemove) {
        await idbDelete(STORE_CONVERSATIONS, entry.id);
      }
    }

    for (const conv of conversations) {
      if (conv.id) {
        await idbPut(STORE_CONVERSATIONS, {
          ...conv,
          updated_at: conv.updated_at || conv.created_at || new Date().toISOString(),
          _cached_at: Date.now(),
        });
      }
    }

    // Update the content index after caching
    updateContentIndex().catch(() => {});
  } catch (err) {
    console.log("SW: Failed to cache conversations:", err);
  }
}

// ─── Cache messages array into IndexedDB ────────────────────────────
async function cacheMessagesToIDB(conversationId, messages) {
  try {
    // Remove old messages for this conversation first
    const existing = await idbGetAllByIndex(STORE_MESSAGES, "conversation_id", conversationId);
    for (const msg of existing) {
      await idbDelete(STORE_MESSAGES, msg.id);
    }

    // Insert new messages
    for (const msg of messages) {
      if (msg.id) {
        await idbPut(STORE_MESSAGES, {
          ...msg,
          conversation_id: conversationId,
          _cached_at: Date.now(),
        });
      }
    }
  } catch (err) {
    console.log("SW: Failed to cache messages:", err);
  }
}

// ─── Sync conversations in background ───────────────────────────────
async function syncConversationsInBackground() {
  try {
    const response = await fetch("/api/conversations");
    if (response && response.ok) {
      const data = await response.json();
      const conversations = data.conversations || data.data || data || [];
      if (Array.isArray(conversations)) {
        await cacheConversationsToIDB(conversations);
      }
    }
  } catch (err) {
    console.log("SW: Background conversation sync failed:", err);
  }
}

// ─── Content Index API: register cached conversations for discovery ──
async function updateContentIndex() {
  if (!self.registration.index) return;
  try {
    const conversations = await idbGetAll(STORE_CONVERSATIONS);
    // Clear existing entries first
    const existingEntries = await self.registration.index.getAll();
    for (const entry of existingEntries) {
      await self.registration.index.delete(entry.id);
    }
    // Register cached conversations
    for (const conv of conversations) {
      try {
        await self.registration.index.add({
          id: `conv-${conv.id}`,
          url: `/?conversation=${conv.id}`,
          title: conv.title || conv.name || "Conversation",
          description: conv.last_message || conv.title || "Cached conversation",
          icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
          category: "article",
        });
      } catch {
        // Some entries may fail — continue with next
      }
    }
  } catch (err) {
    console.log("SW: Content index update failed:", err);
  }
}

// ─── Notify all connected clients ───────────────────────────────────
async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage(message);
    });
  } catch {
    // Ignore notification errors
  }
}

// ─── Offline message queue (IndexedDB-like using cache API) ──────────
async function queueOfflineMessage(path, body, headers) {
  const cache = await caches.open(CACHE_NAME);
  const queueResponse = await cache.match(OFFLINE_QUEUE_KEY);
  let queue = [];

  if (queueResponse) {
    try {
      queue = await queueResponse.json();
    } catch {}
  }

  // Strip auth headers before persisting to cache storage
  const safeHeaders = { ...headers };
  delete safeHeaders['Authorization'];
  delete safeHeaders['authorization'];

  queue.push({
    path,
    body,
    headers: safeHeaders,
    timestamp: Date.now(),
  });

  await cache.put(
    OFFLINE_QUEUE_KEY,
    new Response(JSON.stringify(queue), { headers: { "Content-Type": "application/json" } })
  );
}

// ─── Request auth token from a connected client ─────────────────────
async function getAuthTokenFromClient() {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    try {
      const mc = new MessageChannel();
      const tokenPromise = new Promise((resolve) => {
        mc.port1.onmessage = (e) => resolve(e.data?.token || null);
        setTimeout(() => resolve(null), 2000);
      });
      client.postMessage({ type: "REQUEST_AUTH_TOKEN" }, [mc.port2]);
      const token = await tokenPromise;
      if (token) return token;
    } catch {}
  }
  return null;
}

// ─── Process offline queue when back online ──────────────────────────
async function processOfflineQueue(authToken) {
  const cache = await caches.open(CACHE_NAME);
  const queueResponse = await cache.match(OFFLINE_QUEUE_KEY);

  if (!queueResponse) return;

  let queue = [];
  try {
    queue = await queueResponse.json();
  } catch {
    return;
  }

  if (queue.length === 0) return;

  // Get auth token: prefer passed token, then request from client
  const token = authToken || await getAuthTokenFromClient();

  const remaining = [];

  for (const item of queue) {
    try {
      const headers = { ...item.headers };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(item.path, {
        method: "POST",
        headers,
        body: JSON.stringify(item.body),
      });

      if (response.ok) {
        // Notify the client
        notifyClients({
          type: "OFFLINE_MESSAGE_SENT",
          data: item.body,
        });
      } else {
        remaining.push(item); // Keep for retry
      }
    } catch {
      remaining.push(item); // Still offline for this one
    }
  }

  // Update queue
  if (remaining.length > 0) {
    await cache.put(
      OFFLINE_QUEUE_KEY,
      new Response(JSON.stringify(remaining), { headers: { "Content-Type": "application/json" } })
    );
  } else {
    await cache.delete(OFFLINE_QUEUE_KEY);
  }

  // Notify clients of queue update
  notifyClients({ type: "QUEUE_UPDATED" });
}

// ─── Message handling from main thread ───────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data && event.data.type === "PROCESS_QUEUE") {
    processOfflineQueue(event.data.token);
  }

  if (event.data && event.data.type === "GET_QUEUE_STATUS") {
    caches.open(CACHE_NAME).then(async (cache) => {
      const queueResponse = await cache.match(OFFLINE_QUEUE_KEY);
      let count = 0;
      if (queueResponse) {
        try {
          const queue = await queueResponse.json();
          count = queue.length;
        } catch {}
      }
      event.source.postMessage({ type: "QUEUE_STATUS", count });
    });
  }

  // Allow client to pre-cache templates on demand
  if (event.data && event.data.type === "PRECACHE_TEMPLATES") {
    preCacheTemplates().then(() => {
      if (event.source) {
        event.source.postMessage({ type: "TEMPLATES_CACHED", count: Object.keys(DEFAULT_TEMPLATE_RESPONSES).length });
      }
    });
  }

  // Allow client to cache a specific response
  if (event.data && event.data.type === "CACHE_RESPONSE") {
    const { prompt, response } = event.data;
    if (prompt && response) {
      hashPrompt(prompt).then((hash) => {
        idbPut(STORE_RESPONSE_CACHE, {
          hash,
          prompt: prompt.substring(0, 200),
          response,
          timestamp: Date.now(),
        }).catch(() => {});
      });
    }
  }

  // Clear offline queue and cached data on logout
  if (event.data && event.data.type === 'LOGOUT') {
    caches.open(CACHE_NAME).then(async (cache) => {
      // Clear offline queue
      await cache.delete(OFFLINE_QUEUE_KEY).catch(() => {});
      // Clear all cached responses from IndexedDB
      idbClear(STORE_RESPONSE_CACHE).catch(() => {});
      notifyClients({ type: "QUEUE_UPDATED" });
    });
  }
});

// ─── Background Sync: process queue when OS signals connectivity ─────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-offline-queue") {
    event.waitUntil(processOfflineQueue());
  }
});

// ─── Periodic Background Sync (if supported): keep templates + conversations fresh ───
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "refresh-templates") {
    event.waitUntil(preCacheTemplates());
  }
  if (event.tag === "sync-conversations") {
    event.waitUntil(syncConversationsInBackground());
  }
});

// Removed duplicate fetch listener that piggybacked queue processing on every fetch.
// Queue processing is handled by: (1) explicit PROCESS_QUEUE messages from client,
// (2) Background Sync API via "sync-offline-queue" tag, (3) online event in client.
