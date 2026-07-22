import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase_migrations/061_design_only_recruitment_campaigns.sql", "utf8").toLowerCase();
const rollback = readFileSync("docs/audits/sql/VAM_OS_BATCH_5B1_RECRUITMENT_CAMPAIGN_ROLLBACK.sql", "utf8").toLowerCase();

describe("recruitment campaign migration design contract", () => {
  it("is explicitly marked design-only and contains no seed/backfill writes", () => {
    expect(sql).toContain("design only — not applied");
    expect(sql).not.toMatch(/insert\s+into\s+public\.(programs|seasons|intake_batches|recruitment_campaigns)/);
    expect(sql).not.toMatch(/update\s+public\.applications/);
  });

  it("enforces program-season-batch consistency in the database", () => {
    expect(sql).toContain("validate_recruitment_campaign_scope");
    expect(sql).toContain("season does not belong to program");
    expect(sql).toContain("intake batch does not belong to season");
  });

  it("adds the race-safe campaign email-role unique index", () => {
    expect(sql).toContain("create unique index if not exists applications_campaign_email_role_uniq");
    expect(sql).toContain("recruitment_campaign_id, role_applied, lower(email_primary)");
  });

  it("does not grant anonymous table select or insert", () => {
    expect(sql).toContain("no anon select/insert policy");
    expect(sql).not.toMatch(/create policy[\s\S]{0,160}to anon/);
  });

  it("uses restrictive historical linkage and validates application scope", () => {
    expect(sql).toContain("references public.recruitment_campaigns(id) on delete restrict");
    expect(sql).toContain("validate_application_campaign_scope");
  });

  it("provides a rollback that refuses to erase campaign-backed history", () => {
    expect(rollback).toContain("rollback_blocked");
    expect(rollback).toContain("recruitment_campaign_id is not null");
  });
});
