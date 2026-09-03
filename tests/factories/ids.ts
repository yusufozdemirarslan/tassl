// Deterministic ids for fixtures (docs/tech/06-data-model.md §5): `uuidFrom('run-1')` is the UUID v5 of
// the label in the Tassl test namespace, so every factory row has a stable id across runs.
import { createHash } from 'node:crypto'

// A fixed v4 namespace for the test suite (RFC 9562 name-based UUIDs need one).
const NAMESPACE = '6f1c2b6e-3d0a-4c8f-9b7e-2a4d5e6f7a80'

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.replace(/-/g, '').match(/.{2}/g) ?? [], (h) => parseInt(h, 16))

/** UUID v5 (SHA-1) of `label` under the Tassl test namespace. */
export function uuidFrom(label: string): string {
  const hash = createHash('sha1')
  hash.update(hexToBytes(NAMESPACE))
  hash.update(label, 'utf8')
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC variant
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Seat account emails follow `<label>@tassl.local`; fixtures use example.test to stay distinct. */
export const emailFrom = (label: string): string => `${label}@example.test`
