/**
 * Per-organisation limits on actions that send emails, store files or create records in bulk.
 * Generous for real use; they stop a compromised or scripted account from flooding the system.
 * Counted in the database (RateLimitService), so they hold across every copy of the API.
 */
export const ABUSE_LIMITS = {
  invitationsPerOrganisationPerHour: 50,
  documentUploadsPerOrganisationPerHour: 30,
  logoUploadsPerOrganisationPerHour: 20,
  importsPerOrganisationPerHour: 30,
  paymentReportsPerOrganisationPerHour: 20,
} as const;

export const HOUR_SECONDS = 3_600;
