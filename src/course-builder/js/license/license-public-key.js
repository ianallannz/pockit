// ── Local license — public key ───────────────────────────────
// The counterpart to whatever private key eventually signs a local_license
// key_code (see supabase/schema.sql's license_keys table) — that signing
// step is server-side and explicitly out of scope of the architecture plan
// this module belongs to (/home/ian/.claude/plans/graceful-exploring-cosmos.md).
//
// No license-issuing process exists yet, so there is no real key pair to
// ship. This stays `null` until one does — license.js's verifyLicenseKey()
// treats a null public key as "nothing can ever verify," which is exactly
// the inert behavior wanted: the mechanism is complete and testable (tests
// inject their own throwaway key pair — see test/license.test.js) without
// this module ever holding a placeholder that could be mistaken for real.
//
// When a real key pair exists, replace this with the public half only,
// exported as a JWK — e.g. the output of:
//   const { publicKey } = await crypto.subtle.generateKey(
//     { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
//   await crypto.subtle.exportKey('jwk', publicKey);
// The private key must never be committed here or anywhere in this repo.
export const LICENSE_PUBLIC_KEY_JWK = null;
