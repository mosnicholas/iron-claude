import {
  escapeForTelegramItalic,
  formatForTelegram,
  ThrottledMessageEditor,
  type TelegramBot,
} from "./telegram.js";

describe("formatForTelegram", () => {
  describe("heading conversion", () => {
    it("converts h1 to emoji + bold", () => {
      const input = "# Weekly Plan";
      const result = formatForTelegram(input);
      expect(result).toContain("📌 *Weekly Plan*");
    });

    it("converts h2 to bold", () => {
      const input = "## Monday Push Day";
      const result = formatForTelegram(input);
      expect(result).toContain("*Monday Push Day*");
      expect(result).not.toContain("##");
    });

    it("converts h3 to italic", () => {
      const input = "### Notes";
      const result = formatForTelegram(input);
      expect(result).toContain("_Notes_");
      expect(result).not.toContain("###");
    });

    it("handles multiple heading levels", () => {
      const input = "# Main Title\n## Section\n### Subsection";
      const result = formatForTelegram(input);
      expect(result).toContain("📌 *Main Title*");
      expect(result).toContain("*Section*");
      expect(result).toContain("_Subsection_");
    });
  });

  describe("bold conversion", () => {
    it("converts **bold** to *bold*", () => {
      const input = "This is **important** text";
      const result = formatForTelegram(input);
      expect(result).toContain("*important*");
      expect(result).not.toContain("**");
    });

    it("handles multiple bold sections", () => {
      const input = "**First** and **second** bold";
      const result = formatForTelegram(input);
      expect(result).toContain("*First*");
      expect(result).toContain("*second*");
    });
  });

  describe("bullet conversion", () => {
    it("converts hyphen bullets to Unicode bullets", () => {
      const input = "- First item\n- Second item";
      const result = formatForTelegram(input);
      expect(result).toContain("• First item");
      expect(result).toContain("• Second item");
    });

    it("converts asterisk bullets to Unicode bullets", () => {
      const input = "* First item\n* Second item";
      const result = formatForTelegram(input);
      expect(result).toContain("• First item");
      expect(result).toContain("• Second item");
    });

    it("converts 2-space nested bullets to hollow circles", () => {
      const input = "- Main item\n  - Sub item";
      const result = formatForTelegram(input);
      expect(result).toContain("• Main item");
      expect(result).toContain("◦ Sub item");
    });

    it("converts 4-space nested bullets to small squares", () => {
      const input = "- Main\n    - Deep nested";
      const result = formatForTelegram(input);
      expect(result).toContain("• Main");
      expect(result).toContain("▪ Deep nested");
    });
  });

  describe("special character escaping", () => {
    it("escapes periods", () => {
      const input = "This is a sentence.";
      const result = formatForTelegram(input);
      expect(result).toContain("\\.");
    });

    it("escapes parentheses", () => {
      const input = "Something (in parens)";
      const result = formatForTelegram(input);
      expect(result).toContain("\\(");
      expect(result).toContain("\\)");
    });

    it("escapes exclamation marks", () => {
      const input = "Great job!";
      const result = formatForTelegram(input);
      expect(result).toContain("\\!");
    });

    it("escapes plus signs", () => {
      const input = "1+1=2";
      const result = formatForTelegram(input);
      expect(result).toContain("\\+");
      expect(result).toContain("\\=");
    });

    it("escapes hyphens in text", () => {
      const input = "Monday - Push Day";
      const result = formatForTelegram(input);
      expect(result).toContain("\\-");
    });

    it("escapes hyphens at start of non-bullet lines", () => {
      const input = "Title\n---";
      const result = formatForTelegram(input);
      expect(result).toContain("\\-\\-\\-");
    });

    it("escapes hash symbols that are not headings", () => {
      const input = "Issue #123";
      const result = formatForTelegram(input);
      expect(result).toContain("\\#");
    });
  });

  describe("combined formatting", () => {
    it("handles a typical workout plan format", () => {
      const input = `# Weekly Plan

## Monday - Push Day

**Main Lifts:**
- Bench Press: 4x5 @ 175
- OHP: 3x8 @ 95

### Notes
Form felt good today.`;

      const result = formatForTelegram(input);

      // Headings converted
      expect(result).toContain("📌 *Weekly Plan*");
      expect(result).toContain("*Monday \\- Push Day*");
      expect(result).toContain("_Notes_");

      // Bold converted
      expect(result).toContain("*Main Lifts:*");

      // Bullets converted
      expect(result).toContain("• Bench Press:");
      expect(result).toContain("• OHP:");

      // Special chars escaped
      expect(result).toContain("\\.");
    });

    it("preserves formatting markers (* and _)", () => {
      const input = "**bold** and _italic_";
      const result = formatForTelegram(input);
      // Bold converted to single asterisk
      expect(result).toContain("*bold*");
      // Underscore preserved for italic
      expect(result).toContain("_italic_");
    });
  });

  describe("table conversion", () => {
    it("converts markdown tables to bullet lists", () => {
      const input = `| Exercise | Sets | Reps |
|----------|------|------|
| Squat | 4 | 5 |
| Bench | 3 | 8 |`;

      const result = formatForTelegram(input);

      // Should have bullet points, not pipe characters
      expect(result).toContain("•");
      expect(result).toContain("Exercise:");
      expect(result).toContain("Squat");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(formatForTelegram("")).toBe("");
    });

    it("handles text with no special formatting", () => {
      const input = "Plain text";
      const result = formatForTelegram(input);
      expect(result).toBe("Plain text");
    });

    it("does not convert asterisk bullets that look like bold", () => {
      // Asterisk at start of line followed by space is a bullet, not bold
      const input = "* item one\n* item two";
      const result = formatForTelegram(input);
      expect(result).toContain("• item one");
      expect(result).toContain("• item two");
    });

    it("handles backslashes", () => {
      const input = "path\\to\\file";
      const result = formatForTelegram(input);
      expect(result).toContain("\\\\");
    });
  });
});

describe("escapeForTelegramItalic", () => {
  it("escapes underscores so tool names like get_prs don't break italic", () => {
    // Regression: "🧠 _Using get_prs_" was parsed as italic("Using get") +
    // unmatched "_", crashing the bot with "Can't find end of Italic entity".
    const escaped = escapeForTelegramItalic("Using get_prs");
    expect(escaped).toBe("Using get\\_prs");
    // The wrapped form has matched outer _..._ around literal text.
    expect(`🧠 _${escaped}_`).toBe("🧠 _Using get\\_prs_");
  });

  it("escapes asterisks", () => {
    expect(escapeForTelegramItalic("Using *bold*")).toBe("Using \\*bold\\*");
  });

  it("escapes brackets, parens, and backticks", () => {
    expect(escapeForTelegramItalic("(a) [b] `c`")).toBe("\\(a\\) \\[b\\] \\`c\\`");
  });

  it("escapes dots, exclamation, and other MarkdownV2 specials", () => {
    expect(escapeForTelegramItalic("done!")).toBe("done\\!");
    expect(escapeForTelegramItalic("v2.0")).toBe("v2\\.0");
    expect(escapeForTelegramItalic("a+b=c")).toBe("a\\+b\\=c");
  });

  it("escapes backslashes before other escapes", () => {
    // A literal backslash must become \\, not interfere with other escapes.
    expect(escapeForTelegramItalic("a\\b")).toBe("a\\\\b");
  });

  it("handles tool-call status text with trailing ellipsis", () => {
    const escaped = escapeForTelegramItalic("Using get_prs.");
    expect(escaped).toBe("Using get\\_prs\\.");
  });

  it("returns empty string for empty input", () => {
    expect(escapeForTelegramItalic("")).toBe("");
  });

  it("returns idempotent output when run twice (already-escaped input)", () => {
    // Defensive: running escapeForTelegramItalic on its own output should be a
    // no-op for content with no further specials. This guards against accidental
    // re-escaping inside the editor, which used to compound with formatForTelegram.
    const once = escapeForTelegramItalic("Using get_prs");
    const twice = escapeForTelegramItalic(once);
    // Once-escaped: "Using get\_prs". Re-escaping treats `\` as a special and
    // doubles it; this is the EXPECTED corruption — the test pins the difference
    // so callers know they must NOT re-escape.
    expect(once).toBe("Using get\\_prs");
    expect(twice).toBe("Using get\\\\\\_prs");
    expect(twice).not.toBe(once);
  });

  it("double-formatting via formatForTelegram corrupts the escaped form", () => {
    // Regression: ThrottledMessageEditor used to pass already-escaped status
    // text (e.g. "🧠 _Using get\\_recent\\_workouts…_") through
    // bot.editMessage / bot.sendMessage, which re-ran formatForTelegram and
    // doubled every backslash. The result was "🧠 _Using get\\\\_recent\\\\_workouts…_",
    // which Telegram then rejected ("Can't find end of Italic entity") and
    // — on plain-text fallback — surfaced literal backslashes to the user.
    //
    // This test pins the corruption so we don't reintroduce the call path.
    const escaped = escapeForTelegramItalic("Using get_recent_workouts");
    const wrapped = `🧠 _${escaped}_`;
    expect(wrapped).toBe("🧠 _Using get\\_recent\\_workouts_");

    const doubleFormatted = formatForTelegram(wrapped);
    // formatForTelegram doubles single backslashes, so the inner \_ becomes \\_
    // — at which point the trailing _ is unmatched in MarkdownV2 parsing.
    expect(doubleFormatted).toBe("🧠 _Using get\\\\_recent\\\\_workouts_");
    expect(doubleFormatted).not.toBe(wrapped);
  });

  it("status with multiple underscores stays parseable when wrapped (no double-format)", () => {
    // The screenshot showed "Using get|recent\\workouts…" — the artifact of a
    // double-formatted status hitting the plain-text fallback. The fix is to
    // never re-run formatForTelegram on already-escaped italic content.
    //
    // Sending the wrapped form directly to Telegram (without re-formatting)
    // produces a well-formed italic entity: balanced outer underscores and
    // every inner underscore preceded by exactly one backslash.
    const wrapped = `🧠 _${escapeForTelegramItalic("Using get_recent_workouts…")}_`;
    expect(wrapped).toBe("🧠 _Using get\\_recent\\_workouts…_");

    // Open/close italic count: exactly two unescaped underscores (the wrappers).
    // Anywhere else, an underscore must be preceded by a backslash.
    const unescapedUnderscores = wrapped.match(/(?<!\\)_/g) ?? [];
    expect(unescapedUnderscores).toHaveLength(2);
  });

  it("thinking text with markdown specials renders as a single italic block", () => {
    // Reasoning streams from extended thinking can contain underscores,
    // asterisks, parens, dots — anything. We escape every special then wrap,
    // so the entire reasoning is one italic span.
    const reasoning =
      "Need to check user_profile.md and call get_prs(). " +
      "Last week's plan had **5x5** at 80% — heavy.";
    const wrapped = `🧠 _${escapeForTelegramItalic(reasoning)}_`;

    // No unescaped underscores, asterisks, or parens inside the wrapper.
    // 🧠 is a surrogate pair (2 JS chars) + space + leading "_" = 4 chars.
    const inner = wrapped.slice(4, -1);
    expect(inner).not.toMatch(/(?<!\\)_/);
    expect(inner).not.toMatch(/(?<!\\)\*/);
    expect(inner).not.toMatch(/(?<!\\)\(/);
    expect(inner).not.toMatch(/(?<!\\)\)/);
  });

  it("ellipsis (…) is preserved without escaping (not a MarkdownV2 special)", () => {
    // Unicode ellipsis isn't in the MarkdownV2 special set, so it should pass
    // through untouched. ASCII "..." would each get escaped as \. \. \.
    expect(escapeForTelegramItalic("Using get_prs…")).toBe("Using get\\_prs…");
    expect(escapeForTelegramItalic("Using get_prs...")).toBe("Using get\\_prs\\.\\.\\.");
  });

  it("Continuing placeholder is pre-escaped and balanced", () => {
    // The rotation paths now send a pre-escaped "Continuing..." placeholder so
    // they can use sendFormattedMessage (no re-formatting). Verify the literal
    // we hardcoded matches what escapeForTelegramItalic would produce.
    const handHardcoded = "🧠 _Continuing\\.\\.\\._";
    const programmatic = `🧠 _${escapeForTelegramItalic("Continuing...")}_`;
    expect(handHardcoded).toBe(programmatic);
  });
});

/**
 * Capturing fake of TelegramBot for ThrottledMessageEditor tests.
 * Records every send/edit so tests can assert the EXACT bytes we put on the
 * wire — that's the layer where the double-format bug used to live.
 */
type SendCall =
  | { kind: "sendFormatted"; text: string }
  | { kind: "sendPlain"; text: string }
  | { kind: "sendMessage"; text: string }
  | { kind: "editFormatted"; messageId: number; text: string }
  | { kind: "editMessage"; messageId: number; text: string };

class FakeBot {
  calls: SendCall[] = [];
  nextId = 100;
  /** If set, sendFormattedMessage rejects with this error to simulate parse fail. */
  sendFormattedError: Error | null = null;
  /** If set, editFormattedMessage rejects with this error. */
  editFormattedError: Error | null = null;

  async sendFormattedMessage(text: string): Promise<number | undefined> {
    this.calls.push({ kind: "sendFormatted", text });
    if (this.sendFormattedError) throw this.sendFormattedError;
    return ++this.nextId;
  }

  async sendPlainMessage(text: string): Promise<number | undefined> {
    this.calls.push({ kind: "sendPlain", text });
    return ++this.nextId;
  }

  async sendMessage(text: string): Promise<number | undefined> {
    this.calls.push({ kind: "sendMessage", text });
    return ++this.nextId;
  }

  async editFormattedMessage(messageId: number, text: string): Promise<void> {
    this.calls.push({ kind: "editFormatted", messageId, text });
    if (this.editFormattedError) throw this.editFormattedError;
  }

  async editMessage(messageId: number, text: string): Promise<void> {
    this.calls.push({ kind: "editMessage", messageId, text });
  }

  getBotToken(): string {
    return "fake-token";
  }

  getChatId(): string {
    return "fake-chat";
  }
}

function asBot(fake: FakeBot): TelegramBot {
  return fake as unknown as TelegramBot;
}

describe("ThrottledMessageEditor — pre-formatted text never re-escapes", () => {
  // ThrottledMessageEditor.editPlain reaches outside the bot wrapper and uses
  // global fetch directly. Stub it so streaming-edit fallbacks don't hit the
  // real Telegram API (and don't emit "Cannot log after tests are done" noise).
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = async () =>
      ({ ok: true, text: async () => "", json: async () => ({}) }) as unknown as Response;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("locks in status with editFormattedMessage (no re-format) on first stream delta", async () => {
    const fake = new FakeBot();
    const editor = new ThrottledMessageEditor(asBot(fake), 42, /* throttleMs */ 0);

    // 1) Status: "Using get_recent_workouts…" — should be wrapped + escaped.
    editor.update("Using get_recent_workouts…");

    // 2) First stream delta triggers rotateStatusForStream → locks in the
    //    placeholder via editFormattedMessage, opens new placeholder via
    //    sendFormattedMessage.
    editor.appendStreamDelta("Hello, world.");

    // Allow the async rotation to settle.
    await new Promise((r) => setTimeout(r, 10));

    // The lock-in edit must use editFormattedMessage with the SAME pre-escaped
    // text — never editMessage (which would call formatForTelegram and double
    // the backslashes). That's the regression.
    const lockIn = fake.calls.find((c) => c.kind === "editFormatted");
    expect(lockIn).toBeDefined();
    expect(lockIn?.kind).toBe("editFormatted");
    if (lockIn?.kind === "editFormatted") {
      expect(lockIn.text).toBe("🧠 _Using get\\_recent\\_workouts…_");
      // No double-backslash sequence anywhere — that would be the corruption.
      expect(lockIn.text).not.toContain("\\\\_");
    }

    // No editMessage (re-formatting) calls during rotation.
    const reformattedEdits = fake.calls.filter((c) => c.kind === "editMessage");
    expect(reformattedEdits).toEqual([]);

    // The new placeholder must also go through sendFormattedMessage (pre-escaped).
    const newPlaceholder = fake.calls.find((c) => c.kind === "sendFormatted");
    expect(newPlaceholder).toBeDefined();
    if (newPlaceholder?.kind === "sendFormatted") {
      // Pre-escaped "Continuing..." — dots are escaped, no other specials.
      expect(newPlaceholder.text).toBe("🧠 _Continuing\\.\\.\\._");
    }
  });

  it("locks in pre-escaped thinking block on status-after-thinking transition", async () => {
    const fake = new FakeBot();
    const editor = new ThrottledMessageEditor(asBot(fake), 42, /* throttleMs */ 0);

    // Reasoning text with multiple specials.
    editor.appendThinkingDelta("Need to check get_prs() and **5x5** plan.");
    // Allow first thinking delta to write through.
    await new Promise((r) => setTimeout(r, 10));

    // Status fires → rotateThinkingForStatus locks in thinking placeholder
    // and opens a new one with the status. Both must be pre-escaped sends.
    editor.update("Using get_prs…");
    await new Promise((r) => setTimeout(r, 10));

    // Find the lock-in edit of the thinking message — must use editFormatted.
    const thinkingLockIn = fake.calls.filter((c) => c.kind === "editFormatted").pop(); // the most recent one is the lock-in
    expect(thinkingLockIn).toBeDefined();
    if (thinkingLockIn?.kind === "editFormatted") {
      // No double-escaped backslashes in the locked-in text.
      expect(thinkingLockIn.text).not.toMatch(/\\\\_/);
      // Underscore in get_prs is escaped exactly once.
      expect(thinkingLockIn.text).toContain("get\\_prs");
    }

    // The status placeholder send for the new tool-call status — must also be
    // pre-escaped (sendFormatted, not sendMessage which would re-format).
    const statusSends = fake.calls.filter((c) => c.kind === "sendFormatted");
    expect(statusSends.length).toBeGreaterThan(0);
    const lastStatus = statusSends[statusSends.length - 1];
    if (lastStatus.kind === "sendFormatted") {
      expect(lastStatus.text).toBe("🧠 _Using get\\_prs…_");
    }

    // No formatting-applying send calls anywhere during rotation.
    const reformattedSends = fake.calls.filter((c) => c.kind === "sendMessage");
    expect(reformattedSends).toEqual([]);
  });

  it("falls back to plain text when pre-formatted send rejects (no crash)", async () => {
    const fake = new FakeBot();
    // Simulate Telegram rejecting the pre-formatted send (e.g. parse error
    // surfacing through some other path). We must not crash; we should fall
    // back to sendPlainMessage and continue.
    fake.sendFormattedError = new Error("Bad Request: can't parse entities");

    const editor = new ThrottledMessageEditor(asBot(fake), 42, /* throttleMs */ 0);
    editor.update("Using get_prs…");
    editor.appendStreamDelta("text");
    await new Promise((r) => setTimeout(r, 10));

    // Plain fallback was invoked.
    const plainCall = fake.calls.find((c) => c.kind === "sendPlain");
    expect(plainCall).toBeDefined();
  });
});
