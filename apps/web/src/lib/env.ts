import { z } from 'zod';

/**
 * Public settings for the web front end. Only NEXT_PUBLIC_ variables belong here:
 * they are visible to every visitor, so they must never contain secrets.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .url('must be a full URL, e.g. http://localhost:4000/api/v1')
    .default('http://localhost:4000/api/v1'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(env: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`);
    throw new Error(`Invalid web configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return result.data;
}

// Each variable must be referenced by its full name so Next.js can inline it at build time.
export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
