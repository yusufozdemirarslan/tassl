/**
 * Whether a demo reset is aimed at one deployment rather than half of one (D-744).
 *
 * `pnpm demo:reset` runs on the operator's machine, and `dotenv/config` fills in whatever the command
 * line left out from the local `.env` — including `NEXT_PUBLIC_APP_URL=http://localhost:3000`. Pointed
 * at a deployment's database, the reset then writes notification emails whose links are on this
 * machine. The deployment's email worker is right to refuse them (`appLink` requires every link to
 * share the deployment's origin), so every one is retried and dead-lettered as "Invalid props for the
 * notification email", and the demo seats never get the mail the demo describes.
 *
 * So the database and the link origin move together, or the reset does not start: the same rule D-725
 * gives the browser and the database of the guide chain.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** The reason the reset must not run, or `null` when the target is coherent. */
export function resetTargetProblem(target: {
  databaseUrl: string | undefined
  appUrl: string | undefined
}): string | null {
  const databaseHost = target.databaseUrl === undefined ? null : hostOf(target.databaseUrl)
  if (databaseHost === null || LOCAL_HOSTS.has(databaseHost)) return null

  const appUrl = target.appUrl ?? ''
  const appHost = hostOf(appUrl)
  if (appHost === null) {
    return (
      'DATABASE_URL points at a deployment, but NEXT_PUBLIC_APP_URL is not set to a URL. Every ' +
      "notification this reset writes links to the app, so set NEXT_PUBLIC_APP_URL to that deployment's " +
      'address (for production, https://tassl.vercel.app).'
    )
  }
  if (LOCAL_HOSTS.has(appHost) || new URL(appUrl).protocol !== 'https:') {
    return (
      `DATABASE_URL points at a deployment, but NEXT_PUBLIC_APP_URL is ${appUrl}. The notifications ` +
      "this reset writes would link to this machine, and the deployment's email worker refuses every " +
      "one of them. Set NEXT_PUBLIC_APP_URL to that deployment's address (for production, " +
      'https://tassl.vercel.app).'
    )
  }
  return null
}
