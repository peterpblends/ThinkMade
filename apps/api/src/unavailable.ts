/**
 * When the database can't be reached (Neon's monthly allowance is used up, the database is suspended, or the
 * connection fails), the API answers 503 with a plain message instead of an empty 500, so the app can tell
 * people ThinkMade is briefly unavailable rather than suggesting their own connection is at fault.
 */
export const UNAVAILABLE_MESSAGE =
  'ThinkMade is briefly unavailable while we sort out a problem on our side. Please try again in a little while.';

const DATABASE_DOWN = [
  /exceeded the (data transfer |compute time )?quota/i,
  /upgrade your plan to increase limits/i,
  /endpoint (is|has been) disabled/i,
  /project (is|has been) suspended/i,
  /too many connections/i,
  /connection terminated/i,
  /\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b|\bENOTFOUND\b/,
  /fetch failed/i,
];

/** Whether an error means the database (not the request) is the problem. */
export function isDatabaseUnavailable(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    const code = (e as { code?: unknown }).code;
    if (
      DATABASE_DOWN.some((re) => re.test(message)) ||
      (typeof code === 'string' && DATABASE_DOWN.some((re) => re.test(code)))
    )
      return true;
    e = e instanceof Error ? e.cause : undefined;
  }
  return false;
}

export function unavailableResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'service_unavailable', message: UNAVAILABLE_MESSAGE }),
    {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': '300',
        'cache-control': 'no-store',
      },
    },
  );
}
