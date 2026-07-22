# VAM OS Staging Baseline Bootstrap Plan

Date: 2026-07-22
Decision: **PRODUCTION READ-ONLY SCHEMA INVENTORY REQUIRED**

## Current State

Confirmed staging is `vam-os-staging` / `ljfneyuvpxrmejpxsmpz`. The failed preflight proves `public.applications` was absent at execution time. Backups are not listed, traffic is low, and overall schema completeness is unknown.

## Missing Core Schema

The baseline probe must inventory programs, seasons, batches, people, profiles, applications, matches, events, registrations, admin scope and audit/log tables. No absence beyond applications is asserted without probe output.

## Authoritative Schema Source

Repository migrations start at 012. Numbers 001-011 are absent; 037, 039, 042, 044, 045 and 046 are also absent as numeric files (lettered 044a/044b, 045a, 046a exist). Core tables such as seasons, people, profiles, matches and events are assumed by migration 012-018 rather than created. Migration 059 bootstraps only application workflow for a particular staging gap. There is no canonical complete schema dump. Production cannot be reconstructed deterministically from repository alone.

| Object | Created by repository migration | Assumed pre-existing | Source of truth | Reconstructible |
|---|---|---:|---|---:|
| programs/intake_batches | 036 | No | 036 plus later alignments | Partial |
| seasons | No | Yes | Production metadata needed | No |
| people/profiles | No | Yes | Production metadata needed | No |
| applications | 059 only as gap bootstrap; earlier migrations alter it | Yes historically | Production metadata + reviewed migrations | Not reliably |
| matches/events | No | Yes | Production metadata needed | No |
| event_registrations | 051 | Events pre-exist | 051 plus production alignment | Partial |
| admin_users/scope | 017/020/026 | Auth dependencies pre-exist | Repository plus metadata | Partial |
| audit/log tables | 015/024/026/052 | Mixed | Repository plus metadata | Partial |
| RLS/functions/grants | Incremental | Existing policies assumed | Production catalog | No |

## Recommended Bootstrap Strategy

Use **schema-only clone derived from separately authorized production metadata/schema export**, reviewed and versioned before import. Do not copy business rows or auth identities.

| Strategy | Completeness | PII risk | Reproducibility | Cost | Recommendation |
|---|---|---|---|---|---|
| Fresh from complete history | Low: history incomplete | Low | Low today | Medium | Do not use |
| Schema-only production clone | High | Low if truly schema-only | High once versioned | Medium | Recommended |
| Full clone then sanitize | High | Critical | Medium | High | Do not recommend |
| Purpose-built baseline SQL | Medium/high after review | Low | High | High | Fallback derived from authoritative metadata |
| Supabase branch/restore | Unknown until plan capability confirmed | Depends on controls | Potentially high | Unknown | Owner/platform assessment only |

## PII Controls

Schema metadata only. No production names, emails, phones, tokens, answers, storage objects or business rows. Sanitized fixtures require a separate review and authorization.

## Schema-only Export/Import

Design export to include schemas, extensions, types, tables, sequences, constraints, indexes, functions, triggers, RLS, policies and grants. Review output for ownership/environment coupling. Import commands remain unauthorized until staging disposability and backup decisions are recorded.

## Auth User Handling

Do not clone `auth.users`. Create staging-only identities after schema bootstrap under a separate approved process.

## Test Account Handling

Inventory whether unique staging test accounts exist. Export only a safe account manifest if approved; never copy passwords or tokens.

## Storage Handling

Do not clone production objects/buckets. Recreate bucket definitions separately only when application tests require them.

## RLS Verification

Compare catalog definitions, then test anonymous denial, viewer/reviewer restrictions, Super Admin access and UEH/HAM isolation with staging-only fixtures.

## Rollback/Recreate Strategy

Prefer recreating a disposable staging project from the versioned schema package. No reset is allowed until the owner answers the disposability checklist and preserves any approved unique artifacts.

## Staging Disposability Checklist

- Does staging contain unique manual data?
- Is any preview deployment dependent on it?
- Are test accounts stored only there?
- Can it be recreated?
- Is there confidential data?
- Is reset safe after an approved metadata/account export?
- Who approves deletion/recreation, and what restore point exists?

## Preflight

Confirm project ref, billing/branch capabilities, backup, extensions, empty/owned schemas, auth/storage dependencies, preview environment mapping and approved maintenance window.

## Execution Commands - NOT AUTHORIZED

No executable import/reset command is supplied. First produce and review a schema-only artifact. Later commands must name the confirmed staging ref and require explicit owner authorization; never include production passwords or connection strings.

## Post-bootstrap Verification

Run baseline probe, compare exact schema, run RLS negatives, validate legacy routes, verify no production business rows, run tests/build, then re-evaluate migration 061 preconditions.

## Migration 061 Prerequisites

Applications/programs/seasons/intake_batches/admin_users/admin_scope_access must exist with compatible types; 061 target objects must be absent; migration history understood; staging baseline validated.

## Owner Authorizations Required

1. `AUTHORIZE READ-ONLY PRODUCTION SCHEMA INVENTORY` for metadata-only production inspection.
2. Separate approval for schema-only export design.
3. Separate approval to recreate/reset staging.
4. Separate approval to import an reviewed baseline.
5. New explicit authorization before migration 061. None is granted here.

## Offline baseline-gaps update

The authorized metadata run resolved enum order, three view bodies/dependencies, function/trigger provenance, comments, and absence of standalone public sequences. It did not supply missing pre-012 `CREATE TABLE` DDL or approve security behavior. The recommended schema-only/design-first strategy is unchanged. Do not clone platform schemas or generate sequence DDL from the 441 broadly collected dependency rows. Bootstrap remains **NOT AUTHORIZED**.
