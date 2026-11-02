// Web front-end health check: GET /api/health
// Used by the hosting platform and uptime monitoring. Reveals no internal details.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    { status: 'ok', service: 'web', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
