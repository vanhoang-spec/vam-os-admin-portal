export const SEASON_CONFIG = {
  /**
   * The primary season the admin portal is currently operating in.
   * This drives the default views for all operations dashboards, KPI cards, and event creation.
   *
   * IMPORTANT: Keep this as UEHM-S11 until the owner confirms that UEHM-S12 has been
   * seeded into the `seasons` database table AND the team is ready to switch the dashboard.
   * Switching prematurely will cause dashboards to show unfiltered or empty data.
   *
   * To switch to Season 12: change this value to "UEHM-S12".
   */
  CURRENT_OPERATING_SEASON_CODE: "UEHM-S11",

  /**
   * The season code for incoming applications.
   * This is used by public forms to tag new submissions.
   */
  CURRENT_APPLICATION_SEASON_CODE: "UEHM-S12",

  /**
   * The primary recruitment batch code for incoming applications.
   * Season 12 uses a one-wave model, so this is B1.
   */
  CURRENT_APPLICATION_BATCH_CODE: "UEHM-S12-B1",

  /**
   * Recommended synthetic season code for safe demonstrations without mutating real data.
   */
  DEMO_SEASON_CODE: "DEMO-S12",

  /**
   * M069: the public mentor/mentee form state is NO LONGER an environment
   * variable. It lives in `public.application_form_controls` and is changed
   * from Quản trị → Mùa & Form đăng ký, with an audit row per change.
   *
   * `VAM_OS_ENABLE_MENTOR_APPLICATION`, `VAM_OS_ENABLE_MENTEE_APPLICATION`
   * and `VAM_OS_ALLOW_TOKENLESS_APPLICATIONS` are dead config: nothing reads
   * them. Setting them has no effect and cannot open a form. Remove them from
   * Vercel once M069 is live so nobody believes otherwise.
   *
   * See lib/application-form-controls.ts and lib/apply-gate.ts.
   */
};
