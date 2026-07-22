# VAM OS Public Sequence Remediation — 2026-07-22

The captured inventory contains no public `nextval(...)` column defaults and no public sequence grants. That is not proof that no public sequences exist because sequence catalog rows and ownership parameters were outside the probe.

| Sequence | Owner | Type/start/increment/min/max/cache/cycle | Owned by | Dependent defaults | Repository source | Status |
|---|---|---|---|---|---|---|
| Public sequence set | UNKNOWN | UNKNOWN | UNKNOWN | No `nextval` default observed | No explicit public sequence DDL found | UNKNOWN |

The read-only sequence probe is required. No sequence DDL or ownership statement may be reconstructed from absence alone.
