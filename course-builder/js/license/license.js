// ── Local license mechanism ──────────────────────────────────
// Offline verification for a purchased local_license key — a string the
// user pastes into the app once, checked entirely with the Web Crypto API,
// no network call. See the architecture plan
// (/home/ian/.claude/plans/graceful-exploring-cosmos.md, §4) for why: a
// machine that bought an outright local license may never be online again,
// so it can't check a live database row the way a signed-in cloud user's
// entitlement can be checked.
//
// A key_code is `base64url(JSON.stringify(payload)) + '.' + base64url(signature)`,
// signed with ECDSA P-256 + SHA-256 over the UTF-8 payload bytes. The app
// ships only the matching *public* key (license-public-key.js) — nothing
// here can sign a key, only verify one, so there is no secret to protect
// in the client bundle.
//
// IMPORTANT — per the plan's scope: this module is deliberately not called
// from anywhere that gates a feature yet. It exists and is testable
// (test/license.test.js); what a missing/invalid license should someday
// restrict is an explicit open product decision, not made here.
import { LICENSE_PUBLIC_KEY_JWK } from './license-public-key.js';

const STORAGE_KEY = 'pockit-license-key';

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const binary = atob(b64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function importPublicKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

// Verifies a key_code string against a public key (defaulting to the
// shipped LICENSE_PUBLIC_KEY_JWK). Never throws — a malformed or
// unverifiable key is just `{ valid: false }`, since this runs against
// arbitrary user-pasted text.
export async function verifyLicenseKey(keyCode, publicKeyJwk = LICENSE_PUBLIC_KEY_JWK) {
  if (!publicKeyJwk || typeof keyCode !== 'string') return { valid: false };

  const parts = keyCode.trim().split('.');
  if (parts.length !== 2) return { valid: false };
  const [payloadPart, signaturePart] = parts;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
  } catch {
    return { valid: false };
  }

  try {
    const key = await importPublicKey(publicKeyJwk);
    const signatureBytes = base64UrlToBytes(signaturePart);
    const payloadBytes = new TextEncoder().encode(payloadPart);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, payloadBytes);
    return ok ? { valid: true, payload } : { valid: false };
  } catch {
    return { valid: false };
  }
}

// Stored separately from `pockit-course-builder`'s blob so a license
// survives independently of any course data, and is present before any
// course has ever been created.
export function getStoredLicense() {
  return localStorage.getItem(STORAGE_KEY);
}

export function storeLicense(keyCode) {
  localStorage.setItem(STORAGE_KEY, keyCode);
}

export function clearStoredLicense() {
  localStorage.removeItem(STORAGE_KEY);
}
