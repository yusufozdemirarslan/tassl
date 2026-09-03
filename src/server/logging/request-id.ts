// docs/tech/13-observability-ops.md §2.4: honor an incoming x-request-id only when it is a UUID (D-086).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const getOrCreateRequestId = (headers: Headers): string => {
  const incoming = headers.get('x-request-id') ?? ''
  return UUID.test(incoming) ? incoming.toLowerCase() : crypto.randomUUID()
}
