/**
 * Tool definition primitives.
 *
 * Tools are the only path from the model to disk/network. Each tool:
 *   - Has a zod input schema (validated on entry)
 *   - Returns a string the model sees as the tool result
 *   - Auto-commits to git inside the tool body (for write tools)
 */

import { z, type ZodObject, type ZodRawShape } from "zod";
import type { ToolDef } from "./llm-client.js";
import type { Storage } from "../storage/storage.js";

export interface ToolContext {
  /** ID of the user this turn belongs to */
  userId: string;
  /** Storage adapter (DB-backed) */
  storage: Storage;
  /** Configured timezone for the user (e.g. "America/New_York") */
  timezone: string;
  /** Stable id for the conversation turn — used for observability and idempotency */
  turnId: string;
  /** Current handler name (for tool-call logs) */
  handler: string;
}

export interface Tool<S extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>> {
  name: string;
  description: string;
  schema: S;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<string>;
}

export function defineTool<S extends ZodObject<ZodRawShape>>(spec: Tool<S>): Tool<S> {
  return spec;
}

/**
 * Convert a tool's zod schema to the JSON-Schema shape Anthropic's tools API expects.
 * `z.toJSONSchema` covers all the property kinds we use (strings, numbers, enums,
 * arrays, nested objects, optionals, descriptions).
 */
export function toolToAnthropic(t: Tool): ToolDef {
  const json = z.toJSONSchema(t.schema, { target: "draft-7" }) as Record<string, unknown>;
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: (json.properties as Record<string, unknown>) ?? {},
      required: (json.required as string[]) ?? [],
    },
  };
}
