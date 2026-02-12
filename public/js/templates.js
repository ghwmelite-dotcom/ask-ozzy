// ─── GhanaGov AI — Prompt Templates for Civil Servants ──────────────

const TEMPLATES = [
  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: MEMO DRAFTING
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "memo-internal",
    category: "Memo Drafting",
    icon: "📝",
    title: "Internal Memo",
    description: "Draft a professional internal memo to colleagues or departments",
    prompt: `Draft a professional internal memo with the following details:

TO: [Recipient Name / Department]
FROM: [Your Name / Department]
DATE: [Today's Date]
SUBJECT: [Subject of the Memo]

Context / Background:
[Provide context here]

Key Points to Address:
[List main points]

Please follow Ghana Civil Service memo formatting standards. Include:
1. A clear reference number format (e.g., MDA/DEPT/VOL.X/XX)
2. Proper salutation and formal tone
3. Clear subject line
4. Well-structured body with numbered paragraphs
5. Appropriate closing and action required section
6. Space for signature block`,
    placeholders: ["Recipient Name / Department", "Your Name / Department", "Subject of the Memo", "Context here", "List main points"],
  },
  {
    id: "memo-cabinet",
    category: "Memo Drafting",
    icon: "🏛️",
    title: "Cabinet Memo",
    description: "Draft a Cabinet Memorandum for ministerial consideration",
    prompt: `Draft a Cabinet Memorandum with the following structure and details:

MEMORANDUM FOR CABINET

MINISTRY: [Ministry Name]
SUBJECT: [Subject Matter]
CABINET MEMO NO: [Reference Number]

The memorandum should follow the standard Ghana Cabinet Memo format:

1. PURPOSE: [What is this memo seeking Cabinet approval for?]

2. BACKGROUND: [Provide the history and context of the issue]

3. CURRENT SITUATION: [Describe the present state of affairs]

4. ISSUES FOR CONSIDERATION: [Key issues Cabinet should deliberate on]

5. FINANCIAL IMPLICATIONS: [Budget impact, funding source, cost estimates]

6. LEGAL IMPLICATIONS: [Any legislative requirements or constitutional considerations]

7. CONSULTATIONS: [Which MDAs, stakeholders, or agencies were consulted]

8. RECOMMENDATIONS: [Specific recommendations for Cabinet to approve]

9. CONCLUSION: [Summary and call to action]

Please ensure the tone is formal, authoritative, and suitable for presentation at a Cabinet meeting. Use precise language and avoid ambiguity.`,
    placeholders: ["Ministry Name", "Subject Matter", "Reference Number", "What is this memo seeking Cabinet approval for?", "Provide the history and context", "Describe the present state", "Key issues", "Budget impact", "Legislative requirements", "Which MDAs were consulted"],
  },
  {
    id: "memo-briefing",
    category: "Memo Drafting",
    icon: "📋",
    title: "Briefing Note",
    description: "Prepare a concise briefing note for a senior official or Minister",
    prompt: `Prepare a concise Briefing Note for a senior official with these details:

BRIEFING NOTE
FOR: [Hon. Minister / Chief Director / Director]
FROM: [Your Name and Title]
DATE: [Date]
RE: [Subject]

PURPOSE OF BRIEFING: [Why is this briefing needed? Meeting, decision, event?]

KEY FACTS: [Provide the essential facts]

BACKGROUND: [Brief context]

CURRENT STATUS: [Where things stand now]

OPTIONS / RECOMMENDATIONS: [What are the possible courses of action?]

TALKING POINTS (if for a meeting/event): [Key messages to convey]

The briefing note should be:
- Maximum 2 pages
- Written in clear, direct language
- Highlight critical information prominently
- Include risk assessment where relevant
- Provide actionable recommendations`,
    placeholders: ["Recipient title", "Your Name and Title", "Subject", "Why is this briefing needed?", "Essential facts", "Brief context", "Where things stand", "Possible courses of action"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: OFFICIAL LETTERS
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "letter-official",
    category: "Official Letters",
    icon: "✉️",
    title: "Official Correspondence",
    description: "Draft formal official letters to external bodies or other MDAs",
    prompt: `Draft an official letter with the following details:

REFERENCE: [Your Ref / Their Ref]
DATE: [Date]

TO:
[Recipient's Name]
[Recipient's Title]
[Organization/Ministry/Department]
[Address]

SUBJECT: [Subject of the Letter]

PURPOSE: [What is the purpose of this letter?]

KEY CONTENT: [Main message or request]

Please format this as a standard Ghana Civil Service official letter with:
1. Proper letterhead reference format
2. Formal salutation ("Dear Sir/Madam" or appropriate title)
3. Clear, numbered paragraphs
4. Appropriate courtesies and diplomatic language
5. Clear statement of any action required and deadlines
6. Formal closing ("Yours faithfully" for first contact, "Yours sincerely" for established contact)
7. Signature block with name, title, and "for: Chief Director/Director"`,
    placeholders: ["Your Ref / Their Ref", "Recipient's Name", "Recipient's Title", "Organization", "Subject of the Letter", "Purpose", "Main message or request"],
  },
  {
    id: "letter-response",
    category: "Official Letters",
    icon: "↩️",
    title: "Response Letter",
    description: "Draft a formal response to correspondence received",
    prompt: `Draft a formal response letter with these details:

REFERENCE TO ORIGINAL LETTER: [Their reference number and date]
SUBJECT OF ORIGINAL LETTER: [What was the original letter about?]
KEY POINTS IN ORIGINAL LETTER: [What did they request or communicate?]

YOUR RESPONSE SHOULD ADDRESS: [What is your response to their points?]

DECISION OR ACTION TAKEN: [What has been decided or done?]

Please write a professional response that:
1. References the original correspondence clearly
2. Acknowledges receipt and thanks the sender
3. Addresses each point raised systematically
4. States the position/decision clearly
5. Outlines any follow-up actions or next steps
6. Uses appropriate diplomatic language
7. Follows Ghana Civil Service correspondence format`,
    placeholders: ["Their reference number", "Original letter subject", "What did they request?", "Your response to their points", "Decision or action taken"],
  },
  {
    id: "letter-circular",
    category: "Official Letters",
    icon: "📢",
    title: "Circular / Directive",
    description: "Draft a circular or directive to be distributed across departments",
    prompt: `Draft an official circular / directive with these details:

CIRCULAR NO: [Reference Number]
DATE: [Date]
TO: [All Staff / Specific Departments / Regional Offices]
FROM: [Chief Director / Director / Head of Department]
SUBJECT: [Subject]

DIRECTIVE / POLICY CHANGE: [What is being communicated?]

EFFECTIVE DATE: [When does this take effect?]

BACKGROUND: [Why is this circular being issued?]

Please draft the circular with:
1. Clear, unambiguous instructions
2. Specific actions required from recipients
3. Timeline for compliance
4. Consequences of non-compliance (if applicable)
5. Contact person for enquiries
6. Distribution list at the bottom
7. Appropriate authority and tone`,
    placeholders: ["Reference Number", "Recipients", "Issuing Authority", "Subject", "What is being communicated?", "Effective date", "Background/reason"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: REPORTS
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "report-annual",
    category: "Reports",
    icon: "📊",
    title: "Annual / Quarterly Report",
    description: "Draft a comprehensive annual or quarterly report for your department",
    prompt: `Draft a comprehensive report with the following details:

REPORT TYPE: [Annual Report / Quarterly Report / Mid-Year Review]
DEPARTMENT/UNIT: [Your Department]
PERIOD COVERED: [e.g., January - December 2025]

KEY ACHIEVEMENTS: [List major accomplishments]

CHALLENGES ENCOUNTERED: [List key challenges]

STATISTICS/DATA: [Any numbers or metrics to include]

BUDGET UTILIZATION: [Budget allocated vs spent]

PLANS FOR NEXT PERIOD: [Upcoming priorities and targets]

Please structure the report with:
1. Executive Summary
2. Introduction (mandate, vision, mission of the department)
3. Achievements and Progress Against Targets
4. Financial Performance
5. Human Resource Overview
6. Challenges and Constraints
7. Lessons Learned
8. Recommendations
9. Outlook and Plans for Next Period
10. Appendices (tables, charts descriptions)

Use formal tone suitable for submission to the Head of Civil Service or Public Services Commission.`,
    placeholders: ["Report type", "Department", "Period covered", "Major accomplishments", "Key challenges", "Numbers or metrics", "Budget info", "Upcoming priorities"],
  },
  {
    id: "report-activity",
    category: "Reports",
    icon: "📈",
    title: "Activity / Trip Report",
    description: "Write a report on an official activity, workshop, conference, or trip",
    prompt: `Write an official activity/trip report with these details:

ACTIVITY TYPE: [Workshop / Conference / Official Trip / Training / Site Visit]
TITLE OF EVENT: [Event name]
DATE(S): [When it took place]
VENUE: [Location]
ORGANIZED BY: [Organizer]
PARTICIPANTS: [Who attended from your office?]

OBJECTIVES OF THE ACTIVITY: [What was the purpose?]

KEY PROCEEDINGS / SESSIONS: [What happened? Main topics covered]

KEY OUTCOMES / RESOLUTIONS: [What was decided or achieved?]

RECOMMENDATIONS: [What should be done as follow-up?]

Please write a structured report with:
1. Introduction and Background
2. Objectives
3. Summary of Proceedings (day-by-day if multi-day)
4. Key Findings and Outcomes
5. Recommendations for Action
6. Conclusion
7. Annexes (participant list, agenda — noted as attachments)`,
    placeholders: ["Activity type", "Event name", "Dates", "Location", "Organizer", "Participants", "Purpose", "Main topics", "Outcomes", "Recommendations"],
  },
  {
    id: "report-investigation",
    category: "Reports",
    icon: "🔍",
    title: "Investigation / Inquiry Report",
    description: "Draft a formal report on an investigation or committee inquiry",
    prompt: `Draft a formal investigation/inquiry report with these details:

COMMITTEE / INVESTIGATOR: [Names and titles of committee members]
AUTHORITY: [Who constituted the committee? Reference letter/directive]
SUBJECT OF INVESTIGATION: [What is being investigated?]
DATE(S) OF INVESTIGATION: [When was it conducted?]

TERMS OF REFERENCE: [What was the committee asked to look into?]

FINDINGS: [What was discovered?]

EVIDENCE GATHERED: [Testimonies, documents, observations]

Please structure as:
1. Preamble (authority, composition, terms of reference)
2. Methodology (how the investigation was conducted)
3. Findings of Fact
4. Analysis and Discussion
5. Conclusions
6. Recommendations
7. Signature block for all committee members`,
    placeholders: ["Committee members", "Constituting authority", "Subject of investigation", "Investigation dates", "Terms of reference", "Key findings", "Evidence gathered"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: MINUTES WRITING
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "minutes-formal",
    category: "Minutes Writing",
    icon: "📒",
    title: "Formal Meeting Minutes",
    description: "Draft professional minutes of a formal/statutory meeting",
    prompt: `Draft formal meeting minutes with these details:

MEETING: [Name of the meeting, e.g., "3rd Quarterly Management Meeting"]
DATE: [Date]
TIME: [Start time - End time]
VENUE: [Location]
CHAIRPERSON: [Name and Title]
PRESENT: [List of attendees with titles]
ABSENT WITH APOLOGY: [Names]
ABSENT WITHOUT APOLOGY: [Names]
SECRETARY / RECORDER: [Name]

AGENDA ITEMS AND DISCUSSIONS:
[List each agenda item and what was discussed]

DECISIONS MADE:
[Key decisions taken]

ACTION ITEMS:
[Tasks assigned, responsible person, deadline]

Please format the minutes with:
1. Header with all meeting details
2. Confirmation of previous minutes
3. Matters arising from previous minutes
4. Each agenda item as a numbered section
5. Clear recording of motions, seconders, and voting results (if applicable)
6. Action items table (Action | Responsible | Deadline)
7. Date and time of next meeting
8. Closing
9. Signature lines for Chairperson and Secretary`,
    placeholders: ["Meeting name", "Date", "Time", "Venue", "Chairperson", "Attendees", "Absent with apology", "Agenda items and discussions", "Key decisions", "Action items"],
  },
  {
    id: "minutes-quick",
    category: "Minutes Writing",
    icon: "⚡",
    title: "Quick Meeting Summary",
    description: "Generate a concise summary of a meeting from rough notes",
    prompt: `I have rough notes from a meeting. Please organize them into proper minutes.

MEETING TYPE: [Staff meeting / Committee meeting / Ad-hoc meeting]
DATE: [Date]
ROUGH NOTES:
[Paste your rough notes, bullet points, or voice-to-text transcript here]

Please:
1. Identify and list participants mentioned
2. Extract and organize agenda items discussed
3. Summarize each discussion point professionally
4. Identify all decisions made
5. Extract all action items with responsible persons and deadlines
6. Format as proper minutes following Ghana Civil Service standards
7. Flag any items that seem incomplete or need clarification`,
    placeholders: ["Meeting type", "Date", "Paste rough notes here"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: RESEARCH & ANALYSIS
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "research-policy",
    category: "Research & Analysis",
    icon: "🔬",
    title: "Policy Research Brief",
    description: "Research and analyse a policy issue with recommendations",
    prompt: `Conduct a thorough policy analysis on the following topic:

POLICY AREA: [e.g., Digital transformation, public health, education reform]
SPECIFIC QUESTION: [What specific policy question needs to be addressed?]
CONTEXT: [Any relevant Ghana-specific context, existing policies, or recent developments]
TARGET AUDIENCE: [Who will read this? Minister, Director, Committee?]

Please provide:
1. Executive Summary (1 paragraph)
2. Background and Context
3. Current Policy Landscape (existing frameworks, legislation)
4. Comparative Analysis (how have other countries, especially in West Africa and Commonwealth nations, handled this?)
5. Stakeholder Analysis
6. Options Appraisal (at least 3 policy options with pros/cons)
7. Recommended Option with justification
8. Implementation Roadmap
9. Risk Assessment
10. References and Further Reading

Ensure the analysis is evidence-based and suitable for senior policy decision-makers in the Ghana Civil Service.`,
    placeholders: ["Policy area", "Specific question", "Ghana-specific context", "Target audience"],
  },
  {
    id: "research-proposal",
    category: "Research & Analysis",
    icon: "📑",
    title: "Project Proposal",
    description: "Draft a project proposal or concept note for funding or approval",
    prompt: `Draft a comprehensive project proposal with these details:

PROJECT TITLE: [Name of the project]
IMPLEMENTING AGENCY: [Your MDA]
PROJECT DURATION: [Timeline]
ESTIMATED BUDGET: [Budget range]
FUNDING SOURCE: [GoG / Donor / PPP / IGF]

PROBLEM STATEMENT: [What problem does this project address?]
OBJECTIVES: [What will the project achieve?]
TARGET BENEFICIARIES: [Who benefits?]

Please structure as:
1. Cover Page
2. Executive Summary
3. Background and Rationale
4. Problem Statement
5. Project Objectives (SMART format)
6. Expected Outcomes and Outputs
7. Project Strategy and Methodology
8. Implementation Plan (with Gantt chart description)
9. Budget Summary (by component)
10. Monitoring and Evaluation Framework
11. Sustainability Plan
12. Risk Management
13. Institutional Arrangements

Format for submission to NDPC, Ministry of Finance, or development partners.`,
    placeholders: ["Project title", "Implementing agency", "Timeline", "Budget range", "Funding source", "Problem statement", "Objectives", "Target beneficiaries"],
  },
  {
    id: "research-data",
    category: "Research & Analysis",
    icon: "📉",
    title: "Data Analysis & Summary",
    description: "Analyse data and present findings in a structured format",
    prompt: `Analyse the following data and present a structured summary:

DATA TYPE: [Survey results / Performance metrics / Budget data / Statistics]
DATA:
[Paste your data, numbers, or descriptions here]

ANALYSIS NEEDED: [What insights are you looking for?]

Please provide:
1. Data Overview and Description
2. Key Findings (with specific numbers)
3. Trend Analysis (if time-series data)
4. Comparative Analysis (benchmarks, targets vs actuals)
5. Visual Descriptions (describe what charts/graphs would best represent this data)
6. Implications for Policy/Decision-making
7. Recommendations based on the data
8. Limitations of the analysis

Present findings in a format suitable for inclusion in an official report or presentation.`,
    placeholders: ["Data type", "Paste data here", "What insights are you looking for?"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: PROMOTION & CAREER
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "promo-interview",
    category: "Promotion & Career",
    icon: "🎯",
    title: "Promotion Interview Preparation",
    description: "Prepare for your Civil Service promotion interview",
    prompt: `Help me prepare for a Ghana Civil Service promotion interview with these details:

CURRENT GRADE/RANK: [e.g., Principal Administrative Officer]
TARGET GRADE/RANK: [e.g., Assistant Director]
MINISTRY/DEPARTMENT: [Your MDA]
YEARS IN CURRENT GRADE: [Duration]
KEY ACHIEVEMENTS IN CURRENT ROLE: [List your accomplishments]
AREAS OF SPECIALIZATION: [Your expertise areas]

Please provide:
1. Common Promotion Interview Questions for this grade level
2. Model Answers tailored to my profile (STAR method)
3. Questions about:
   - Ghana's public service reforms and policies
   - Current government flagship programmes
   - My functional area knowledge
   - Leadership and management scenarios
   - Financial management and budgeting
   - Public Service Commission regulations
4. Tips on:
   - How to present achievements quantitatively
   - How to demonstrate readiness for the next level
   - Common mistakes to avoid
   - How to handle difficult/unexpected questions
5. A 2-minute self-introduction script
6. Questions I should ask the panel`,
    placeholders: ["Current grade/rank", "Target grade/rank", "Your MDA", "Years in current grade", "Key achievements", "Areas of specialization"],
  },
  {
    id: "promo-cv",
    category: "Promotion & Career",
    icon: "📄",
    title: "Professional CV / Resume",
    description: "Create or update your professional CV for promotion or assignment",
    prompt: `Help me create/update a professional CV for the Ghana Civil Service with these details:

FULL NAME: [Name]
CURRENT POSITION: [Title and Grade]
MINISTRY/DEPARTMENT: [MDA]
YEARS OF SERVICE: [Total years]

EDUCATION:
[List qualifications]

WORK HISTORY:
[List positions held with dates]

KEY ACHIEVEMENTS:
[List notable accomplishments]

TRAININGS & CERTIFICATIONS:
[List relevant training]

Please create a professional CV that:
1. Follows public sector CV conventions
2. Emphasizes impact and results (use metrics)
3. Highlights leadership and management experience
4. Lists relevant training, workshops, and certifications
5. Includes committee memberships and special assignments
6. Is structured for promotion panel review
7. Is concise (maximum 3-4 pages)
8. Uses action verbs and quantifiable achievements`,
    placeholders: ["Full name", "Current position", "MDA", "Years of service", "Qualifications", "Positions held", "Accomplishments", "Training"],
  },
  {
    id: "promo-appraisal",
    category: "Promotion & Career",
    icon: "⭐",
    title: "Staff Performance Appraisal",
    description: "Draft self-appraisal or staff appraisal comments",
    prompt: `Help me write a performance appraisal with these details:

APPRAISAL TYPE: [Self-appraisal / Supervisor appraisal]
PERIOD: [Appraisal period]
NAME OF OFFICER: [Name]
GRADE/RANK: [Grade]
DEPARTMENT: [Department]

KEY OBJECTIVES SET FOR THE PERIOD:
[List objectives and targets]

ACHIEVEMENTS AGAINST EACH OBJECTIVE:
[What was accomplished?]

CHALLENGES FACED:
[Key obstacles]

Please provide:
1. Well-written objective assessments for each KPI/target
2. Achievement ratings with justification
3. Strengths and competencies demonstrated
4. Areas for development
5. Training recommendations
6. Goals for next period
7. Overall assessment summary

Use the Ghana Public Services Commission appraisal framework language and scoring criteria.`,
    placeholders: ["Appraisal type", "Period", "Officer name", "Grade", "Department", "Objectives and targets", "What was accomplished?", "Key obstacles"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: IT SUPPORT & TECHNOLOGY
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "it-troubleshoot",
    category: "IT Support",
    icon: "🔧",
    title: "IT Troubleshooting Guide",
    description: "Get step-by-step troubleshooting help for IT issues",
    prompt: `I need help troubleshooting an IT issue:

PROBLEM DESCRIPTION: [Describe the issue in detail]
DEVICE/SYSTEM: [Computer, printer, network, software name, etc.]
OPERATING SYSTEM: [Windows 10/11, etc.]
WHEN IT STARTED: [When did the problem begin?]
ERROR MESSAGES: [Any error codes or messages?]
WHAT YOU'VE TRIED: [Any steps already attempted?]

Please provide:
1. Likely cause(s) of the problem
2. Step-by-step troubleshooting guide (non-technical language)
3. Screenshots descriptions of where to find settings
4. Escalation path if basic troubleshooting fails
5. Preventive measures to avoid recurrence

Explain in clear, simple language suitable for a non-technical civil servant.`,
    placeholders: ["Describe the issue", "Device or system", "Operating system", "When it started", "Error messages", "Steps already tried"],
  },
  {
    id: "it-maintenance",
    category: "IT Support",
    icon: "🖥️",
    title: "IT Maintenance Plan",
    description: "Create an IT maintenance schedule or plan for your department",
    prompt: `Help me create an IT maintenance plan for my department:

DEPARTMENT: [Department name]
NUMBER OF COMPUTERS: [Count]
OTHER EQUIPMENT: [Printers, servers, network devices, etc.]
CURRENT ISSUES: [Any ongoing IT problems?]
BUDGET AVAILABLE: [Approximate IT budget]

Please create:
1. Preventive Maintenance Schedule (daily, weekly, monthly, quarterly)
2. Hardware Maintenance Checklist
   - Computer cleaning and inspection
   - Printer maintenance
   - Network equipment checks
   - UPS/power protection
3. Software Maintenance Tasks
   - OS updates and patches
   - Antivirus updates
   - Software license tracking
   - Data backup procedures
4. Network Maintenance
   - Internet connectivity monitoring
   - Network security checks
   - WiFi optimization
5. Asset Register Template
6. Helpdesk/Issue Tracking System recommendations
7. Budget Allocation Recommendations
8. Staff Training Needs for basic IT hygiene

Format as an actionable plan suitable for approval by management.`,
    placeholders: ["Department name", "Number of computers", "Other equipment", "Ongoing IT problems", "IT budget"],
  },
  {
    id: "it-procurement",
    category: "IT Support",
    icon: "🛒",
    title: "IT Procurement Specification",
    description: "Draft technical specifications for IT equipment procurement",
    prompt: `Help me draft IT procurement specifications:

ITEMS TO PROCURE: [e.g., 20 desktop computers, 5 laptops, 2 printers]
PURPOSE: [What will they be used for?]
USERS: [Who will use them? Technical/general staff?]
BUDGET RANGE: [Approximate budget per item or total]
SPECIAL REQUIREMENTS: [Any specific needs?]

Please provide:
1. Detailed Technical Specifications for each item
   - Minimum processor, RAM, storage requirements
   - Display specifications
   - Connectivity requirements
   - Warranty requirements
2. Justification Statement (for procurement committee)
3. Evaluation Criteria (scoring matrix)
4. Terms of Reference for the procurement
5. Comparison table of recommended brands/models available in Ghana
6. Total Cost of Ownership analysis (3-5 years)
7. Installation and setup requirements
8. Training requirements for end users

Format per Ghana Public Procurement Authority (PPA) standards.`,
    placeholders: ["Items to procure", "Purpose", "Users", "Budget range", "Special requirements"],
  },
  {
    id: "it-upgrade",
    category: "IT Support",
    icon: "⬆️",
    title: "System Upgrade Proposal",
    description: "Draft a proposal for IT system upgrades within the service",
    prompt: `Help me draft an IT system upgrade proposal:

CURRENT SYSTEM: [What system/infrastructure is currently in place?]
PROBLEMS WITH CURRENT SYSTEM: [Why does it need upgrading?]
PROPOSED UPGRADE: [What upgrade is being proposed?]
ESTIMATED COST: [Budget estimate]
AFFECTED USERS: [How many people does this affect?]

Please draft a proposal with:
1. Executive Summary
2. Current State Assessment
3. Gap Analysis
4. Proposed Solution
5. Cost-Benefit Analysis
6. Implementation Timeline
7. Risk Assessment and Mitigation
8. Training Plan
9. Change Management Strategy
10. ROI Projection
11. Vendor Comparison (if applicable)
12. Recommendation

Make it compelling for non-technical decision-makers while including enough technical detail for IT review.`,
    placeholders: ["Current system", "Problems", "Proposed upgrade", "Cost estimate", "Affected users"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: WEB DESIGN & DEVELOPMENT
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "web-design",
    category: "Web & Development",
    icon: "🌐",
    title: "Website Design Brief",
    description: "Create a website design brief or specification document",
    prompt: `Help me create a website design brief:

ORGANIZATION: [Ministry/Department/Agency]
WEBSITE PURPOSE: [Informational / Service delivery / Portal]
TARGET AUDIENCE: [Who will use the website?]
KEY FEATURES NEEDED: [What should the website do?]
EXISTING WEBSITE: [URL of current site, if any]
BUDGET: [Approximate budget]
TIMELINE: [When is it needed?]

Please provide:
1. Project Overview and Objectives
2. Sitemap (recommended page structure)
3. Wireframe Descriptions for key pages
4. Content Strategy (what content is needed)
5. Functional Requirements
6. Technical Requirements (hosting, CMS, security)
7. Accessibility Requirements (WCAG compliance)
8. Mobile Responsiveness Requirements
9. Ghana.gov.gh Integration Requirements
10. Security and Data Protection Requirements
11. Maintenance and Update Plan
12. Evaluation Criteria for selecting a developer

This should be usable as a Terms of Reference for procuring web development services.`,
    placeholders: ["Organization", "Website purpose", "Target audience", "Key features", "Existing website URL", "Budget", "Timeline"],
  },
  {
    id: "web-code",
    category: "Web & Development",
    icon: "💻",
    title: "Code Assistant",
    description: "Get help with coding, scripting, or software development",
    prompt: `I need help with a coding task:

LANGUAGE/TECHNOLOGY: [e.g., Python, JavaScript, HTML/CSS, Excel VBA, SQL]
TASK DESCRIPTION: [What do you want to build or fix?]
CURRENT CODE (if any):
[Paste your existing code here]
ERROR MESSAGES (if any):
[Paste any errors]

Please provide:
1. Complete, working code solution
2. Clear comments explaining each section
3. Step-by-step setup/installation instructions
4. How to run or deploy the code
5. Common issues and how to fix them
6. Suggestions for improvements

Write clean, well-documented code suitable for a government IT department.`,
    placeholders: ["Language or technology", "What do you want to build or fix?", "Paste existing code", "Paste errors"],
  },
  {
    id: "web-database",
    category: "Web & Development",
    icon: "🗃️",
    title: "Database Design",
    description: "Design a database schema for a departmental system",
    prompt: `Help me design a database for the following system:

SYSTEM PURPOSE: [What is this database for? e.g., Staff records, asset tracking, case management]
DATA TO STORE: [What information needs to be captured?]
NUMBER OF USERS: [How many people will use it?]
REPORTS NEEDED: [What reports or queries are needed?]

Please provide:
1. Entity-Relationship description
2. Complete database schema (tables, columns, data types)
3. SQL CREATE TABLE statements
4. Sample INSERT statements with test data
5. Common queries (SELECT statements for typical reports)
6. Indexing recommendations
7. Data validation rules
8. Backup and security recommendations
9. Suggestions for the front-end interface

Use standard SQL compatible with common databases available in Ghana government offices.`,
    placeholders: ["System purpose", "Data to store", "Number of users", "Reports needed"],
  },

  // ═══════════════════════════════════════════════════════════════════
  //  CATEGORY: GENERAL CIVIL SERVICE
  // ═══════════════════════════════════════════════════════════════════
  {
    id: "general-speech",
    category: "General",
    icon: "🎤",
    title: "Speech / Keynote Address",
    description: "Draft a speech for an official event, ceremony, or conference",
    prompt: `Draft a speech with these details:

EVENT: [What is the occasion?]
SPEAKER: [Name and Title of the speaker]
AUDIENCE: [Who will be listening?]
DURATION: [How long should the speech be? e.g., 10 minutes]
KEY MESSAGES: [What are the main points to convey?]
TONE: [Inspirational / Informative / Ceremonial / Motivational]

Please draft a speech that:
1. Opens with an appropriate greeting (respecting Ghanaian protocol for dignitaries)
2. Sets the context for the occasion
3. Delivers key messages in a compelling narrative
4. Includes relevant statistics or examples
5. References government policies or programmes where appropriate
6. Ends with a strong call to action or closing remarks
7. Is appropriate for the Ghana Civil Service context
8. Includes protocol acknowledgments (e.g., "Mr. Chairman, Hon. Minister, Nananom...")`,
    placeholders: ["Occasion", "Speaker name and title", "Audience", "Duration", "Main points to convey", "Tone"],
  },
  {
    id: "general-presentation",
    category: "General",
    icon: "📽️",
    title: "Presentation Creator",
    description: "Create slide content and speaking notes for a presentation",
    prompt: `Help me create a presentation with these details:

TOPIC: [Presentation topic]
AUDIENCE: [Who will you present to?]
DURATION: [How much time do you have?]
PURPOSE: [Inform / Persuade / Report / Train]
KEY POINTS: [Main messages to convey]

Please provide:
1. Suggested slide-by-slide outline (title + bullet points per slide)
2. Speaker notes for each slide
3. Suggested visuals/charts for each slide
4. Opening hook to capture attention
5. Data points or statistics to include
6. Transition phrases between sections
7. Strong conclusion and call to action
8. Q&A preparation (anticipated questions and answers)

Keep slides concise (5-7 bullet points max per slide) with detailed speaker notes.`,
    placeholders: ["Presentation topic", "Audience", "Duration", "Purpose", "Main messages"],
  },
  {
    id: "general-tender",
    category: "General",
    icon: "📜",
    title: "Procurement / Tender Document",
    description: "Draft procurement documents, Terms of Reference, or bid evaluations",
    prompt: `Help me draft procurement documentation:

PROCUREMENT TYPE: [Goods / Services / Works / Consultancy]
DESCRIPTION: [What is being procured?]
ESTIMATED VALUE: [Budget range]
PROCUREMENT METHOD: [NCB / ICB / Shopping / Single Source — per PPA Act]
FUNDING SOURCE: [GoG / Donor / IGF]

Please draft:
1. Terms of Reference (TOR) / Statement of Requirements
2. Scope of Work
3. Deliverables and Timeline
4. Qualification Requirements for bidders
5. Evaluation Criteria (with scoring weights)
6. Special Conditions
7. Required Submission Documents
8. Key Contract Terms

Follow Ghana Public Procurement Authority (PPA) Act 2003 (Act 663) as amended by Act 914 standards and templates.`,
    placeholders: ["Procurement type", "What is being procured?", "Budget range", "Procurement method", "Funding source"],
  },
  {
    id: "general-training",
    category: "General",
    icon: "📚",
    title: "Training Programme Design",
    description: "Design a training programme or capacity building plan",
    prompt: `Help me design a training programme with these details:

TRAINING TOPIC: [Subject matter]
TARGET PARTICIPANTS: [Who is this for? Grade level, department]
NUMBER OF PARTICIPANTS: [Expected count]
DURATION: [e.g., 3 days, 1 week]
MODE: [In-person / Virtual / Hybrid]
OBJECTIVE: [What should participants be able to do after the training?]

Please provide:
1. Training Programme Overview
2. Learning Objectives (SMART)
3. Detailed Session Plan / Timetable
   - Session title, duration, facilitator notes
   - Activities and exercises for each session
4. Methodology (lectures, group work, case studies, role play)
5. Resource Requirements (venue, materials, equipment)
6. Pre-training Assessment
7. Post-training Evaluation Form
8. Certificate Criteria
9. Budget Estimate
10. Follow-up Action Plan

Design for adult learners in a professional civil service environment.`,
    placeholders: ["Training topic", "Target participants", "Number of participants", "Duration", "Mode", "Learning objectives"],
  },
  {
    id: "general-translate",
    category: "General",
    icon: "🌍",
    title: "Document Simplifier",
    description: "Simplify complex policy or legal documents into plain language",
    prompt: `Please simplify the following document/text into clear, plain language:

DOCUMENT TYPE: [Policy document / Legal text / Technical report / Regulation]
ORIGINAL TEXT:
[Paste the complex text here]

TARGET AUDIENCE: [General public / Junior staff / Citizens / Media]

Please provide:
1. Plain language summary (1-2 paragraphs)
2. Key points in bullet format
3. "What this means for you" section
4. Frequently Asked Questions (5-8 FAQs)
5. Glossary of technical terms used
6. Action items or next steps for the reader

Maintain accuracy while making the content accessible to a non-specialist reader.`,
    placeholders: ["Document type", "Paste the complex text here", "Target audience"],
  },
];

// ═══════════════════════════════════════════════════════════════════
//  STUDENT-ONLY TEMPLATES
// ═══════════════════════════════════════════════════════════════════

// ─── ESSAY WRITING ─────────────────────────────────────────────────
TEMPLATES.push(
  {
    id: "essay-argumentative",
    category: "Essay Writing",
    icon: "✍️",
    title: "Argumentative Essay",
    description: "Build a structured argumentative essay with thesis, evidence, and counterarguments",
    studentOnly: true,
    prompt: `Help me write an argumentative essay on the following topic:

TOPIC: [Your essay topic]
POSITION: [For / Against / Nuanced]
WORD COUNT TARGET: [e.g. 500, 1000, 1500 words]
LEVEL: [SHS / University undergraduate / University postgraduate]

Please provide:
1. A strong thesis statement
2. Essay outline with main arguments and counterarguments
3. Introduction paragraph with hook, context, and thesis
4. Body paragraphs with topic sentences, evidence, and analysis
5. Counterargument paragraph with rebuttal
6. Conclusion that reinforces the thesis
7. Tips for improving the essay further`,
    placeholders: ["Your essay topic", "Your position", "Word count target", "Academic level"],
  },
  {
    id: "essay-expository",
    category: "Essay Writing",
    icon: "📖",
    title: "Expository Essay",
    description: "Explain a topic clearly with facts, examples, and logical structure",
    studentOnly: true,
    prompt: `Help me write an expository essay explaining the following topic:

TOPIC: [What you need to explain]
PURPOSE: [Inform / Define / Compare / Analyse cause-effect]
AUDIENCE: [Teacher / Examiner / General reader]
WORD COUNT: [Target word count]

Please provide:
1. Clear thesis statement that previews main points
2. Detailed outline
3. Introduction with engaging opening
4. Body paragraphs with facts, examples, and explanations
5. Transition sentences between paragraphs
6. Conclusion summarising key points
7. Checklist for self-review`,
    placeholders: ["Topic to explain", "Purpose", "Audience", "Word count"],
  },
  {
    id: "essay-narrative",
    category: "Essay Writing",
    icon: "📝",
    title: "Narrative / Creative Writing",
    description: "Craft a compelling story with plot, characters, and vivid descriptions",
    studentOnly: true,
    prompt: `Help me write a narrative/creative piece with the following details:

THEME/PROMPT: [Story theme or writing prompt]
GENRE: [Personal narrative / Short story / Descriptive essay]
SETTING: [Where and when the story takes place]
WORD COUNT: [Target word count]

Please provide:
1. Story outline (beginning, rising action, climax, falling action, resolution)
2. Character sketches for main characters
3. Opening paragraph with a hook
4. Descriptive passages using sensory details
5. Dialogue examples (if applicable)
6. A satisfying conclusion
7. Literary devices used (metaphor, simile, imagery, etc.)`,
    placeholders: ["Story theme or prompt", "Genre", "Setting", "Word count"],
  },
  {
    id: "essay-literature",
    category: "Essay Writing",
    icon: "📚",
    title: "Literature Analysis",
    description: "Analyse literary works — themes, characters, style, and context",
    studentOnly: true,
    prompt: `Help me analyse the following literary work:

TITLE: [Book/Play/Poem title]
AUTHOR: [Author name]
FOCUS: [Theme / Character / Style / Historical context / Symbolism]
SPECIFIC QUESTION: [What your teacher/examiner is asking]

Please provide:
1. Brief summary of the work
2. Analysis of the chosen focus area
3. Key quotes with page references and analysis
4. How the author's techniques support the theme
5. Comparison with other works (if relevant)
6. Essay structure for writing up the analysis
7. Common mistakes to avoid in literature essays`,
    placeholders: ["Book/Play/Poem title", "Author name", "Focus area", "Specific question"],
  }
);

// ─── EXAM PREPARATION ──────────────────────────────────────────────
TEMPLATES.push(
  {
    id: "exam-wassce",
    category: "Exam Preparation",
    icon: "🎓",
    title: "WASSCE Subject Review",
    description: "Revise any WASSCE subject with key topics, past questions, and exam tips",
    studentOnly: true,
    prompt: `Help me revise for WASSCE in the following subject:

SUBJECT: [e.g. Mathematics, English, Biology, Economics]
SPECIFIC TOPIC: [e.g. Quadratic equations, Organic Chemistry, Supply & Demand]
AREAS OF DIFFICULTY: [What you struggle with]
TARGET GRADE: [e.g. A1, B2, B3]

Please provide:
1. Key concepts and definitions for this topic
2. Summary notes in bullet point format
3. 5 practice questions (mix of objectives and theory) with solutions
4. Common mistakes students make in this topic
5. WAEC examiner tips for this subject
6. Memory aids (mnemonics, diagrams, tables)
7. Recommended study approach for the remaining revision period`,
    placeholders: ["Subject", "Specific topic", "Areas of difficulty", "Target grade"],
  },
  {
    id: "exam-bece",
    category: "Exam Preparation",
    icon: "📝",
    title: "BECE Revision",
    description: "Prepare for BECE with topic summaries and practice questions",
    studentOnly: true,
    prompt: `Help me prepare for BECE in the following subject:

SUBJECT: [e.g. Mathematics, English, Integrated Science, Social Studies]
TOPIC: [Specific topic to revise]
WHAT I FIND DIFFICULT: [Areas of confusion]

Please provide:
1. Simple explanation of the topic
2. Key points to remember
3. Worked examples (step by step)
4. 5 practice questions with answers
5. Tips for answering BECE-style questions
6. A quick revision checklist`,
    placeholders: ["Subject", "Topic", "What you find difficult"],
  },
  {
    id: "exam-university",
    category: "Exam Preparation",
    icon: "🏫",
    title: "University Exam Prep",
    description: "Prepare for university-level exams with structured revision",
    studentOnly: true,
    prompt: `Help me prepare for my university exam:

COURSE: [Course name and code]
TOPIC/CHAPTER: [What to revise]
EXAM FORMAT: [MCQ / Essay / Short answer / Problem-solving / Mixed]
LECTURER'S FOCUS AREAS: [Topics emphasised in class]

Please provide:
1. Comprehensive topic summary
2. Key theories, models, or frameworks
3. Definitions of important terms
4. Sample exam questions with model answers
5. How to structure essay answers for maximum marks
6. Time management tips for the exam format
7. Last-minute revision checklist`,
    placeholders: ["Course name", "Topic/chapter", "Exam format", "Focus areas"],
  },
  {
    id: "exam-quiz",
    category: "Exam Preparation",
    icon: "❓",
    title: "Practice Quiz Generator",
    description: "Generate practice quizzes on any subject or topic",
    studentOnly: true,
    prompt: `Generate a practice quiz for me:

SUBJECT: [Subject area]
TOPIC: [Specific topic]
DIFFICULTY: [Easy / Medium / Hard / WASSCE-level / University-level]
NUMBER OF QUESTIONS: [e.g. 10, 20]
FORMAT: [Multiple choice / True-False / Short answer / Mixed]

Please:
1. Generate the requested questions
2. Include answer options for MCQs (A, B, C, D)
3. Provide the answer key at the end
4. Add explanations for each correct answer
5. Mark difficulty level for each question
6. Include at least 2 "tricky" questions that test deep understanding`,
    placeholders: ["Subject", "Topic", "Difficulty level", "Number of questions", "Question format"],
  }
);

// ─── STUDY SKILLS ──────────────────────────────────────────────────
TEMPLATES.push(
  {
    id: "study-timetable",
    category: "Study Skills",
    icon: "📅",
    title: "Study Timetable Creator",
    description: "Create a personalised study timetable based on your subjects and goals",
    studentOnly: true,
    prompt: `Help me create a study timetable:

SUBJECTS: [List all subjects you're studying]
EXAM DATE / DEADLINE: [When you need to be ready]
AVAILABLE STUDY HOURS PER DAY: [e.g. 4-6 hours]
WEAK SUBJECTS: [Subjects needing more time]
PREFERRED STUDY TIMES: [Morning / Afternoon / Evening]
OTHER COMMITMENTS: [Sports, chores, work, etc.]

Please create:
1. Weekly study timetable (Monday to Sunday)
2. Time allocation based on subject difficulty
3. Built-in breaks (Pomodoro style: 25 min study, 5 min break)
4. Revision sessions for previously covered topics
5. Weekend intensive review sessions
6. Tips for sticking to the timetable
7. A progress tracking checklist`,
    placeholders: ["Subjects", "Exam date", "Study hours per day", "Weak subjects", "Preferred study times"],
  },
  {
    id: "study-notes",
    category: "Study Skills",
    icon: "📝",
    title: "Note-Taking Guide",
    description: "Learn effective note-taking methods and get organised notes on any topic",
    studentOnly: true,
    prompt: `Help me take effective notes on the following:

SUBJECT: [Subject]
TOPIC: [Specific topic or lecture content]
NOTE-TAKING METHOD: [Cornell / Mind Map / Outline / Summary / Let Ozzy decide]
SOURCE: [Textbook chapter / Lecture / Video / Article]

Please provide:
1. Structured notes using the chosen method
2. Key terms highlighted and defined
3. Main ideas vs. supporting details clearly separated
4. Diagrams or visual representations (described)
5. Summary section (3-5 key takeaways)
6. Review questions for self-testing
7. Tips for reviewing these notes effectively`,
    placeholders: ["Subject", "Topic", "Note-taking method", "Source material"],
  },
  {
    id: "study-summarizer",
    category: "Study Skills",
    icon: "📋",
    title: "Subject Summarizer",
    description: "Get concise summaries of any topic, chapter, or subject area",
    studentOnly: true,
    prompt: `Summarise the following topic for me:

SUBJECT: [Subject]
TOPIC/CHAPTER: [What to summarise]
LEVEL OF DETAIL: [Brief overview / Detailed summary / Exam-ready notes]
MY LEVEL: [JHS / SHS / University]

Please provide:
1. One-paragraph overview
2. Detailed bullet-point summary of all key concepts
3. Important formulas, dates, or facts (if applicable)
4. Connections to other topics in the subject
5. Common exam questions on this topic
6. A "Remember This" box with the most testable points`,
    placeholders: ["Subject", "Topic/chapter", "Level of detail", "Academic level"],
  },
  {
    id: "study-explainer",
    category: "Study Skills",
    icon: "💡",
    title: "Concept Explainer",
    description: "Get any difficult concept explained simply with real-world examples",
    studentOnly: true,
    prompt: `Explain this concept to me in a way I can understand:

CONCEPT: [What you need explained]
SUBJECT: [Which subject this is from]
WHAT I ALREADY KNOW: [Your current understanding]
WHAT CONFUSES ME: [Specific part that's unclear]

Please:
1. Explain using simple language first (ELI5 — Explain Like I'm 5)
2. Then give the proper academic explanation
3. Use a real-world analogy or Ghana-related example
4. Provide a diagram or visual description
5. Show how this connects to other concepts
6. Give 2-3 practice problems to test understanding
7. Suggest resources for deeper learning`,
    placeholders: ["Concept to explain", "Subject", "What you already know", "What confuses you"],
  }
);

// ─── ACADEMIC WRITING ──────────────────────────────────────────────
TEMPLATES.push(
  {
    id: "academic-proposal",
    category: "Academic Writing",
    icon: "📄",
    title: "Thesis / Project Proposal",
    description: "Structure a research proposal for your thesis or final year project",
    studentOnly: true,
    prompt: `Help me write a research proposal:

TOPIC AREA: [Your research area]
PROPOSED TITLE: [Working title]
DEGREE LEVEL: [Undergraduate / Masters / PhD]
DEPARTMENT: [Your department]
UNIVERSITY: [Your university]

Please provide:
1. Refined research title
2. Background / Introduction (context and importance)
3. Problem Statement
4. Research Objectives (general + specific)
5. Research Questions or Hypotheses
6. Brief Literature Review outline
7. Methodology (research design, population, sampling, data collection, analysis)
8. Significance of the Study
9. Scope and Limitations
10. Tentative Chapter Outline
11. Preliminary References (APA 7th format)
12. Timeline / Work Plan`,
    placeholders: ["Research area", "Proposed title", "Degree level", "Department", "University"],
  },
  {
    id: "academic-litreview",
    category: "Academic Writing",
    icon: "📖",
    title: "Literature Review",
    description: "Structure and write a literature review for your research",
    studentOnly: true,
    prompt: `Help me write a literature review:

RESEARCH TOPIC: [Your research topic]
KEY THEMES: [Main themes to cover]
SOURCES FOUND SO FAR: [List any papers/books you've already found]
CITATION STYLE: [APA 7th / Harvard / Other]

Please provide:
1. Suggested structure (thematic, chronological, or methodological)
2. Key themes and sub-themes to organise the review
3. How to introduce the literature review section
4. Sample paragraphs showing how to synthesise multiple sources
5. Transition phrases between themes
6. How to identify gaps in the literature
7. Conclusion that links to your research objectives
8. Tips for avoiding plagiarism in literature reviews`,
    placeholders: ["Research topic", "Key themes", "Sources found", "Citation style"],
  },
  {
    id: "academic-labreport",
    category: "Academic Writing",
    icon: "🧪",
    title: "Lab Report",
    description: "Write a structured lab report for science experiments",
    studentOnly: true,
    prompt: `Help me write a lab report:

EXPERIMENT TITLE: [Name of the experiment]
SUBJECT: [Biology / Chemistry / Physics / Other]
AIM: [What the experiment aimed to achieve]
MATERIALS USED: [List of materials and equipment]
PROCEDURE: [Brief description of what you did]
RESULTS: [Your observations and data]

Please provide:
1. Formatted Title Page
2. Abstract (150-200 words)
3. Introduction with background theory
4. Materials and Methods (past tense, passive voice)
5. Results section with suggested tables/graphs
6. Discussion (explain results, compare with theory, sources of error)
7. Conclusion
8. References (APA 7th format)`,
    placeholders: ["Experiment title", "Subject", "Aim", "Materials", "Procedure", "Results"],
  },
  {
    id: "academic-citation",
    category: "Academic Writing",
    icon: "📎",
    title: "Citation Helper",
    description: "Format citations and references in APA, Harvard, or other styles",
    studentOnly: true,
    prompt: `Help me with citations and referencing:

CITATION STYLE: [APA 7th / Harvard / MLA / Chicago]
TASK: [Format a reference list / Create in-text citations / Check my references / Explain citation rules]

SOURCES TO CITE:
[Paste your source details here — title, author, year, publisher, URL, etc.]

Please provide:
1. Properly formatted references for each source
2. In-text citation examples for each source
3. Common mistakes to avoid with this citation style
4. Rules for citing different source types (book, journal, website, etc.)
5. How to handle sources with no author, no date, or multiple authors`,
    placeholders: ["Citation style", "Task", "Source details"],
  }
);

// Category definitions for the UI
const TEMPLATE_CATEGORIES = [
  { id: "Memo Drafting", icon: "📝", color: "#D4AF37" },
  { id: "Official Letters", icon: "✉️", color: "#2E8B57" },
  { id: "Reports", icon: "📊", color: "#4169E1" },
  { id: "Minutes Writing", icon: "📒", color: "#8B4513" },
  { id: "Research & Analysis", icon: "🔬", color: "#6A5ACD" },
  { id: "Promotion & Career", icon: "🎯", color: "#DC143C" },
  { id: "IT Support", icon: "🔧", color: "#FF8C00" },
  { id: "Web & Development", icon: "🌐", color: "#20B2AA" },
  { id: "General", icon: "📋", color: "#708090" },
  // Student-only categories
  { id: "Essay Writing", icon: "✍️", color: "#E91E63", studentOnly: true },
  { id: "Exam Preparation", icon: "📝", color: "#FF5722", studentOnly: true },
  { id: "Study Skills", icon: "📅", color: "#9C27B0", studentOnly: true },
  { id: "Academic Writing", icon: "🎓", color: "#3F51B5", studentOnly: true },
];
