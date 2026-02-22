# IronClaude Redesign — Tickets

## Ticket 1: Replace time-parser.ts with chrono-node

**Priority**: High
**Effort**: Small
**Files**: `src/utils/time-parser.ts`, `package.json`

### Problem

`time-parser.ts` is 105 lines of hand-rolled regex with hardcoded assumptions ("1-6 almost certainly means PM for gym time"). It can't handle `"in 2 hours"`, `"after lunch"`, or many natural expressions.

### Solution

Replace with [chrono-node](https://www.npmjs.com/package/chrono-node) — the standard NLP date/time parser for JS (2.4M weekly downloads, TypeScript, used by Dub.co and others).

### Scope

1. `npm install chrono-node`
2. Rewrite `parseTimeToHour()` to use `chrono.parseDate()` and extract the hour
3. Keep the same function signature (`(input: string) => number | null`) so callers don't change
4. Delete all the regex patterns and `convertTo24` helper
5. Run existing callers to verify (used by gym-time scheduling in `daily-reminder.ts` flow)

### Acceptance

- `parseTimeToHour("3pm")` → 15
- `parseTimeToHour("around 7")` → 7 (or 19 with PM context)
- `parseTimeToHour("noon")` → 12
- `parseTimeToHour("6ish")` → 18
- File drops from ~105 lines to ~15 lines

---

## Ticket 2: Bump default maxTurns to 25

**Priority**: High
**Effort**: Tiny
**Files**: `src/coach/index.ts`

### Problem

Default `maxTurns` is 10 (`index.ts:77`). Complex tasks like progress checks that need to Glob + Read multiple week folders hit this ceiling. Planning already overrides to 25. Force-regen uses 20. The inconsistency causes silent truncation.

### Solution

Change the default from 10 to 25. The agent stops early on simple chats (1-3 turns), so this only affects complex tasks where the ceiling matters.

### Scope

1. Change `maxTurns: config.maxTurns || 10` → `config.maxTurns || 25` in `src/coach/index.ts:77`
2. Remove the explicit `maxTurns: 25` override in `weekly-plan.ts:107` (now redundant)
3. Remove the explicit `maxTurns: 20` override in `weekly-plan.ts:257` (now redundant — or bump to 25 for consistency)

### Acceptance

- Default chat uses 25 turns
- Planning and force-regen use the same default (no special overrides)

---

## Ticket 3: Eliminate gymTimePendingState plumbing

**Priority**: High
**Effort**: Medium
**Files**: `src/cron/daily-reminder.ts`, `src/handlers/webhook.ts`, `src/storage/github.ts`

### Problem

The daily reminder flow uses a state machine spread across 3 files:

1. `daily-reminder.ts:68-72` — After the agent sends the morning message, **application code** sends a hardcoded "What time are you heading to the gym?" and writes `gymTimePendingState`
2. `webhook.ts:189-208` — Detects the pending state, clears it, and wraps the user's raw message in instructions telling the agent what to do
3. `storage/github.ts:407-425` — CRUD for the state file

This is application-level orchestration that belongs to the agent.

### Solution

Move the gym-time question into the agent's morning reminder task prompt. The agent asks the question as part of its message. When the user replies, the agent sees its own question in message history and handles it naturally — no state file needed.

### Scope

1. **`daily-reminder.ts`**: Add "Ask what time they're heading to the gym and offer to send a warm-up reminder" to the agent's task prompt. Remove the hardcoded `bot.sendMessage()` and `storage.saveGymTimePendingState()` calls (lines 68-72)
2. **`webhook.ts`**: Remove the entire gymTimePendingState check block (lines 189-208). The user's response flows through normal agent chat, which sees the gym-time question in message history
3. **`storage/github.ts`**: Remove `saveGymTimePendingState`, `getGymTimePendingState`, `clearGymTimePendingState` and the associated state file path. Keep the methods if other callers exist (check first)
4. **System prompt**: No changes needed — the agent already has `add_reminder` tool and message history context

### Why this works

The agent sees message history (via `formatRecentMessagesForPrompt` in `message-history.ts`). When its previous message said "What time are you heading to the gym?" and the user replies "6pm", the agent naturally understands the context and can call `add_reminder` without being told.

### Acceptance

- Morning reminder asks about gym time as part of the agent message (not a separate hardcoded message)
- User reply is processed by normal chat flow
- Agent uses `add_reminder` to schedule the warm-up reminder
- No `gymTimePendingState` files written or read
- `state/gym-time-pending.json` no longer created

---

## Ticket 4: Eliminate planningState plumbing

**Priority**: High
**Effort**: Medium
**Files**: `src/cron/weekly-plan.ts`, `src/handlers/webhook.ts`, `src/storage/github.ts`

### Problem

The weekly planning flow uses a similar state machine:

1. `weekly-plan.ts:80-81` — Cron saves `planningState` and sends hardcoded `PLANNING_QUESTIONS`
2. `webhook.ts:210-220` — Detects planning state, bypasses normal chat, calls `generatePlanWithContext()` directly. The user's response **never reaches the agent via normal chat** — it goes to a completely separate code path
3. `storage/github.ts:387-405` — CRUD for planning state

The user's reply to planning questions gets routed to `generatePlanWithContext()` which creates a fresh agent with `maxTurns: 25` and a long task prompt. The normal chat agent never sees the conversation.

### Solution

Have the cron send the planning questions via the agent (so they appear in message history). When the user replies, normal webhook chat handles it — the agent sees its own planning questions in history, recognizes the user is providing planning context, and loads the `plan-week` skill to generate the plan.

### Scope

1. **`weekly-plan.ts`**: Change `runWeeklyPlan()` to use the agent to send planning questions instead of hardcoded `PLANNING_QUESTIONS`. The agent's task: "Check if a plan for {nextWeek} exists. If not, ask the user about energy, schedule, and focus for next week." Remove `savePlanningState()` call
2. **`webhook.ts`**: Remove the entire planningState check block (lines 210-220). Remove the `generatePlanWithContext` import
3. **System prompt / skills**: The `plan-week` skill already exists. Ensure the agent knows to use it when the user responds to planning questions. May need a small prompt addition: "If your recent messages asked planning questions and the user is responding, load the plan-week skill and generate the plan"
4. **`weekly-plan.ts`**: Keep `generatePlanWithContext()` and `forceRegeneratePlan()` for the `/plan` command — those are explicitly triggered, not state-machine driven
5. **`storage/github.ts`**: Remove `savePlanningState`, `getPlanningState`, `clearPlanningState`

### Risk

The agent needs to reliably recognize that the user is responding to planning questions. Message history provides this context. If message history is empty (e.g., server restart between cron and response), the agent won't have context. Mitigation: the agent can check if a plan for next week exists and proactively ask if one is needed.

### Acceptance

- Sunday cron sends planning questions via agent (not hardcoded string)
- User reply goes through normal chat
- Agent recognizes planning context from message history and generates plan
- No `planningState` files written or read
- `/plan` command still works (uses `forceRegeneratePlan`)

---

## Ticket 5: Trim workout-management.md from 217 → ~50 lines

**Priority**: Medium
**Effort**: Medium
**Files**: `prompts/partials/workout-management.md`

### Problem

`workout-management.md` is 217 lines of step-by-step instructions for a task that Sonnet 4.6 handles naturally given the file structure and session state tools. Much of it is:

- 17 lines listing end signals ("done", "I'm done", "that's it", "finished", "that's all", "workout complete", "wrapping up", "calling it a day", "all done", "that wraps it up") — the model infers these
- 13 lines of workout file example with every field — the model sees real examples in context
- 10 lines on abandoned workouts — the model checks `status: in_progress` and timestamps naturally
- Repeated "NEVER use the plan's day name" (already in system.md line 30)

### Solution

Cut to essentials: file structure with frontmatter schema, the completion workflow (status change + commit), and key behaviors (plan is suggestion, user is truth). Let the model reason about edge cases.

### Scope

Rewrite `workout-management.md` keeping:
1. Workout file location and frontmatter schema (date, type, started, finished, status, etc.)
2. Key workflow: create → log exercises → complete (status: completed + finished time + summary)
3. Completion must commit and push
4. Plan is a suggestion, user's actual exercises are truth
5. Confirm parsed exercises to catch errors

Cut:
- Exhaustive end signal lists
- Step-by-step "starting a workout" (7 sub-steps)
- Full file example (model sees real examples in pre-loaded context)
- Detailed commentary handling rules
- Abandoned workout protocol (model checks timestamps)
- Duplicate date accuracy rules (already in system.md)

### Acceptance

- File is ~50 lines
- Agent still correctly: creates workout files, logs exercises, detects completion, marks status, commits
- No regression in workout logging behavior (test with a real workout session)

---

## Ticket 6: Trim PR detection prompt — remove prescriptive celebration

**Priority**: Medium
**Effort**: Small
**Files**: `prompts/partials/pr-detection.md`

### Problem

`pr-detection.md` is 147 lines including prescribed emoji patterns per PR type, a hardcoded movements list, a full 1RM percentage table, and step-by-step detection logic. The model knows how to celebrate, calculate 1RM, and detect records from context.

### Solution

Keep: PR types (weight/rep/estimated 1RM), the Brzycki formula, `prs.yaml` format, edge cases (bodyweight, time-based, failed reps). Cut: celebration prescriptions, emoji assignments, hardcoded movement lists, the percentage table.

### Scope

Rewrite `pr-detection.md` keeping:
1. Three PR types and their definitions
2. Brzycki formula: `1RM = weight × (36 / (37 - reps))` (valid for 1-10 reps)
3. `prs.yaml` format reference
4. Edge cases: bodyweight, time-based holds, failed reps
5. Plate milestones worth noting (135/225/315/405)

Cut:
- Celebration level assignments with specific emojis
- Prioritization rules ("Weight PR > Rep PR > 1RM PR")
- Full percentage table (model knows these)
- Hardcoded "Primary" and "Secondary" movement lists
- Step-by-step detection pseudocode

### Acceptance

- File drops from ~147 to ~60 lines
- Agent still detects PRs, updates `prs.yaml`, celebrates appropriately
- Celebration tone matches athlete personality (from learnings.md) rather than prescribed emoji patterns

---

## Ticket 7: Remove exercise abbreviation table from prompt

**Priority**: Medium
**Effort**: Small
**Files**: `prompts/partials/exercise-parsing.md`

### Problem

Lines 17-31 of `exercise-parsing.md` are a hardcoded abbreviation table (bench→Bench Press, ohp→Overhead Press, etc.). The model infers these naturally. New exercises require prompt updates.

### Solution

Remove the abbreviation table. Keep the parsing format examples, weight notation guide, RPE guide, and plate math section — those are genuinely useful reference material the model benefits from.

### Scope

1. Delete the "Common Abbreviations" section (lines 17-31)
2. Keep everything else (format examples, weight notation, RPE, plate math, retroactive sets)

### Acceptance

- `exercise-parsing.md` drops by ~15 lines
- Agent still parses "bench 175x5" → Bench Press correctly
- Agent handles abbreviations not in the old table (e.g., "lat pull" → Lat Pulldown)

---

## Ticket 8: Document `---` message splitting convention

**Priority**: Medium
**Effort**: Tiny
**Files**: `prompts/system.md`

### Problem

`webhook.ts:236` splits agent responses on `---` markers for multi-message Telegram sending. The agent doesn't know about this convention. It could accidentally split a response, or miss the opportunity to use it intentionally for long messages.

### Solution

Add one line to the system prompt's Telegram style section.

### Scope

Add to `prompts/system.md` in the `<your-identity>` or `<instructions>` section:

```
Use `---` on its own line to split long responses into separate Telegram messages.
```

### Acceptance

- Agent knows it can use `---` to split messages
- Agent uses it intentionally for long responses (workout summaries, plans)

---

## Ticket 9: Document WebSearch capability in system prompt

**Priority**: Medium
**Effort**: Tiny
**Files**: `prompts/system.md`

### Problem

`WebSearch` is in `allowedTools` (`index.ts:264`) but the system prompt doesn't mention it. The exercise-demo skill says "search for content" but the agent may not realize it has a search tool.

### Solution

Add WebSearch to the Tools section of the system prompt.

### Scope

Add to the `## Tools` section in `prompts/system.md`:

```
**Web Search**: Use WebSearch to find exercise demonstrations, technique videos, or any fitness information you need to answer the user's questions.
```

### Acceptance

- Agent uses WebSearch when asked "show me how to do a face pull"
- Exercise-demo skill works with web search

---

## Ticket 10: Instruct agent on workout history location

**Priority**: Low
**Effort**: Tiny
**Files**: `prompts/system.md`

### Problem

The agent can only see the current week's workout summaries in pre-loaded context. For "how's my bench progressing?" queries, it must discover and read historical files manually. This is fine (not worth pre-loading), but the agent should know exactly where to look.

### Solution

Add a brief note to the system prompt about where historical data lives and how to access it.

### Scope

Add to `<data-structure>` or `<instructions>` section:

```
**Historical data**: Past weeks live in `weeks/YYYY-WXX/` folders. To analyze trends, Glob for `weeks/*/YYYY-MM-DD.md` files and read them. Each has frontmatter with date, type, status, and optionally recovery_score, energy_level, prs_hit.
```

### Acceptance

- Agent can answer "how's my bench progressing over the last month?" by reading historical files
- No change to pre-loaded context (keeps prompt lean for normal chat)

---

## Ticket 11: Collapse plan-flexibility.md into system.md

**Priority**: Low
**Effort**: Small
**Files**: `prompts/partials/plan-flexibility.md`, `prompts/system.md`

### Problem

`plan-flexibility.md` is 85 lines, much of it duplicating what's already in `system.md` (date accuracy rules, plan vs reality). The "Date Accuracy Rules" section (lines 65-74) literally says "These rules are ABSOLUTE" — the same rules already in `system.md:29-30`.

### Solution

The essential content (amend plan when workouts shift, log on actual date, use `planned_day` frontmatter) is already captured in `system.md:32-39`. The amendment format example is the only new content worth keeping. Fold that into `system.md` and delete the partial.

### Scope

1. Add the amendment format example to `system.md` under "Plan vs. Reality"
2. Delete `prompts/partials/plan-flexibility.md`
3. Update `src/coach/prompts.ts` to stop loading this partial

### Acceptance

- No `plan-flexibility.md` partial
- Plan amendment behavior unchanged
- System prompt not noticeably longer (net reduction since we removed duplication)
