# IronClaude Redesign: Merged Architecture Plan

## Design Principles

These constraints shape every decision in this plan:

1. **Server-deployed, crash-safe**: Runs on Fly.io. Process can die at any time. All meaningful state must survive a restart — no relying on in-memory-only data.
2. **Agentic-first**: The Agent SDK's `query()` with tool use is the core strength. Claude reads files, writes files, uses tools. We keep that. We don't drop down to raw Messages API.
3. **Smart agent, simple code**: Prefer giving Claude better context over writing application-level parsers. A well-informed Sonnet 4.6 with the right context will outperform a brittle regex pre-parser. Let the agent do the heavy lifting.
4. **Model upgrade**: Move from `claude-sonnet-4-5-20250929` to `claude-sonnet-4-6-20250929`.

---

## Part 1: Bug Diagnosis (Merged)

### Bug 1: Exercise Confusion (Calf Raises Logged as Leg Curls)
The bot followed the plan's exercise order instead of listening to the user's actual input.

**Root causes**:
- Each message is a fresh `query()` call — Claude has no memory of its own previous tool calls or reasoning
- The workout-management prompt says "proactively tell them what's next from the plan" (`prompts/partials/workout-management.md:60`), biasing Claude toward plan-following over user-listening
- The flat text message history (`[HH:MM] User: calf raises`) loses the structure of what was actually logged
- Claude may be working with stale workout file data if the previous write hasn't synced

### Bug 2: "Second Done" / Contextual Confusion
The bot can't track "which exercise, which set" across messages.

**Root causes**:
- No concept of "current exercise" or "current set number" in any state
- 10-message text history injected into the system prompt is not real multi-turn conversation — Claude treats it as flat text alongside 1,300 lines of instructions
- The model has to re-derive the entire workout state by reading and parsing a markdown file on every single message

### Bug 3: Wrong Machine Identification
The bot hallucinated information about a gym machine instead of saying "I don't know."

**Root causes**:
- `WebSearch` is not in `allowedTools` for normal chat (only available via `/demo`)
- The prompt says "admit not knowing, then search" but the tool isn't available
- No explicit permission to express uncertainty — the prompt says "don't make things up" but doesn't give positive permission to say "I'm not sure"

### Bug 4: Stiff and Unnatural Responses
The bot reads like a manual, not a coach.

**Root causes**:
- ~1,400 lines of instructions loaded on every message, including 8+ reference guides
- 8+ `CRITICAL` markers, 5+ `IMPORTANT` markers, 3+ `ABSOLUTE RULE` markers all competing for attention — when everything is critical, nothing is
- The model spends its attention budget parsing rules instead of being conversational
- Weekly planning guide, retrospective guide loaded even when logging a bench press set

### Bug 5: Natural Language Weight Parsing
"2 & 3 were with bar & 10lb plates on each side" requires plate math the bot can't do.

**Root causes**:
- The exercise-parsing guide covers "175x5" format but not plate-loading descriptions
- No reference for standard barbell weight (45 lbs) or plate math
- No guidance for retroactive set descriptions ("sets 2 & 3 were...")

### Bug 6: Race Conditions (Silent Data Corruption)
Two rapid messages can both spawn `query()` calls that write to the same workout file simultaneously.

**Root causes**:
- `processMessage(update, bot).catch()` is fire-and-forget async
- No message serialization within a session
- Two concurrent writes to the same workout markdown = unpredictable results

---

## Part 2: Architectural Root Causes (Priority Order)

| # | Issue | Severity | Code Location |
|---|-------|----------|---------------|
| 1 | Stateless per-message `query()` | Critical | `src/coach/index.ts:252` |
| 2 | Monolithic system prompt (all guides, every time) | High | `src/coach/prompts.ts:160-334` |
| 3 | No workout session state machine | High | `src/handlers/webhook.ts:209` |
| 4 | Lossy flat-text message history | Medium-High | `src/bot/message-history.ts` |
| 5 | Plan-biased instructions | Medium | `prompts/partials/workout-management.md:60` |
| 6 | No message serialization (race conditions) | Medium | `src/handlers/webhook.ts` |
| 7 | No WebSearch in general chat | Low-Medium | `src/coach/index.ts:247` |

### The Core Insight

The problem isn't that Claude is dumb — it's that Claude is smart but blind. Every message, we hand it 1,400 lines of instructions and say "figure out what's going on." A well-informed agent with focused context will dramatically outperform a confused agent with everything.

---

## Part 3: The Fixes

### Fix 1: Crash-Safe Structured Workout State (Highest Priority)

**The problem**: During a workout, the only state is a growing markdown file. Claude must read it, parse tables, count rows, and cross-reference with the plan to know "what set are we on?" This is error-prone.

**The fix**: Maintain a structured JSON state file alongside the markdown workout log. This file is the agent's "cheat sheet" — it tells Claude exactly where things stand without parsing markdown.

**File**: `state/session.json` in the fitness-data repo (persisted via GitHub, survives crashes)

```json
{
  "mode": "workout_active",
  "workout": {
    "date": "2026-02-22",
    "type": "upper",
    "startedAt": "14:00",
    "exercisesCompleted": [
      {
        "name": "Bench Press",
        "sets": [
          { "weight": 175, "reps": 5, "rpe": 8 },
          { "weight": 175, "reps": 5, "rpe": 8.5 },
          { "weight": 170, "reps": 6, "rpe": 9 }
        ]
      }
    ],
    "exercisesSkipped": ["Lateral Raises"],
    "currentExercise": "OHP",
    "currentSetNumber": 2,
    "plannedExercises": ["Bench Press", "OHP", "Lateral Raises", "Tricep Pushdowns", "Face Pulls"]
  },
  "lastUpdated": "2026-02-22T14:35:00Z",
  "messageCount": 7
}
```

**How it works**:
1. When a workout starts, the agent creates `state/session.json` with the plan's exercises
2. After each exercise/set is logged, the agent updates this file (via its normal tool use — Write tool)
3. This file is **injected into the system prompt** as `<current-session-state>` on every message
4. On crash/restart, the file is read from GitHub — full state recovery
5. When the workout ends, the file is cleared (mode → "idle")

**Why this works with the agentic approach**: Claude already writes files as part of its workflow. We're just asking it to write one more small file. The structured JSON is injected into its context on the next message, so it always knows exactly where things stand. No application-level parsing needed.

**Key design decision**: This file lives in the fitness-data repo (GitHub-persisted), not in `/tmp/`. A Fly.io restart loses `/tmp/` but the GitHub file survives. The tradeoff is a GitHub API call to read it, but we're already making GitHub calls to read the workout file anyway.

**Instructions to add to the prompt**:
```
After every exercise you log or modify, update state/session.json to reflect
the current workout state. This file is your memory between messages — keep
it accurate. Include: exercises completed (with sets/reps/weight), exercises
skipped, current exercise, current set number, and planned exercises remaining.
```

### Fix 2: Mode-Based Prompt Assembly (High Priority)

**The problem**: `buildSystemPrompt()` loads all 8 reference guides (~1,400 lines) on every message. The weekly planning guide is irrelevant when logging bench press. The retrospective guide is irrelevant when asking about a gym machine.

**The fix**: Load only the guides relevant to the current mode. The mode is determined from `state/session.json` (or defaults to "chatting" if no session exists).

**Modes and their guides**:

| Mode | Loaded Guides | NOT Loaded |
|------|--------------|------------|
| `workout_active` | exercise-parsing, workout-management, pr-detection | weekly-planning, retrospective, historical-data, rpe-analysis |
| `chatting` | (none — just core identity) | all reference guides |
| `planning` | weekly-planning, historical-data | workout-management, pr-detection, exercise-parsing |
| `retrospective` | retrospective, historical-data, rpe-analysis | workout-management, exercise-parsing |

**Implementation** (modify `src/coach/prompts.ts`):

```typescript
type ConversationMode = 'workout_active' | 'chatting' | 'planning' | 'retrospective';

function getMode(sessionState: SessionState | null): ConversationMode {
  if (!sessionState) return 'chatting';
  return sessionState.mode;
}

function buildSystemPrompt(context: SystemPromptContext, mode: ConversationMode): string {
  const base = loadPrompt("system");           // Core identity (trimmed)
  const guides = loadGuidesForMode(mode);       // Only relevant guides
  const contextSection = buildContext(context);  // Dynamic data
  return `${base}\n\n${guides}\n\n${contextSection}`;
}

function loadGuidesForMode(mode: ConversationMode): string {
  switch (mode) {
    case 'workout_active':
      return [
        loadPartial("exercise-parsing"),
        loadPartial("workout-management"),
        loadPartial("pr-detection"),
      ].join("\n\n");
    case 'planning':
      return [
        loadPartial("weekly-planning"),
        loadPartial("historical-data"),
      ].join("\n\n");
    case 'retrospective':
      return [
        loadPartial("retrospective"),
        loadPartial("historical-data"),
        loadPartial("rpe-analysis"),
      ].join("\n\n");
    case 'chatting':
      return ""; // No guides needed for general chat
  }
}
```

**Estimated prompt reduction**:
- Workout mode: ~645 → ~425 lines of guides (exercise-parsing + workout-management + pr-detection)
- Chat mode: ~645 → 0 lines of guides
- Planning: ~645 → ~370 lines of guides
- **Average reduction**: 40-100% of guide content removed per message

**What stays in the base prompt**: Core identity, coaching style, communication rules, date/time, integration status. These are always relevant. Everything else is mode-gated.

### Fix 3: Inject Session State as Structured Context (High Priority)

**The problem**: Claude has to read the workout file, parse markdown tables, and count rows to figure out where we are. This is the single biggest source of hallucinated summaries and exercise confusion.

**The fix**: Inject the `state/session.json` content directly into the system prompt as a structured XML block. Claude reads it instantly — no file parsing needed.

**Add to the system prompt construction**:
```typescript
function buildContext(context: SystemPromptContext): string {
  let sections = [];

  // Session state (from state/session.json)
  if (context.sessionState) {
    sections.push(`<current-session-state>
${JSON.stringify(context.sessionState, null, 2)}
</current-session-state>`);
  }

  // ... rest of context (plan, PRs, learnings, etc.)
}
```

**What Claude sees at the top of every workout message**:
```xml
<current-session-state>
{
  "mode": "workout_active",
  "workout": {
    "exercisesCompleted": [
      { "name": "Bench Press", "sets": [{"weight": 175, "reps": 5}, ...] }
    ],
    "currentExercise": "OHP",
    "currentSetNumber": 2,
    "plannedExercises": ["Bench Press", "OHP", "Lateral Raises", "Tricep Pushdowns"]
  }
}
</current-session-state>
```

**Why this is better than the "cumulative state summary" pattern**: Both plans (and Anthropic's own research) recommend injecting state. The question is: who maintains it? In our design, **Claude maintains it** (by writing `session.json` after each action) and **the application injects it** (by reading `session.json` before each `query()`). This keeps the agentic philosophy — Claude is responsible for its own state — while giving it perfect recall.

### Fix 4: Message Serialization Queue (High Priority)

**The problem**: Two rapid messages can both spawn `query()` calls that write to the same files simultaneously, causing silent data corruption.

**The fix**: A simple per-chat serial queue. Messages execute one at a time.

**Implementation** (modify `src/handlers/webhook.ts`):

```typescript
// Simple serial queue per chat
const messageQueues = new Map<number, Promise<void>>();

async function enqueueMessage(chatId: number, fn: () => Promise<void>): Promise<void> {
  const previous = messageQueues.get(chatId) || Promise.resolve();
  const current = previous.then(fn, fn); // Execute after previous completes (even if it failed)
  messageQueues.set(chatId, current);
  await current;
}

// In webhookHandler:
enqueueMessage(chatId, async () => {
  await processMessage(update, bot);
});
```

This is ~10 lines of code. No external dependencies. Messages still process in the background (Telegram gets 200 immediately), but they execute in order within a chat.

**Crash safety**: If the process dies mid-queue, the queue is lost — but that's fine. The next message after restart will read the latest `state/session.json` from GitHub and continue from the last committed state. No corruption.

### Fix 5: Rewrite Plan-Biased Instructions (Medium Priority, Zero Code)

**The problem**: The workout-management prompt tells Claude to "proactively suggest the next exercise from the plan." This makes Claude follow the plan's order instead of listening to the user.

**The fix**: Replace the plan-biased instruction with user-biased instruction.

**In `prompts/partials/workout-management.md`, replace**:
```
5. **Guide to next exercise**
   - If a weekly plan exists, proactively tell them what's next: "Next up: {exercise from plan}"
   - Don't ask "What's next?" - inform them based on the plan
```

**With**:
```
5. **After logging an exercise**
   - FIRST: Confirm what the user actually did (the exercise THEY reported, not what the plan says)
   - SECOND: Mention what the plan suggests next as a suggestion, not a directive
   - Example: "✓ Calf Raises — 65 x 12. Plan has leg curls next — want to do those or move on?"
   - If the user is doing exercises out of order or substituting, follow THEIR flow
   - The user's message is the source of truth for what they did. The plan is a suggestion for what to do next.
```

**Also add to the base system prompt**:
```
If you are not sure about an exercise, weight, or rep count, ask rather than
guess. Accuracy matters more than speed for progressive overload tracking.
It's better to say "I'm not sure — was that bench or incline?" than to guess wrong.
```

### Fix 6: Add Plate Math and Retroactive Sets to Exercise Parsing (Medium Priority, Zero Code)

**The problem**: "Bar & 10lb plates on each side" = 65 lbs, but the parsing guide doesn't cover plate math.

**The fix**: Add to `prompts/partials/exercise-parsing.md`:

```markdown
## Plate Math & Natural Language Weights

Users sometimes describe weights using plate configurations:

| Description | Calculation | Total |
|-------------|-------------|-------|
| "bar with 10s" | 45 (bar) + 10 + 10 | 65 lbs |
| "bar with 25s" | 45 + 25 + 25 | 95 lbs |
| "bar with 45s" / "a plate" | 45 + 45 + 45 | 135 lbs |
| "two plates" / "two plates each side" | 45 + 90 + 90 | 225 lbs |
| "plate and a quarter each side" | 45 + (45+25) + (45+25) | 185 lbs |

Standard barbell = 45 lbs unless stated otherwise.
"Each side" means the weight is on both ends (reflected in total).

When uncertain, confirm: "Bar + 10s each side = 65 lbs total — right?"

## Retroactive Set Descriptions

Users sometimes describe sets after the fact:
- "2 & 3 were with bar & 10lb plates" → Sets 2 and 3 used 65 lbs
- "last set was at 185" → Most recent set used 185 lbs
- "first two were warmup" → Sets 1 and 2 were warmup sets

Update already-logged sets rather than creating new ones.
```

### Fix 7: Enable WebSearch for General Chat (Low-Medium Priority, One Line)

**The fix** (in `src/coach/index.ts`):
```typescript
// Add WebSearch to base allowed tools
const baseTools = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", ...mcpToolNames];
```

### Fix 8: Trim the Base System Prompt (Medium Priority)

**The problem**: The base `prompts/system.md` (216 lines) has competing priority markers and redundant instructions.

**The fix**:
1. **Cut priority markers**: Remove all but 2-3 uses of CRITICAL/IMPORTANT. Reserve these for genuinely critical rules (e.g., "never fabricate workout data")
2. **Replace rules with examples**: Add a short example conversation showing ideal workout-mode behavior (borrowed from the prompt engineering research)
3. **Add uncertainty permission**: Explicitly allow Claude to say "I'm not sure"
4. **Add investigation mandate**: "Always read the workout file before claiming what exercises were completed"
5. **Separate identity from instructions**: Put coaching personality in a `<your-identity>` block, task instructions in a `<instructions>` block, using XML tags for clear boundaries

**Example conversation to add** (teaches by showing, not telling):
```
<example-workout-conversation>
User: bench 175x5
Coach: ✓ Bench Press — 175 x 5
Two more sets at 175, then OHP.

User: 175x5
Coach: ✓ Set 2 — 175 x 5

User: last set, 170x6 felt tough
Coach: ✓ Set 3 — 170 x 6. Good grind.
Moving to OHP — 3x6 @ 95 per plan. Rest up.

User: actually I want to do lateral raises first
Coach: Sure. Lateral raises it is — what weight?
</example-workout-conversation>
```

### Fix 9: Upgrade to Sonnet 4.6 (Quick Win)

**The fix** (in `src/coach/index.ts`):
```typescript
model: config.model || "claude-sonnet-4-6-20250929"
```

Sonnet 4.6 is better at following nuanced instructions, less prone to over-specified prompt confusion, and more naturally conversational. Combined with the prompt trimming, this should noticeably improve response quality.

---

## Part 4: What We Considered and Rejected

### Rejected: Dropping Agent SDK for Raw Messages API

Both original plans proposed replacing `query()` with direct Anthropic Messages API calls to maintain a true multi-turn conversation. This would give Claude full memory of its previous tool calls and reasoning.

**Why we rejected it**: The user wants to keep the agentic approach. The Agent SDK handles tool execution, error recovery, and the agentic loop. Reimplementing that with raw `messages.create()` is a lot of code, and the tool-use loop is non-trivial (especially with streaming, retries, and multi-tool chains). The structured state injection approach (Fix 1 + Fix 3) gives us 80% of the benefit at 10% of the complexity. If Claude knows "I've logged Bench Press 3x5@175 and OHP 1x6@95, currently on OHP set 2" via JSON state, it doesn't need to remember its own tool calls — it has the result.

**Future reconsideration**: If the state injection approach still leads to confusion after shipping, we could explore passing prior messages to `query()` via the SDK's messages option, or maintaining a lightweight conversation log. But start simple.

### Rejected: Application-Level Exercise Parser (TypeScript Regex)

My original plan proposed pre-parsing "bench 175x5" in TypeScript before sending to Claude, maintaining a separate structured tracker in application code.

**Why we rejected it**: This fights against the agentic design. Claude is already great at parsing "bench 175x5" — the problem isn't parsing, it's context. A regex parser would need to handle every format users throw at it (abbreviations, plate math, natural language, corrections, retroactive descriptions). Claude handles all of these naturally. The real fix is giving Claude better context (structured state) so it knows what to do with the parsed result. Let the smart agent do the smart work.

### Rejected: Application-Level Message Classifier

My original plan proposed classifying messages (exercise_input, question, command, etc.) in TypeScript before routing to different handlers.

**Why we rejected it**: Same reasoning. The mode-based prompt system (Fix 2) already focuses Claude's attention. Within a mode, Claude is perfectly capable of distinguishing "175x5" from "what's next?" from "I'm done." Adding a classifier adds complexity, maintenance burden, and failure modes (misclassification) without clear benefit. If the classifier gets it wrong, it's worse than not having one.

### Rejected: In-Memory-Only State

The other plan proposed `let activeSession: WorkoutSession | null = null` — a pure in-memory session object.

**Why we rejected it**: Fly.io can restart the process at any time. In-memory state is lost. For a workout that lasts 45-90 minutes, a crash mid-session would lose all state. By persisting to GitHub (which we already do for the workout file), we get crash recovery for free. The tradeoff is one additional GitHub API call per message to read `state/session.json`, but we're already making GitHub calls for the workout file, plan, and PRs.

### Rejected: OpenClaw-Style Architecture (Lane Queue, SOUL.md, Container Isolation)

The other plan extensively studied OpenClaw's 5-stage pipeline with channel adapters, gateway servers, lane queues, and container isolation.

**Why we adopted only the serial queue**: OpenClaw is a multi-user, multi-channel platform. IronClaude is a single-user Telegram bot. We don't need channel adapters (one channel), gateway servers (one endpoint), or container isolation (one user). The serial queue pattern (Fix 4) is the one piece that directly applies — preventing race conditions when messages arrive rapidly. Everything else is over-engineering for our use case.

**SOUL.md pattern**: Interesting but not needed. Our `prompts/system.md` already serves this purpose. The insight about "embody a persona rather than follow rigid instructions" is captured in Fix 8's prompt trimming — fewer rules, more examples, more personality.

### Considered but Deferred: Rich Message History

The other plan proposed adding `parsedExercise`, `setsLogged`, `coachAction`, `correction` fields to the message history.

**Why deferred**: The structured session state (Fix 1) makes this less critical. If `state/session.json` already tells Claude "Bench Press: 3 sets completed, OHP: 1 set completed," the message history doesn't need to duplicate that. We keep the current flat text history as a conversational aide, and rely on the session state for structured tracking. If the session state approach proves insufficient, we can revisit enriching the history.

### Considered but Deferred: Memory Flush Before Context Compaction

OpenClaw's pattern of saving state before the context window fills up.

**Why deferred**: Our `query()` calls are short-lived (single message → response). We don't have long-running sessions that approach context limits. The session state file inherently persists everything we need. If we later move to multi-turn conversations within `query()`, this becomes relevant.

---

## Part 5: Implementation Order

### Phase 1: Prompt Fixes (Zero Code Changes, Immediate Impact)

These can ship today. They fix real bugs with no risk.

1. **Fix 5**: Rewrite plan-biased instructions in `workout-management.md`
2. **Fix 6**: Add plate math and retroactive sets to `exercise-parsing.md`
3. **Fix 8**: Trim base system prompt — fewer priority markers, add examples, add uncertainty permission, add investigation mandate

**Expected impact**: Bug 1 (exercise confusion) and Bug 5 (plate math) directly addressed. Bug 4 (stiffness) partially addressed.

### Phase 2: Architecture Changes (Medium Effort, High Impact)

4. **Fix 9**: Upgrade to Sonnet 4.6 (one-line change, but test thoroughly)
5. **Fix 7**: Enable WebSearch (one-line change)
6. **Fix 4**: Message serialization queue (10 lines of code)
7. **Fix 2**: Mode-based prompt assembly (refactor `buildSystemPrompt()`)
8. **Fix 1**: Structured session state file (`state/session.json`)
9. **Fix 3**: Inject session state into system prompt

Fixes 7-9 are tightly coupled and should ship together.

**Expected impact**: All bugs addressed. 40-100% reduction in prompt size. Crash-safe state persistence. No more race conditions.

### Phase 3: Polish (If Needed After Phase 1-2)

10. Enrich message history with structured metadata (if session state alone isn't enough)
11. Add adaptive thinking (enable for planning/retro, skip for workout logging)
12. Add confirmation flow for ambiguous inputs (prompt-level, not code-level)

---

## Part 6: Specific Code Changes

### Modified Files

| File | Changes |
|------|---------|
| `src/coach/index.ts` | Change default model to `claude-sonnet-4-6-20250929`. Add `WebSearch` to `allowedTools`. Read `state/session.json` in `runQuery()` context pre-loading. |
| `src/coach/prompts.ts` | Accept `mode` parameter. Load guides conditionally based on mode. Inject session state as `<current-session-state>` XML block. |
| `src/handlers/webhook.ts` | Add message serialization queue. Read session state to determine mode before calling agent. |
| `prompts/system.md` | Trim to ~120 lines. Add XML structure tags. Add example conversation. Add uncertainty permission. Add investigation mandate. Reduce priority markers. |
| `prompts/partials/workout-management.md` | Rewrite "guide to next exercise" section to be user-biased. Add session state update instructions. |
| `prompts/partials/exercise-parsing.md` | Add plate math table. Add retroactive set handling. |

### New Files

| File | Purpose |
|------|---------|
| `src/state/session.ts` | TypeScript types for session state. Helper functions: `readSessionState()`, `getMode()`. Reads from GitHub, returns typed object. |

### Deleted/Removed Content

- Remove ~50% of `CRITICAL`/`IMPORTANT`/`ABSOLUTE RULE` markers from all prompt files
- Remove the `plan-flexibility.md` partial (fold the key insight — "user can deviate from plan" — into the rewritten `workout-management.md`)

---

## Part 7: Testing Strategy

After implementing, verify these scenarios:

| # | Scenario | What to Check |
|---|----------|---------------|
| 1 | Basic workout flow | Log 3 exercises → /done. Correct names, sets, completion. |
| 2 | Exercise deviation | Log an exercise NOT in the plan. Bot acknowledges the actual exercise. |
| 3 | "Second done" | Log set 1, say "second done." Bot logs set 2 of the same exercise. |
| 4 | Correction | Log bench press → "actually that was incline." Bot corrects it. |
| 5 | Skip exercise | "Skip lateral raises." Bot removes from remaining, suggests next. |
| 6 | Out-of-order | Do exercise 3 from plan first. Bot doesn't re-suggest exercises 1-2. |
| 7 | Plate math | "Bar with 25s each side." Bot calculates 95 lbs and confirms. |
| 8 | General question mid-workout | Ask "what's the world record bench?" Bot answers AND maintains workout state. |
| 9 | Web search | Ask about a specific machine model. Bot searches and gives real info. |
| 10 | Crash recovery | Kill process mid-workout, restart. Bot picks up from `state/session.json`. |
| 11 | Rapid messages | Send 3 messages in 2 seconds. All process in order, no file corruption. |

---

## Part 8: Key Metrics

| Metric | How to Measure | Target |
|--------|---------------|--------|
| Exercise accuracy | Manual: does logged exercise match user input? | ~100% (currently ~80%) |
| Correction rate | How often user corrects the bot | < 1 per workout (currently ~2-3) |
| Response naturalness | Subjective: does it feel like a coach? | Noticeable improvement |
| Prompt size | Token count of system prompt | 40-60% reduction in workout mode |
| Response latency | Time from message to response | Decrease (smaller prompt = faster) |
| Crash recovery | Does state survive restart? | 100% |

---

## Part 9: Research That Informed This Plan

### Why Structured State Injection Works
**Source**: [Anthropic — Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Anthropic recommends injecting a "game state summary" at the start of each message. Models anchor to structured data more reliably than conversation flow. This is the theoretical basis for Fix 1 + Fix 3.

### Why Prompt Trimming Matters
**Source**: ["LLMs Get Lost In Multi-Turn Conversation" (Microsoft Research)](https://arxiv.org/abs/2505.06120)

Models exhibit a 39% performance drop in multi-turn conversations. Once they take a wrong turn, they don't recover. Reducing noise in the prompt gives the model more attention budget for the actual task.

**Source**: Over-specified CLAUDE.md research

"~150-200 instructions is the reasonable limit for consistent adherence." IronClaude's current prompt likely exceeds this. "Never send an LLM to do a linter's job" — deterministic rules should be in code, not prompts.

### Why Serial Queues Matter
**Source**: [OpenClaw Lane Queue pattern](https://github.com/openclaw/openclaw)

"The default failure mode in concurrent agent systems" is race conditions from parallel message processing. Serial execution within a session is the standard fix.

### Why Examples Beat Rules
**Source**: [Anthropic — Prompt Engineering Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

One well-chosen example teaches the model more than 10 rules. Start with one-shot examples, only add more if needed. Verbosity alone makes outputs worse.

### Sources

- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Claude Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [LLMs Get Lost In Multi-Turn Conversation (Microsoft Research)](https://arxiv.org/abs/2505.06120)
- [OpenClaw Architecture](https://github.com/openclaw/openclaw)
- [Anthropic: Context Management](https://www.anthropic.com/news/context-management)
- [Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
