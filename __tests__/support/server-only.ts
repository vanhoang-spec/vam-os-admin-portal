// Test-only stand-in for the `server-only` marker module. Next.js resolves that
// specifier internally at build time; under Vitest it has no on-disk package, so
// vitest.config.ts aliases it here to keep server modules importable in tests.
export {};
