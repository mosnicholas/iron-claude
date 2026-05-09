import { formatCommitStatus, type CommitResult } from "./git.js";

describe("formatCommitStatus", () => {
  it("returns just `commit: <sha>` on success", () => {
    const result: CommitResult = { commit: "abc1234", pushed: true };
    expect(formatCommitStatus(result)).toBe("commit: abc1234");
  });

  it("does not warn when push was a no-op (nothing to push)", () => {
    // No push attempted because diff was empty — pushed=false, no error.
    const result: CommitResult = { commit: "abc1234", pushed: false, noop: true };
    expect(formatCommitStatus(result)).toBe("commit: abc1234");
  });

  it("surfaces non-fast-forward divergence in a one-line warning", () => {
    const result: CommitResult = {
      commit: "abc1234",
      pushed: false,
      pushError: "non-fast-forward (remote diverged and rebase failed — likely a content conflict)",
    };
    const formatted = formatCommitStatus(result);
    expect(formatted).toContain("commit: abc1234");
    expect(formatted).toContain("LOCAL ONLY");
    expect(formatted).toContain("non-fast-forward");
    expect(formatted).toContain("git -C <repo> status");
  });

  it("surfaces arbitrary push errors verbatim (trimmed)", () => {
    const result: CommitResult = {
      commit: "abc1234",
      pushed: false,
      pushError: "  fatal: unable to access 'https://github.com/...': SSL connect error  ",
    };
    const formatted = formatCommitStatus(result);
    expect(formatted).toContain("SSL connect error");
    expect(formatted).not.toContain("  fatal:"); // leading whitespace trimmed
  });
});
