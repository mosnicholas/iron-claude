/**
 * Timeline recorder — a ring buffer of recent events that the harness prints
 * when a test fails, giving the agent / dev a chronological view of:
 *
 *   - HTTP requests in/out of our server
 *   - DB writes
 *   - Agent turn lifecycle
 *   - Outbound Telegram calls
 *   - LLM requests (just metadata; bodies are too verbose)
 *
 * Plain Anthropic call durations + token usage so we can spot regressions
 * ("this turn cost $0.50, before it cost $0.05") at-a-glance from the
 * failure output.
 */

export interface TimelineEvent {
  ts: number; // ms since recorder start
  kind:
    | "telegram.in"
    | "telegram.out"
    | "http.in"
    | "http.out"
    | "db.write"
    | "agent.start"
    | "agent.end"
    | "anthropic"
    | "pgboss.job"
    | "stripe.in"
    | "whoop.in"
    | "test.assert";
  data: Record<string, unknown>;
}

export class Recorder {
  private readonly events: TimelineEvent[] = [];
  private readonly start = Date.now();
  private readonly capacity: number;

  constructor(capacity = 200) {
    this.capacity = capacity;
  }

  push(kind: TimelineEvent["kind"], data: Record<string, unknown> = {}): void {
    this.events.push({ ts: Date.now() - this.start, kind, data });
    if (this.events.length > this.capacity) {
      this.events.shift();
    }
  }

  /** All events recorded so far. */
  all(): TimelineEvent[] {
    return this.events.slice();
  }

  /** Last N events. Used by the failure printer. */
  tail(n = 10): TimelineEvent[] {
    return this.events.slice(-n);
  }

  /** Filter by kind for assertions. */
  filter(kind: TimelineEvent["kind"]): TimelineEvent[] {
    return this.events.filter((e) => e.kind === kind);
  }

  /** Clear between tests. */
  reset(): void {
    this.events.length = 0;
  }

  /**
   * Format the timeline for human consumption. Used in afterEach when a
   * test fails so the agent sees what actually happened before the failed
   * assertion.
   */
  format(n = 10): string {
    const tail = this.tail(n);
    if (tail.length === 0) return "(no recorded events)";
    const padKind = Math.max(...tail.map((e) => e.kind.length));
    return tail
      .map((e) => {
        const tsLabel = `T+${e.ts.toString().padStart(5, " ")}ms`;
        const kindLabel = e.kind.padEnd(padKind, " ");
        const summary = formatData(e.kind, e.data);
        return `${tsLabel}  ${kindLabel}  ${summary}`;
      })
      .join("\n");
  }
}

function formatData(_kind: TimelineEvent["kind"], data: Record<string, unknown>): string {
  const text = data.text ?? data.method ?? data.event ?? data.name ?? "";
  const meta: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === "text" || k === "method" || k === "event" || k === "name") continue;
    if (v === undefined || v === null) continue;
    meta.push(`${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60)}`);
  }
  const head = String(text).slice(0, 80);
  return [head, meta.join(" ")].filter(Boolean).join("  ");
}
