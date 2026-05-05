/**
 * Web-search-style tools.
 *
 * The Anthropic SDK exposes an in-API `web_search` tool — but to keep this
 * harness portable across providers, we declare our own thin tool here.
 * Today's implementation routes through Anthropic's web search via a fresh
 * messages.create call with web_search enabled. Swapping providers means
 * editing this one file.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { defineTool } from "../tool.js";

export const searchTechnique = defineTool({
  name: "search_technique",
  description:
    "Search the web for exercise form/technique cues from reputable strength-coaching sources. " +
    "Returns 2-3 concise cues plus a link. Use sparingly — for technique questions only, not for general chat.",
  schema: z.object({
    query: z
      .string()
      .describe("Specific technique question, e.g. 'bench press leg drive cues' or 'squat depth'"),
  }),
  handler: async (input) => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system:
        "You are a search summarizer. Given a strength training technique query, return 2-3 short cues (<= 12 words each) " +
        "followed by ONE link to a reputable source (Jeff Nippard, Renaissance Periodization, Squat University, Stronger By Science). " +
        "Format as bullets. No preamble.",
      messages: [{ role: "user", content: input.query }],
      // Enable Anthropic's hosted web search.
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        } as unknown as Anthropic.Tool,
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || "(no usable results)";
  },
});

export const WEB_TOOLS = [searchTechnique];
