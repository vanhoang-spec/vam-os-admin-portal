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
    expect(sql).toContain("create unique index applications_campaign_email_role_uniq");
    expect(sql).toContain("recruitment_campaign_id, role_applied, lower(btrim(email_primary))");
  });

  it("does not grant anonymous table select or insert", () => {
    expect(sql).toContain("no anonymous application policy");
    expect(sql).toContain("revoke all on table public.applications from anon");
    expect(sql).not.toMatch(/create policy[\s\S]{0,160}to anon/);
  });

  it("uses restrictive historical linkage and validates application scope", () => {
    expect(sql).toContain("references public.recruitment_campaigns(id) on delete restrict");
    expect(sql).toContain("validate_application_campaign_scope");
  });

  it("fails closed on existing target objects instead of silently accepting schema drift", () => {
    expect(sql).toContain("object_conflict");
    expect(sql).not.toContain("create table if not exists public.recruitment_campaigns");
    expect(sql).not.toContain("add column if not exists recruitment_campaign_id");
  });

  it("canonicalizes duplicate email whitespace and ignores blank email", () => {
    expect(sql).toContain("lower(btrim(email_primary))");
    expect(sql).toContain("nullif(btrim(email_primary), '') is not null");
  });

  it("requires canonical email, opaque reference and consent evidence for campaign submissions", () => {
    expect(sql).toContain("campaign_application_governance_invalid");
    expect(sql).toContain("new.application_reference !~ '^vam-[a-z0-9]{10,12}$'");
    expect(sql).toContain("new.consented_at is null");
    expect(sql).toContain("role_applied, email_primary, application_reference, consent_version, consented_at");
  });

  it("locks campaign scope after an application exists", () => {
    expect(sql).toContain("campaign_scope_locked");
    expect(sql).toContain("a.recruitment_campaign_id = old.id");
  });

  it("uses restricted trigger functions and a safe search path", () => {
    expect(sql.match(/set search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(sql).toContain("revoke all on function public.validate_recruitment_campaign_scope()");
    expect(sql).not.toContain("security definer");
  });

  it("scopes authenticated reads and provides no campaign mutation policy", () => {
    expect(sql).toContain("recruitment_campaigns_scoped_admin_read");
    expect(sql).toContain("admin_scope_access");
    expect(sql).toContain("revoke insert, update, delete");
    expect(sql).not.toMatch(/create policy[\s\S]+?for (insert|update|delete)/);
  });

  it("provides a rollback that refuses to erase campaign-backed history", () => {
    expect(rollback).toContain("rollback_blocked");
    expect(rollback).toContain("recruitment_campaign_id is not null");
  });
});
