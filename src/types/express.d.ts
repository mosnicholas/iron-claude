/**
 * Express request augmentation.
 *
 * Adds `req.user` so auth middleware can attach the resolved IronClaude user
 * row without an unsafe cast at every call site.
 */

import type { User } from "../db/schema.js";

declare global {
  namespace Express {
    interface Request {
      user?: User | null;
    }
  }
}

export {};
