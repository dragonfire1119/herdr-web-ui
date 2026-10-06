import { describe, expect, it, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { paneChangeDiff, paneChanges, type ChangeDiffResult, type ChangesResult } from "./changes.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "herdr-changes-"));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(
    ["git", "-c", "core.autocrlf=false", "-c", "user.name=herdr-web-ui test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

function listed(result: ChangesResult): { path: string; code: string; old_path?: string }[] {
  if ("error" in result) throw new Error(`${result.error}: ${result.message}`);
  return result.changes;
}

describe("paneChanges", () => {
  it("returns a rename with the new path and the old path", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "old.txt"), "same\n");
    git(cwd, "add", "--", "old.txt");
    git(cwd, "commit", "-q", "-m", "add");
    git(cwd, "mv", "--", "old.txt", "new.txt");
    const changes = listed(await paneChanges(cwd));
    expect(changes).toEqual([{ path: "new.txt", code: "R ", old_path: "old.txt" }]);
  });

  it("round-trips a filename that contains a newline and a double quote", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    const name = "odd\"name\nfile.txt";
    writeFileSync(join(cwd, name), "x\n");
    expect(listed(await paneChanges(cwd))).toEqual([{ path: name, code: "??" }]);
  });

  it("returns an empty success when the folder is not a checkout", async () => {
    const cwd = scratch();
    expect(await paneChanges(cwd)).toEqual({ git: false, changes: [] });
  });

  it("returns an empty list for a clean checkout", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "kept.txt"), "kept\n");
    git(cwd, "add", "--", "kept.txt");
    git(cwd, "commit", "-q", "-m", "kept");
    expect(await paneChanges(cwd)).toEqual({ git: true, changes: [] });
  });

  it("sorts by path with localeCompare and does not list an ignored file or a directory row", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, ".gitignore"), "ignored.txt\n");
    git(cwd, "add", "--", ".gitignore");
    git(cwd, "commit", "-q", "-m", "ignore");
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "app.ts"), "app\n");
    writeFileSync(join(cwd, "notes.txt"), "notes\n");
    writeFileSync(join(cwd, "ignored.txt"), "nope\n");
    mkdirSync(join(cwd, "nested"));
    writeFileSync(join(cwd, "nested", "inside.txt"), "in\n");
    const changes = listed(await paneChanges(cwd));
    expect(changes.map((entry) => entry.path)).toEqual(["nested/inside.txt", "notes.txt", "src/app.ts"]);
    expect(changes.map((entry) => entry.code)).toEqual(["??", "??", "??"]);
    expect(changes.every((entry) => !("old_path" in entry))).toBe(true);
  });
});

function diffed(result: ChangeDiffResult): { path: string; old_path?: string; code: string; kind: string; truncated: boolean; text: string } {
  if ("error" in result) throw new Error(`${result.error}: ${result.message}`);
  return result;
}

describe("paneChangeDiff", () => {
  it("diffs a worktree edit against HEAD and not the index", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "tracked.txt"), "old\n");
    git(cwd, "add", "--", "tracked.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "tracked.txt"), "new\n");
    const list = listed(await paneChanges(cwd));
    expect(list).toEqual([{ path: "tracked.txt", code: " M" }]);
    const body = diffed(await paneChangeDiff(cwd, "tracked.txt"));
    expect(body.code).toBe(" M");
    expect(body.kind).toBe("diff");
    expect(body.truncated).toBe(false);
    expect(body.text).toContain("+new");
    expect(body).not.toHaveProperty("old_path");
  });

  it("diffs a staged edit whose worktree matches the index", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "tracked.txt"), "old\n");
    git(cwd, "add", "--", "tracked.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "tracked.txt"), "staged\n");
    git(cwd, "add", "--", "tracked.txt");
    expect(listed(await paneChanges(cwd))).toEqual([{ path: "tracked.txt", code: "M " }]);
    const body = diffed(await paneChangeDiff(cwd, "tracked.txt"));
    expect(body.kind).toBe("diff");
    expect(body.text).toContain("+staged");
  });

  it("returns an empty diff when the worktree matches HEAD and the index does not", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "tracked.txt"), "old\n");
    git(cwd, "add", "--", "tracked.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "tracked.txt"), "staged\n");
    git(cwd, "add", "--", "tracked.txt");
    writeFileSync(join(cwd, "tracked.txt"), "old\n");
    expect(listed(await paneChanges(cwd))).toEqual([{ path: "tracked.txt", code: "MM" }]);
    expect(await paneChangeDiff(cwd, "tracked.txt")).toEqual({
      path: "tracked.txt", code: "MM", kind: "empty", truncated: false, text: "",
    });
  });

  it("synthesizes an untracked text diff, including a repository with no commit", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "notes.txt"), "one\ntwo\n");
    writeFileSync(join(cwd, "raw.txt"), "one\ntwo");
    writeFileSync(join(cwd, "empty.txt"), "");
    expect(await paneChangeDiff(cwd, "notes.txt")).toEqual({
      path: "notes.txt", code: "??", kind: "untracked", truncated: false,
      text: "--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n",
    });
    expect(diffed(await paneChangeDiff(cwd, "raw.txt")).text).toBe(
      "--- /dev/null\n+++ b/raw.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n",
    );
    expect(await paneChangeDiff(cwd, "empty.txt")).toEqual({
      path: "empty.txt", code: "??", kind: "untracked", truncated: false,
      text: "--- /dev/null\n+++ b/empty.txt\n",
    });
  });

  it("treats a NUL in the first 8192 bytes of an untracked file as binary", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "blob.bin"), Buffer.from([0x00, 0x01, 0x02]));
    const body = await paneChangeDiff(cwd, "blob.bin");
    expect(body).toEqual({ path: "blob.bin", code: "??", kind: "binary", truncated: false, text: "" });
    expect(JSON.stringify(body)).not.toContain("\\u0000");
  });

  it("treats a tracked binary patch as binary and keeps a text line that merely mentions the marker", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "note.txt"), "keep Binary files in the sentence\n");
    writeFileSync(join(cwd, "blob.bin"), "text\n");
    git(cwd, "add", "--", "note.txt", "blob.bin");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "note.txt"), "keep Binary files in the sentence!\n");
    writeFileSync(join(cwd, "blob.bin"), Buffer.from([0x00, 0x01]));
    const note = diffed(await paneChangeDiff(cwd, "note.txt"));
    expect(note.kind).toBe("diff");
    expect(note.text).toContain("Binary files");
    expect(await paneChangeDiff(cwd, "blob.bin")).toMatchObject({ kind: "binary", truncated: false, text: "" });
  });

  it("cuts a diff longer than 256 KB on a newline", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "big.txt"), "old\n");
    git(cwd, "add", "--", "big.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "big.txt"), `${"x".repeat(200)}\n`.repeat(2000));
    const body = diffed(await paneChangeDiff(cwd, "big.txt"));
    expect(body.kind).toBe("diff");
    expect(body.truncated).toBe(true);
    expect(new TextEncoder().encode(body.text).byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(body.text.endsWith("\n")).toBe(true);
  });

  it("rejects a path with a .. segment without reading outside the repo", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    const canary = join(dirname(cwd), `secret-${crypto.randomUUID()}.txt`);
    try {
      writeFileSync(canary, "TOP-SECRET-BYTES");
      const result = await paneChangeDiff(cwd, `../${canary.slice(dirname(cwd).length + 1)}`);
      expect(result).toEqual({ error: "invalid_path", message: "path is invalid" });
      expect(JSON.stringify(result)).not.toContain("TOP-SECRET-BYTES");
    } finally {
      rmSync(canary, { force: true });
    }
  });

  it("rejects the other lexical paths and a path that is not a current change", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "tracked.txt"), "old\n");
    git(cwd, "add", "--", "tracked.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "tracked.txt"), "new\n");
    for (const path of ["", "/etc/passwd", "a\\b", "a//b", "a/../b", "foo/../../etc/passwd", "a/\0b"]) {
      expect(await paneChangeDiff(cwd, path)).toEqual({ error: "invalid_path", message: "path is invalid" });
    }
    expect(await paneChangeDiff(cwd, ".")).toEqual({ error: "not_a_change", message: "path is not an uncommitted file" });
    expect(await paneChangeDiff(cwd, "missing.txt")).toEqual({ error: "not_a_change", message: "path is not an uncommitted file" });
  });

  it("limits the list and the diff to a pane folder that is a subdirectory", async () => {
    const root = scratch();
    git(root, "init", "-q", "-b", "main");
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "outside.txt"), "base\n");
    writeFileSync(join(root, "sub", "inside.txt"), "base\n");
    git(root, "add", "--", "outside.txt", "sub/inside.txt");
    git(root, "commit", "-q", "-m", "base");
    writeFileSync(join(root, "outside.txt"), "out\n");
    writeFileSync(join(root, "sub", "inside.txt"), "in\n");
    const sub = join(root, "sub");
    expect(listed(await paneChanges(sub)).map((entry) => entry.path)).toEqual(["sub/inside.txt"]);
    expect(diffed(await paneChangeDiff(sub, "sub/inside.txt")).text).toContain("+in");
  });

  it("returns git_failed for a missing repository on the diff and not git:false", async () => {
    const cwd = scratch();
    const result = await paneChangeDiff(cwd, "notes.txt");
    expect(result).toMatchObject({ error: "git_failed" });
    if (!("error" in result)) throw new Error("expected git_failed");
    expect(result.message).toContain("not a git repository");
  });

  it("fails a non-untracked diff when HEAD does not exist", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "new.txt"), "hello\n");
    git(cwd, "add", "--", "new.txt");
    expect(listed(await paneChanges(cwd)).map((entry) => entry.path)).toEqual(["new.txt"]);
    expect(await paneChangeDiff(cwd, "new.txt")).toMatchObject({ error: "git_failed" });
  });

  it("diffs a deleted tracked file without requiring the file to exist", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "gone.txt"), "was\n");
    git(cwd, "add", "--", "gone.txt");
    git(cwd, "commit", "-q", "-m", "base");
    unlinkSync(join(cwd, "gone.txt"));
    const body = diffed(await paneChangeDiff(cwd, "gone.txt"));
    expect(body.kind).toBe("diff");
    expect(body.text).toContain("-was");
  });

  it("rejects an untracked symlink whose real path is outside the pane folder", async () => {
    const outside = scratch();
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(outside, "secret.txt"), "TOP-SECRET-BYTES");
    symlinkSync(join(outside, "secret.txt"), join(cwd, "link.txt"));
    const result = await paneChangeDiff(cwd, "link.txt");
    expect(result).toEqual({ error: "invalid_path", message: "path is invalid" });
    expect(JSON.stringify(result)).not.toContain("TOP-SECRET-BYTES");
  });

  it("does not hang on an untracked fifo and does not treat it as text", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    const made = Bun.spawnSync(["mkfifo", join(cwd, "pipe")]);
    expect(made.exitCode).toBe(0);
    symlinkSync("pipe", join(cwd, "link"));
    const started = Date.now();
    const result = await paneChangeDiff(cwd, "link");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({ kind: "binary", text: "", truncated: false });
  });

  it("diffs a literal star path without including another dirty file", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "*"), "STAR-ONLY\n");
    writeFileSync(join(cwd, "other.txt"), "OTHER-SECRET\n");
    git(cwd, "add", "--", "*", "other.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "*"), "STAR-NEXT\n");
    writeFileSync(join(cwd, "other.txt"), "OTHER-SECRET-NEXT\n");
    const body = diffed(await paneChangeDiff(cwd, "*"));
    expect(body.text).toContain("STAR-NEXT");
    expect(body.text).not.toContain("OTHER-SECRET");
  });

  it("diffs a path that is itself a magic pathspec without including another file", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, ":(top)*"), "MAGIC-ONLY\n");
    writeFileSync(join(cwd, "other.txt"), "OTHER-SECRET\n");
    git(cwd, "add", "--", ":(top)*", "other.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, ":(top)*"), "MAGIC-NEXT\n");
    writeFileSync(join(cwd, "other.txt"), "OTHER-SECRET-NEXT\n");
    const body = diffed(await paneChangeDiff(cwd, ":(top)*"));
    expect(body.text).toContain("MAGIC-NEXT");
    expect(body.text).not.toContain("OTHER-SECRET");
  });

  it("shows the worktree bytes when the checkout configures textconv or a clean filter", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "file.txt"), "base\n");
    git(cwd, "add", "--", "file.txt");
    git(cwd, "commit", "-q", "-m", "base");
    writeFileSync(join(cwd, "file.txt"), "changed-line\n");
    writeFileSync(join(cwd, ".gitattributes"), "* diff=evil\n* filter=evil\n");
    git(cwd, "config", "diff.evil.textconv", "echo TEXTCONV-SECRET");
    git(cwd, "config", "filter.evil.clean", "echo CLEAN-SECRET");
    git(cwd, "config", "filter.evil.smudge", "cat");
    const body = diffed(await paneChangeDiff(cwd, "file.txt"));
    expect(body.text).toContain("changed-line");
    expect(body.text).not.toContain("TEXTCONV-SECRET");
    expect(body.text).not.toContain("CLEAN-SECRET");
  });

  it("does not list or diff a pane whose git dir is another checkout", async () => {
    const victim = scratch();
    git(victim, "init", "-q", "-b", "main");
    writeFileSync(join(victim, "secret.txt"), "secret-base-line\n");
    git(victim, "add", "--", "secret.txt");
    git(victim, "commit", "-q", "-m", "base");
    const pane = scratch();
    writeFileSync(join(pane, ".git"), `gitdir: ${victim}/.git\n`);
    const listedResult = await paneChanges(pane);
    expect(listedResult).toMatchObject({ error: "git_failed" });
    expect(JSON.stringify(listedResult)).not.toContain("secret-base-line");
    expect(JSON.stringify(listedResult)).not.toContain("secret.txt");
    const diffResult = await paneChangeDiff(pane, "secret.txt");
    expect(diffResult).toMatchObject({ error: "git_failed" });
    expect(JSON.stringify(diffResult)).not.toContain("secret-base-line");
  });

  it("diffs a linked worktree and a submodule", async () => {
    const parent = scratch();
    const main = join(parent, "main");
    const linked = join(parent, "linked");
    mkdirSync(main);
    git(main, "init", "-q", "-b", "main");
    writeFileSync(join(main, "a.txt"), "base\n");
    git(main, "add", "--", "a.txt");
    git(main, "commit", "-q", "-m", "base");
    git(main, "worktree", "add", "-q", "-b", "feature", linked);
    writeFileSync(join(linked, "a.txt"), "linked-edit\n");
    const linkedBody = diffed(await paneChangeDiff(linked, "a.txt"));
    expect(linkedBody.text).toContain("linked-edit");

    const remote = scratch();
    git(remote, "init", "-q", "-b", "main");
    writeFileSync(join(remote, "s.txt"), "sub-base\n");
    git(remote, "add", "--", "s.txt");
    git(remote, "commit", "-q", "-m", "base");
    const superproject = scratch();
    git(superproject, "init", "-q", "-b", "main");
    git(superproject, "-c", "protocol.file.allow=always", "submodule", "add", "-q", remote, "child");
    writeFileSync(join(superproject, "child", "s.txt"), "sub-edit\n");
    const subBody = diffed(await paneChangeDiff(join(superproject, "child"), "s.txt"));
    expect(subBody.text).toContain("sub-edit");
  });

  it("copies old_path onto a rename diff", async () => {
    const cwd = scratch();
    git(cwd, "init", "-q", "-b", "main");
    writeFileSync(join(cwd, "old.txt"), "same\n");
    git(cwd, "add", "--", "old.txt");
    git(cwd, "commit", "-q", "-m", "add");
    git(cwd, "mv", "--", "old.txt", "new.txt");
    expect(await paneChangeDiff(cwd, "new.txt")).toMatchObject({ path: "new.txt", old_path: "old.txt", code: "R " });
    expect(await paneChangeDiff(cwd, "old.txt")).toEqual({ error: "not_a_change", message: "path is not an uncommitted file" });
  });
});
