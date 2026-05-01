# VAM OS Roadmap & Execution Plan

## Context
Production core dashboard is now working.
March 2026 closed-month data has been rolled out:
- `season_monthly_kpis` 2026-03 = 271 / 224
- March clean recaps imported = 236
- Dashboard and Operations now load production data
- RPC `match_status` enum issue has been fixed

**Remaining issue:**
- `/admin/users` and `/admin` workflow show Invalid API key
- Likely missing or wrong `SUPABASE_SERVICE_ROLE_KEY` in Vercel production env

---

## PHASE A — Production Stabilization
**Goal:** Stabilize the production environment and ensure all administrative and tracking workflows are functional.
*See [Production Stabilization Checklist](PRODUCTION_STABILIZATION_CHECKLIST.md)*

## PHASE B — Monthly Operations Workflow
**Goal:** Establish a rigorous, predictable monthly rhythm for data collection, quality assurance, and KPI generation.
*See [Monthly Operations SOP](MONTHLY_OPERATIONS_SOP.md)*

## PHASE C — Admin Correction Workflow
**Goal:** Provide clear protocols and tools for administrators to rectify data discrepancies and manage ongoing issues.
*See [Admin Correction Workflow](ADMIN_CORRECTION_WORKFLOW.md)*

## PHASE D — Event & Activity Tracking
**Goal:** Standardize the management of events, training sessions, and participant engagement.
*See [Event & Activity Tracking Blueprint](EVENT_ACTIVITY_TRACKING_BLUEPRINT.md)*

## PHASE E — Season 12 Lifecycle
**Goal:** Design the end-to-end system and process flow for launching, managing, and transitioning into Season 12.
*See [Season 12 Lifecycle Blueprint](SEASON_12_LIFECYCLE_BLUEPRINT.md)*

## PHASE F — Environment Safety System
**Goal:** Implement strict deployment and environmental guardrails to prevent data loss or unauthorized access in production.
*See [Environment Safety Checklist](ENVIRONMENT_SAFETY_CHECKLIST.md)*
