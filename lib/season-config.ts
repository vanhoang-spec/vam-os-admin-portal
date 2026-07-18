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
   * Explicit enable flag for the public mentor application form.
   *
   * BOTH this flag AND a valid token are required to open the form.
   * Token presence alone is NOT sufficient.
   *
   * Control via env var: VAM_OS_ENABLE_MENTOR_APPLICATION=true
   * Default: false (closed). Form remains closed until explicitly enabled.
   */
  ENABLE_PUBLIC_MENTOR_APPLICATION: process.env.VAM_OS_ENABLE_MENTOR_APPLICATION === "true",

  /**
   * Explicit enable flag for the public mentee application form.
   *
   * BOTH this flag AND a valid token are required to open the form.
   * Token presence alone is NOT sufficient.
   *
   * Control via env var: VAM_OS_ENABLE_MENTEE_APPLICATION=true
   * Default: false (closed). Form remains closed until explicitly enabled.
   */
  ENABLE_PUBLIC_MENTEE_APPLICATION: process.env.VAM_OS_ENABLE_MENTEE_APPLICATION === "true",
};
