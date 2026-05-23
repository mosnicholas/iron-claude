/**
 * Inbox tier gate.
 *
 * Called from `runAgentTurn` (and any other inbox-bound handler) BEFORE the
 * agent is invoked. Returns "allow" for paying / trialing users; for
 * `expired` users it returns a block message that the caller should send via
 * Telegram in place of running the model. This keeps the agent code itself
 * tier-unaware.
 */

import type { User } from "../db/schema.js";
import { effectiveTier } from "../auth/tiers.js";

export type GateDecision = "allow" | { block: string };

const EXPIRED_MESSAGE =
  "Your IronClaude trial has ended. Subscribe to keep your training going — reply /subscribe for the checkout link.";

export function gateInboxTurn(user: User): GateDecision {
  const tier = effectiveTier(user);
  if (tier === "expired") {
    return { block: EXPIRED_MESSAGE };
  }
  return "allow";
}
