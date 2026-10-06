import { describe, expect, it, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paneChanges, type ChangesResult } from "./changes.ts";

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
