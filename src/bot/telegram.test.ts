import { escapeForTelegramItalic, formatForTelegram } from "./telegram.js";

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
});
