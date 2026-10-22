# Validation — 2026-10-21

- iPhone compatibility correction: aligned Expo/native modules to SDK 57, React Native 0.86.3 and React 19.2.3. App Store lists Expo Go 57.0.9; SDK 58 release notes say its store build is pending. Explicitly pin expo-asset and expo-constants to SDK 57 to prevent incompatible peer resolution. Typecheck, all 7 server tests and web export passed again after alignment.
- Version sources: https://apps.apple.com/us/app/expo-go/id982107779 and https://expo.dev/changelog/sdk-58 (checked 2026-10-21).
- Recording review update: the selected recording owns a preloaded audio player; pause/resume retains position and replay seeks to zero. Recording mode is disabled after saving and before playback. Saved copies are checked for nonzero size before source cleanup. Actual iPhone speaker playback still requires device confirmation.
- Browser verified: labelled test-only summary/transcript preview, manual memo save surviving reload/reopen, and return to recording home. Preview text is display-only, separate from persisted transcripts/results and email payloads. Typecheck, all 7 server tests, web export and iOS JS bundle HTTP 200 passed after the update. No real AI/mail calls made.

- Windows: TypeScript typecheck passed.
- Server tests: 7 passed; fake AI and mail gateways only, no paid calls or real email.
- Expo web export passed. Main screen, sample meeting summary, transcript and action item rendering checked in browser.
- Native iPhone microphone / background recording / interruption testing: not yet run.
- Actual OpenAI, SMTP, Supabase and App Store services: not configured or deployed.
- npm audit: 15 high-severity dependency-chain findings in the Expo/Metro development toolchain (braces / node-forge). `npm audit fix` applied available non-breaking updates; npm's proposed force fix downgrades Expo to 44 and was not applied. Review upstream fixes before public release. Server package dependencies should be isolated for deployment.
- Expo template license is preserved in EXPO_TEMPLATE_LICENSE. No publication license for newly authored VNT code has been selected.
