-- Migration 056: Event Phase 2B — optional meal / lunch payment add-on
-- All changes are idempotent (ADD COLUMN IF NOT EXISTS).
-- Run in Supabase SQL editor (service role) before deploying app code that
-- reads these columns.

-- ── events table — meal configuration ────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS meal_option_enabled         boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meal_label                  text,
  ADD COLUMN IF NOT EXISTS meal_fee_amount             numeric(10,2),
  ADD COLUMN IF NOT EXISTS meal_fee_currency           text          NOT NULL DEFAULT 'VND',
  ADD COLUMN IF NOT EXISTS meal_payment_instruction    text,
  ADD COLUMN IF NOT EXISTS meal_payment_proof_required boolean       NOT NULL DEFAULT true;

-- ── event_registrations table — per-registration meal selection ───────────────
-- meal_fee_amount / meal_fee_currency are denormalized from event config at
-- registration time so the record is self-contained regardless of later edits.
ALTER TABLE event_registrations
  ADD COLUMN IF NOT EXISTS meal_selected      boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meal_label         text,
  ADD COLUMN IF NOT EXISTS meal_fee_amount    numeric(10,2),
  ADD COLUMN IF NOT EXISTS meal_fee_currency  text;

-- Reload PostgREST schema cache so new columns are immediately accessible
NOTIFY pgrst, 'reload schema';
