# VNT working rules

- iPhone-first meeting recorder; development host is Windows. Use Expo / React Native with TypeScript.
- Main screen stays simple: one large red button starts/stops recording. After stopping, save audio locally before any network request, transcribe, save transcript, summarize, and optionally email the meeting notes.
- Recipient settings support up to ten addresses. The owner's local default is configured in ignored `.env`; public builds must start with no recipient.
- Never commit API keys, SMTP credentials, authentication sessions, recordings, transcripts, or private meeting notes. AI and SMTP credentials belong on the server only.
- Do not replace real AI responses with mock results. Sample meetings must be clearly labelled.
- Run `npm run typecheck`, `npm test`, and `npm run build:web` after functional changes. Server tests use fake gateways and must not send real email or incur API charges.
- Native microphone / interruption / lock-screen tests require a real iPhone. Do not claim native verification from a web build.
- Public deployment requires HTTPS, individual verified user authentication, account deletion, proper quotas, persistent email delivery metadata, and reviewed privacy/support documentation.
- Do not automatically retry uncertain email delivery. Explicit resend gets a new attempt ID.
- Do not change Square POS Apps Script sources; this repository is independent.
