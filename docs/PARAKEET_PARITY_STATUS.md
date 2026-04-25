# Parakeet-Style Feature Parity Status (Legitimate/Disclosed Variant)

This file tracks requested parity in MeetingMind without deceptive or covert behavior.

## Implemented in This Workspace

- Real-time support workflow (scripted replay runtime)
- Question detection and type classification
- Grounded answer cards with confidence and evidence snippets
- Resume/document upload grounding in local knowledge base
- Coding support mode (explicit user-triggered prompt analysis)
- Screen capture and OCR integration hook (native command + browser fallback path)
- Meeting candidate auto-detection utility (platform signature matching)
- Live capture beta orchestration for mic/system streams (browser API dependent)
- Session controls: start, pause, resume, stop
- Post-call summary, actions, follow-up draft, CRM notes
- Exports: JSON, Markdown, CSV
- Runtime reliability: retries, timeout fallback, throttling, error boundary
- Runtime config validation and health surface
- Consent gate and disclosure templates
- Share Guard privacy workflow for second-screen/window-only/tab-only/mobile-companion setups
- Dedicated companion display surface for private second-screen/device use
- Local audit event logging
- SQLite-backed transcript and audit-event command bridge with browser fallbacks
- Data retention and reset controls
- CI quality gates for lint/test/build
- Native Tauri command scaffolding for audio pipeline, screen capture, and OCR
- Zoom/Google Meet connector adapter contracts with health reporting

## Simulated or Browser-Mode Only

- Scripted transcript replay remains the deterministic demo baseline
- Meeting auto-detect runs as utility simulation from active window title input
- Browser OCR path depends on display capture permission and bridge fallback

## Pending for Full Native Desktop Production

- OS-level native audio engine wiring behind Rust command scaffolding
- True native OCR backend wiring behind Rust command scaffolding
- Native desktop E2E validation beyond compile/build checks
- Zoom/Meet API-authenticated connector implementations behind adapter contracts
- Automatic OS-level detection of active screen-share state across Zoom/Meet/Teams

## Safety Constraints

- No hidden-process behavior
- No undetectable/proctoring-bypass features
- No deceptive exam-cheating functionality
- Product posture remains disclosed and legitimate
