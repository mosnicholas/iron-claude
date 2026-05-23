import {
  escapeForTelegramItalic,
  formatForTelegram,
  ThrottledMessageEditor,
  type TelegramBot,
} from "./telegram.js";

describe("formatForTelegram", () => {
  it("converts heading levels (# / ## / ###) to emoji+bold / bold / italic", () => {
    const result = formatForTelegram("# Main Title\n## Section\n### Subsection");
    expect(result).toContain("📌 *Main Title*");
    expect(result).toContain("*Section*");
    expect(result).toContain("_Subsection_");
    expect(result).not.toContain("##");
  });

  it("converts **bold** to *bold* (MarkdownV2 single-asterisk)", () => {
    const result = formatForTelegram("**First** and **second**");
    expect(result).toContain("*First*");
    expect(result).toContain("*second*");
    expect(result).not.toContain("**");
  });

  it("converts hyphen / asterisk bullets and indents to Unicode bullet glyphs", () => {
    const result = formatForTelegram("- top\n* top2\n  - nested\n    - deep");
    expect(result).toContain("• top");
    expect(result).toContain("• top2");
    expect(result).toContain("◦ nested");
    expect(result).toContain("▪ deep");
  });

  // Parameterized: every MarkdownV2 special must get a backslash.
  it.each(["(", ")", "+", "!", ".", "-", "=", ">", "#", "{", "}"])(
    "escapes special character %s",
    (char) => {
      const result = formatForTelegram(`a${char}b`);
      expect(result).toContain(`\\${char}`);
    }
  );

  it("converts markdown tables to bullet lists (no pipe characters survive)", () => {
    const result = formatForTelegram(
      `| Exercise | Sets | Reps |
|----------|------|------|
| Squat | 4 | 5 |`
    );
    expect(result).toContain("•");
    expect(result).toContain("Exercise:");
    expect(result).toContain("Squat");
  });

  it("preserves _italic_ underscores and doubles literal backslashes", () => {
    const result = formatForTelegram("**bold** and _italic_ with path\\to\\file");
    expect(result).toContain("*bold*");
    expect(result).toContain("_italic_");
    expect(result).toContain("\\\\"); // literal \ becomes \\
  });

  it("passes through empty and unformatted strings unchanged", () => {
    expect(formatForTelegram("")).toBe("");
    expect(formatForTelegram("Plain text")).toBe("Plain text");
  });
});

describe("escapeForTelegramItalic", () => {
  it("escapes underscores so tool names like get_prs don't break italic", () => {
    // regression: "🧠 _Using get_prs_" used to parse as italic("Using get") +
    // unmatched "_", crashing the bot with "Can't find end of Italic entity".
    expect(escapeForTelegramItalic("Using get_prs")).toBe("Using get\\_prs");
    expect(`🧠 _${escapeForTelegramItalic("Using get_prs")}_`).toBe("🧠 _Using get\\_prs_");
  });

  it("escapes asterisks, brackets, parens, backticks, dots, !, +, =", () => {
    expect(escapeForTelegramItalic("Using *bold*")).toBe("Using \\*bold\\*");
    expect(escapeForTelegramItalic("(a) [b] `c`")).toBe("\\(a\\) \\[b\\] \\`c\\`");
    expect(escapeForTelegramItalic("done!")).toBe("done\\!");
    expect(escapeForTelegramItalic("v2.0")).toBe("v2\\.0");
    expect(escapeForTelegramItalic("a+b=c")).toBe("a\\+b\\=c");
  });

  it("escapes backslashes before other escapes (no compounding)", () => {
    expect(escapeForTelegramItalic("a\\b")).toBe("a\\\\b");
  });

  it("preserves Unicode ellipsis but escapes ASCII '...'", () => {
    expect(escapeForTelegramItalic("Using get_prs…")).toBe("Using get\\_prs…");
    expect(escapeForTelegramItalic("Using get_prs...")).toBe("Using get\\_prs\\.\\.\\.");
  });

  it("double-formatting via formatForTelegram corrupts the escaped form", () => {
    // regression: ThrottledMessageEditor used to pass already-escaped status
    // text through bot.editMessage / bot.sendMessage, which re-ran
    // formatForTelegram and doubled every backslash. Telegram then rejected
    // "Can't find end of Italic entity" and surfaced literal backslashes to
    // the user. This test pins the corruption so we don't reintroduce the path.
    const wrapped = `🧠 _${escapeForTelegramItalic("Using get_recent_workouts")}_`;
    expect(wrapped).toBe("🧠 _Using get\\_recent\\_workouts_");

    const doubleFormatted = formatForTelegram(wrapped);
    expect(doubleFormatted).toBe("🧠 _Using get\\\\_recent\\\\_workouts_");
    expect(doubleFormatted).not.toBe(wrapped);
  });

  it("wrapped italic has exactly two unescaped underscores (the wrappers)", () => {
    const wrapped = `🧠 _${escapeForTelegramItalic("Using get_recent_workouts…")}_`;
    const unescapedUnderscores = wrapped.match(/(?<!\\)_/g) ?? [];
    expect(unescapedUnderscores).toHaveLength(2);
  });

  it("hardcoded 'Continuing...' placeholder matches programmatic escape", () => {
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
  sendFormattedError: Error | null = null;
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

    editor.update("Using get_recent_workouts…");
    editor.appendStreamDelta("Hello, world.");
    await new Promise((r) => setTimeout(r, 10));

    const lockIn = fake.calls.find((c) => c.kind === "editFormatted");
    expect(lockIn).toBeDefined();
    if (lockIn?.kind === "editFormatted") {
      expect(lockIn.text).toBe("🧠 _Using get\\_recent\\_workouts…_");
      expect(lockIn.text).not.toContain("\\\\_");
    }

    // No editMessage (re-formatting) calls during rotation.
    expect(fake.calls.filter((c) => c.kind === "editMessage")).toEqual([]);

    const newPlaceholder = fake.calls.find((c) => c.kind === "sendFormatted");
    expect(newPlaceholder).toBeDefined();
    if (newPlaceholder?.kind === "sendFormatted") {
      expect(newPlaceholder.text).toBe("🧠 _Continuing\\.\\.\\._");
    }
  });

  it("falls back to plain text when pre-formatted send rejects (no crash)", async () => {
    const fake = new FakeBot();
    fake.sendFormattedError = new Error("Bad Request: can't parse entities");

    const editor = new ThrottledMessageEditor(asBot(fake), 42, /* throttleMs */ 0);
    editor.update("Using get_prs…");
    editor.appendStreamDelta("text");
    await new Promise((r) => setTimeout(r, 10));

    expect(fake.calls.find((c) => c.kind === "sendPlain")).toBeDefined();
  });
});
