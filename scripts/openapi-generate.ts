// Generates docs/tech/openapi.yaml from the route specs attached by defineRoute() / attachRouteSpec().
//   pnpm openapi:generate          # rewrite the document
//   pnpm openapi:check             # exit 1 when the committed document differs
//
// The committed document is also the API design target (D-145): this script re-serializes it,
// replaces the operations whose operationId is implemented in src/app/api/**/route.ts (plus the
// component schemas those operations emit), sorts paths, component names, methods, and response
// codes, and leaves everything else untouched. Every run is deterministic.
import 'dotenv/config'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi'
import { getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'

const OUT = resolve('docs/tech/openapi.yaml')
const API_ROOT = 'src/app/api'
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type Method = (typeof METHODS)[number]
type Collected = {
  docPath: string
  method: Method
  servers?: { url: string }[]
  spec: RegisteredRoute
}
type Doc = Record<string, unknown> & {
  paths?: Record<string, Record<string, unknown>>
  components?: Record<string, Record<string, unknown>>
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

/** src/app/api/v1/runs/[runId]/route.ts → /api/v1/runs/{runId} (route groups are dropped). */
function urlFromFile(file: string): string {
  const rel = file
    .split(sep)
    .join('/')
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')
  const segments = rel
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, '{$1}').replace(/^\[(.+)\]$/, '{$1}'))
  return `/${segments.join('/')}`
}

/** Paths are relative to the document server (/api/v1); other /api routes use a per-operation server. */
function toDocPath(url: string): { docPath: string; servers?: { url: string }[] } {
  if (url === '/api/v1') return { docPath: '/' }
  if (url.startsWith('/api/v1/')) return { docPath: url.slice('/api/v1'.length) }
  if (url.startsWith('/api/'))
    return { docPath: `/../${url.slice('/api/'.length)}`, servers: [{ url: '/api' }] }
  throw new Error(`route outside /api: ${url}`)
}

async function collect(): Promise<Collected[]> {
  const out: Collected[] = []
  for (const file of walk(API_ROOT)) {
    const mod = (await import(pathToFileURL(resolve(file)).href)) as Record<string, unknown>
    const url = urlFromFile(file)
    for (const method of METHODS) {
      const spec = getRouteSpec(mod[method.toUpperCase()])
      if (!spec) continue
      const { docPath, servers } = toDocPath(url)
      out.push({ docPath, method, spec, ...(servers ? { servers } : {}) })
    }
  }
  return out
}

const ref = (name: string) => ({ $ref: `#/components/responses/${name}` })

function operation(c: Collected): ZodOpenApiOperationObject {
  const { spec } = c
  const responses: Record<string, unknown> = {
    [String(spec.status)]: {
      description: spec.description ?? 'OK',
      content: { 'application/json': { schema: spec.output } },
    },
  }
  for (const [code, r] of Object.entries(spec.responses ?? {})) {
    responses[code] = {
      description: r.description,
      content: { 'application/json': { schema: r.schema } },
    }
  }
  const hasInput = Boolean(spec.input?.params || spec.input?.query || spec.input?.body)
  if (hasInput) responses['400'] ??= ref('BadRequest')
  if (spec.auth === 'session') {
    responses['401'] ??= ref('Unauthenticated')
    responses['403'] ??= ref('Forbidden')
  }
  if (spec.auth === 'cron') responses['401'] ??= ref('Unauthenticated')
  if (spec.input?.params) responses['404'] ??= ref('NotFound')
  if (spec.rateLimit) responses['429'] ??= ref('RateLimited')

  const requestParams = {
    ...(spec.input?.params ? { path: spec.input.params } : {}),
    ...(spec.input?.query ? { query: spec.input.query } : {}),
  }
  return {
    tags: spec.tags,
    operationId: spec.operationId,
    summary: spec.summary,
    ...(spec.auth === 'public' ? { security: [] } : {}),
    ...(spec.auth === 'cron' ? { security: [{ cronAuth: [] }] } : {}),
    ...(c.servers ? { servers: c.servers } : {}),
    ...(Object.keys(requestParams).length ? { requestParams } : {}),
    ...(spec.input?.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: spec.input.body } },
          },
        }
      : {}),
    responses: sortKeys(responses) as ZodOpenApiResponsesObject,
  } as ZodOpenApiOperationObject
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) as T
}

function sortMethods(pathItem: Record<string, unknown>): Record<string, unknown> {
  const order = [...METHODS, 'head', 'options', 'trace', 'parameters', 'summary', 'description']
  return Object.fromEntries(
    Object.entries(pathItem).sort(([a], [b]) => {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b)
    }),
  )
}

async function build(): Promise<string> {
  const existing: Doc = existsSync(OUT)
    ? (YAML.parse(readFileSync(OUT, 'utf8')) as Doc)
    : {
        openapi: '3.1.0',
        info: { title: 'Tassl API', version: '1.0.0' },
        servers: [{ url: '/api/v1', description: 'Same-origin, version 1' }],
        components: {},
        paths: {},
      }

  const collected = await collect()
  const paths: ZodOpenApiPathsObject = {}
  for (const c of collected) {
    const item = (paths[c.docPath] ??= {}) as Record<string, unknown>
    item[c.method] = operation(c)
  }
  const generated = createDocument({
    openapi: '3.1.0',
    info: existing.info as { title: string; version: string },
    servers: existing.servers as { url: string }[],
    paths,
  }) as unknown as Doc

  const mergedPaths: Record<string, Record<string, unknown>> = { ...(existing.paths ?? {}) }
  for (const c of collected) {
    const op = generated.paths?.[c.docPath]?.[c.method]
    if (!op) throw new Error(`generator produced no operation for ${c.method} ${c.docPath}`)
    mergedPaths[c.docPath] = sortMethods({ ...(mergedPaths[c.docPath] ?? {}), [c.method]: op })
  }

  const components = { ...(existing.components ?? {}) }
  const schemas = { ...(components.schemas ?? {}), ...(generated.components?.schemas ?? {}) }
  for (const key of Object.keys(components)) {
    components[key] = sortKeys(components[key] as Record<string, unknown>)
  }
  if (Object.keys(schemas).length) components.schemas = sortKeys(schemas)

  const doc = {
    openapi: '3.1.0',
    info: existing.info,
    servers: existing.servers,
    ...(existing.tags ? { tags: existing.tags } : {}),
    ...(existing.security ? { security: existing.security } : {}),
    components,
    paths: sortKeys(mergedPaths),
  }
  console.error(
    `openapi: ${collected.length} implemented operation(s) merged into ${Object.keys(mergedPaths).length} path(s)`,
  )
  return YAML.stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false })
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check')
  const output = await build()
  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (current !== output) {
      console.error(
        'docs/tech/openapi.yaml is out of date: run pnpm openapi:generate and commit the result',
      )
      process.exit(1)
    }
    console.error('openapi: up to date')
    return
  }
  writeFileSync(OUT, output)
  console.error(`openapi: wrote ${OUT}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
