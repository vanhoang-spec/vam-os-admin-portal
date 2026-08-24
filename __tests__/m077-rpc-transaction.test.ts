import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { Client } from "pg";
import fs from "fs";
import path from "path";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

describe("M077 RPC Transactional Regression (UNIT_OR_ISOLATED_DB_CONTRACT_TEST)", () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;
  let pgClient = null as unknown as Client;

  const seasonId = "00000000-0000-0000-0000-000000000001";
  const batchId = "00000000-0000-0000-0000-000000000002";

  beforeAll(async () => {
    pgClient = new Client({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    });
    try {
      await pgClient.connect();
    } catch (e) {
      console.warn("Local DB not available, skipping m077 tests");
      pgClient = null as any;
      return;
    }

    adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Setup minimal authoritative-compatible schema contract without destructive DROP of public schema
    await pgClient.query(`
      DROP TABLE IF EXISTS public.application_answers CASCADE;
      DROP TABLE IF EXISTS public.applications CASCADE;
      
      DO $$ BEGIN
        CREATE TYPE public.role_type AS ENUM ('mentee', 'mentor');
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      CREATE TABLE IF NOT EXISTS public.seasons (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text,
        code text
      );

      CREATE TABLE IF NOT EXISTS public.intake_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id uuid,
        name text,
        code text
      );

      CREATE TABLE IF NOT EXISTS public.applications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id uuid,
        intake_batch_id uuid,
        role_applied public.role_type,
        status text DEFAULT 'submitted',
        source text DEFAULT 'manual',
        full_name text,
        email_primary text,
        phone_primary text,
        gender text,
        consent_data_storage boolean,
        raw_payload jsonb,
        submitted_at date
      );

      CREATE TABLE IF NOT EXISTS public.application_answers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
        question_key text NOT NULL,
        question_label text,
        value_text text,
        created_at timestamptz DEFAULT now()
      );
    `);

    // Insert dummy season UEHM-S12 and batch first so 077 can find it
    await pgClient.query(`
      INSERT INTO public.seasons (id, name, code) VALUES ('${seasonId}', 'Test Season', 'UEHM-S12')
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO public.intake_batches (id, season_id, name, code) VALUES ('${batchId}', '${seasonId}', 'Test Batch', 'TEST-B1')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Load and run the 077 migration
    const m077 = fs.readFileSync(path.join(__dirname, "../supabase_migrations/077_canonical_applicant_identity.sql"), "utf-8");
    await pgClient.query(m077);

    // Reload schema for PostgREST
    await pgClient.query('NOTIFY pgrst, $$reload schema$$');
    await new Promise(r => setTimeout(r, 1000));
  });

  afterAll(async () => {
    if (pgClient) {
      await pgClient.end();
    }
  });

  const generateInput = (suffix: string, role = "mentee") => ({
    p_season_id: seasonId,
    p_intake_batch_id: batchId,
    p_role_applied: role,
    p_source: "website",
    p_full_name: "Test User",
    p_email_primary: `test_${suffix}@example.com`,
    p_phone_primary: "0123456789",
    p_gender: "male",
    p_consent_data_storage: true,
    p_raw_payload: { mssv: `3120${suffix}` },
    p_answers: [
      {
        questionKey: "TEST_Q1",
        questionLabel: "Test Q1?",
        valueText: "Answer 1",
        acceptedAt: new Date().toISOString()
      }
    ]
  });

  it.skipIf(!pgClient)("A. successful application + answers commit atomically", async () => {
    const input = generateInput(randomUUID().slice(0, 8));
    const { data, error } = await adminClient.rpc("vam_submit_intake_application_atomic", input);
    
    expect(error).toBeNull();
    expect(data).toHaveProperty("applicationId");
    
    const appRes: any = await (pgClient as any).query("SELECT id, status, role_applied FROM public.applications WHERE id = $1", [data.applicationId]);
    expect(appRes.rows.length).toBe(1);
    expect(appRes.rows[0].status).toBe("submitted");
    expect(appRes.rows[0].role_applied).toBe("mentee");
    
    const ansRes: any = await (pgClient as any).query("SELECT question_key, question_label, value_text FROM public.application_answers WHERE application_id = $1", [data.applicationId]);
    expect(ansRes.rows.length).toBe(1);
    expect(ansRes.rows[0].question_key).toBe("TEST_Q1");
    expect(ansRes.rows[0].question_label).toBe("Test Q1?");
    expect(ansRes.rows[0].value_text).toBe("Answer 1");
  });

  it.skipIf(!pgClient)("B. forced answer insertion failure leaves ZERO surviving application row", async () => {
    const suffix = randomUUID().slice(0, 8);
    const input = generateInput(suffix);
    // Force answer failure by violating NOT NULL DB constraint
    (input.p_answers[0] as any).questionKey = null;

    const { data, error } = await adminClient.rpc("vam_submit_intake_application_atomic", input);
    expect(error).not.toBeNull();
    
    const appsRes: any = await (pgClient as any).query("SELECT id FROM public.applications WHERE email_primary = $1", [input.p_email_primary]);
    expect(appsRes.rows.length).toBe(0);
  });

  it.skipIf(!pgClient)("C. duplicate email conflict leaves no partial rows", async () => {
    const suffix = randomUUID().slice(0, 8);
    const input1 = generateInput(suffix);
    
    const { error: err1 } = await adminClient.rpc("vam_submit_intake_application_atomic", input1);
    expect(err1).toBeNull();
    
    const input2 = generateInput(randomUUID().slice(0, 8));
    input2.p_email_primary = input1.p_email_primary; 
    
    const { data, error } = await adminClient.rpc("vam_submit_intake_application_atomic", input2);
    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.code).toBe("duplicate");
    
    const appsRes: any = await (pgClient as any).query("SELECT id FROM public.applications WHERE email_primary = $1", [input1.p_email_primary]);
    expect(appsRes.rows.length).toBe(1);
  });

  it.skipIf(!pgClient)("D. duplicate MSSV conflict leaves no partial rows", async () => {
    const suffix = randomUUID().slice(0, 8);
    const input1 = generateInput(suffix);
    
    const { error: err1 } = await adminClient.rpc("vam_submit_intake_application_atomic", input1);
    expect(err1).toBeNull();
    
    const input2 = generateInput(randomUUID().slice(0, 8));
    input2.p_raw_payload.mssv = input1.p_raw_payload.mssv; 
    
    const { data, error } = await adminClient.rpc("vam_submit_intake_application_atomic", input2);
    expect(error).toBeNull();
    expect(data?.ok).toBe(false);
    expect(data?.code).toBe("duplicate");
    
    const appsRes: any = await (pgClient as any).query("SELECT id FROM public.applications WHERE raw_payload->>'mssv' = $1", [input1.p_raw_payload.mssv]);
    expect(appsRes.rows.length).toBe(1);
  });

  it.skipIf(!pgClient)("E. unexpected constraint failure is NOT misclassified as applicant duplicate", async () => {
    const suffix = randomUUID().slice(0, 8);
    const input = generateInput(suffix);
    (input as any).p_role_applied = "invalid_role";
    
    const { error } = await adminClient.rpc("vam_submit_intake_application_atomic", input);
    
    expect(error).not.toBeNull();
    expect(error?.message).not.toContain("duplicate");
  });

  it.skipIf(!pgClient)("F. token stripping removes __apply_token and token", async () => {
    const suffix = randomUUID().slice(0, 8);
    const input = generateInput(suffix) as any;
    input.p_raw_payload.token = "secret-token-123";
    input.p_raw_payload.__apply_token = "secret-apply-token-123";
    
    const { data, error } = await adminClient.rpc("vam_submit_intake_application_atomic", input);
    expect(error).toBeNull();
    
    const appRes: any = await (pgClient as any).query("SELECT raw_payload FROM public.applications WHERE id = $1", [data.applicationId]);
    expect(appRes.rows[0]?.raw_payload).not.toHaveProperty("token");
    expect(appRes.rows[0]?.raw_payload).not.toHaveProperty("__apply_token");
  });

  it.skipIf(!pgClient)("G. RPC privilege boundary is trusted/service-role only", async () => {
    const suffix = randomUUID().slice(0, 8);
    const input = generateInput(suffix);
    
    const { error } = await anonClient.rpc("vam_submit_intake_application_atomic", input);
    expect(error).not.toBeNull();
    expect(["42883", "PGRST202", "42501"]).toContain(error?.code);
  });
  
  it.skipIf(!pgClient)("H. mentors are NOT deduplicated by the UEHM-S12 mentee indexes", async () => {
    const suffix = randomUUID().slice(0, 8);
    const input1 = generateInput(suffix, "mentor"); 
    
    const { error: err1 } = await adminClient.rpc("vam_submit_intake_application_atomic", input1);
    expect(err1).toBeNull();
    
    const input2 = generateInput(randomUUID().slice(0, 8), "mentor");
    input2.p_email_primary = input1.p_email_primary; 
    
    const { data, error } = await adminClient.rpc("vam_submit_intake_application_atomic", input2);
    expect(error).toBeNull();
    expect(data?.ok).toBe(true); 
  });
});
