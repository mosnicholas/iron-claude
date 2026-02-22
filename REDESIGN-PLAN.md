# IronClaude Redesign: Diagnosis & Architecture Plan

## Part 1: Root Cause Analysis

### What's Going Wrong (From the Screenshots + Code)

After a thorough review of the codebase and the bug screenshots, here are the core problems:

#### Bug 1: Incorrect Workout Summaries (Hallucinated Exercise Completions)
The bot said exercises were completed that were actually skipped, and missed exercises that were done. This happens because:
- Each message creates a **fresh `CoachAgent` instance** with a brand new `query()` call
- The only "memory" of what happened in the workout is the markdown file on disk
- The model must **read the workout file** to know what's been logged, but it often skips this step or misreads it
- There's no structured state tracking — just a markdown file that the model has to parse every time

#### Bug 2: "Second done" Confusion
When the user says "second done" (meaning second set of leg press), the bot struggles because:
- The conversation history is just 10 text lines injected into the system prompt as `[HH:MM] User: text`
- This is **not real multi-turn conversation** — Claude processes it as flat text inside its system prompt
- There's no concept of "current exercise" or "current set number" in the state
- The model has to infer all context from the markdown file + injected text history

#### Bug 3: Wrong Machine Identification
The bot gave generic/wrong info about a gym machine because:
- It doesn't have access to look things up (no WebSearch in normal messages)
- The system prompt tells it to "admit not knowing, then search" but WebSearch isn't in the allowed tools list for regular chat
- It hallucinated an answer rather than saying "I don't know"

#### Bug 4: Stiff and Unnatural Responses
The bot reads like a manual, not a coach, because:
- The system prompt is ~1000+ lines of instructions, reference guides, and rules
- It includes EVERY guide for EVERY mode (workout logging + PR detection + RPE analysis + weekly planning + retrospectives + plan flexibility + historical data) on EVERY single message
- The model spends its "attention budget" parsing rules instead of being conversational
- Too many `CRITICAL`, `IMPORTANT`, `ABSOLUTE RULE` markers competing for attention

---

## Part 2: Architectural Issues (The Deeper Problems)

### 1. Stateless Per-Message Architecture
**Current**: Every Telegram message → new `CoachAgent()` → new `query()` → fresh system prompt → response → discard everything.

The only continuity between messages:
- A 20-message text history file (`/tmp/iron-claude-message-history.json`) formatted as flat text in the system prompt
- The workout markdown file on disk

**Problem**: Claude Agent SDK's `query()` is designed for single-shot tasks. Each call starts a completely new conversation with Claude. There's no multi-turn conversation happening — what looks like a chat is actually dozens of independent API calls, each one rebuilding the entire world from scratch.

### 2. Conversation History is Prompt-Injected Text, Not Real Turns
**Current**: Message history is formatted as:
```
[14:30] User: bench 175x5
[14:30] Coach: ✓ Bench Press 175 x 5. Next up: OHP...
[14:32] User: second done
```
This is injected into the system prompt as plain text.

**Problem**: Claude can't distinguish between **instructions** and **conversation**. The model treats this text the same as the rest of the system prompt. In a real multi-turn conversation, Claude maintains an internal model of the dialogue flow. Here, it has to reconstruct that understanding from text every time.

### 3. Monolithic Prompt (Everything, Every Time)
**Current**: `buildSystemPrompt()` includes ALL of:
- Core identity + coaching style (~100 lines)
- Exercise parsing guide (~66 lines)
- Workout management guide (~215 lines)
- PR detection guide (~147 lines)
- RPE analysis guide (~60 lines)
- Plan flexibility guide (~84 lines)
- Historical data guide (~78 lines)
- Weekly planning guide (~294 lines)
- Retrospective guide (~277 lines)
- Dynamic context (plan, PRs, learnings, workout, week progress)

That's **1300+ lines of instructions** for every message, including "yes" or "175x5".

**Problem**: Attention dilution. The model has so many instructions that it can't focus on the relevant ones. The weekly planning guide is irrelevant when logging a bench press set, but it's consuming context tokens and competing for attention.

### 4. No Explicit State Machine
**Current**: The code has three implicit states checked in the webhook handler:
1. `gymTimePending` — checked via GitHub API call
2. `planningPending` — checked via GitHub API call
3. Everything else → send to agent

**Problem**: There's no concept of "we are in an active workout session." The model has to figure this out by reading files. If the user is mid-workout and sends a message, the model doesn't know if it should:
- Log an exercise
- Answer a question
- Continue the previous exercise's sets
- Complete the workout

### 5. No Structured In-Progress Workout State
**Current**: During a workout, the only state is the growing markdown file. To know "what set are we on?" the model must read the file, parse the markdown table, count rows, cross-reference with the plan.

**Problem**: This is error-prone. The model can miscount sets, forget which exercise was being discussed, or hallucinate completed exercises. It's asking a language model to do structured data operations by parsing markdown every single message.

### 6. GitHub API Calls for State Checks on Every Message
**Current**: Every incoming message triggers `storage.getGymTimePendingState()` and `storage.getPlanningState()` — both are GitHub API calls.

**Problem**: Latency and fragility. Every message pays the cost of GitHub API roundtrips before even starting to process.

---

## Part 3: Redesign Recommendations

### Architecture Change 1: Multi-Turn Conversations (Highest Impact)

**The single biggest improvement**: Replace per-message `query()` with persistent multi-turn conversations using the Claude API's messages endpoint directly.

**How it works now**:
```
Message 1: query("bench 175x5", systemPrompt) → response → discard
Message 2: query("175x5", systemPrompt)        → response → discard
Message 3: query("done", systemPrompt)          → response → discard
```

**How it should work**:
```
Session starts → build system prompt → create conversation
Message 1: conversation.addUser("bench 175x5") → response (kept)
Message 2: conversation.addUser("175x5")        → response (kept, with full prior context)
Message 3: conversation.addUser("done")          → response (kept, knows entire workout)
```

**Implementation approach**:
- Use the Anthropic SDK's messages API directly (not the Agent SDK's `query()`) for the core chat loop
- Maintain a conversation `messages` array in memory (and persist to disk for crash recovery)
- The system prompt is set once per "session" (workout session, chat session, etc.)
- Tool use still works — Claude can call Read/Write/Edit tools within the conversation
- Session expires after inactivity (e.g., 4 hours) or explicit end (`/done`)

**Why this fixes the bugs**:
- Claude remembers "we were doing leg press" without re-reading files
- "Second done" makes sense because the previous turn said "first set logged"
- The model maintains a coherent mental model of the workout across all messages
- Responses are more natural because the model is actually in a conversation, not answering isolated prompts

**Alternative if you want to keep the Agent SDK**: Use `query()` but pass in the full conversation history as proper `messages` array (user/assistant pairs) rather than text injected into the system prompt. The SDK supports this via the `messages` option.

### Architecture Change 2: Dynamic Prompt Assembly (Mode-Based)

**Replace the monolithic prompt with a layered system**:

```
Layer 1 (always): Core identity + coaching style + date/time + environment (~50 lines)
Layer 2 (always): Athlete context (plan, PRs, learnings)
Layer 3 (mode-specific): Only the relevant reference guide(s)
```

**Modes and their guides**:

| Mode | Active Guides | Inactive Guides |
|------|--------------|-----------------|
| `workout_active` | exercise-parsing, workout-management, pr-detection | weekly-planning, retrospective, historical-data |
| `chatting` | (none — just core identity) | all reference guides |
| `planning` | weekly-planning, historical-data | workout-management, pr-detection |
| `retrospective` | retrospective, historical-data | workout-management, weekly-planning |
| `analyzing` | historical-data, rpe-analysis | workout-management, weekly-planning |

**This cuts the system prompt by 60-80%** for most messages, giving the model more room to focus on the actual task.

**Implementation**:
```typescript
function buildSystemPrompt(mode: ConversationMode, context: SystemPromptContext): string {
  const core = loadPrompt("core-identity");     // Always
  const athleteContext = buildAthleteContext(context);  // Always
  const guides = getGuidesForMode(mode);         // Mode-specific
  return `${core}\n\n${athleteContext}\n\n${guides}`;
}
```

### Architecture Change 3: Explicit State Machine

**Add a lightweight conversation state tracker**:

```typescript
interface ConversationState {
  mode: 'idle' | 'workout_active' | 'planning' | 'chatting';

  // Workout-specific state (when mode === 'workout_active')
  workout?: {
    date: string;
    type: string;
    startedAt: string;
    exercisesCompleted: Array<{
      name: string;
      sets: Array<{ weight: number; reps: number; rpe?: number }>;
    }>;
    currentExercise?: string;
    planReference?: string;
    nextPlannedExercise?: string;
  };

  // Conversation tracking
  sessionStartedAt: string;
  lastMessageAt: string;
  messageCount: number;
}
```

**This state is**:
- Updated after each message (by the application code, not the LLM)
- Injected into the system prompt as structured context
- Persisted to disk (for crash recovery)
- Used to determine which mode we're in and which guides to load

**Key state transitions**:
```
idle → workout_active:  User sends first exercise input
workout_active → idle:  User says "done" / /done / 4hr timeout
idle → planning:        Cron triggers or user says "plan my week"
planning → idle:        Plan generated and saved
idle → chatting:        User sends non-exercise text
chatting → workout_active: User sends exercise input
```

### Architecture Change 4: Structured Workout Tracker (Parse Before LLM)

**Move exercise parsing out of the LLM and into application code**:

Currently, the LLM does everything: parse "bench 175x5", determine it's Bench Press at 175 lbs for 5 reps, update the markdown file, check PRs, respond. This is error-prone.

**Better approach**:
1. **Pre-parse** common exercise formats in TypeScript code (regex-based)
2. **Maintain structured state** as JSON (not just markdown)
3. **Let the LLM handle** ambiguous inputs, coaching decisions, and natural language
4. **Use the structured state** to generate accurate summaries (not LLM recall)

```typescript
// Before sending to Claude:
const parsed = tryParseExerciseInput(userMessage);
if (parsed) {
  // We know it's "Bench Press, 175 lbs, 5 reps"
  // Update structured state
  state.workout.exercisesCompleted.push(parsed);
  // Tell Claude what happened (structured, not ambiguous)
  augmentedMessage = `[SYSTEM: Logged ${parsed.exercise}: ${parsed.weight}x${parsed.reps}. ` +
    `Set ${state.workout.currentSetNumber} of exercise ${state.workout.exercisesCompleted.length}. ` +
    `Next planned: ${state.workout.nextPlannedExercise}]` +
    `\n\nUser said: "${userMessage}"`;
}
```

**The LLM still**:
- Generates the conversational response
- Handles ambiguous inputs ("that felt heavy", "skip triceps")
- Makes coaching decisions
- Writes the workout file

**But the application code**:
- Tracks what's been logged (reliably)
- Knows what set we're on (no hallucination)
- Can generate accurate summaries
- Handles the mechanical bookkeeping

### Architecture Change 5: Smart Message Classification

**Before hitting the LLM, classify the message to optimize routing**:

```typescript
type MessageType =
  | 'exercise_input'    // "bench 175x5", "175x5", "3x8 lateral raises 20s"
  | 'set_update'        // "done", "second done", "that's 3"
  | 'commentary'        // "felt heavy", "easy set"
  | 'question'          // "what's next?", "how's my bench?"
  | 'command'           // "/done", "/demo", "/help"
  | 'end_workout'       // "I'm done", "finished", "calling it"
  | 'planning_response' // response to planning questions
  | 'general'           // everything else
```

**This enables**:
- Exercise inputs get fast-path processing (parse → log → brief confirmation)
- Questions get full context assembly
- End signals trigger completion workflow immediately
- General messages get the conversational treatment

### Architecture Change 6: Local State Instead of GitHub API Checks

**Move transient state to local disk/memory**:

Currently, every message does:
```typescript
const gymTimeState = await storage.getGymTimePendingState();  // GitHub API call
const planningState = await storage.getPlanningState();         // GitHub API call
```

**Move to**:
```typescript
// In-memory state with disk persistence
const state = LocalState.load();  // Read from /tmp/iron-claude-state.json
if (state.gymTimePending) { ... }
if (state.planningPending) { ... }
```

**GitHub is still the source of truth** for workout logs, plans, PRs, etc. But transient state (pending flags, conversation state, current workout progress) should live locally for speed.

### Architecture Change 7: Tool Access Control

**Give WebSearch to the regular chat mode** so the bot can actually look things up when asked about equipment, exercises, etc. Currently it's only available via `/demo`:

```typescript
// Current
const baseTools = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", ...mcpToolNames];

// Proposed: Add WebSearch for general chat
const baseTools = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", ...mcpToolNames];
```

This fixes the "wrong machine identification" bug — the bot can actually search instead of guessing.

---

## Part 4: Prompt Engineering Improvements

### 1. Separate "Identity" from "Instructions"

**Current**: Everything is in one massive prompt. The model's personality, coaching rules, exercise parsing, PR detection, etc. are all jumbled together.

**Better**: Two-layer prompt structure:
```
IDENTITY (who you are, how you communicate):
  - You are a personal fitness coach
  - Keep messages concise (Telegram, mobile-first)
  - Be direct, specific, encouraging but not sappy
  - Celebrate PRs genuinely

INSTRUCTIONS (what to do right now, based on mode):
  - [mode-specific guide only]
```

### 2. Reduce Competing Priorities

**Current**: The prompt has 8+ `CRITICAL` markers, 5+ `IMPORTANT` markers, 3+ `ABSOLUTE RULE` markers. When everything is critical, nothing is.

**Better**: One clear priority hierarchy per mode:
```
WORKOUT MODE:
1. Parse and log the exercise accurately
2. Check for PRs
3. Tell them what's next
4. Keep it brief

THAT'S IT. Nothing about retrospectives, planning, historical analysis, etc.
```

### 3. Use XML Tags for Clear Section Boundaries

**Current**: Already partially doing this with `<exercise-parsing>` etc., but the sections are all included all the time.

**Better**: Only include relevant sections, and use clear role tags:
```xml
<your-identity>
You are a personal fitness coach...
</your-identity>

<current-situation>
Mode: workout_active
Exercise #3 of 5 planned
Current exercise: OHP (3x6 @ 95)
Sets completed: 1 of 3
</current-situation>

<reference>
[Only workout-management guide, not all 8 guides]
</reference>
```

### 4. Add "Thinking Protocol" for Ambiguous Inputs

When the user sends something ambiguous (like "second done"), the model should have a clear protocol:

```
When user input is ambiguous:
1. Check conversation history — what were we just talking about?
2. Check current workout state — what exercise is in progress?
3. Make your best interpretation
4. State your interpretation briefly: "✓ OHP Set 2: 95 x 6"
5. If truly unclear, ask ONE clarifying question
```

### 5. Fewer Rules, More Examples

**Current**: Long lists of rules ("NEVER do X", "ALWAYS do Y", "CRITICAL: Z").

**Better**: Replace rules with examples of good behavior:

```
Example conversation during a workout:

User: bench 175x5
Coach: ✓ Bench Press — 175 x 5
Next: 2 more sets @ 175, then OHP.

User: 175x5
Coach: ✓ Set 2 — 175 x 5

User: last set, 170x6 felt tough
Coach: ✓ Set 3 — 170 x 6. Good grind.
Moving on to OHP — 3x6 @ 95. Rest up.

User: 95x6
Coach: ✓ OHP — 95 x 6 (1/3)
```

This shows the model the desired behavior pattern more effectively than rules.

---

## Part 5: Implementation Priority

### Phase 1: Quick Wins (Immediate Impact)
1. **Add WebSearch to base tools** — fixes the machine identification bug
2. **Dynamic prompt assembly** — only load relevant guides per mode, cut prompt size 60-80%
3. **Inject structured workout state** into prompt (what exercises done, current exercise, sets remaining) instead of relying on LLM to read and parse the markdown file

### Phase 2: Core Architecture (Medium Effort, High Impact)
4. **Multi-turn conversations** — replace per-message `query()` with persistent conversation
5. **Explicit state machine** — track conversation mode in application code
6. **Local state for transient flags** — stop hitting GitHub API on every message

### Phase 3: Advanced (Higher Effort, Polish)
7. **TypeScript exercise parser** — pre-parse common formats before hitting LLM
8. **Smart message classification** — route different message types differently
9. **Conversation session management** — expiry, recovery, handoff between modes

---

## Part 6: Specific Code Changes Needed

### File: `src/coach/index.ts`
- Replace single `query()` with conversation management
- Add session persistence (save/restore message history)
- Accept conversation mode parameter
- Build system prompt dynamically based on mode

### File: `src/coach/prompts.ts`
- Split `buildSystemPrompt()` into `buildCorePrompt()` + `buildModePrompt(mode)`
- Remove the `{{CONTEXT}}` template approach
- Create separate prompt files per mode instead of loading all partials

### File: `src/handlers/webhook.ts`
- Add state machine management (determine mode before calling agent)
- Move state checks to local storage
- Add message classification
- Manage conversation sessions (start, continue, expire)

### File: `prompts/system.md`
- Split into `prompts/core-identity.md` (small, always loaded)
- Move mode-specific instructions to `prompts/modes/workout.md`, `prompts/modes/chat.md`, etc.
- Drastically shorten — replace rules with examples

### New Files:
- `src/state/conversation.ts` — Conversation state machine
- `src/state/workout-tracker.ts` — Structured workout tracking
- `src/state/local-store.ts` — Local state persistence
- `src/utils/message-classifier.ts` — Message type classification
- `src/utils/exercise-parser.ts` — TypeScript exercise input parser
- `prompts/core-identity.md` — Core identity prompt (short)
- `prompts/modes/workout.md` — Workout mode instructions
- `prompts/modes/chat.md` — General chat instructions
- `prompts/modes/planning.md` — Planning mode instructions

---

## Part 7: Key Metrics to Track

After the redesign, measure:

1. **Response accuracy**: Does the workout summary match what was actually logged? (Manual spot-check)
2. **Response latency**: Time from user message to bot response (should decrease with smaller prompts)
3. **Token usage**: Tokens per message (should decrease 40-60% with dynamic prompts)
4. **Confusion rate**: How often does the user need to correct the bot? (Track correction patterns)
5. **Naturalness**: Subjective — does the bot feel like a coach or a manual?

---

## Summary

The core problem isn't the prompts — it's the architecture. IronClaude is built as a stateless request-response system where every message starts from scratch. The fixes aren't about better instructions; they're about:

1. **Real conversations** (multi-turn, not per-message)
2. **Focused prompts** (mode-specific, not monolithic)
3. **Application-level state** (structured tracking, not LLM-dependent parsing)
4. **Smart routing** (classify before sending to LLM)

The prompts are actually well-written — they're just too many instructions all at once. The model can't focus when it has 1300 lines of CRITICAL instructions for every "175x5" message.

---

## Part 8: Research-Backed Patterns (From Anthropic Docs & Academic Research)

The following findings from Anthropic's official documentation, engineering blog posts, and academic research directly validate and extend the recommendations above.

### Finding 1: LLMs Lose 39% Performance in Multi-Turn Conversations
**Source**: ["LLMs Get Lost In Multi-Turn Conversation" (Microsoft Research, 2025)](https://arxiv.org/abs/2505.06120)

Research shows models exhibit a **39% average performance drop** in multi-turn vs single-turn interactions. Once models take a wrong turn, they tend not to recover. This is exactly the "confusion" problem — the bot makes an incorrect assumption about which exercise is being discussed and then doubles down.

**Mitigation**: Re-inject current state as a structured summary at the top of each API call. The model anchors to structured data more reliably than conversation flow.

### Finding 2: Cumulative State Summary Pattern
**Source**: [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Anthropic recommends injecting a short "game state summary" before each user message:

```
[Session State: Upper body workout in progress. Logged: Bench Press 3x5@185
(RPE 8), OHP 2x8@95 (RPE 7). Pending: 1 more set of OHP, then rows.]
```

This anchors the model regardless of how messy the conversation gets. This is the single most impactful pattern for the workout tracking use case.

### Finding 3: Context Editing Reduces Token Usage 84%
**Source**: [Anthropic — Context Management](https://www.anthropic.com/news/context-management)

Anthropic's `clear_tool_uses` strategy automatically clears old tool results from context when it grows beyond a threshold. In a 100-turn evaluation, this reduced token consumption by 84% while enabling workflows that would otherwise fail. The insight: **older tool results are rarely needed once processed — replace them with placeholders.**

For IronClaude, this means the bot doesn't need to keep every file read result in the conversation — just the current state summary.

### Finding 4: Agent-Computer Interface (ACI) Design
**Source**: [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)

Anthropic emphasizes investing in your "Agent-Computer Interface" as much as your human-computer interface:
- **Use absolute references** — Anthropic found that switching from relative to absolute filepaths eliminated an entire class of model errors (the "poka-yoke" principle)
- **Choose natural formats** — avoid unnecessary complexity
- **Write thorough tool descriptions** including example usage and edge cases

### Finding 5: Investigate Before Answering
**Source**: [Anthropic — Prompt Engineering Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

From Anthropic's own prompting best practices for agent-style systems:

```xml
<investigate_before_answering>
Never speculate about data you have not opened. If the user references a
specific file, you MUST read the file before answering.
</investigate_before_answering>
```

For IronClaude: the bot should ALWAYS read the workout file before claiming what exercises were completed. Currently it sometimes guesses from memory, which is what causes the hallucinated summaries.

### Finding 6: Allow Uncertainty Explicitly
**Source**: [Anthropic Docs — Be Clear and Direct](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/be-clear-and-direct)

Give Claude explicit permission to express uncertainty rather than guessing. This single technique significantly reduces hallucinations. Add to the system prompt:

```
If you are not sure about an exercise, weight, or rep count, ask rather
than guess. Accuracy matters more than speed for progressive overload tracking.
```

This directly addresses Bug 3 (wrong machine identification) — the bot guessed instead of saying "I don't know."

### Finding 7: The Five Workflow Patterns
**Source**: [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)

Anthropic identifies five composable patterns. The most relevant for IronClaude:

| Pattern | Application |
|---------|-------------|
| **Routing** | Classify message type (exercise, question, commentary) before processing |
| **Prompt Chaining** | Parse input → validate → store → generate feedback (with verification gates) |
| **Orchestrator-Workers** | Weekly retro: delegate volume analysis, PR check, fatigue analysis to sub-tasks |

The current architecture uses none of these — everything goes through one monolithic path.

### Finding 8: Start Simple, Add Complexity Only When Needed
**Source**: [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)

> "Frameworks hide complexity and make debugging harder. Incorrect assumptions about what's under the hood are a common source of customer error."

The Agent SDK's `query()` is actually MORE complex than needed for a chat bot. A direct `messages` API call with a maintained message array would be simpler, more transparent, and give more control over the conversation flow.

### Finding 9: Extended Thinking for Complex Operations
**Source**: [Anthropic — Chain of Thought](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/chain-of-thought)

Use adaptive thinking (`thinking: {"type": "adaptive"}`) for complex operations (weekly planning, progress analysis) and skip it for simple operations (logging sets). This matches the mode-based architecture — workout mode doesn't need deep reasoning, but planning mode does.

### Sources

- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic: Building Agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Claude Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Claude Tool Use Overview](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/overview)
- [Claude Chain of Thought](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/chain-of-thought)
- [Claude Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude Context Windows](https://platform.claude.com/docs/en/build-with-claude/context-windows)
- [Anthropic Cookbook: Agent Patterns](https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents)
- [LLMs Get Lost In Multi-Turn Conversation (Microsoft Research)](https://arxiv.org/abs/2505.06120)
- [Anthropic Context Management](https://www.anthropic.com/news/context-management)
