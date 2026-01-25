/**
 * API Handler Utilities
 *
 * Shared patterns for Vercel serverless API endpoints.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export interface CronResult {
  success: boolean;
  error?: string;
}

export interface HandlerOptions<T extends CronResult> {
  allowedMethods: string[];
  validateSecret: (req: VercelRequest) => boolean;
  handler: (req: VercelRequest) => Promise<T>;
  errorLabel: string;
}

/**
 * Validates the cron secret from the Authorization header.
 * Returns true if no secret is configured (allows unauthenticated in dev).
 */
export function validateCronSecret(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;

  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Creates a standardized Vercel API handler with:
 * - HTTP method validation
 * - Secret/auth validation
 * - Consistent error handling and response format
 */
export function createApiHandler<T extends CronResult>(options: HandlerOptions<T>) {
  const { allowedMethods, validateSecret, handler, errorLabel } = options;

  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    // Validate HTTP method
    if (!allowedMethods.includes(req.method || "")) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // Validate secret/auth
    if (!validateSecret(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await handler(req);

      if (result.success) {
        // Extract extra fields beyond success/error for response
        const {
          success: _success,
          error: _error,
          ...rest
        } = result as CronResult & Record<string, unknown>;
        res.status(200).json({ ok: true, ...rest });
      } else {
        res.status(500).json({ ok: false, error: result.error });
      }
    } catch (error) {
      console.error(`${errorLabel} error:`, error);
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}
