# IronClaude Rearchitecture: Diagnosis & Planning Prompt

## How to Use This Document

This is a comprehensive analysis and planning prompt. It has two parts:
1. **Diagnosis** — What's wrong and why, with root causes traced to specific code
2. **Planning Prompt** — A detailed prompt you can pass to Claude Code to debug and rearchitect the system

---

# PART 1: DIAGNOSIS

## Screenshot Bug Analysis

### Bug 1: "Wut lol. I did calf raises. I skipped leg curls"
**What happened**: The bot said "Leg curls next" and logged leg curls, when the user had actually done calf raises and skipped leg curls entirely.

**Root cause chain**:
1. Each message is a completely fresh `query()` call (`src/coach/index.ts:252`). Claude has no memory of the *conversation within the workout* — only 10 flat text messages from `message-history.ts`.
2. The system prompt instructs: "proactively tell them what's next" from the plan (`prompts/partials/workout-management.md:61`). This makes Claude follow the plan's exercise ORDER rather than listening to what the user actually reports.
3. The pre-loaded "Today's Workout" (`todayWorkout` in `prompts.ts:246`) shows what was logged, but if the file update from the previous message wasn't pushed/synced yet, Claude might be working with stale data.
4. Claude doesn't see its own TOOL USAGE from the previous turn — it doesn't know "last message I wrote 'Calf Raises' to the workout file." It only sees the flat text history: "[HH:MM] User: calf raises..." and "[HH:MM] Coach: ✓ logged..."

**The fundamental issue**: Claude is plan-biased rather than user-biased. The plan tells it "leg curls are next," and without strong conversational context about what just happened, it defaults to the plan.

### Bug 2: General Stiffness / Easily Confused
**What happened**: The bot can't react to questions well, gets confused when anything deviates from the plan, and is "clearly wrong at times."

**Root cause chain**:
1. **Information overload**: The system prompt includes ALL reference guides on every single message — exercise parsing, workout management, PR detection, RPE analysis, plan flexibility, historical data, weekly planning, AND retrospective guide. That's ~3000+ tokens of instructions even for a simple "how heavy should I go today?" question.
2. **No message classification**: Every message goes through the exact same pipeline with the exact same massive prompt. A casual question like "what time should I work out?" gets the same treatment as "bench 175x5."
3. **Flat conversation history**: The message history (`message-history.ts`) stores only text, not structured data. Claude can't easily parse what exercises have been logged, what the workout state is, or what happened in the conversation. Example: `[14:32] User: 175x5, 175x5, 170x6` — Claude has to re-parse this from scratch on every message.
4. **No explicit state machine**: Is a workout in progress? Is the user asking a general question? Is this mid-set? The system relies entirely on Claude inferring this from context each time, which is fragile.

### Bug 3: Machine Info (CF3356)
**What happened**: User asked about a specific gym machine and the bot couldn't help.

**Root cause**: Normal chat doesn't have `WebSearch` in its `allowedTools` — only `/demo` adds it (`commands.ts:137`). The bot correctly says "I can't verify without web access" but this is a frustrating user experience. A fitness coach should be able to look things up.

### Bug 4: Complex Weight Notation
**What happened**: User said "2 & 3 were with bar & 10lb plates on each side" for calf raises.

**Root cause**: The exercise parsing guide (`prompts/partials/exercise-parsing.md`) covers common formats like "175x5" but doesn't cover natural language descriptions of plate loading. "bar & 10lb plates on each side" = 45 (bar) + 10 + 10 = 65 lbs, which requires fitness domain knowledge plus plate math. This is a prompt gap.

---

## Architectural Root Causes (Deepest Problems)

### 1. STATELESS PER-MESSAGE ARCHITECTURE (Critical)

**Location**: `src/handlers/webhook.ts:122`, `src/coach/index.ts:252`

Every incoming message:
```
User message → createCoachAgent() → fresh query() → response → done
```

There is NO conversation state carried between messages in Claude's context window. Each call is isolated. The only continuity comes from:
- 10 messages of flat text history (lossy — no tool usage, no structured data)
- Pre-loaded workout file content (can be stale if previous write hasn't synced)
- Pre-loaded plan, PRs, learnings (static per session)

**Why this matters**: During a workout, a user might send 15-20 messages over 45 minutes. Each message creates a completely fresh Claude call. Claude has to re-derive the entire workout state from scratch: "What exercises have been done? What's the plan? Where are we? What did I last tell the user?" This is inherently fragile and causes:
- Exercise confusion (logging wrong exercise)
- Repetitive suggestions ("Next up: bench" when bench was already done)
- Lost context about modifications the user requested
- Inability to maintain a coherent conversation flow

**What good systems do**: Maintain a conversation session with Claude, either via the Anthropic messages API (passing the full conversation history as messages, not flat text in the system prompt) or by maintaining explicit structured state.

### 2. MASSIVE UNDIFFERENTIATED SYSTEM PROMPT (High)

**Location**: `src/coach/prompts.ts:160-334`

The system prompt includes EVERYTHING on every call:
- Base identity + coaching rules (~100 lines)
- Date/time context
- Environment info
- Message history
- Weekly plan content
- PRs YAML
- Learnings
- Today's workout
- Week progress
- Exercise parsing guide
- Workout management guide
- PR detection guide
- RPE analysis guide
- Plan flexibility guide
- Historical data guide
- Weekly planning guide (full workflow!)
- Retrospective guide (full workflow!)

**Estimated tokens**: 4,000-8,000+ tokens of system prompt, depending on plan/workout size.

**Why this matters**: Claude has to process ALL of this on every message, even when 90% is irrelevant. When the user says "bench 175x5," Claude doesn't need the retrospective guide, weekly planning guide, RPE analysis, or historical data guide. This noise:
- Dilutes the signal (important instructions compete with irrelevant ones)
- Increases latency (more tokens to process)
- Increases cost
- Can cause Claude to follow the wrong instruction set (e.g., applying planning logic during workout logging)

**What good systems do**: Use a layered/tiered prompt approach:
- **Always loaded**: Core identity, current date, communication style
- **Loaded when relevant**: Workout management (when in a workout), planning (when planning), etc.
- **Available on demand**: Reference guides that Claude can fetch via tools when needed

### 3. NO WORKOUT SESSION STATE MACHINE (High)

**Location**: `src/handlers/webhook.ts:209-243` (all messages go through same path)

There is no explicit concept of a "workout session." The system relies on Claude detecting that a workout file with `status: in_progress` exists, but:
- This detection happens inside Claude's reasoning, not in code
- If Claude misreads the file, there's no guardrail
- The webhook handler doesn't know if we're mid-workout or not
- There's no session-level conversation history specific to the workout

**What this should look like**:
```
webhook receives message
  → check: is there an active workout session?
    → YES: route to workout handler (with workout-specific context + session history)
    → NO: route to general handler (with lighter context)
```

### 4. LOSSY MESSAGE HISTORY (Medium-High)

**Location**: `src/bot/message-history.ts`

The message history stores only flat text:
```json
{ "text": "175x5, 175x5, 170x6", "timestamp": "...", "isFromUser": true }
```

It does NOT store:
- What exercise this was for (structured data)
- What Claude did in response (tool calls, file edits)
- What the workout state was at that point
- Whether this was a correction ("no, I meant calf raises, not leg curls")

**Why this matters**: When Claude gets a new message, it sees "[14:32] User: 175x5, 175x5, 170x6" and has to figure out from scratch: "Was this bench press? Squats? A continuation? A correction?" It has to read the workout file to check, and if the file is slightly wrong, it compounds the error.

**What good systems do**: Either maintain the full Claude conversation history (messages array with all tool use blocks) or maintain structured session state alongside the messages.

### 5. PLAN-BIASED INSTRUCTIONS (Medium)

**Location**: `prompts/partials/workout-management.md:60-63`

```
5. **Guide to next exercise**
   - If a weekly plan exists, proactively tell them what's next: "Next up: {exercise from plan}"
   - Don't ask "What's next?" - inform them based on the plan
```

This instruction biases Claude toward the plan's exercise order. Combined with the stateless architecture (Claude doesn't remember it already suggested bench), this leads to:
- Repeating "Next up: X" even after X was done or skipped
- Ignoring the user's actual exercise choice in favor of the plan
- Confusion when the user does exercises out of order

### 6. NO WEB SEARCH IN GENERAL CHAT (Low-Medium)

**Location**: `src/coach/index.ts:247` — `allowedTools` doesn't include `WebSearch`

The bot can't look things up during normal conversation. Only `/demo` has WebSearch. A fitness coach that can't search the web for exercise info, machine specs, or training science is limited.

---

## Summary of Root Causes (Priority Order)

| # | Issue | Severity | Symptoms |
|---|-------|----------|----------|
| 1 | Stateless per-message architecture | Critical | Exercise confusion, lost context, repetitive behavior |
| 2 | Massive undifferentiated system prompt | High | Slow responses, confused behavior, follows wrong instructions |
| 3 | No workout session state machine | High | Can't maintain workout flow, rigid exercise tracking |
| 4 | Lossy message history | Medium-High | Can't understand conversation context, repeated parsing |
| 5 | Plan-biased instructions | Medium | Ignores user deviations, suggests completed exercises |
| 6 | No web search in general chat | Low-Medium | Can't answer knowledge questions |

---

# PART 2: PLANNING PROMPT FOR CLAUDE CODE

Copy everything below this line and pass it to Claude Code as your task prompt.

---

## Task: Debug and Rearchitect IronClaude for Resilience and Intelligence

You are working on IronClaude, a Claude-powered fitness coaching bot with a Telegram interface. The bot currently has significant issues with confusion, rigidity, and incorrect behavior during workouts. Your job is to diagnose the root causes and implement architectural improvements to make the bot resilient, smart, and conversational.

### Current Architecture Summary

**Message flow**: Telegram → webhook (`src/handlers/webhook.ts`) → `createCoachAgent()` → `agent.chat(message)` → Claude Agent SDK `query()` → response → Telegram

**Key problem**: Every single message creates a completely fresh `query()` call. There is NO conversation continuity in Claude's context window. The only continuity is 10 flat text messages from `src/bot/message-history.ts` injected into the system prompt, plus pre-loaded file contents (plan, workout, PRs).

**Key files**:
- `src/handlers/webhook.ts` — Message routing
- `src/coach/index.ts` — CoachAgent class, `runQuery()` method
- `src/coach/prompts.ts` — System prompt construction (`buildSystemPrompt()`)
- `src/bot/message-history.ts` — Flat text message history
- `prompts/system.md` — Base system prompt
- `prompts/partials/workout-management.md` — Workout logging instructions
- `prompts/partials/exercise-parsing.md` — Exercise parsing guide

### Known Bugs (from User Screenshots)

1. **Exercise confusion**: Bot said "Leg curls next" and logged leg curls when user did calf raises and explicitly skipped leg curls. Bot followed the plan's exercise order instead of listening to user input.

2. **General stiffness**: Bot can't react well to questions, gets easily confused, gives clearly wrong information, and loses track when anything deviates from the plan.

3. **No web search**: User asked about a gym machine (CF3356) and bot couldn't look it up — `WebSearch` is only available for `/demo` command.

4. **Natural language parsing gaps**: "2 & 3 were with bar & 10lb plates on each side" requires plate math that the exercise parsing guide doesn't cover.

### Root Cause Analysis

#### Problem 1: Stateless Per-Message Architecture (CRITICAL)
Every message creates a new `CoachAgent` → fresh `query()`. No conversation context carried in Claude's context window between messages. During a 45-minute workout with 15+ messages, Claude re-derives the entire state from scratch every time.

**Current code** (`src/coach/index.ts:252`):
```typescript
const q = query({
  prompt,  // Just the user's text message
  options: {
    systemPrompt,  // Giant prompt rebuilt every time
    cwd: repoPath,
    maxTurns: this.config.maxTurns,
    model: this.config.model,
    allowedTools,
    // ...
  },
});
```

**Why it fails**: Claude doesn't remember its own previous tool calls, file edits, or reasoning. The flat text history in the system prompt ("[HH:MM] User: 175x5") loses all structure. Claude has to re-parse everything from scratch.

#### Problem 2: Massive Undifferentiated System Prompt
`buildSystemPrompt()` in `src/coach/prompts.ts` loads ALL reference guides on every call — exercise parsing, workout management, PR detection, RPE analysis, plan flexibility, historical data, weekly planning guide, AND retrospective guide. That's 4,000-8,000+ tokens of instructions regardless of what the user actually needs.

**Why it fails**: Important instructions (like "listen to what the user says, not what the plan says") compete with irrelevant ones (like "how to generate a retrospective"). Claude gets confused about which instructions to follow.

#### Problem 3: No Workout Session State Machine
The webhook handler (`src/handlers/webhook.ts:209`) treats all non-command messages identically. There's no code-level concept of "we're in a workout" that would change how messages are processed.

**Why it fails**: Claude has to infer the entire situational context each time. Am I in a workout? Has the user started? Which exercise are they on? Did they skip something? This inference is fragile and breaks regularly.

#### Problem 4: Lossy Message History
`src/bot/message-history.ts` stores only `{ text, timestamp, isFromUser }`. It doesn't store what Claude did (tool calls, file edits), what exercise was being discussed, or structured workout state.

#### Problem 5: Plan-Biased Instructions
`prompts/partials/workout-management.md:60-63` says "proactively tell them what's next" from the plan. This biases Claude toward rigid plan-following instead of listening to the user.

### What You Need to Do

Implement the following improvements in priority order. Each one independently improves the system, and they compound when combined.

#### Fix 1: Conversation-Aware Query System (HIGHEST PRIORITY)

**Goal**: Maintain conversation context between messages during a session (especially during workouts).

**Approach**: Instead of calling `query()` with just the user's message text and a system prompt, maintain a messages array that accumulates the conversation. The Claude Agent SDK's `query()` function is designed for single-shot tasks. For ongoing conversation, you need to either:

**Option A — Anthropic Messages API directly** (Recommended):
Use the Anthropic SDK (`@anthropic-ai/sdk`) directly with the Messages API, maintaining a `messages` array that grows across the session. Each user message and assistant response (including tool_use blocks) stays in the conversation. This gives Claude full memory of what it said and did.

```typescript
// Pseudocode for the approach
class ConversationSession {
  private messages: MessageParam[] = [];
  private systemPrompt: string;

  async sendMessage(userText: string): Promise<string> {
    this.messages.push({ role: "user", content: userText });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      system: this.systemPrompt,
      messages: this.messages,
      tools: [...],  // Tool definitions
    });

    // Handle tool use loop
    this.messages.push({ role: "assistant", content: response.content });
    // ... handle tool calls, add tool results, loop until done ...

    return extractText(response);
  }
}
```

**Option B — Structured state injection** (Simpler, less ideal):
Keep the `query()` approach but inject structured workout state into the prompt instead of flat text history. Before each query, build a "workout state" object that summarizes exactly what's happened:

```typescript
interface WorkoutState {
  isActive: boolean;
  startedAt: string;
  exercisesCompleted: Array<{
    name: string;
    sets: Array<{ weight: number; reps: number; rpe?: number }>;
    fromPlan: boolean;
  }>;
  exercisesRemaining: string[];  // From plan
  exercisesSkipped: string[];
  lastUserMessage: string;
  lastCoachAction: string;  // "logged bench press sets", "suggested next exercise", etc.
}
```

This state would be maintained in code (not by Claude) and injected into the system prompt, giving Claude a clear picture of where things stand.

**Implementation notes**:
- If using Option A, add session management to track when a conversation "starts" and "ends" (workout start → workout complete, or 4-hour timeout)
- The messages array should be trimmed when it gets too long (keep system prompt + last N exchanges)
- Store the session in memory on the server (conversations are short-lived, 1-2 hours max)
- On server restart, session can be rebuilt from the workout file + message history

#### Fix 2: Tiered/Contextual System Prompt (HIGH PRIORITY)

**Goal**: Only load the reference guides Claude actually needs for the current message.

**Approach**: Split the monolithic `buildSystemPrompt()` into tiers:

**Tier 1 — Always loaded** (~500 tokens):
- Coach identity and communication style
- Current date/time
- Core rules (date accuracy, never shame, etc.)
- What tools are available

**Tier 2 — Loaded based on context** (~500-1500 tokens):
- **During workout**: exercise parsing guide, workout management guide, today's workout file, PR thresholds for current exercises
- **General chat**: Lighter context, just plan overview and recent history
- **Planning**: Weekly planning guide + retrospective guide + historical data guide
- **Progress questions**: PR detection, RPE analysis, historical data guide

**Tier 3 — Available on demand** (0 tokens unless needed):
- Full weekly planning workflow (only during planning)
- Full retrospective guide (only during retro generation)
- Detailed historical data exploration (only when analyzing trends)

**Implementation**:
```typescript
type MessageIntent = "workout_logging" | "general_chat" | "planning" | "progress_query" | "exercise_question";

function classifyIntent(message: string, hasActiveWorkout: boolean): MessageIntent {
  // Simple heuristic classification
  if (hasActiveWorkout && looksLikeExerciseEntry(message)) return "workout_logging";
  if (message.includes("plan") || message.includes("next week")) return "planning";
  if (message.includes("PR") || message.includes("progress")) return "progress_query";
  // ... etc
  return "general_chat";
}

function buildSystemPrompt(intent: MessageIntent, context: SystemPromptContext): string {
  let prompt = loadTier1();  // Always loaded

  switch (intent) {
    case "workout_logging":
      prompt += loadPartial("exercise-parsing");
      prompt += loadPartial("workout-management");
      prompt += loadPartial("pr-detection");  // Lightweight version
      break;
    case "planning":
      prompt += loadPrompt("weekly-planning");
      prompt += loadPartial("historical-data");
      break;
    // ... etc
  }

  prompt += buildContextSection(context);  // Plan, workout, PRs as needed
  return prompt;
}
```

**Key change**: The exercise parsing and workout management guides are still available during workouts, but the weekly planning guide, retrospective guide, and historical data guide are NOT loaded. This dramatically reduces noise.

#### Fix 3: Workout Session Manager (HIGH PRIORITY)

**Goal**: Explicit code-level tracking of workout sessions so the webhook handler can route messages appropriately.

**Implementation**:
```typescript
// src/workout/session.ts
interface WorkoutSession {
  date: string;
  startedAt: Date;
  exercisesLogged: Array<{
    name: string;
    sets: number;
    lastLoggedAt: Date;
  }>;
  exercisesFromPlan: string[];
  exercisesSkipped: string[];
  modifications: string[];  // "swapped bench for incline"
  lastCoachResponse: string;
  conversationMessages?: MessageParam[];  // If using Option A from Fix 1
}

// In-memory session store (single user, single workout at a time)
let activeSession: WorkoutSession | null = null;

export function getActiveSession(): WorkoutSession | null { ... }
export function startSession(date: string, planExercises: string[]): WorkoutSession { ... }
export function logExercise(session: WorkoutSession, name: string, sets: number): void { ... }
export function endSession(): void { ... }
export function isWorkoutActive(): boolean { ... }
```

Then in the webhook handler:
```typescript
// src/handlers/webhook.ts
const session = getActiveSession();

if (session) {
  // Route to workout-specific handler with session context
  await handleWorkoutMessage(messageText, session, agent, bot);
} else {
  // Route to general handler
  await handleGeneralMessage(messageText, agent, bot);
}
```

This gives you code-level state about the workout, not just Claude-inferred state.

#### Fix 4: Rich Message History (MEDIUM-HIGH PRIORITY)

**Goal**: Store structured data about what happened in each exchange, not just flat text.

**Enhancement to `src/bot/message-history.ts`**:
```typescript
interface StoredMessage {
  text: string;
  timestamp: string;
  isFromUser: boolean;
  // NEW fields:
  parsedExercise?: string;  // "Bench Press" if this was exercise logging
  setsLogged?: number;      // How many sets were recorded
  coachAction?: string;     // "logged_exercise" | "answered_question" | "suggested_next" | etc.
  workoutFileUpdated?: boolean;
  correction?: boolean;     // Was this a correction of a previous entry?
}
```

When formatting for the prompt, include the structured data:
```
[14:32] User: 175x5, 175x5, 170x6
  → Logged: Bench Press, 3 sets
[14:32] Coach: ✓ Bench Press logged. Next up from plan: Incline DB Press
  → Action: logged_exercise, suggested_next
[14:35] User: actually those were incline, not flat bench
  → Correction detected
[14:35] Coach: Fixed! Updated to Incline Bench Press.
  → Action: correction_applied
```

This gives Claude much richer context about what happened in the conversation.

#### Fix 5: Rewrite Plan-Biased Instructions (MEDIUM PRIORITY)

**Goal**: Make Claude listen to the user first, consult the plan second.

**Change in `prompts/partials/workout-management.md`**:

Replace:
```
5. **Guide to next exercise**
   - If a weekly plan exists, proactively tell them what's next: "Next up: {exercise from plan}"
   - Don't ask "What's next?" - inform them based on the plan
```

With:
```
5. **After logging an exercise**
   - FIRST: Confirm what the user just did (the exercise THEY reported, not what the plan says)
   - SECOND: Briefly mention what the plan suggests next, but frame it as a suggestion, not a directive
   - Example: "✓ Calf Raises logged. Plan has leg curls next — want to do those or something else?"
   - If the user has been deviating from the plan, follow THEIR flow, not the plan's
   - NEVER assume the user did an exercise just because it's next in the plan
   - ALWAYS parse the user's message to determine what exercise they're reporting — the exercise name comes from THEIR input, not the plan's sequence
```

Also add to the base system prompt:
```
### User Input Priority (CRITICAL)
When the user tells you what exercise they did, BELIEVE THEM. Parse their message to determine the exercise name. Do NOT substitute the plan's next exercise for what the user reported. The user's message is the source of truth for what they did. The plan is a suggestion for what to do next.
```

#### Fix 6: Enable Web Search for General Chat (LOW-MEDIUM PRIORITY)

**Simple change in `src/coach/index.ts:247`**:

Add `WebSearch` to the default allowed tools:
```typescript
const baseTools = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", ...mcpToolNames];
```

Or add it conditionally when the message looks like a question:
```typescript
function messageNeedsWebSearch(text: string): boolean {
  const questionPatterns = /\b(what is|how to|how do|tell me about|explain|show me|find|look up)\b/i;
  return questionPatterns.test(text);
}
```

#### Fix 7: Improve Exercise Parsing for Natural Language (LOW PRIORITY)

**Add to `prompts/partials/exercise-parsing.md`**:

```markdown
## Plate Math & Natural Language Weights

Users sometimes describe weights using plate configurations instead of total weight:

| Description | Calculation | Total |
|-------------|-------------|-------|
| "bar with 10s" | 45 (bar) + 10 + 10 | 65 lbs |
| "bar with 25s" | 45 + 25 + 25 | 95 lbs |
| "bar with 45s" | 45 + 45 + 45 | 135 lbs |
| "plate and a quarter each side" | 45 + 45 + 25 + 45 + 25 | 185 lbs |
| "two plates" / "two plates each side" | 45 + 90 + 90 | 225 lbs |
| "10lb plates on each side" | 45 + 10 + 10 | 65 lbs |

**Standard barbell weight**: 45 lbs (unless user specifies otherwise)
**"Plates"** without specification usually means 45 lb plates
**"each side"** means the weight is on both sides (already reflected in total)

When a user describes plate loading, calculate the total weight and confirm:
"Got it — bar + 10s each side = 65 lbs total. That right?"

## Retroactive Set Descriptions

Users sometimes describe sets after the fact:
- "2 & 3 were with bar & 10lb plates on each side" → Sets 2 and 3 used 65 lbs
- "last set was at 185" → The most recent set used 185 lbs
- "first two were warmup" → Sets 1 and 2 were warmup sets

When a user retroactively describes sets, update the already-logged sets rather than creating new ones.
```

### Implementation Order

1. **Fix 5** (Rewrite plan-biased instructions) — Immediate, prompt-only change, no code
2. **Fix 6** (Enable web search) — One-line code change
3. **Fix 7** (Improve exercise parsing) — Prompt addition
4. **Fix 3** (Workout session manager) — New module, moderate code
5. **Fix 4** (Rich message history) — Enhancement to existing module
6. **Fix 2** (Tiered system prompt) — Refactor of `buildSystemPrompt()`
7. **Fix 1** (Conversation-aware queries) — Architecture change, most impactful

Fixes 1-3 can be done incrementally. Each independently improves the system.

### Testing Strategy

After each fix, test these scenarios:

1. **Basic workout flow**: Start workout → log 3 exercises → /done. Verify correct exercise names, sets, and completion.

2. **Exercise deviation**: Start workout → log exercise NOT in the plan → verify bot acknowledges the actual exercise, not the planned one.

3. **Correction**: Log an exercise → say "actually that was [different exercise]" → verify bot corrects it.

4. **Skip and continue**: Log 2 exercises → say "skip [exercise]" → log next exercise → verify bot tracks correctly.

5. **General question mid-workout**: Log an exercise → ask "what's the world record bench press?" → verify bot answers the question AND remembers the workout state.

6. **Out-of-order exercises**: Log exercise 3 from the plan first → verify bot doesn't try to re-suggest exercise 1 and 2.

7. **Natural language weights**: Say "bar with 25s each side" → verify bot calculates 95 lbs.

8. **Multi-message set logging**: Log set 1 → log set 2 → say "those were for incline bench" → verify bot assigns both sets to incline bench.

### Architecture Patterns from Successful Claude Bots

Based on research into OpenClaw (140k GitHub stars, formerly ClawdBot), NanoClaw, ClaudeClaw, and Anthropic's own Agent SDK best practices:

---

#### OpenClaw Architecture (Key Lessons)

OpenClaw is a **gateway**, not a framework. Its 5-stage pipeline is directly relevant:

1. **Channel Adapter** — Standardizes inputs from Telegram/Discord/WhatsApp into a unified format. IronClaude already does this via the Telegram webhook, but OpenClaw's adapter also extracts metadata (attachments, reply-to references, etc.).

2. **Gateway Server** — Acts as a **session coordinator**. Determines which session a message belongs to and assigns it to a queue. This is what IronClaude is missing — there's no session concept at the server level.

3. **Lane Queue** — The critical reliability layer. Enforces **serial execution by default** within a session. Each session gets its own "lane" and tasks execute one at a time. This prevents race conditions (e.g., two messages arriving rapidly and both trying to create a workout file). IronClaude has no execution queue — messages are processed in parallel with `processMessage().catch()`.

4. **Agent Runner** — Handles prompt assembly and **context window management**. Builds a custom system prompt for every run from modular sections.

5. **Agentic Loop** — Iterative tool use cycle with limits.

**The SOUL.md / Identity File Pattern** — OpenClaw separates agent identity into modular markdown files:
- `SOUL.md` — Behavioral philosophy, personality, values. The agent "embodies its persona and tone" rather than following rigid instructions. This is why OpenClaw agents feel natural vs. IronClaude feeling "stiff."
- `MEMORY.md` — Long-term curated memory (equivalent to IronClaude's `learnings.md`)
- `USER.md` — User profile and preferences (equivalent to `profile.md`)
- `AGENTS.md` — Instructions for the coding agent (equivalent to reference guides)

**Key insight**: OpenClaw uses **minimal prompts for sub-agents** — when spawning a sub-agent for a focused task, it strips down to just base identity + task. This is the tiered prompting pattern IronClaude needs.

**Memory search pattern**: Before answering about prior work, OpenClaw's prompt instructs: "Run `memory_search` on MEMORY.md + memory/*.md; then use `memory_get` to pull only the needed lines." This is **retrieval-augmented memory** — the model searches for relevant memories rather than having everything dumped into context.

**Memory flush before compaction**: When approaching context limits, a silent agentic turn triggers memory writing before compaction. This ensures no information is lost when the context window fills up.

---

#### NanoClaw Architecture (Key Lessons)

NanoClaw is a minimalist ~500-line TypeScript alternative:

- **Per-group isolation**: Each conversation gets its own container, context, and `CLAUDE.md` memory file. This prevents cross-contamination between different conversation contexts.
- **Skills over features**: Instead of adding features to core code, contributors create Claude Code skills (like `/add-telegram`) that transform the codebase. This keeps the core minimal.
- **Container-based execution**: Each agent run happens in an isolated container with only relevant directories mounted. This prevents file system conflicts.

**Key insight for IronClaude**: The per-context isolation pattern suggests IronClaude should have separate, focused contexts for different situations (workout vs. planning vs. general chat) rather than one monolithic context.

---

#### ClaudeClaw (Key Lessons)

A lightweight OpenClaw variant that runs as a **background daemon**:
- Executes tasks on schedule
- Responds to messages on Telegram
- Uses Claude Code's own SDK (zero additional API overhead)

**Key insight**: The daemon pattern with scheduled execution is exactly what IronClaude's cron system already does, but ClaudeClaw demonstrates that the messaging and scheduling should share a session/state layer.

---

#### Anthropic's Official Agent SDK Best Practices

**The Structured Artifacts Pattern**: Rather than relying on context compaction alone, use **structured artifacts** (JSON state files, git history, progress files) that persist between sessions. These are external to the context window and can be read at the start of each new session.

**Applied to IronClaude**: Instead of flat message history in the system prompt, maintain a `workout-state.json` that tracks:
```json
{
  "active": true,
  "date": "2026-02-22",
  "exercisesCompleted": ["Bench Press", "Incline DB Press"],
  "exercisesSkipped": ["Lateral Raises"],
  "currentExercise": null,
  "nextSuggested": "Tricep Pushdowns",
  "totalSets": 9,
  "startedAt": "14:00"
}
```

This file is read at the start of each agent call, giving Claude perfect state awareness without relying on conversation memory.

**The "Contract" Format for Prompts**: A good system prompt reads like a short contract:
- **Role** (1 line)
- **Success Criteria** (bullets)
- **Constraints** (bullets)
- **Uncertainty Handling Rule**
- **Output Format**

Don't mix context and instructions in one big paragraph.

**Progressive Disclosure**: Skills and plugins let Claude load what it needs, when it needs it. Everything else stays dormant. This is exactly the tiered prompting pattern recommended in Fix 2.

**Context Bloat Mitigation**:
- Spawn fresh Claude instances for sub-tasks with condensed state
- Provide tools like `grep` and `read_file` instead of dumping everything into context
- Instruct the model to use a "Search-Refine-Edit" pattern

---

#### Synthesized Best Practices for IronClaude

| Pattern | Source | IronClaude Status | Fix |
|---------|--------|------------------|-----|
| Session-based conversation | OpenClaw, ClaudeClaw | Missing entirely | Fix 1 |
| Serial execution queue | OpenClaw Lane Queue | Missing — parallel fire-and-forget | Fix 3 |
| Tiered/modular prompts | OpenClaw minimal mode | Monolithic prompt | Fix 2 |
| SOUL.md personality file | OpenClaw | Partial (system.md) | Enhance system.md |
| Structured state artifacts | Anthropic best practices | Missing | Fix 3 + Fix 4 |
| Memory search (RAG) | OpenClaw memory_search | Dumps all into context | Future: MCP tool |
| Per-context isolation | NanoClaw | Missing | Fix 2 + Fix 3 |
| User input priority | All successful bots | Inverted (plan-biased) | Fix 5 |
| Memory flush before compaction | OpenClaw | N/A (no long sessions) | Future |
| Confirmation before logging | Standard pattern | Missing | Add to prompt |
| Error/correction flow | Standard pattern | Missing | Add to prompt |

### Key Metrics to Track

After implementing fixes, monitor:
- **Correction rate**: How often does the user have to correct the bot? (Should decrease)
- **Turn count per workout**: How many back-and-forth messages per workout? (Indicates efficiency)
- **Exercise accuracy**: Does the logged exercise match what the user reported? (Should be ~100%)
- **Response latency**: How long does each response take? (Should decrease with tiered prompts)
- **Successful workout completions**: What % of started workouts reach `status: completed`?
