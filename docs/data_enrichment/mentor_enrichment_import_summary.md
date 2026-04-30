# Mentor Enrichment Import Summary

Generated from `docs/data_enrichment/mentor_enrichment_full_review.csv`.

No Supabase data was updated by this generation step. No UI was modified.

## Counts

| metric | count |
| --- | --- |
| high-confidence rows in review CSV | 216 |
| eligible rows with proposed industry and function | 135 |
| high-confidence rows skipped because industry/function was blank | 81 |
| maximum rows that can be affected if every target field is blank | 135 |
| actual rows affected | computed by SQL dry-run in Supabase before COMMIT |

## QA Checks

| check | result |
| --- | --- |
| no null primary_function in eligible rows | PASS |
| no null primary_industry in eligible rows | PASS |
| script does not overwrite existing DB values | PASS - SQL only updates blank target fields |
| production write confirmation required | PASS - generated SQL rolls back by default |

## Proposed Primary Industry Counts

| primary_industry | count |
| --- | --- |
| Marketing & Communications | 22 |
| Insurance | 21 |
| Consulting | 15 |
| Venture Capital & Startups | 13 |
| Finance | 9 |
| Consumer Goods | 8 |
| Banking | 6 |
| Healthcare | 6 |
| Real Estate | 6 |
| Education | 5 |
| Technology | 5 |
| Financial Services | 4 |
| E-commerce / Digital Commerce | 3 |
| Apparel / Retail | 2 |
| Logistics & Supply Chain | 2 |
| Manufacturing | 2 |
| Retail | 2 |
| Advertising / Marketing Tech | 1 |
| Energy | 1 |
| Hospitality | 1 |
| Nonprofit & Social Impact | 1 |

## Proposed Primary Function Counts

| primary_function | count |
| --- | --- |
| Leadership | 42 |
| Entrepreneurship | 23 |
| Marketing | 21 |
| Operations | 15 |
| Finance | 9 |
| Human Resources | 6 |
| Sales | 6 |
| Business Development | 5 |
| Consulting | 5 |
| Accounting | 2 |
| Teaching & Training | 1 |

## Dry-Run Preview

See `docs/data_enrichment/mentor_enrichment_dry_run_preview_10.csv` for 10 generated candidate rows.

Run the dry-run SELECT section in `docs/data_enrichment/mentor_enrichment_update.sql` in Supabase SQL Editor to see real current DB values and actual affected rows before any write.
