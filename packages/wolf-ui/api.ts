
export class WolfApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message) }
}

/** One local capability per carrier. It never enters persistence or the UI. */
export function createWolfClient(base = '/api/wolf/v1', fetchImpl: typeof fetch = globalThis.fetch) {
  let capability: Promise<string> | undefined
  const session = () => capability ??= fetchImpl(`${base}/session`, { credentials: 'same-origin', cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new WolfApiError('The Wolf service is unavailable. Please retry.', 'SESSION_UNAVAILABLE', response.status)
      const value = await response.json()
      if (typeof value.capability !== 'string') throw new Error('The Wolf service did not provide a session.')
      return value.capability
    }).catch(error => { capability = undefined; throw error })

  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-Wolf-Capability'] = await session() }
    const response = await fetchImpl(`${base}/${path}`, { method: body === undefined ? 'GET' : 'POST', headers,
      credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal })
    const result = await response.json().catch(() => null)
    if (!response.ok || result?.ok === false) {
      const error = result?.error
      throw new WolfApiError(typeof error?.message === 'string' ? error.message : 'That request could not finish. Please retry.', error?.code ?? 'REQUEST_FAILED', response.status)
    }
    return result as T
  }
  return { request }
}

export type WolfClient = ReturnType<typeof createWolfClient>
