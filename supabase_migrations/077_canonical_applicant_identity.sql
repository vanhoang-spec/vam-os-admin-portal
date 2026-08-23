-- Migration 077: Canonical Applicant Identity

-- 1. Normalizer functions
CREATE OR REPLACE FUNCTION public.applicant_email_norm_v1(email text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT trim(lower(email));
$$;

CREATE OR REPLACE FUNCTION public.applicant_student_id_norm_v1(mssv text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT trim(lower(mssv));
$$;

-- 2. Add columns
ALTER TABLE public.applications
ADD COLUMN dedup_exempt_reason text,
ADD COLUMN applicant_email_norm text GENERATED ALWAYS AS (public.applicant_email_norm_v1(email_primary)) STORED,
ADD COLUMN applicant_student_id_norm text GENERATED ALWAYS AS (public.applicant_student_id_norm_v1(raw_payload->>'mssv')) STORED;

-- 3. Preflight check for existing duplicates
DO $$ 
DECLARE
  email_collision_count integer;
  mssv_collision_count integer;
  v_uehm_s12_season_id uuid;
BEGIN
  SELECT id INTO v_uehm_s12_season_id FROM public.seasons WHERE code = 'UEHM-S12';

  IF v_uehm_s12_season_id IS NULL THEN
    RAISE NOTICE 'Season UEHM-S12 not found. Skipping canonical identity unique indexes.';
    RETURN;
  END IF;

  SELECT count(*) INTO email_collision_count
  FROM (
    SELECT applicant_email_norm
    FROM public.applications
    WHERE season_id = v_uehm_s12_season_id AND role_applied = 'mentee' AND applicant_email_norm IS NOT NULL
    GROUP BY applicant_email_norm
    HAVING count(*) > 1
  ) as duplicates;

  IF email_collision_count > 0 THEN
    RAISE EXCEPTION 'Migration preflight failed: found % email collisions for UEHM-S12 Mentees', email_collision_count;
  END IF;

  SELECT count(*) INTO mssv_collision_count
  FROM (
    SELECT applicant_student_id_norm
    FROM public.applications
    WHERE season_id = v_uehm_s12_season_id AND role_applied = 'mentee' AND applicant_student_id_norm IS NOT NULL AND applicant_student_id_norm != ''
    GROUP BY applicant_student_id_norm
    HAVING count(*) > 1
  ) as duplicates;

  IF mssv_collision_count > 0 THEN
    RAISE EXCEPTION 'Migration preflight failed: found % MSSV collisions for UEHM-S12 Mentees', mssv_collision_count;
  END IF;

  -- 4. Create Indexes (Dynamic SQL required in DO block to use variable)
  EXECUTE format('
    CREATE UNIQUE INDEX canonical_identity_email_idx
    ON public.applications (season_id, applicant_email_norm)
    WHERE season_id = %L AND role_applied = ''mentee'' AND applicant_email_norm IS NOT NULL;
  ', v_uehm_s12_season_id);

  EXECUTE format('
    CREATE UNIQUE INDEX canonical_identity_mssv_idx
    ON public.applications (season_id, applicant_student_id_norm)
    WHERE season_id = %L AND role_applied = ''mentee'' AND applicant_student_id_norm IS NOT NULL AND applicant_student_id_norm != '''';
  ', v_uehm_s12_season_id);

END $$;

-- 5. Atomic RPC
CREATE OR REPLACE FUNCTION public.vam_submit_intake_application_atomic(
  p_season_id uuid,
  p_intake_batch_id uuid,
  p_role_applied text,
  p_source text,
  p_full_name text,
  p_email_primary text,
  p_phone_primary text,
  p_gender text,
  p_consent_data_storage boolean,
  p_raw_payload jsonb,
  p_answers jsonb -- array of answers
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application_id uuid;
  v_answer jsonb;
BEGIN
  INSERT INTO public.applications (
    season_id,
    intake_batch_id,
    role_applied,
    status,
    source,
    full_name,
    email_primary,
    phone_primary,
    gender,
    consent_data_storage,
    raw_payload,
    submitted_at
  ) VALUES (
    p_season_id,
    p_intake_batch_id,
    p_role_applied::public.role_type,
    'submitted',
    p_source,
    p_full_name,
    p_email_primary,
    p_phone_primary,
    p_gender,
    p_consent_data_storage,
    (p_raw_payload - 'token') - '__apply_token',
    CURRENT_DATE
  ) RETURNING id INTO v_application_id;

  IF p_answers IS NOT NULL AND jsonb_array_length(p_answers) > 0 THEN
    FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
    LOOP
      INSERT INTO public.application_answers (
        application_id,
        question_key,
        question_label,
        value_text,
        created_at
      ) VALUES (
        v_application_id,
        v_answer->>'questionKey',
        v_answer->>'questionLabel',
        v_answer->>'valueText',
        coalesce((v_answer->>'acceptedAt')::timestamptz, now())
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'applicationId', v_application_id
  );

EXCEPTION
  WHEN unique_violation THEN
    DECLARE
      v_constraint_name text;
    BEGIN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      IF v_constraint_name IN ('canonical_identity_email_idx', 'canonical_identity_mssv_idx') THEN
        RETURN jsonb_build_object(
          'ok', false,
          'code', 'duplicate',
          'message', 'Đơn đăng ký của bạn đã được ghi nhận trước đó. Vui lòng liên hệ BTC nếu cần hỗ trợ.'
        );
      ELSE
        RAISE;
      END IF;
    END;
END;
$$;

-- Restrict RPC to service_role
REVOKE ALL ON FUNCTION public.vam_submit_intake_application_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vam_submit_intake_application_atomic FROM anon;
REVOKE ALL ON FUNCTION public.vam_submit_intake_application_atomic FROM authenticated;
GRANT EXECUTE ON FUNCTION public.vam_submit_intake_application_atomic TO service_role;
