# Phase 9 report: administration and reporting

**Status: complete.** Email sending is tested against Resend's and Brevo's documented APIs with stubbed responses. No real email has been sent, because no key is configured.

## Completed

- **Admin area.** It requires the admin role and two-step verification, checked against the database. That covers both ThinkMade's routes and Better Auth's built-in admin endpoints. Sections:
  - **Overview.** People, generations, build times, held episodes, first-review pass rate, tokens, speech minutes, storage, database size, emails and an estimated cost. Free-tier allowances show progress bars and warn at 80%. Bandwidth is marked as measured by the hosts.
  - **Defaults.** The versioned settings from Phase 1, now including quality thresholds, cost prices and alert limits.
  - **AI models.** Provider and model per stage, including embeddings, with a Test button that makes one tiny request and reports honestly. API keys stay in server environment variables.
  - **Prompts.** Built-in instructions per stage. Drafts can be tested on sample input against the stage's output schema, then activated, rolled back or reset. The worker and the coach use active versions.
  - **Quality.** Held scripts with scores, notes and the full script. Approving resumes the original job and records the audio; rejecting marks the episode failed. Recent episodes can be spot-checked.
  - **Bug reports.** Search, status filter (New, In Progress, Resolved, Closed), screenshots and recurring-problem groups.
  - **People.** Promote or demote admins, and suspend or restore access.
  - **Public content.** Lists everything shared, and can unpublish with a reason.
  - **Audit log.** Every admin change, filterable.
- **Report a Bug.**
  - Diagnostics are allow-listed: app version, user agent, platform, language, viewport, online, installed, path without query, and error identifiers. Anything else is dropped. The user can see exactly what is sent.
  - A screenshot is optional and checked by content.
  - A hidden field catches bots, and reports are rate-limited.
  - The report is emailed to the address set in Defaults. Every email, including authentication emails, is logged in `email_delivery`, failures included. The user is told whether the team was notified.

## Known gaps

The audit log can't yet be exported to CSV, and alerts are shown only in the dashboard; they are not pushed by email.
