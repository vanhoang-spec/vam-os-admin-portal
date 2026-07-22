# Migration 061 Production Comparison

Date: 2026-07-22
Classification vocabulary: MATCH, EQUIVALENT, MISSING, CONFLICT, UNKNOWN.

| Object | Production evidence | Classification | Notes |
|---|---|---|---|
| public.recruitment_campaigns | No table/relation found | MISSING | Expected target object is absent |
| applications.recruitment_campaign_id | No column found | MISSING | No historical linkage exists |
| applications.application_reference | No column found | MISSING | Reference contract absent |
| applications.consent_version | No column found | MISSING | Consent-version evidence absent |
| applications.consented_at | No column found | MISSING | Timestamp evidence absent |
| recruitment_campaigns_public_slug_uniq | No index found | MISSING | No equivalent campaign table exists |
| recruitment_campaigns_scope_idx | No index found | MISSING | No equivalent |
| applications_campaign_email_role_uniq | No index/expression found | MISSING | Campaign duplicate race guard absent |
| applications_reference_uniq | No index found | MISSING | No reference uniqueness |
| applications_campaign_status_idx | No index found | MISSING | No campaign/status access path |
| validate_recruitment_campaign_scope | No function found | MISSING | No equivalent identified |
| validate_application_campaign_scope | No function found | MISSING | No equivalent identified |
| recruitment_campaigns_scope_guard | No trigger found | MISSING | Scope immutability absent |
| applications_campaign_scope_guard | No trigger found | MISSING | Campaign governance absent |
| Campaign RLS | Table absent | MISSING | Cannot be enabled on absent object |
| Scoped campaign read policy | No policy found | MISSING | No campaign policy |
| Campaign table grants | Table absent | MISSING | No grants |
| Applications direct privileges | anon/authenticated have all seven table privileges | CONFLICT | Final 061 design revokes anon and authenticated mutations |
| Applications RLS | Disabled | CONFLICT | Existing application policy does not enforce while RLS is disabled |
| Campaign FKs/checks/time/archive rules | Table absent | MISSING | None can be validated |
| Trigger function search_path/ACL | Functions absent | MISSING | No definitions/grants |

## Overall classification

**CONFLICT** for the full post-061 security contract, with all campaign-domain objects **MISSING**. Production appears pre-061, but absence does not authorize execution. Existing production objects must not be overwritten. Staging still lacks its baseline, and migration 061 remains unauthorized.
