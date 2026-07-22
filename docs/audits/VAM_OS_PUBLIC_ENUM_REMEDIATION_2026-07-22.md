# VAM OS Public Enum Remediation — 2026-07-22

Design review only. No database query or mutation was performed.

The production inventory exposes enum type names through column metadata but does not contain `pg_enum` labels or `enumsortorder`. Repository values are evidence of application expectations, not proof of the production definition.

| Enum | Referenced by | Labels known | Label order known | Source | Status |
|---|---|---|---|---|---|
| `role_type` | `applications.role_applied`, `person_roles.role` | Repository candidate values exist | No | migration 059 and generated types | PARTIAL |
| `application_status` | `applications.final_status` | Repository candidate values exist | No | migration 059 and generated types | PARTIAL |
| `communication_channel` | `communications.channel` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |
| `communication_status` | `communications.status` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |
| `event_type` | `events.event_type` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |
| `match_type` | `matches.match_type` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |
| `match_status` | `matches.status` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |
| `gender_type` | `people.gender` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |
| `role_status` | `person_roles.status` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |
| `season_status` | `seasons.status` | Only usage/check evidence | No | production inventory, code references | UNKNOWN |

`citext` is extension-managed and is not an enum. No labels or ordering above may be emitted into baseline DDL until the owner runs the enum metadata probe and the result is reviewed.

Unresolved required set: all ten enum types. `role_type` and `application_status` have candidate definitions but still require production ordering confirmation; the remaining eight require complete metadata.
