// Type surface for the migration 059 PostgREST security probe.
// Only the pure, side-effect-free helpers are declared: importing the module
// never runs the probe, so these can be unit-tested without network access.

export declare const EXPECTED_HOST: "ljfneyuvpxrmejpxsmpz.supabase.co";
export declare const FORBIDDEN_HOST: "qkkroesfiazsejkzflcd.supabase.co";

/** The only two endpoint strings the probe will ever accept. */
export declare const ACCEPTED_ENDPOINTS: readonly string[];

/**
 * Returns null when the endpoint satisfies the strict staging contract, or a
 * fixed `endpoint_*` error code otherwise. The supplied value is never
 * interpolated into the returned code.
 */
export declare function validateEndpoint(raw: unknown): string | null;

/** Strips tokens, keys, UUIDs, emails and auth headers from a string. */
export declare function redact<T>(v: T): T;

/** Runs the probe. Never called on import. */
export declare function main(argv?: string[]): Promise<boolean>;
