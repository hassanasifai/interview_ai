# Production Base Checklist (No Users/Billing)

This document defines what is considered production-base in the current local-first scope.

## Included

- Runtime config validation and health checks
- App-level crash boundary to avoid full white-screen failures
- Explicit consent gate before session start
- Share Guard privacy checklist and overlay-content suppression for full-screen sharing plans
- Companion display mode for private second-screen/device workflows
- Local audit event stream for key lifecycle actions
- Session controls with clear status/error surfaces
- Export paths for post-call artifacts (JSON, Markdown, CSV)
- CI quality gates (lint, test, build)
- Deterministic fixtures and regression tests
- SQLite command coverage for session summaries, transcript items, and audit events

## Not Included Yet

- Multi-user auth, teams, billing, subscriptions
- Cloud sync and central telemetry backend
- Native system audio + microphone capture in this browser demo mode
- Enterprise Zoom/Meet direct integrations

## Reliability Standards

- Every commit must pass lint, test, and build
- New runtime settings must be schema-validated
- Session start must enforce consent acknowledgment
- Export actions must emit audit events

## Security and Safety

- Product is designed for disclosed, legitimate meeting assistance
- No hidden-process, anti-detection, or deceptive proctoring bypass features
- Sensitive keys remain local-first and user-provided

## Next Production Milestones

1. Native Rust audio capture pipeline with channel separation
2. Additional integration and E2E desktop tests under Tauri runtime
3. Optional encrypted settings and OS keychain storage for provider keys
