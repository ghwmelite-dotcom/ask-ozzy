# AskOzzy User Guide

> Your complete guide to using AskOzzy — the AI-powered productivity platform for Government of Ghana.

---

## Chapter 1: Getting Started

Welcome to AskOzzy. This chapter walks you through creating your account, signing in for the first time, and sending your very first message to the AI assistant.

### Creating Your Account

1. Open your browser and visit **https://askozzy.ghwmelite.workers.dev**.
2. You will see the AskOzzy welcome screen with the national branding, a brief tagline, and two prominent buttons: **Sign In** and **Create Account**.
3. Click **Create Account**.
4. A registration form appears. Fill in your details:
   - **Full Name** — Enter your official name as it appears on your government ID or student ID.
   - **Email** — Enter your work email (for GoG employees) or your school/personal email (for students).
   - **Department** — Select your ministry, department, or agency from the dropdown list. Students may select "Student" or their institution.
   - **User Type** — Choose either **GoG Employee** or **Student**. This determines your template library and pricing tier.
   - **Referral Code** *(optional)* — If a colleague or friend shared a referral code with you, enter it here. This earns your referrer a commission when you later upgrade.
5. Click **Register**.
6. The system generates your unique **Access Code** in the format `XXXX-XXXX` (eight alphanumeric characters separated by a hyphen). This code is displayed prominently on the screen.
7. **IMPORTANT: Save your access code immediately.** Write it down on paper, save it in your phone's notes app, or take a screenshot. This is your login credential — there are no passwords in AskOzzy.
8. You are automatically logged in and taken to the main chat interface. A brief onboarding tooltip may highlight key features on your first visit.

### Signing In

1. Visit the app at **https://askozzy.ghwmelite.workers.dev**.
2. You will see the sign-in screen with fields for your **Email** and **Access Code or Authenticator Code**.
3. Enter your email address and your access code (e.g., `A3K9-M2X7`) or 6-digit authenticator code. The access code is case-insensitive.
4. Click **Sign In**.
5. You are taken to the chat interface with your conversation history intact.

### Trouble Signing In?

If you have lost your access code or authenticator app, you can reset your account yourself:

1. On the sign-in screen, click the **"Trouble signing in?"** link below the Sign In button.
2. Enter your **email address** and your **recovery code** (the `XXXX-XXXX` code you saved when you first registered).
3. Click **Reset My Account**.
4. If your recovery code is valid, you will see:
   - Your **new access code** — copy and save this securely.
   - A **QR code** to set up your authenticator app again.
   - Your **new recovery code** — copy and save this securely for future use.
5. Scan the QR code with your authenticator app (e.g., Google Authenticator, Authy).
6. Enter the **6-digit code** from your authenticator app to verify.
7. You are now signed in with your new credentials.

**Important:** Your old access code and authenticator setup stop working immediately after the reset. Make sure to save your new access code and recovery code — they are shown only once.

### Your First Conversation

1. After signing in, you see the main chat interface. The layout has three main areas:
   - **Sidebar** (left) — Lists your conversations, folders, and navigation options.
   - **Chat area** (center) — Where messages appear.
   - **Input bar** (bottom) — Where you type your messages.
2. The input box at the bottom displays placeholder text such as *"Ask me anything..."*.
3. Type your first message. For example: *"Help me draft a memo to the Director of Finance about Q3 budget overruns."*
4. Press **Enter** or click the **Send** button (arrow icon) to the right of the input box.
5. Watch as the AI streams its response word-by-word in real time. A small typing indicator pulses while the response is being generated.
6. Your conversation now appears in the sidebar on the left, titled with a summary of your first message.
7. Continue the conversation by typing follow-up messages. The AI remembers the full context of the current chat.

---

## Chapter 2: Chat Interface

The chat interface is where you spend most of your time in AskOzzy. This chapter explains every element of the interface in detail.

### Sending Messages

- Type your message in the input box at the bottom of the screen.
- Press **Enter** to send the message immediately.
- Press **Shift+Enter** to insert a new line without sending (useful for multi-paragraph messages).
- Alternatively, press **Ctrl+Enter** to send if you have changed the default send behavior in settings.
- Your messages appear as dark-colored bubbles aligned to the right side of the chat area.
- AI responses appear as lighter-colored bubbles aligned to the left side.

### Streaming Responses

- When you send a message, AskOzzy begins generating a response immediately.
- The response streams in word-by-word using Server-Sent Events (SSE), so you can start reading before the full response is complete.
- A subtle typing indicator (pulsing dots) appears at the bottom of the AI message while generation is in progress.
- A small badge on each AI message shows which model generated the response (e.g., "Llama 3.3 70B").
- You can scroll up while a response is streaming — the chat will not auto-scroll if you have scrolled away.

### Message Actions

Each AI response includes a row of action buttons that appear when you hover over the message (or tap on mobile):

- **Copy** — Copies the full response text to your clipboard. A brief "Copied!" confirmation appears.
- **Download** — Downloads the response as a plain text file to your device.
- **Thumbs Up / Thumbs Down** — Rate the quality of the response. This feedback helps improve the system. The selected rating highlights in color.
- **Regenerate** — Discards the current response and generates a new one for the same question. Useful if the first response was not quite what you needed.

### Markdown Rendering

AI responses are rendered with full Markdown formatting for readability:

- **Bold text** and *italic text* for emphasis.
- ~~Strikethrough~~ for corrections or deletions.
- `Inline code` and fenced code blocks with syntax highlighting for programming content.
- Tables with headers and aligned columns.
- Numbered lists (1, 2, 3...) and bulleted lists.
- Headings (H1 through H6) and horizontal rules for document structure.
- Clickable links that open in a new tab.

### Conversation Management

Your conversations are listed in the sidebar. Here is how to manage them:

- **New Chat** — Click the **"+"** button at the top of the sidebar, or press **Ctrl+N**. A fresh conversation starts in the main area.
- **Rename** — Click the conversation title in the sidebar to edit it. Type a new name and press Enter to save.
- **Delete** — Hover over a conversation in the sidebar to reveal a trash icon. Click it and confirm deletion. This action is permanent.
- **Pin** — Click the pin icon on any conversation to pin it to the top of the sidebar. Pinned conversations always appear first, regardless of age.
- **Grouping** — Conversations are automatically grouped by time: Today, Yesterday, Previous 7 Days, and Older. This helps you find recent work quickly.

---

## Chapter 3: Templates

Templates are pre-built structured prompts that help you get high-quality, formatted output for common government and academic tasks.

### Overview

AskOzzy includes **45 pre-built templates** organized across **13 categories**. Templates save you time by providing the right prompt structure — you simply fill in the details specific to your task.

### GoG Employee Templates (27 Templates)

The following templates are available to Government of Ghana employees:

| Category | Templates |
|----------|-----------|
| **Memo Drafting** | Internal Memo, Cabinet Memo, Briefing Note |
| **Official Letters** | Official Correspondence, Response Letter, Circular/Directive |
| **Reports** | Annual/Quarterly Report, Activity/Trip Report, Investigation Report |
| **Minutes Writing** | Formal Meeting Minutes, Quick Meeting Summary |
| **Research & Analysis** | Policy Research Brief, Project Proposal, Data Analysis & Summary |
| **Promotion & Career** | Promotion Interview Prep, Professional CV/Resume, Staff Performance Appraisal |
| **IT Support** | Troubleshooting Guide, Maintenance Plan, Procurement Spec, System Upgrade Proposal |
| **Web & Development** | Website Design Brief, Code Assistant, Database Design |
| **General** | Speech/Keynote, Presentation Creator, Procurement/Tender, Training Programme, Document Simplifier |

### Student Templates (16 Templates)

The following templates are available to students:

| Category | Templates |
|----------|-----------|
| **Essay Writing** | Argumentative Essay, Expository Essay, Narrative/Creative Writing, Literature Analysis |
| **Exam Preparation** | WASSCE Subject Review, BECE Revision, University Exam Prep, Practice Quiz Generator |
| **Study Skills** | Study Timetable Creator, Note-Taking Guide, Subject Summarizer, Concept Explainer |
| **Academic Writing** | Thesis/Project Proposal, Literature Review, Lab Report, Citation Helper |

### How to Use a Template

1. Click the **Templates** button in the toolbar above the input box, or press **Ctrl+Shift+T**. A modal window opens displaying all available templates.
2. Browse by category using the tabs along the top, or type a keyword in the search bar to filter (e.g., "memo" or "essay").
3. Each template card shows a title, brief description, and category badge. Click a template to select it.
4. The template prompt loads into your input box. Placeholders appear in **[square brackets]** — for example: `[Recipient Name]`, `[Subject Matter]`, `[Date]`.
5. Replace each placeholder with your specific information. For example, change `[Recipient Name]` to `Dr. Kwame Mensah, Director of Finance`.
6. Press **Enter** to send. The AI generates a fully formatted output following the template structure.
7. Review the output and ask follow-up questions to refine it (e.g., *"Make the tone more formal"* or *"Add a section about budget implications"*).

---

## Chapter 4: Voice Features

AskOzzy supports voice input and output in multiple Ghanaian and international languages, making it accessible even when typing is inconvenient.

### Voice Input (Speech-to-Text)

1. Look for the **microphone** button to the right of the input box (a small mic icon).
2. Click the microphone button. A language selection dropdown appears.
3. Select your preferred language:
   - English
   - Twi
   - Ga
   - Ewe
   - Hausa
   - Dagbani
   - French
4. A recording indicator appears (pulsing red dot or waveform) to show that the microphone is active.
5. Speak clearly into your device's microphone. Speak at a natural pace.
6. When you finish speaking, click the microphone button again to stop recording (or wait for the auto-stop after a pause).
7. Your speech is transcribed into text in the input box. Review the transcription for accuracy.
8. Edit the text if needed, then press **Enter** to send.

### Voice Mode (Full Conversational)

1. Click the **Voice Mode** button (headphone or voice icon) in the toolbar to enter a dedicated voice conversation mode.
2. The interface transitions to a focused voice view with a large waveform visualization in the center.
3. Speak your question or request naturally.
4. AskOzzy transcribes your speech, processes it through the AI, and reads the response back to you using text-to-speech (TTS).
5. The conversation flows naturally — speak, listen, speak again — like a phone call with an AI assistant.
6. Click **Exit Voice Mode** to return to the standard text chat interface.

### Text-to-Speech (Read Aloud)

- On any AI message, look for the **speaker** icon in the message action buttons.
- Click the speaker icon to have the response read aloud.
- Playback controls appear: **Pause**, **Resume**, and **Stop**.
- This is useful for reviewing long responses while multitasking, or for accessibility purposes.

---

## Chapter 5: Smart Tools

AskOzzy includes several advanced productivity tools that go beyond simple chat. Each tool is accessible from the toolbar above the input box.

### Deep Research

Deep Research performs multi-step web research to answer complex questions with cited sources.

1. Click the **Research** tool button in the toolbar, or type `/research` in the input box.
2. Enter your research question. Be specific for best results (e.g., *"What are the key provisions of Ghana's Public Procurement Act 2003 (Act 663) and its 2016 amendments?"*).
3. AskOzzy launches a five-step research process. A progress bar tracks each step:
   - **Step 1: Analyzing** — The AI breaks down your question into sub-queries.
   - **Step 2: Searching** — Web searches are performed across multiple queries.
   - **Step 3: Evaluating** — Sources are ranked by relevance and reliability.
   - **Step 4: Synthesizing** — Information is combined into a coherent narrative.
   - **Step 5: Reporting** — The final research report is generated.
4. The completed report includes:
   - An executive summary.
   - Detailed findings organized by topic.
   - Numbered citations linking to original sources.
   - A bibliography at the end.
5. You can ask follow-up questions to dive deeper into specific findings.

### Data Analysis

Data Analysis lets you upload spreadsheets and ask questions about your data.

1. Click the **Analysis** tool button in the toolbar.
2. Upload a data file: CSV or Excel (.xlsx) format is supported. Click the upload area or drag and drop your file.
3. AskOzzy reads the file and displays a preview of the first few rows so you can confirm the data loaded correctly.
4. Type your question about the data. Examples:
   - *"What is the average expenditure by department?"*
   - *"Show me a trend of monthly revenue over the past year."*
   - *"Which regions have the highest and lowest performance?"*
5. AskOzzy generates:
   - A **statistical summary** (counts, averages, totals, min/max values).
   - **Key insights and trends** identified in the data.
   - **Interactive charts** — bar charts, line graphs, pie charts, and more, rendered directly in the chat.
   - **Recommendations** based on the analysis.
6. Ask follow-up questions to explore different angles of the data.

### Workflow Automation

Workflows guide you through multi-step processes that produce comprehensive documents.

1. Click the **Workflows** tool button in the toolbar.
2. A list of available workflow templates appears. Examples include:
   - Board Meeting Preparation
   - Project Planning
   - Policy Review
   - Budget Preparation
3. Select a workflow template.
4. The workflow wizard begins. Each step presents a prompt with specific instructions:
   - Step 1 might ask for background information.
   - Step 2 might draft an agenda based on your input.
   - Step 3 might generate supporting documents.
   - And so on, with each step building on the previous output.
5. At the end of the workflow, you receive a complete, multi-part document ready for use.

### Meeting Assistant

The Meeting Assistant transcribes audio recordings and generates formatted meeting minutes.

1. Click the **Meetings** tool button in the toolbar.
2. Upload a meeting recording. Supported audio formats include MP3, WAV, M4A, and WebM.
3. AskOzzy uses Whisper AI to transcribe the audio. A progress indicator shows the transcription status.
4. Once transcription is complete, the full transcript appears in the chat.
5. Click **Generate Minutes** (or type a request like *"Generate formal meeting minutes from this transcript"*).
6. AskOzzy produces formatted meeting minutes including:
   - **Header** — Meeting title, date, time, location.
   - **Attendees** — List of participants (extracted from the audio when possible).
   - **Agenda Items** — Organized discussion topics.
   - **Discussion Summary** — Key points for each agenda item.
   - **Action Items** — Tasks with assigned owners and deadlines.
   - **Next Steps** — Follow-up actions and next meeting date.
7. Copy or download the minutes for distribution.

### Collaborative Spaces

Collaborative Spaces allow teams to share and work together on conversations.

1. Click **Spaces** in the sidebar navigation.
2. Click **Create Space** and enter a name and description (e.g., *"Q4 Budget Review — Finance Department"*).
3. Invite team members by entering their email addresses. They receive an invitation notification.
4. To share a conversation into a space:
   - Open the conversation you want to share.
   - Click the **Share** button and select **Share to Space**.
   - Choose the target space from the dropdown.
5. All space members can view shared conversations. Depending on their role:
   - **Admin** — Can manage members, remove conversations, and delete the space.
   - **Member** — Can view conversations and add their own.
   - **Viewer** — Can view conversations only (read-only access).
6. Spaces appear in the sidebar under the Spaces section for all members.

---

## Chapter 6: Files and Media

AskOzzy supports file uploads, camera capture, and image analysis to help you work with documents and visual content.

### Uploading Files

1. Click the **attach** button (paperclip icon) to the left of the input box.
2. A file picker opens. Navigate to and select the file(s) you want to upload.
3. Supported file types:
   - **Images** — JPG, PNG, GIF, WebP
   - **Documents** — TXT, PDF
4. Selected files appear as thumbnails or file badges above the input box.
5. Type a message to accompany the file (e.g., *"Summarize this document"* or *"What does this image show?"*).
6. Press **Enter** to send. The file content is included with your message for the AI to process.

### Camera Capture

1. On mobile devices and tablets, a **camera** button appears next to the attach button.
2. Tap the camera button to open your device's camera.
3. Take a photo of a document, receipt, whiteboard, form, or any other content.
4. The captured photo is attached to your message automatically.
5. Add an instruction (e.g., *"Extract the text from this document"*) and send.

### Image Paste

- Copy any image to your clipboard (e.g., right-click an image and select Copy, or take a screenshot).
- Click into the input box and press **Ctrl+V** (or Cmd+V on Mac).
- The pasted image appears as an attachment above the input box.
- Send with your message as usual.

### Vision AI Modes

When you attach an image, AskOzzy can analyze it in several ways. You can specify the mode in your message or select from the options that appear:

1. **Describe** — The AI provides a general description of what is in the image. Useful for accessibility or quick summaries.
2. **OCR (Optical Character Recognition)** — Extracts all visible text from the image and returns it as editable text. Ideal for scanned documents.
3. **Form Extraction** — Identifies form fields and their values. Returns structured data from printed or handwritten forms.
4. **Receipt Scanning** — Extracts receipt details including vendor name, individual items, quantities, unit prices, subtotals, taxes, and grand total.

---

## Chapter 7: AI Personalization

AskOzzy adapts to you over time. This chapter explains how to manage AI memories, use custom agents, and work with the artifact canvas.

### AI Memories

AskOzzy maintains a memory system that stores facts about you to provide more personalized responses.

**Automatic Memory Extraction:**
- As you chat, the AI detects relevant facts about you and stores them automatically.
- Examples of auto-extracted memories:
  - *"User works at the Ministry of Finance."*
  - *"User prefers responses in a formal tone."*
  - *"User frequently drafts cabinet memos."*
- These memories are used in future conversations to tailor responses without you having to repeat context.

**Manual Memory Entry:**
1. Go to **Settings** (gear icon) and select **Memories**.
2. Click **Add Memory**.
3. Enter a **key** (e.g., `department`) and a **value** (e.g., `Ministry of Finance, Budget Division`).
4. Click **Save**.
5. The AI now uses this memory in all your conversations.

### Managing Memories

- Navigate to **Settings** then **Memories** to see a complete list of all stored memories.
- Each memory shows its type: **preference**, **fact**, or **auto** (automatically extracted).
- To remove a memory, click the **Delete** button (trash icon) next to it.
- Deleting a memory means the AI will no longer reference that information in future responses.

### Custom Agents

Agents are specialized AI personas that shape how AskOzzy responds.

1. Click the **Agent** button in the toolbar to open the agent browser.
2. Browse through 25+ pre-built agents covering a wide range of GoG departments and specializations. Examples include:
   - **Legal Advisor** — Specializes in Ghana's legal framework, acts, and regulations.
   - **Budget Analyst** — Focuses on financial planning, budget preparation, and expenditure tracking.
   - **HR Consultant** — Assists with civil service regulations, recruitment, and staff management.
   - **Procurement Officer** — Guides you through procurement processes under Act 663.
   - **Policy Researcher** — Helps with evidence-based policy analysis and recommendations.
3. Select an agent by clicking on it. The agent's expertise is now active for the current conversation.
4. A badge at the top of the chat shows which agent is active.
5. All responses in this conversation are shaped by the agent's specialized knowledge and tone.
6. You can switch agents or return to the default assistant at any time.

### Artifact Canvas

When the AI generates structured content like code, tables, or formatted documents, the artifact canvas provides a better viewing experience.

1. When the AI produces a code block, a complex table, or a document, an **"Open in Canvas"** button appears on the message.
2. Click the button to open a side panel on the right.
3. The artifact is displayed in a clean, formatted view:
   - Code appears with syntax highlighting and line numbers.
   - Tables render with proper alignment and styling.
   - Documents show with headers, paragraphs, and formatting.
4. Use the **Copy** button at the top of the canvas to copy the content.
5. Use the **Download** button to save the artifact as a file.
6. Close the canvas by clicking the **X** button or pressing **Escape**.

---

## Chapter 8: Organization

Keep your conversations organized with folders, pins, search, and sharing.

### Folders

1. Click **Folders** in the sidebar navigation.
2. Click **Create Folder**.
3. Enter a folder name (e.g., *"Q4 Reports"* or *"WASSCE Prep"*) and optionally select a color.
4. Click **Save**.
5. To move a conversation into a folder:
   - **Drag and drop**: Drag the conversation from the sidebar into the folder.
   - **Context menu**: Right-click (or long-press on mobile) a conversation and select **Move to Folder**, then choose the target folder.
6. Click a folder in the sidebar to filter and view only conversations within it.
7. To rename or delete a folder, right-click the folder name and select the appropriate option.

### Pinning Conversations

- Hover over any conversation in the sidebar to reveal the **pin** icon.
- Click the pin icon to pin the conversation to the top of the sidebar.
- Pinned conversations always appear first, above the time-based groupings.
- Click the pin icon again to unpin.

### Searching Conversations

1. Press **Ctrl+K** or click the **search** icon at the top of the sidebar.
2. A search overlay appears with an input field.
3. Type your search query (e.g., *"budget memo"* or *"procurement act"*).
4. Results appear in real time, showing matching conversation titles and message snippets.
5. Click a result to navigate directly to that conversation and message.
6. Press **Escape** to close the search overlay.

### Sharing Conversations

1. Open the conversation you want to share.
2. Click the **Share** button in the top toolbar of the chat area.
3. AskOzzy generates a unique shareable link.
4. Copy the link and distribute it to colleagues via email, WhatsApp, or any messaging platform.
5. Anyone with the link can view the conversation in **read-only** mode. They do not need an AskOzzy account.
6. To revoke sharing, click the **Share** button again and select **Revoke Link**. The link will no longer work.

---

## Chapter 9: Account and Security

AskOzzy provides robust security features including two-factor authentication, passkeys, and session management.

### Your Profile

- Click your **avatar** or name in the bottom-left corner of the sidebar.
- Select **Profile** from the menu.
- Your profile page displays:
  - **Full Name** and **Email**
  - **Department** and **User Type** (GoG Employee or Student)
  - **Current Tier** (Free, Professional, or Enterprise)
  - **Referral Code** — Your unique code for the affiliate program
  - **Account Age** — How long you have been using AskOzzy
  - **Total Messages** — Lifetime message count

### Setting Up Two-Factor Authentication (2FA)

Two-factor authentication adds an extra layer of security to your account.

1. Go to **Settings** (gear icon) and select **Security**.
2. Under the 2FA section, click **Enable 2FA**.
3. A QR code is displayed on the screen.
4. Open your authenticator app (Google Authenticator, Authy, Microsoft Authenticator, or similar).
5. In the authenticator app, tap **Add Account** or the **"+"** button.
6. Scan the QR code displayed in AskOzzy.
7. The authenticator app now shows a 6-digit code that refreshes every 30 seconds.
8. Enter the current 6-digit code into AskOzzy's verification field.
9. Click **Verify**.
10. 2FA is now active. Every time you sign in, you will be asked for your authenticator code after entering your access code.

### Setting Up Passkeys

Passkeys let you sign in using biometrics (fingerprint, face recognition) or a security key, without needing your access code.

1. Go to **Settings** then **Security** then **Passkeys**.
2. Click **Register Passkey**.
3. Your device prompts you to authenticate:
   - On a phone: use fingerprint or face recognition.
   - On a laptop: use a fingerprint reader, Windows Hello, or a USB security key.
4. Follow the on-screen prompts from your browser or operating system.
5. Once registered, the passkey appears in your list of registered passkeys with a name and creation date.
6. On your next login, you can choose **Sign in with Passkey** instead of entering your access code.

### Managing Sessions

- Go to **Settings** then **Sessions**.
- You will see a list of all active sessions, each showing:
  - **Device** — Browser and operating system.
  - **Location** — Approximate geographic location.
  - **Last Active** — When the session was last used.
  - **Current Session** — Highlighted to show which session you are currently using.
- To end a specific session, click **Revoke** next to it.
- To end all sessions except the current one, click **Revoke All Other Sessions**.

### Recovery Code

If you lose access to your 2FA device, a recovery code allows you to regain access to your account.

1. Go to **Settings** then **Security** then **Recovery Code**.
2. Your recovery code is displayed. It is in the format `XXXX-XXXX`.
3. **Save this code securely** — write it down and store it in a safe place, or save it to a secure password manager.
4. If you are locked out of your account, click **"Trouble signing in?"** on the login page and enter your email and recovery code.
5. You will receive a new access code, a new QR code for your authenticator app, and a new recovery code.
6. After scanning the QR code and verifying a 6-digit code, you are signed in.

**Tip:** Your recovery code can only be used once. Each time you reset your account, a new recovery code is generated. Always save the latest one.

---

## Chapter 10: Pricing and Payments

AskOzzy offers a generous free tier and affordable paid plans with mobile money support.

### Plans at a Glance

| Feature | Free | Professional | Enterprise |
|---------|------|-------------|-----------|
| **Monthly Price** | GHS 0 | GHS 60 | GHS 100 |
| **Student Price** | GHS 0 | GHS 25 | GHS 45 |
| **Messages Per Day** | 10 | 200 | Unlimited |
| **AI Models Available** | 3 | All 10 | All 10 |
| **Templates** | All | All | All + Custom |
| **Voice Features** | Basic | Full | Full |
| **Smart Tools** | Limited | Full | Full |
| **Collaborative Spaces** | No | Yes | Yes |
| **Priority Support** | No | No | Yes |

### Upgrading Your Plan

1. Click the **Upgrade** button. You can find this in the sidebar, in settings, or in the message that appears when you reach your daily limit.
2. The pricing page displays all available plans with feature comparisons.
3. Select the plan you want (Professional or Enterprise).
4. Choose your payment method:
   - **Mobile Money** — Select your network:
     - MTN Mobile Money (MoMo)
     - Vodafone Cash
     - AirtelTigo Money
   - **Card** — Enter Visa or Mastercard details.
5. You are redirected to the **Paystack** secure checkout page.
6. Complete the payment:
   - For Mobile Money: approve the payment prompt on your phone.
   - For Card: enter your card details and authorize.
7. After successful payment, you are returned to AskOzzy with your plan activated immediately.
8. A confirmation message displays your new tier and its benefits.

### Free Trial

New users can try Professional features for free:

1. Look for the **"Start Free Trial"** banner or button on the pricing page.
2. Click it. No payment information is required.
3. You receive full Professional access for **3 days**.
4. At the end of the trial, your account reverts to the Free tier unless you upgrade.
5. The trial is available once per account.

---

## Chapter 11: Referral Program

Earn money by sharing AskOzzy with your colleagues, friends, and networks.

### How It Works

1. Every AskOzzy user receives a unique **referral code** upon registration.
2. Share your referral code with others.
3. When someone registers using your code, they become your **Level 1 (L1)** referral.
4. When your L1 referral upgrades to a paid plan, you earn a commission.
5. When your L1 referral's own referrals (your Level 2, or L2) upgrade, you also earn a smaller commission.

### Commission Structure

- **Level 1 (Direct Referral)** — Earn **30%** of each payment made by people you directly referred.
- **Level 2 (Indirect Referral)** — Earn **5%** of payments made by your referrals' referrals.

**Example:** You refer Kwame, who subscribes to Professional (GHS 60/month). You earn GHS 18/month (30%). Kwame then refers Ama, who subscribes to Enterprise (GHS 100/month). You earn GHS 5/month (5% of Ama's payment) as an L2 commission.

### Viewing Your Earnings

1. Click your avatar and select **Affiliate Dashboard** (or navigate via Settings).
2. The dashboard displays:
   - **Current Balance** — Available for withdrawal.
   - **Total Earned** — Lifetime commission earnings.
   - **Total Withdrawn** — Amount already withdrawn.
   - **Referral Count** — Number of L1 and L2 referrals.
3. Below the summary, a table lists each referral with their status, tier, and your earned commission.

### Sharing Your Referral Code

1. In the Affiliate Dashboard, click **Share Referral Link**.
2. A sharing menu appears with options:
   - **WhatsApp** — Opens WhatsApp with a pre-filled message containing your link.
   - **SMS** — Opens your messaging app with the referral link.
   - **Email** — Opens your email client with a pre-composed message.
   - **Copy Link** — Copies the referral URL to your clipboard.
3. Your referral link format: `https://askozzy.ghwmelite.workers.dev/?ref=YOUR-CODE`

### Withdrawing Earnings

1. In the Affiliate Dashboard, click **Withdraw**.
2. Enter the amount you wish to withdraw (must not exceed your available balance).
3. Select your **mobile money network**: MTN MoMo, Vodafone Cash, or AirtelTigo Money.
4. Enter your **mobile money number**.
5. Click **Submit Withdrawal Request**.
6. The request is sent to the admin for review and approval.
7. Once approved, the funds are transferred to your mobile money account.
8. You receive a notification when the withdrawal is processed.

### Milestone Bonuses

Earn bonus rewards as you hit referral milestones:

| Milestone | Reward |
|-----------|--------|
| **10 Referrals** | GHS 30 cash bonus |
| **25 Referrals** | GHS 60 bonus (equivalent to 1 month Professional) |
| **50 Referrals** | GHS 100 bonus + permanent discount on your subscription |
| **100 Referrals** | GHS 200 bonus + free Enterprise tier for life |

### Leaderboard

- The Affiliate Dashboard features a **Leaderboard** showing top affiliates ranked by total referral count.
- Your rank and position are highlighted.
- Compete with other users for bragging rights and milestone bonuses.

---

## Chapter 12: Mobile and PWA

AskOzzy is a Progressive Web App (PWA) — it works like a native app on any device, with offline support and push notifications.

### Installing AskOzzy as an App

**On Android (Chrome):**
1. Visit **https://askozzy.ghwmelite.workers.dev** in Google Chrome.
2. An install banner may appear automatically at the bottom of the screen saying *"Add AskOzzy to Home Screen"*. Tap **Install**.
3. If no banner appears: tap the **three-dot menu** (top right) and select **"Add to Home Screen"** or **"Install App"**.
4. Confirm the installation.
5. AskOzzy now appears on your home screen as a standalone app with its own icon. It opens without the browser toolbar, looking and feeling like a native app.

**On iOS (Safari):**
1. Visit **https://askozzy.ghwmelite.workers.dev** in Safari (this does not work in Chrome on iOS).
2. Tap the **Share** button (the square with an upward arrow at the bottom of the screen).
3. Scroll down in the share menu and tap **"Add to Home Screen"**.
4. Edit the name if desired, then tap **Add**.
5. AskOzzy appears on your home screen as a standalone app.

**On Desktop (Chrome or Edge):**
1. Visit **https://askozzy.ghwmelite.workers.dev** in Chrome or Microsoft Edge.
2. Look for the **install icon** in the address bar (a small monitor with a down arrow, or a "+" icon).
3. Click it and confirm the installation.
4. AskOzzy opens as a standalone desktop application in its own window, separate from the browser.

### Offline Mode

AskOzzy continues to work even without an internet connection:

- **Cached Conversations** — Previously viewed conversations are stored locally. You can browse and read them offline.
- **Cached Templates** — All templates are available offline for reference.
- **Message Queuing** — If you send a message while offline, it is saved in a queue. When your connection is restored, queued messages are automatically sent and responses are received.
- **Offline Indicator** — A subtle banner at the top of the screen shows when you are offline, and disappears when connectivity is restored.
- **Automatic Sync** — When you come back online, all queued messages sync seamlessly without any action required from you.

### Mobile Gestures

On touch-screen devices, AskOzzy supports gesture navigation:

- **Swipe right** from the left edge to open the sidebar.
- **Swipe left** on the sidebar to close it.
- **Pull down** on the conversation list to refresh.
- **Long press** on a message to reveal the action menu (copy, download, rate, regenerate).

### Push Notifications

1. On your first visit or after installing the PWA, AskOzzy may request permission to send notifications.
2. Tap **Allow** to enable push notifications.
3. You will receive notifications for:
   - System announcements and updates.
   - Confirmation that offline-queued messages have been sent and responses received.
   - Alerts when someone shares a conversation with you (in Collaborative Spaces).
4. Manage notification preferences in **Settings** then **Notifications**. Toggle individual notification types on or off.

---

## Chapter 13: Citizen Bot

The Citizen Bot is a public-facing AI service designed to provide government information to all citizens of Ghana, with no registration or login required.

### How to Use the Citizen Bot

1. Visit the Citizen Bot page (accessible from the AskOzzy homepage or a direct link provided by your government office).
2. If prompted, select your preferred language.
3. You see a simple chat interface with a welcome message.
4. Type your question in the input box and press **Enter**.
5. The AI responds with relevant information about government services and procedures.
6. Sessions are **anonymous** — no personal data is collected or stored.

### What the Citizen Bot Can Help With

The Citizen Bot is trained to assist with a wide range of government-related inquiries:

- **Government Service Information** — How to apply for a passport, driver's license, birth certificate, business registration, and other government services.
- **Regulatory Questions** — Understanding regulations, compliance requirements, and legal obligations for businesses and individuals.
- **Public Service Procedures** — Step-by-step guidance on interacting with government agencies, filing complaints, and accessing public services.
- **General Ghana Government Inquiries** — Information about ministries, departments, agencies, their roles, and contact details.

---

## Chapter 14: Keyboard Shortcuts

Master these keyboard shortcuts to navigate AskOzzy faster:

| Shortcut | Action |
|----------|--------|
| **Ctrl+N** | Start a new conversation |
| **Ctrl+K** | Open the search overlay |
| **Ctrl+/** | Toggle the sidebar open/closed |
| **Ctrl+Shift+V** | Toggle voice mode on/off |
| **Ctrl+Shift+T** | Open the template browser |
| **Ctrl+Shift+M** | Open the model selector |
| **Enter** | Send message (default behavior) |
| **Ctrl+Enter** | Send message (alternative, if configured) |
| **Shift+Enter** | Insert a new line without sending |
| **Escape** | Close any open modal, panel, or overlay |
| **Up Arrow** | Edit your last sent message (when the input box is empty) |

**Tips:**
- On macOS, replace **Ctrl** with **Cmd** for all shortcuts.
- Keyboard shortcuts work from anywhere in the app, except when a modal input field is focused.

---

## Chapter 15: Troubleshooting

If you encounter issues, consult this section before reaching out for support.

### "Invalid access code"

- Verify that you are entering the code in the correct format: `XXXX-XXXX` (eight characters with a hyphen in the middle).
- Access codes are **case-insensitive** — `a3k9-m2x7` and `A3K9-M2X7` are treated the same.
- Remove any extra spaces before or after the code.
- If you have forgotten your access code, click **"Trouble signing in?"** on the login page to reset your account using your recovery code. If you don't have your recovery code either, contact the administrator for your department — they can reset your account from the admin portal.

### "Rate limit exceeded"

- You have sent more requests than your plan allows in the current period.
- **Free tier**: 10 messages per day.
- **Professional tier**: 200 messages per day.
- **Enterprise tier**: Unlimited.
- Wait until the limit resets (midnight UTC) or upgrade your plan for a higher limit.

### "Model unavailable"

- Some AI models are restricted to paid tiers.
- Free users have access to 3 models. Professional and Enterprise users can access all 10 models.
- Switch to a free-tier model or upgrade your plan.
- To see which models are available to you, open the model selector (Ctrl+Shift+M).

### Messages not sending

- Check your internet connection. Open another website to confirm connectivity.
- If you are offline, AskOzzy automatically queues your messages. A small badge or indicator shows the number of queued messages.
- When your connection is restored, queued messages are sent automatically.
- If messages remain stuck after reconnecting, try refreshing the page.

### Voice input not working

- Ensure you have granted microphone permission to AskOzzy in your browser settings.
- Check that no other application is currently using the microphone.
- Google Chrome is recommended for the best voice input compatibility.
- Try refreshing the page and attempting voice input again.
- On iOS, voice input works best in Safari.

### PWA not updating to the latest version

- Close **all** AskOzzy tabs and windows in your browser.
- If installed as a PWA, close the standalone app window completely.
- Reopen AskOzzy. The service worker detects the update and installs it automatically.
- If the issue persists, clear the app's cache: go to browser settings, find AskOzzy in the site settings, and clear cached data.

### 2FA code not accepted

- Authenticator codes change every 30 seconds. Ensure you are entering the **current** code, not an expired one.
- Check that the clock on your authenticator device is accurate. Time-based codes require synchronized clocks. On Android, go to your authenticator app's settings and select "Time correction for codes." On iOS, ensure automatic time is enabled in Settings then General then Date and Time.
- If you are completely locked out, click **"Trouble signing in?"** on the login page and use your **recovery code** to reset your account. This will generate a new authenticator setup and a new access code.
- If you have also lost your recovery code, contact your department administrator — they can perform a full account reset from the admin portal.

### Cannot see all AI models

- The Free tier provides access to 3 AI models.
- Upgrade to Professional (GHS 60/month) or Enterprise (GHS 100/month) to unlock all 10 models.
- Open the model selector (Ctrl+Shift+M) to see which models are available and which require an upgrade.

### File upload fails

- Check that the file is in a supported format: JPG, PNG, GIF, WebP (images) or TXT, PDF (documents).
- Ensure the file size is within the allowed limit.
- Binary files such as .doc, .docx, and .pptx are not directly supported for upload as raw files. Convert them to PDF first.
- Try a different browser if the issue persists.

### App is slow or unresponsive

- Clear your browser cache and cookies for the AskOzzy domain.
- Close unnecessary browser tabs to free up memory.
- Check your internet speed — slow connections can cause delays in streaming responses.
- Try using a different browser (Chrome or Edge recommended).

---

## Chapter 16: Frequently Asked Questions

**Q: Is AskOzzy free to use?**
A: Yes. The Free tier provides 10 messages per day with access to 3 AI models and all templates, at no cost. For heavier usage, upgrade to Professional (GHS 60/month) or Enterprise (GHS 100/month). Students get discounted rates.

**Q: Is my data private and secure?**
A: Yes. All data is stored on Cloudflare's global infrastructure with encryption at rest and in transit. Your conversations are private to your account. Administrators cannot read your conversations unless reviewing content flagged by the moderation system.

**Q: Can I use AskOzzy on my phone?**
A: Absolutely. AskOzzy is a Progressive Web App (PWA). Install it from your mobile browser for a native app experience with offline support, push notifications, and gesture navigation. See Chapter 12 for installation instructions.

**Q: What languages does voice input support?**
A: Voice input supports seven languages: English, Twi, Ga, Ewe, Hausa, Dagbani, and French. Select your language when activating the microphone.

**Q: How do I earn money with the referral program?**
A: Share your unique referral code with others. When they register and later upgrade to a paid plan, you earn a 30% commission on their payments. You also earn 5% on payments from their referrals (Level 2). See Chapter 11 for full details.

**Q: What is the difference between the AI models?**
A: AskOzzy offers models ranging from 8B to 120B parameters. Larger models (such as Llama 3.3 70B and Qwen 2.5 120B) are more capable and produce higher-quality responses, but may take slightly longer. Smaller models (such as Llama 3.2 8B and Mistral 12B) are faster and suitable for simpler tasks. Use the model selector (Ctrl+Shift+M) to see descriptions of each model.

**Q: Can I use AskOzzy without internet?**
A: Yes, to a limited extent. Previously viewed conversations are cached locally and accessible offline. New messages are queued and automatically sent when your connection is restored. Templates are also available offline. However, generating new AI responses requires an internet connection.

**Q: How do I get student pricing?**
A: When registering, select **"Student"** as your user type. Student pricing is: Professional at GHS 25/month and Enterprise at GHS 45/month. You may be required to verify your student status.

**Q: Is there a desktop app?**
A: Yes. Install AskOzzy as a PWA from Google Chrome or Microsoft Edge. It opens in its own window without browser toolbars, functioning like a native desktop application. See Chapter 12 for instructions.

**Q: How do I contact support?**
A: Enterprise tier users have access to dedicated priority support. All users can reach the support team through the platform's help section or by contacting the administrator.

**Q: Can I export my conversations?**
A: You can download individual AI responses using the Download button on each message. Administrators have additional export capabilities for user data and analytics in CSV format.

**Q: What is the Citizen Bot?**
A: The Citizen Bot is a free, public-facing AI service that provides information about government services and procedures. It requires no registration and is completely anonymous. See Chapter 13 for details.

**Q: How many templates are available?**
A: AskOzzy includes 45 templates across 13 categories: 27 templates for GoG employees and 16 templates for students, plus 2 general templates.

**Q: Can I create my own custom templates?**
A: Custom template creation is not available through the user interface at this time. Enterprise users can request custom templates through the administrator. Custom agents (see Chapter 7) provide similar personalization for specialized tasks.

**Q: What happens when I reach my daily message limit?**
A: A notification appears informing you that you have reached your daily limit. You can either upgrade to a higher plan for more messages or wait until the limit resets at midnight UTC. Messages cannot be sent until the limit resets or your plan is upgraded.

**Q: Can multiple people in my department use AskOzzy?**
A: Yes. Each person creates their own account with their own access code. Department-level onboarding with bulk signup and department-specific administration is available for organizations. Contact the administrator for department onboarding.

**Q: How do AI Memories work? Can I control them?**
A: AI Memories store facts about you (like your department, preferences, and work patterns) to personalize responses. The AI extracts some memories automatically from your conversations. You can also add, view, and delete memories manually in Settings then Memories. You have full control over what the AI remembers.

---

*For technical documentation, see the [API Reference](04-api-reference.md) and [Architecture Guide](02-architecture.md).*

*Built for the Government of Ghana. Powered by Cloudflare Workers AI.*
