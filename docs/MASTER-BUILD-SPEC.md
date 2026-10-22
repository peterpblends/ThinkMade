# THINKMADE

## COMPLETE MASTER BUILD INSTRUCTIONS FOR CLAUDE CODE

Version 3.0 — Full Application Development Specification

- Application: ThinkMade
- Tagline: Better Thinking. Made Personal.
- Production URL: https://thinkmade.zicaworld.com
- Frontend Hosting: Vercel
- Platform: Mobile-first Progressive Web App (PWA)
- Launch Pricing: Free for all users
- Core Learning Methodology: Thinking. Seeing. Doing.

---

## 1. THE THINKMADE VISION

Build ThinkMade as a beautiful, intuitive, secure, AI-powered personal learning companion.

ThinkMade transforms the world's best books and mental models into personalized podcasts that teach you how to think through whatever you're trying to learn or solve.

The application should help people become better thinkers, not simply accumulate knowledge.

Someone should be able to explain a problem, ask a question, or show a situation through a photograph or video.

ThinkMade should understand the user's objective, identify applicable mental models, research credible books and supporting sources, and create personalized podcasts that teach those models.

The learning experience must help people understand the thinking, recognize opportunities to apply it, and understand how to put it into practice.

### Official Brand Identity

- Name: ThinkMade
- Tagline: Better Thinking. Made Personal.
- Supporting Promise: Don't just learn more. Learn to think better.
- Short Description: Personalized podcasts that teach you how to think.
- Full Description: ThinkMade transforms the world's best books and mental models into personalized podcasts that teach you how to think through whatever you're trying to learn or solve.
- Learning Philosophy: Thinking. Seeing. Doing.

Use the name, tagline, and purpose consistently throughout the app, including the landing page, onboarding, public podcast pages, sharing previews, and installation experience.

Do not assume users know what mental models are. The purpose should be understandable in seconds.

---

## 2. FUNDAMENTAL PRODUCT PRINCIPLES

These requirements are mandatory:

1. Mobile-first, app-like experience.
2. Exceptionally simple navigation.
3. Minimal clicks and configuration.
4. A unique, recognizable visual brand and logo.
5. Text, voice, photo, and video input.
6. Administrator-configured defaults.
7. Natural, educational AI-generated podcasts.
8. Mental models as the foundation of every episode.
9. Thinking, Seeing, and Doing in every episode.
10. Personalized AI coaching.
11. Offline podcast playback.
12. Automatic listening-progress preservation.
13. Synchronization across devices.
14. Personal podcast libraries.
15. Public and private podcast options.
16. Public podcast discovery and sharing.
17. Intelligent podcast reuse.
18. Continued learning without unnecessary duplication.
19. Built-in bug reporting.
20. Secure user accounts and biometric-assisted login where supported.
21. Enterprise-grade security practices.
22. Free access for users at launch.
23. Free and open-source technology wherever practical.
24. Administrator management of AI models and instructions.
25. Deployment compatibility with Vercel.
26. Scalable architecture without unnecessary complexity.
27. Factual accuracy and verified sources.
28. Excellent accessibility and usability.

The application must feel premium, friendly, intelligent, and effortless. The technology should be sophisticated behind the scenes and nearly invisible to users.

---

## 3. BRAND IDENTITY AND LOGO

ThinkMade must have a recognizable, distinctive, long-lasting brand.

Avoid designs that resemble typical AI applications. Do not rely on generic chatbot graphics, glowing brains, robotic faces, circuit patterns, or excessive gradients.

### Brand Personality

The brand should communicate: personal understanding, better thinking, connected knowledge, curiosity, discovery, clarity, practical learning, confidence, approachability.

### Logo Design

Create an original logo with a simple, memorable symbol. Explore creative interpretations of:

- A personalized thinking fingerprint.
- Connected knowledge.
- Ideas coming together.
- A pathway to understanding.
- Transformation from knowledge to insight.
- A distinctive abstract thinking symbol.

Do not try to incorporate every concept literally. Prioritize simplicity, originality, and recognition. The logo should work without text as an app icon. Avoid complex illustrations.

Test the logo at 32px, 48px, 64px, 128px, and common phone home-screen icon sizes.

### Required Logo Files

- Primary wordmark and symbol.
- Standalone app icon.
- Horizontal logo.
- Vertical or stacked logo if appropriate.
- Light version.
- Dark version.
- Monochrome version.
- SVG files.
- Transparent PNG files.
- Favicons.
- Apple touch icon.
- PWA icons, including maskable variants.
- Social sharing images.

Create editable vector-based logo source assets. Do not assert that the brand or logo is legally unique without verification.

### Brand Colors

| Element | Name | Hex |
|---|---|---|
| Background | Warm Ivory | #F7F4EE |
| Primary Text | Deep Charcoal | #292929 |
| Main Accent | Terracotta | #C56B4E |
| Secondary Accent | Sage Green | #829284 |
| Surface | Soft White | #FFFFFF |

Use consistent design tokens. Use accessible contrast and support light and dark appearances.

### Design Direction

ThinkMade should look like a premium reading and podcast application. Use clean typography, ample whitespace, attractive cover art, restrained motion, excellent spacing, and consistent controls. Do not make ThinkMade look like an AI chatbot.

---

## 4. MOBILE-FIRST DESIGN

This is a critical requirement. ThinkMade must be designed primarily for smartphones. Desktop and tablet use are required, but the mobile experience takes priority. The application must feel like a polished native app.

### Mobile Requirements

- Bottom navigation.
- Thumb-friendly controls.
- Large touch targets.
- Simple one-handed interaction.
- Minimal scrolling where practical.
- No horizontal overflow.
- Responsive layouts.
- Safe-area support on modern phones.
- Clear readable text.
- Consistent controls and icons.
- Fast navigation.
- Subtle transitions.
- Persistent audio mini-player.
- Appropriate keyboard handling.
- Clear loading and error states.
- Screen reader support.
- WCAG 2.2 AA accessibility target.

Test on real iPhones and Android phones. Do not rely exclusively on desktop browser simulations.

### Main Navigation

Use only three primary tabs: **Create | Discover | My Library**

Access Profile, Settings, Help, Report a Bug, and administrative functionality through appropriate secondary navigation. Never overwhelm users with navigation choices.

---

## 5. INSTALLABLE PWA

ThinkMade must be an installable Progressive Web App. It should work through a browser and provide a native-like installed experience.

### Installation

Provide a clearly visible but unobtrusive **Install ThinkMade** option.

On supported browsers, use the appropriate installation prompt. On iOS, provide simple Add to Home Screen instructions where direct installation is not supported.

Make the installed app:

- Launch in standalone mode where supported.
- Display ThinkMade branding.
- Use the custom app icon.
- Respect device safe areas.
- Support offline access to downloaded podcasts.
- Preserve app and playback state.

When the PWA is already installed, avoid displaying installation prompts unnecessarily. Provide instructions for removing the installed PWA if the operating system does not allow the app to uninstall itself programmatically.

### PWA Manifest

Configure: Name: ThinkMade. Short name: ThinkMade. Appropriate description. App icons. Theme colors. Background colors. Standalone display mode. Start URL. Appropriate scope.

Implement service-worker update handling so new releases do not unexpectedly interrupt playback.

---

## 6. THE SIMPLEST POSSIBLE USER EXPERIENCE

The main screen must ask: **What would you like to think through today?**

Place one prominent input area immediately below. Users should be able to type, speak, take or upload a photo, record or upload a video. Allow inputs to be combined.

Display one main button: **Create My Podcasts**

Below it, offer: **Customize**

Customization must be optional.

### Default User Journey

1. Open ThinkMade.
2. Type, speak, or show what you want to learn.
3. Tap Create My Podcasts.
4. ThinkMade generates the learning series.
5. Listen when episodes become available.

Do not require the user to configure podcast settings. For an authenticated returning user, the process should require no unnecessary additional steps. First-time users may need to create an account, but keep onboarding minimal.

### Podcast Generation Experience

Show understandable progress such as:

- Understanding your topic.
- Connecting relevant thinking.
- Building your podcasts.
- Preparing the audio.
- Ready to listen.

These statuses must reflect real processing stages. Do not show fabricated percentages or falsely claim work is complete. Allow users to navigate away while background processing continues.

---

## 7. INPUT OPTIONS

### 7.1 Text

Allow users to describe any question, subject, challenge, or problem in natural language. Examples:

- "How can I become a better leader?"
- "Why does my production process experience bottlenecks?"
- "How do I make better financial decisions?"
- "Help me understand why people resist change."

### 7.2 Voice

Provide a microphone button next to the input field. Requirements:

- Request microphone permission.
- Show when recording is active.
- Allow stopping or canceling.
- Transcribe spoken input.
- Display editable transcription.
- Allow users to correct the text.
- Create podcasts using the confirmed transcription.

Favor free, on-device, or open-source speech recognition where practical. Provide a secure fallback if the preferred speech-recognition capability is unavailable. Never record without permission.

### 7.3 Photographs

Allow users to take a picture with their phone, upload an existing photo, attach multiple images within configured limits, and add written or spoken context. Analyze the images and context together. The user should not need to provide a long explanation if the image communicates useful information.

Example: A user photographs a production workstation and asks: "How should I think about improving this operation?" ThinkMade identifies potentially useful concepts while clearly distinguishing visible evidence from assumptions.

### 7.4 Video

Allow users to record a short video, upload an existing video, talk while recording, and include additional text or voice context. The AI should:

1. Extract the audio.
2. Transcribe speech.
3. Identify relevant video frames.
4. Analyze visual information.
5. Combine the inputs.
6. Understand the underlying problem.
7. Identify applicable mental models.

Use efficient frame extraction to minimize computing costs.

### 7.5 Privacy

Uploads must be private by default. Use secure storage and upload validation. Do not expose personal images or videos when sharing podcasts. Provide configurable retention and deletion policies. Treat uploaded content as untrusted.

---

## 8. ADMINISTRATOR-CONTROLLED DEFAULTS

Administrators must be able to manage all creation defaults from the administrator dashboard without changing code.

### Initial Defaults

| Setting | Default |
|---|---|
| Podcast Length | 15 minutes |
| Episodes | 3 |
| Speaker Format | Mixed |
| Learning Mode | Explore |
| Privacy | Private |
| Voice | Best available natural voice |
| Mental Models | AI-selected |
| Language | English |
| Teaching Style | Conversational and practical |
| Source Quality | Verified credible sources |
| Audio Quality | Balanced |
| Educational Method | Thinking, Seeing, Doing |

### Administrator Configuration

Allow administrators to configure: default podcast duration, default number of episodes, maximum episode duration, maximum series length, speaker format, voice selection, available voices, research-depth instructions, source verification rules, mental model identification rules, AI models used for each stage, scriptwriting prompts, episode structure, coaching behavior, learning methodology, audio quality, image upload limits, video length and size limits, generation concurrency, abuse prevention, bug-report email address, storage policies, AI resource consumption limits.

Provide configuration versioning and rollback. Provide a test environment for prompt and model configuration changes. Administrator defaults must make the simple creation path fully functional with no user customization.

---

## 9. OPTIONAL USER CUSTOMIZATION

When users select Customize, show easy-to-understand controls.

- **Podcast Duration:** 5, 10, 15, 20, 30, 45, 60 minutes, or custom up to 60 minutes.
- **Number of Episodes:** 1, 3, 5, 10, or custom within administrator limits.
- **Speaker Format:** Single Host (one natural teacher); Two Hosts (two hosts engage in a meaningful conversation); Mixed (different episodes use different speaker arrangements).
- **Learning Mode:** Explore (introduce new mental models); Deepen (study previously encountered models more extensively); Reinforce (strengthen understanding through different books, cases, and examples).

Allow personal preference saving. Keep advanced controls out of the ordinary user experience.

---

## 10. THINKING, SEEING, DOING — THE CORE EDUCATIONAL METHODOLOGY

This is mandatory for every podcast. Every episode must teach people how to THINK, how to SEE opportunities to apply the thinking, and how to DO something practical with it. These capabilities must flow naturally together. Do not structure every episode as an obvious three-part classroom lecture.

### THINKING

Teach the thinking approach or mental model. The listener should understand: what it is, why it matters, how it works, what assumptions support it, what credible authors and books teach about it, how it connects with other mental models, what its limitations are, what common misunderstandings to avoid. The objective is to help the listener understand how to think, not memorize terminology.

### SEEING

Teach the listener how to recognize opportunities to use the model. Help them see: situations where the thinking is relevant, signals suggesting the model should be considered, patterns they may not have previously noticed, symptoms of a problem, opportunities for improvement, times when assumptions should be challenged, situations where the model may be inappropriate. The user should learn to recognize opportunities independently.

### DOING

Demonstrate how the thinking can be applied. Use: practical examples, real-world cases, credible case studies, hypothetical scenarios identified as such, step-by-step reasoning, applications in business and life, examples of what works and what does not, considerations for taking action.

### Natural Podcast Integration

Thinking, Seeing, and Doing must be woven throughout the learning experience. Do not mechanically announce each stage. For example, an episode could begin with a realistic challenge, introduce a useful thinking model, explain why that model matters, show how to identify the relevant conditions, and walk through a practical example. The result should feel like a natural, compelling podcast.

### Quality Gate

Before generating audio, verify that:

1. The episode teaches a clearly identified mental model.
2. The listener understands the model.
3. The listener learns when to recognize opportunities to use it.
4. The listener understands practical application.
5. The discussion flows naturally.
6. The information is accurate.
7. The supporting sources are credible.
8. The content avoids unnecessary repetition.

If the script does not satisfy these requirements, revise it before speech generation. Include automated checks and periodic human quality reviews.

---

## 11. MENTAL MODEL LEARNING ENGINE

Build a reusable knowledge system connecting: Questions → Learning Objectives → Mental Models → Books → Podcast Episodes → Coaching → Continued Learning

### Processing Workflow

1. **Understand the Request** — Identify the underlying problem, question, or learning objective.
2. **Identify Mental Models** — Find appropriate thinking models. Prioritize by usefulness and relevance.
3. **Research Books and Sources** — Identify authoritative books, authors, research, and supporting references.
4. **Connect Knowledge** — Identify complementary, contrasting, and related mental models.
5. **Develop the Learning Plan** — Organize models into an effective episode sequence.
6. **Plan Thinking, Seeing, Doing** — Determine the understanding, recognition, and application outcomes for each episode.
7. **Write Scripts** — Generate engaging, original scripts.
8. **Validate Content** — Verify facts, sources, model explanations, and learning outcomes.
9. **Generate Audio** — Produce natural-sounding audio.
10. **Save and Deliver** — Store podcasts, transcripts, sources, and metadata.

### Source Reliability

Never invent book titles, authors, quotations, research, citations, case studies, or statistics. Provide verifiable references. If information cannot be verified, exclude it or clearly identify the uncertainty. Do not reproduce protected book content without authorization. Use original explanation and synthesis.

---

## 12. PODCAST REQUIREMENTS

Every episode must have: title, series title, episode number, description, learning objective, primary mental model, supporting mental models, supporting books, authors, credible source references, key takeaways, practical examples, duration, speaker format, transcript.

The mental model must be visible in the podcast description and episode details.

### Natural Voices

Support natural voice synthesis. The podcast must sound engaging and professional. Avoid robotic pacing. Provide consistent speaker identity, audio volume, and pronunciation.

- **Single Speaker:** One knowledgeable teacher presents the learning experience.
- **Two Speakers:** Two speakers discuss the topic. Each speaker should have a meaningful role. They should ask questions, challenge ideas, explain models, and discuss practical situations. Avoid pointless scripted conversation.
- **Mixed Format:** Allow different episodes to use different formats.

### Long Podcasts

Support episodes up to 60 minutes. Use script chunking, audio segment generation, and FFmpeg assembly where necessary. Preserve speaker consistency between segments. Measure actual audio length. Do not falsely claim that a 35-minute recording is a 60-minute episode.

---

## 13. AI COACHING — COACH ME

Every podcast must provide a Coach Me option. Coaching extends the learning experience. Users should be able to ask additional questions through text or speech.

The AI coach must understand: the original user question, the podcast content, the mental models, the cited books and sources, the examples, the transcript, previous coaching conversations.

### Coaching Functions

The coach should: explain unclear concepts, provide different examples, help recognize when a model applies, walk through practical applications, challenge assumptions respectfully, ask helpful follow-up questions, reinforce learning, connect related models, help evaluate real-world situations. Coaching should support independent reasoning, not replace it.

### Voice Coaching

Allow users to speak questions and optionally listen to spoken responses.

### Saved Coaching

Store conversations privately with the relevant podcast. Users should be able to resume coaching later.

### Create More Learning

Provide **Create a Podcast About This**. Use the coaching discussion to generate additional learning. Avoid unnecessary repetition.

---

## 14. MY LIBRARY

Users must have a private personal library. Provide: Continue Listening, My Podcasts, Downloads, Completed, Favorites.

### Library Features

Allow users to: save podcasts, search, sort, filter by topic, filter by mental model, resume playback, download episodes, rate episodes, favorite content, delete library items, share public podcasts, change visibility, continue learning.

Support one-to-five-star ratings. Save listening histories and completion states.

---

## 15. PODCAST PLAYER

Build a polished mobile-first audio player. Required controls: play/pause, skip forward 15 seconds, skip backward 15 seconds, seek, playback speed, duration, remaining time, progress tracking, next episode, download, save, favorite, rate, share, Coach Me.

Display the primary mental model prominently. Allow users to review related books, sources, and key takeaways.

### Playback Preservation

Automatically save playback position. Capture progress during playback, pause, seeking, switching episodes, and app backgrounding when possible.

Use three status categories: Not Started, In Progress, Completed. Default automatic completion threshold: 95%. Allow manual completion changes.

---

## 16. OFFLINE LISTENING

Downloaded podcasts must work without an internet connection.

### Offline Capabilities

Users should be able to: open the installed app, browse downloaded content, play downloaded audio, pause and resume, seek, change speed, track progress, mark episodes complete, save favorites and ratings locally.

### Technical Requirements

Use: service workers, IndexedDB, appropriate browser media storage, offline application shell, persistent local playback data, synchronization queues. Verify downloaded audio before marking it available offline. Handle device storage limits and eviction gracefully.

### Reconnection Synchronization

When connectivity returns, synchronize: listening progress, completion status, favorites, ratings, library changes. Use durable identifiers and conflict-resolution rules. Preserve intentional rewinds. Prevent old device data from incorrectly overwriting newer user actions.

### iPhone Requirements

Test installed iPhone PWAs. Do not assume background synchronization works while the PWA is closed. Synchronize on reopening, foreground activation, and restored connectivity. Offline storage is subject to operating-system limits and possible eviction; communicate these limitations appropriately.

---

## 17. PUBLIC PODCAST DISCOVERY

Build a Discover tab. Users should search public podcasts by: topic, question, problem, mental model, author, book, title. Use semantic search when appropriate.

### Public and Private Content

Default: Private. Users may explicitly make podcasts public. Provide shareable links to public podcasts. Private podcasts and coaching sessions must never be exposed to unauthorized users.

### Intelligent Reuse

Before creating a new series, identify relevant public podcasts already available. Recommend strong matches. Allow the user to create a personalized version. Do not use private podcasts as public search results.

---

## 18. CONTINUED LEARNING

Provide an option: **Continue Learning**. Support:

- **Explore New Models** — Introduce additional relevant mental models.
- **Go Deeper** — Expand understanding of existing models.
- **Reinforce Learning** — Use different books, examples, and scenarios to reinforce familiar models.

Track the user's previously covered models. Avoid repeating the same model without a clear reason. Allow deliberate reinforcement when requested.

### Topic Updates

Allow users to request updated learning when newer information exists. Generate supplemental podcasts using verified new information. Preserve original content unless the user explicitly deletes or replaces it.

---

## 19. ACCOUNTS AND BIOMETRIC LOGIN

Provide secure account registration and login. Support: email registration, email verification, secure passwords, password reset, passkeys where available, secure sessions, account deletion, data export.

### Face ID and Touch ID

Allow biometric-assisted authentication through supported passkey or device-authentication mechanisms. Do not directly collect or store facial or fingerprint data. Use secure fallback authentication where needed. Require strong authentication for administrative access.

---

## 20. ADMINISTRATOR DASHBOARD

Administrators must be able to manage system behavior without editing application source code.

### Configuration

Manage: podcast defaults, AI models, research instructions, source validation, mental model selection, scriptwriting instructions, audio models, speech models, image and video models, quality validation, coaching prompts, media limits, resource limits.

### AI Model Management

Separate model interfaces for: language generation, research, mental model extraction, image understanding, video processing, speech recognition, speech synthesis, embeddings, quality validation, coaching. Support model replacement without rewriting the application.

### Analytics

Monitor: total users, active users, generation requests, completed podcasts, failed generations, processing times, audio storage, bandwidth, database usage, model performance, estimated operating costs.

### Administration Security

Use role-based permissions. Require MFA for administrators. Maintain audit logs for important changes.

---

## 21. BUG REPORTING

Provide a simple Report a Bug option within the app.

### User Workflow

1. Open Report a Bug.
2. Describe the issue.
3. Optionally attach a screenshot.
4. Submit.

Automatically capture appropriate privacy-safe diagnostics: app version, device type, browser, operating system, time, relevant error identifiers. Do not automatically capture passwords, tokens, private podcast content, or other sensitive details.

### Administrator Controls

The administrator must be able to configure the destination email address without code changes. Create a bug-management dashboard. Support: searching reports, viewing details, tracking status, reviewing recurring problems, email notifications.

Statuses: New, In Progress, Resolved, Closed.

Use a suitable free email delivery option where feasible. Track failed notifications and avoid spam or abuse. Do not silently claim email delivery succeeded if it failed.

---

## 22. SECURITY — MANDATORY ENTERPRISE-GRADE PRACTICES

Security must be designed into ThinkMade from the beginning. Treat AI-generated code as untrusted until verified. Target OWASP ASVS Level 2 and relevant API and AI security practices.

### Core Controls

Implement: strong authentication, secure password hashing, MFA for administrators, secure session management, server-side authorization, least-privilege permissions, HTTPS, appropriate encryption at rest, input validation, safe output handling, injection prevention, XSS protection, CSRF protection where applicable, secure upload validation, rate limiting, abuse protection, secure database queries, secure secret storage, dependency scanning, audit logging, monitoring and alerting.

### AI Security

Defend against: prompt injection, unsafe model output, unauthorized tool execution, malicious uploaded files, data leakage, exposure of system instructions, excessive AI resource consumption. Never allow uploaded content or external sources to override privileged instructions or security controls.

### Automated Security Testing

Include: static analysis, dependency scanning, secrets scanning, API authorization testing, file-upload testing, dynamic vulnerability testing, container scanning where applicable.

### Independent Assessment

Before public launch, obtain an independent security review and appropriate penetration testing. Provide a documented assessment covering: controls, tests, findings, remediation, outstanding risks, release recommendation.

Do not launch publicly with known unresolved critical or high-severity vulnerabilities. Never claim the app is impossible to hack. Maintain security after launch through updates, monitoring, and reassessment.

---

## 23. FREE-TO-LAUNCH ARCHITECTURE

The app must be free for users at launch. Do not implement subscriptions, payments, or paid feature restrictions initially. Future monetization may be considered later.

### Development Strategy

Prefer: free development tools, free hosting tiers where permitted, open-source software, free and appropriately licensed AI models, self-hosted inference where practical, free database allowances, cost-effective storage, replaceable service integrations.

Do not introduce paid APIs without explicit approval.

### Important Cost Requirements

Understand that free models still require computing resources. Hour-long, two-speaker podcast generation and video processing can be expensive.

Design around: efficient inference, audio reuse, podcast caching, source reuse, duplicate detection, durable generation queues, processing limits, storage limits, abuse prevention, infrastructure monitoring.

Implement alerts before usage exceeds configured allowances. Do not silently upgrade infrastructure or activate billable services. Clearly document where free-tier limits may affect performance. Zero recurring cost is the starting target, not an unsupported guarantee.

---

## 24. VERCEL DEPLOYMENT

The intended application address is: https://thinkmade.zicaworld.com

Host the frontend on Vercel. Use the existing zicaworld.com domain with a dedicated thinkmade subdomain.

### Requirements

Vercel-compatible frontend, custom domain support, HTTPS, secure environment variables, Git-based deployments, preview deployments, production deployment, clear setup instructions, no disruption to existing zicaworld.com websites.

### DNS

Do not assume access to DNS settings. Provide the exact DNS record required by the Vercel project configuration. Do not replace unrelated DNS records.

### Backend Processing

Podcast generation must run through durable background jobs. Do not depend on a single Vercel serverless request for long-running operations. Use a separate worker or compatible processing environment for: research, script generation, speech synthesis, audio assembly, image processing, video processing. The frontend should submit jobs and display progress.

### Hosting Cost Validation

Verify current Vercel plan terms and usage limits before deployment. Do not assume every type of production or commercial usage is allowed on the free tier. Document any constraints and recommend compliant options.

---

## 25. TECHNICAL ARCHITECTURE

Suggested technology stack:

| Component | Technology |
|---|---|
| Frontend | React + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| PWA | Service Worker + Web Manifest |
| Offline Database | IndexedDB |
| Backend | Python + FastAPI or suitable TypeScript alternative |
| Database | PostgreSQL |
| Semantic Search | pgvector |
| Background Processing | Durable Job Queue |
| AI Integration | Provider-independent adapters |
| Local AI Evaluation | Ollama or llama.cpp |
| Audio Processing | FFmpeg |
| Media Storage | S3-compatible storage |
| Frontend Hosting | Vercel |
| Worker Hosting | Separate compatible processing environment |

Choose the implementation that best balances simplicity, maintainability, security, quality, and operating cost. Avoid unnecessary microservices. Use database migrations, logging, automated tests, and securely managed configuration.

---

## 26. DATABASE REQUIREMENTS

Include appropriate models for: users, user preferences, learning objectives, podcast series, episodes, mental models, model relationships, books, authors, sources, transcripts, audio files, photos and videos, generation jobs, playback history, completion status, favorites, ratings, library items, coaching history, public/private permissions, offline synchronization, learning history, quality evaluations, bug reports, administrator configurations, AI model settings, prompt versions, audit logs.

Track the relationships between questions, models, sources, episodes, coaching, and continued learning. Protect private information with server-side ownership and authorization rules.

---

## 27. DEVELOPMENT PHASES

Build in the following sequence.

- **Phase 1 — Foundation:** Inspect repository. Establish project structure. Configure development environment. Build design system. Create logo and brand assets. Create mobile navigation. Implement accounts. Implement database. Establish administrator settings. Prepare Vercel deployment.
- **Phase 2 — Core Podcast Generation:** Text input. Voice input. Research. Mental model selection. Episode planning. Script generation. Speech synthesis. Audio assembly. Background jobs.
- **Phase 3 — Thinking, Seeing, Doing:** Structured learning outcomes. Recognition examples. Practical application. Case studies. Source checking. Script evaluation. Natural learning progression.
- **Phase 4 — Photo and Video:** Camera capture. Media upload. Video transcription. Visual understanding. Combined context processing. Privacy controls.
- **Phase 5 — Library and Player:** Audio playback. Podcast metadata. Progress tracking. Downloads. Favorites. Ratings. Completion status.
- **Phase 6 — Offline PWA:** Installation. Offline library. Downloaded audio playback. Local progress storage. Synchronization. Real-device testing.
- **Phase 7 — AI Coaching:** Coach Me. Text questions. Spoken questions. Spoken responses. Context-aware coaching. History preservation. Create podcast from coaching.
- **Phase 8 — Discovery and Continued Learning:** Public search. Semantic recommendations. Sharing. Duplicate detection. Explore new models. Deepen. Reinforce. Updated learning.
- **Phase 9 — Administration and Reporting:** AI controls. Default settings. Usage dashboards. Bug reporting. Email notifications. Moderation. Administrative audit logs.
- **Phase 10 — Final Validation:** Functional testing. Security testing. Independent security assessment. Mobile performance testing. Offline testing. Accessibility testing. Deployment verification. Documentation.

Security testing should occur during every phase rather than waiting until the end.

---

## 28. MANDATORY ACCEPTANCE TESTS

Claude Code must verify the following:

1. The app clearly displays ThinkMade, its tagline, and purpose.
2. The logo works at phone icon sizes.
3. The mobile interface feels like a native app.
4. Users can install the PWA.
5. Users can create podcasts using only a topic and Create.
6. Administrator defaults work.
7. Voice topic input works.
8. Photo topic input works.
9. Video topic input works.
10. Optional customization works.
11. Real playable podcast audio is generated.
12. Generation supports the intended maximum duration.
13. Primary mental models are clearly identified.
14. Every episode teaches Thinking.
15. Every episode teaches Seeing.
16. Every episode teaches Doing.
17. These outcomes flow naturally.
18. Sources are verified or appropriately qualified.
19. Podcasts save to the user's library.
20. Downloaded episodes play offline.
21. Playback position is preserved.
22. Offline updates synchronize safely.
23. Completion status is tracked.
24. Ratings and favorites work.
25. Coach Me answers contextually.
26. Coaching history is preserved privately.
27. More podcasts can be created from coaching.
28. Public search works.
29. Private content remains protected.
30. Podcast sharing works.
31. Existing relevant podcasts are suggested.
32. Repeated models are avoided unless reinforcement is selected.
33. Bug reports are saved.
34. Administrator email configuration works.
35. Administrative settings are secured.
36. Authentication and authorization pass security tests.
37. Media uploads are protected.
38. Vercel deployment configuration works.
39. The intended custom domain is documented.
40. Free-tier usage limitations are documented.
41. Failed operations produce honest error states.
42. No unfinished feature is represented as completed.

---

## 29. CLAUDE CODE OPERATING INSTRUCTIONS

You are acting as the software architect, full-stack engineer, AI integration engineer, UX designer, security engineer, and testing engineer for ThinkMade. Your assignment is to build the actual application according to this specification.

### Development Rules

1. Inspect the repository before making changes.
2. Do not overwrite working functionality unnecessarily.
3. Establish a clear implementation plan.
4. Maintain a progress checklist.
5. Build the mobile experience first.
6. Create distinctive ThinkMade branding.
7. Preserve the simple creation path.
8. Implement administrator defaults.
9. Build functioning features, not decorative prototypes.
10. Implement actual podcast generation.
11. Verify every episode's Thinking, Seeing, and Doing outcomes.
12. Implement real voice, photo, and video processing.
13. Implement contextual coaching.
14. Implement actual offline audio playback.
15. Implement reliable synchronization.
16. Implement public search and secure sharing.
17. Implement bug reporting.
18. Maintain strong security.
19. Prefer free and open-source solutions.
20. Do not introduce paid dependencies without approval.
21. Design for Vercel and the intended domain.
22. Automate testing.
23. Document incomplete requirements.
24. Do not fabricate successful tests.
25. Never claim deployment success without verification.
26. Do not treat AI-generated code as inherently safe.
27. Prioritize maintainability.
28. Avoid unnecessary complexity.
29. Identify infrastructure constraints honestly.
30. Request approval before consequential paid or security-sensitive changes.

### Completion Reporting

At the end of each development phase, provide: features completed, tests performed, features not yet completed, known issues, security considerations, infrastructure dependencies, recommended next steps. Do not present an incomplete implementation as production ready.

---

## 30. FINAL PRODUCT SUCCESS CRITERIA

ThinkMade — Better Thinking. Made Personal.

ThinkMade transforms the world's best books and mental models into personalized podcasts that teach you how to think through whatever you're trying to learn or solve.

A person should be able to open ThinkMade on their phone, type or speak a question, take a photograph, or record a short video, and initiate podcast creation with minimal effort. The system should handle the research, knowledge connections, mental model selection, episode planning, scriptwriting, and audio generation.

Every podcast must help users: THINK (understand the mental model), SEE (recognize when the thinking is useful), DO (understand how to apply it).

The experience should be engaging, practical, and conversational. Users must be able to listen offline, resume their podcasts, ask their AI coach questions, continue learning, and explore publicly shared content. Administrators must be able to refine the AI, change defaults, manage bug reports, and monitor system performance without changing application code.

ThinkMade must be secure, maintainable, scalable, and free for users at launch.

Production Domain: https://thinkmade.zicaworld.com

### THE ULTIMATE PRODUCT TEST

A person should finish a ThinkMade podcast and say: "I understand how to think about this. I know when that thinking can help me. And I know how to put it into practice."

The measure of success is not the number of podcasts generated. The measure of success is whether ThinkMade changes how people think, recognize opportunities, and take action.

---

## 31. BEGIN DEVELOPMENT

Begin by inspecting the existing repository. Then:

1. Validate the proposed architecture against Vercel's current hosting constraints.
2. Verify which recommended free AI models can realistically deliver the required quality.
3. Identify any unavoidable operating costs or licensing restrictions.
4. Establish the application architecture.
5. Create the complete implementation roadmap.
6. Begin Phase 1.
7. Progress through subsequent phases systematically.
8. Verify functionality before reporting completion.
9. Keep the project buildable and testable throughout development.
10. Do not require repeated approval for ordinary engineering decisions within the approved free-cost and security constraints.

Before public launch, verify functional completeness, security readiness, infrastructure suitability, and mobile usability. Do not stop at a prototype or visual demonstration. Build a working, deployable application.

The final result should be a premium, mobile-first learning companion that makes better thinking personal, accessible, and practical.
