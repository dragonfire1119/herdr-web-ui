# Changes view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the focused pane folder's uncommitted files, and the diff of one of them, as a third lens beside Chat and Terminal.

**Architecture:** `server/changes.ts` runs git and returns a result. The route in `server/index.ts` looks up the pane and maps that result to HTTP. It does not interpret porcelain. The client stores one `PaneLens` and settles it during render. `ChangesView` owns the list and the open diff. The xterm stays mounted under the new lens.

**Named data shape:** A private `StatusRun` union (`status` | `not_repository` | `failed`) is the only git outcome `paneChanges` and `paneChangeDiff` consume. `PaneLens` and `ListScreen` are the client sums, so a remembered lens and a stale list cannot sit on the wrong screen. `StatusRun`, `StatusRow`, and `DiffBody` stay unexported. The wire types in `shared/protocol.ts` stay the flat interfaces the spec names.

**Tech Stack:** Bun, `bun:test`, the system `git` binary (argument array, never a shell), React 18, lucide-react, the existing `Bun.serve` app in `server/index.ts`.

## Global Constraints

- Tests are bun:test. Unit file: `HERDR_TEST_MODE=unit bun test ./server/changes.test.ts` (the `./` is required). Full unit suite: `bun run test:unit`. A bare `bun test` also loads contract tests and fails in unit mode.
- Contract tests are `*.contract.test.ts` and need a live herdr. Do not tell unit tests to touch herdr. Do not set `HERDR_TEST_MODE=unit` on a contract run.
- Imports use explicit `.ts` / `.tsx` extensions and relative paths. Do not use the `@shared` alias.
- Wire fields are snake_case (`old_path`, `pane_id`). Code is camelCase (`oldPath`, `paneId`).
- Every new `t("…")` string is a string literal. Each needs an entry in `src/lib/i18n.ko.ts`, `src/lib/i18n.ja.ts`, and `src/lib/i18n.zh.ts`. `{count}` and `{path}` stay as those names. The English string is the key. Do not add an i18n test file.
- Shortcuts are Mod+Shift+key. Register `show-changes` in `SHORTCUTS`, `KEY_TO_ID`, the switch in `src/lib/shortcuts.ts`, and `CUSTOM_SHORTCUT_IDS`.
- Icons from lucide-react only. The Changes icon is `FileDiff`.
- UI says "New workspace", not "New session". Do not rename worktree. This feature does not create, open, or delete a worktree.
- Component CSS is colocated, tokens only, no color literals, no `!important`. Diff colors are `--status-done`, `--status-blocked`, and `--text-dim`. No new token.
- Error bodies only through `server/http.ts` helpers (`jsonResponse`, `badRequest`, `errorResponse`). Git failures are returned, never thrown. `errorResponse` stays the only path for `HerdrError`.
- Do not edit `shared/herdr-api.generated.ts`. Do not run `generate:types`. The new interfaces are hand-written in `shared/protocol.ts`.
- A new endpoint needs an answer in `site/demo/transport.ts`. The demo does not run git. `site/` is not typechecked.
- `createServer(options)` is the injection seam. Do not add a git option. The route calls `paneChanges` and `paneChangeDiff`.
- Each git process is killed at 10 seconds. No pool, no status cache, no persistent git process. Arguments are an array, never a shell.
- List route: `bunServer.timeout(request, 15)`. Diff route: `bunServer.timeout(request, 35)`. The remote proxy's 75 second fetch timeout stays. Do not change it.
- `paneChangeDiff` must not call `paneChanges`. A missing repository is `{ git: false, changes: [] }` on the list and `git_failed` on the diff.
- `chatView` stays "show the transcript". Covering the grid is `view !== "terminal"`. Changes does not add `is-chat`. `showsChat` stays `view === "chat"`.
- Changes is never the settings default and never the lens a pane opens on until the user has opened it there. The settings control does not gain a Changes choice.
- No control that stages, unstages, discards, commits, pushes, or pulls. No retry button. No loading sentence.
- The Chat button title stays the exact string `Chat transcript (⌘⇧J)`. Terminal's titles stay the two strings they use today. The Changes title is the literal `Changes (⌘⇧G)`, not a string built from `formatKeys`.
- The client does not sort the list. The server sorts with `path.localeCompare(path)` and no locale argument.
- `scripts/` and `site/` are not typechecked. `bun run typecheck` covers `src/`, `server/`, and `shared/`.

## File map

| File | Responsibility |
| --- | --- |
| `shared/protocol.ts` | Wire `ChangeEntry`, `ChangesResponse`, `ChangeDiffResponse`, and the route comments. Not the git unions. |
| `server/changes.ts` | New. Private `StatusRun` and `DiffBody`. Public `paneChanges` and `paneChangeDiff` only. |
| `server/changes.test.ts` | New. Unit cases. Calls only the two public functions. No herdr. |
| `server/index.ts` | GET handlers beside `/api/pane/files`, `bunServer.timeout`, local `respondChanges`. |
| `server/machine-api.ts` | `MACHINE_PROXY_PATH` alternatives `changes\/diff` and `changes`. |
| `server/machines.test.ts` | Allow `pane/changes` and `pane/changes/diff`. Reject `pane/changes/diff/extra` and `pane/changes/extra`. |
| `server/api.contract.test.ts` | Live herdr: list 200, diff 200, other path 404 `not_a_change`. |
| `site/demo/transport.ts` | Fixture list and diff. No git. |
| `src/lib/paneLens.ts` | New. `PaneLens`, `reducePaneLens`, `settlePaneLens`, `storedPaneView`, `jTarget`. |
| `src/lib/paneLens.test.ts` | New. Pure lens cases, including stored `changes` before the no-attach rule. |
| `src/lib/actions.ts` | Re-export `PaneView`. Add `showChanges`. |
| `src/lib/api.ts`, `src/lib/machineContext.tsx` | `fetchPaneChanges`, `fetchPaneChangeDiff`. |
| `src/lib/shortcuts.ts`, `src/lib/shortcutBindings.ts` | `show-changes` on Mod+Shift+G. |
| `src/App.tsx` | Third header button. Settle during render. Dispatch lens events. |
| `src/components/CommandPalette.tsx` | J label from `switchTo`. Changes item runs G. |
| `src/components/PaneTerminal.tsx`, `PaneTerminal.css` | `covers-grid` versus `chatView`. Keep the xterm mounted. |
| `src/components/ChangesView.tsx`, `ChangesView.css` | New. Private `ListScreen`. Poll and diff lines. |
| `src/lib/i18n.ko.ts`, `i18n.ja.ts`, `i18n.zh.ts` | The new keys. |
| `src/lib/headerCrumb.test.ts` | `showsChat` of `"changes"` stays false. |
| `src/lib/settings.test.ts` | A stored default of `"changes"` stays `auto`. |

Do not edit `server/files.ts`. Changes does not share its helper, its 3 second kill, or its 5 second cache. Do not edit `src/lib/headerCrumb.ts`. Do not edit the settings segmented control in `src/components/SettingsDialog.tsx` (`auto` / `chat` / `terminal` only). Do not edit the local alias check in `server/index.ts` (`/^\/api\/(session|agents|pane\/|...`). It already allows `pane/`.

---

### Task 1: List a pane folder's uncommitted files

**Files:**
- Create: `server/changes.ts`
- Create: `server/changes.test.ts`
- Modify: `shared/protocol.ts` (route comment after the `/api/pane/files` line, interfaces after `SlashCommand`)
- Test: `server/changes.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ChangeEntry`, `ChangesResponse`, `ChangeDiffResponse` from `shared/protocol.ts` (the interfaces in this task's step 3).
  - `export type GitErrorCode = "git_unavailable" | "git_timeout" | "git_failed"`
  - `export type ChangesResult = ChangesResponse | { error: GitErrorCode; message: string }`
  - `export function paneChanges(cwd: string): Promise<ChangesResult>`
  - Private, used by Task 2, not exported:
    - `type GitFailure = { error: GitErrorCode; message: string }`
    - `type StatusRow = { form: "ordinary"; code: string; path: string } | { form: "renamed"; code: string; path: string; oldPath: string }`
    - `type StatusRun = { type: "status"; rows: readonly StatusRow[] } | { type: "not_repository"; failure: GitFailure } | { type: "failed"; failure: GitFailure }`
    - `function runGit(cwd: string, args: readonly string[]): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number } | GitFailure>`
    - `function gitFailedMessage(stderr: string): string`
    - `function statusOf(cwd: string): Promise<StatusRun>`
    - `function parsePorcelain(stdout: Uint8Array): StatusRow[] | GitFailure`

`runGit` returns the `{ stdout, stderr, exitCode: 0 }` object only when the process exits 0. `ENOENT` (spawn throw or a later rejection whose `code` is `"ENOENT"`) is `{ error: "git_unavailable", message: "git is not installed" }`, classified before the exit code. A kill at 10 seconds is `{ error: "git_timeout", message: "git timed out" }` even when the exit is also non-zero and stderr contains `not a git repository`. Any other non-zero exit is `{ error: "git_failed", message: gitFailedMessage(stderr) }`. `gitFailedMessage` is the first stderr line split on `\n`, trimmed, then `slice(0, 200)`, or `git failed` when that is empty.

`statusOf` is the only place that treats a missing repository as its own arm. It matches `not a git repository` on that `git_failed` message (git prints the phrase on the first stderr line). A `git_timeout` or `git_unavailable` stays `{ type: "failed" }`.

- [ ] **Step 1: Write the failing test**

Create `server/changes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `HERDR_TEST_MODE=unit bun test ./server/changes.test.ts`

Expected: FAIL. Cannot find module `./changes.ts`.

- [ ] **Step 3: Write the minimal implementation**

In `shared/protocol.ts`, immediately after the `GET /api/pane/files` comment (the line that ends `bounded walk otherwise)`), add:

```ts
 *  GET    /api/pane/changes?pane_id=         -> ChangesResponse (uncommitted files in the pane
 *         folder; git:false when that folder is not a checkout)
 *  GET    /api/pane/changes/diff?pane_id=&path= -> ChangeDiffResponse (one of those files)
```

Immediately after the `SlashCommand` interface, add:

```ts
export interface ChangeEntry {
  path: string;
  /** Two porcelain characters, such as " M", "M ", "MM", "??", "R ", "D ". Not trimmed. */
  code: string;
  /** Set only for a rename or copy. The previous path. */
  old_path?: string;
}

export interface ChangesResponse {
  /** False when the pane folder is not a git checkout. */
  git: boolean;
  changes: ChangeEntry[];
}

export interface ChangeDiffResponse {
  path: string;
  old_path?: string;
  code: string;
  /** "diff" is unified text. "untracked" is unified text of a new file. "binary" and "empty" have text "". */
  kind: "diff" | "untracked" | "binary" | "empty";
  truncated: boolean;
  text: string;
}
```

Create `server/changes.ts`:

```ts
import type { ChangeEntry, ChangesResponse } from "../shared/protocol.ts";

export type GitErrorCode = "git_unavailable" | "git_timeout" | "git_failed";

export type ChangesResult =
  | ChangesResponse
  | { error: GitErrorCode; message: string };

type GitFailure = { error: GitErrorCode; message: string };

type StatusRow =
  | { form: "ordinary"; code: string; path: string }
  | { form: "renamed"; code: string; path: string; oldPath: string };

type StatusRun =
  | { type: "status"; rows: readonly StatusRow[] }
  | { type: "not_repository"; failure: GitFailure }
  | { type: "failed"; failure: GitFailure };

const GIT_KILL_MS = 10_000;

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function gitFailedMessage(stderr: string): string {
  const line = stderr.split("\n", 1)[0] ?? "";
  const trimmed = line.trim().slice(0, 200);
  return trimmed.length === 0 ? "git failed" : trimmed;
}

function runGit(cwd: string, args: readonly string[]): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number } | GitFailure> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  } catch (error) {
    if (isEnoent(error)) return Promise.resolve({ error: "git_unavailable", message: "git is not installed" });
    return Promise.resolve({ error: "git_failed", message: "git failed" });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, GIT_KILL_MS);
  return (async () => {
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (timedOut) return { error: "git_timeout", message: "git timed out" };
      if (exitCode !== 0) return { error: "git_failed", message: gitFailedMessage(stderr) };
      return { stdout: new Uint8Array(stdout), stderr, exitCode };
    } catch (error) {
      if (timedOut) return { error: "git_timeout", message: "git timed out" };
      if (isEnoent(error)) return { error: "git_unavailable", message: "git is not installed" };
      return { error: "git_failed", message: "git failed" };
    } finally {
      clearTimeout(timer);
    }
  })();
}

function parsePorcelain(stdout: Uint8Array): StatusRow[] | GitFailure {
  const failed: GitFailure = { error: "git_failed", message: "git failed" };
  if (stdout.length === 0) return [];
  if (stdout[stdout.length - 1] !== 0) return failed;
  const decoder = new TextDecoder();
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] !== 0) continue;
    fields.push(decoder.decode(stdout.subarray(start, i)));
    start = i + 1;
  }
  const rows: StatusRow[] = [];
  for (let index = 0; index < fields.length;) {
    const record = fields[index];
    if (record === undefined || record.length < 4 || record[2] !== " ") return failed;
    const code = record.slice(0, 2);
    const path = record.slice(3);
    if (path.length === 0) return failed;
    const left = code[0] ?? "";
    const right = code[1] ?? "";
    if (left === "R" || left === "C" || right === "R" || right === "C") {
      const oldPath = fields[index + 1];
      if (oldPath === undefined || oldPath.length === 0) return failed;
      rows.push({ form: "renamed", code, path, oldPath });
      index += 2;
    } else {
      rows.push({ form: "ordinary", code, path });
      index += 1;
    }
  }
  return rows;
}

async function statusOf(cwd: string): Promise<StatusRun> {
  const run = await runGit(cwd, ["-C", cwd, "--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall", "--", "."]);
  if ("error" in run) {
    if (run.error === "git_failed" && run.message.includes("not a git repository")) return { type: "not_repository", failure: run };
    return { type: "failed", failure: run };
  }
  const parsed = parsePorcelain(run.stdout);
  if ("error" in parsed) return { type: "failed", failure: parsed };
  return { type: "status", rows: parsed };
}

function toEntry(row: StatusRow): ChangeEntry {
  if (row.form === "renamed") return { path: row.path, code: row.code, old_path: row.oldPath };
  return { path: row.path, code: row.code };
}

export async function paneChanges(cwd: string): Promise<ChangesResult> {
  const run = await statusOf(cwd);
  if (run.type === "not_repository") return { git: false, changes: [] };
  if (run.type === "failed") return run.failure;
  const changes = run.rows.map(toEntry);
  changes.sort((left, right) => left.path.localeCompare(right.path));
  return { git: true, changes };
}
```

`ordinary` omits `old_path`. Do not set the key to `undefined`. An unknown porcelain letter in a well-shaped record is still a row. A short record, a missing NUL, or a rename with no old path fails the whole parse. Do not return a partial list. Do not export `statusOf`, `parsePorcelain`, `runGit`, `StatusRun`, or `StatusRow`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `HERDR_TEST_MODE=unit bun test ./server/changes.test.ts`

Expected: PASS. 5 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.ts server/changes.ts server/changes.test.ts
git commit -m "feat(changes): list uncommitted files for a pane folder"
```

---

### Task 2: Diff one uncommitted path

**Files:**
- Modify: `server/changes.ts`
- Modify: `server/changes.test.ts`
- Test: `server/changes.test.ts`

**Interfaces:**
- Consumes: Task 1's `statusOf`, `runGit`, `gitFailedMessage`, `GitFailure`, `StatusRow`, `StatusRun`, `GitErrorCode`, and `toEntry`'s rule that a rename carries `oldPath`.
- Produces:
  - `export type ChangeDiffResult = ChangeDiffResponse | { error: "invalid_path" | "not_a_change" | GitErrorCode; message: string }`
  - `export function paneChangeDiff(cwd: string, path: string): Promise<ChangeDiffResult>`
  - Private: `lexicalChangePath`, `capDiffText`, `repositoryTop`, `untrackedBody`, `trackedBody`, `DiffBody`.

`paneChangeDiff` returns a result. It does not throw for a bad path, a missing binary, a timeout, a git failure, or a record it cannot parse. It calls `statusOf`, never `paneChanges`. `not_repository` and `failed` return that `GitFailure` unchanged.

`lexicalChangePath` is false when the path is missing or empty, absolute, contains a backslash, contains NUL, contains an empty segment, or contains a `..` segment. No Unicode normalization. No `path.normalize`. `.` is allowed and then fails the status match.

`capDiffText` cuts at `256 * 1024` UTF-8 bytes. The cut is the last newline whose byte offset fits, including that newline byte, or the byte cap when bytes `0 .. CAP-1` contain no newline. Decode with `stream: true` and do not flush, so a split code point is dropped instead of replaced by U+FFFD. If the re-encoded text is still over the cap, drop characters from the end until it fits. `truncated` is true only when the cap cut the text.

- [ ] **Step 1: Write the failing test**

Add `paneChangeDiff` to the import in `server/changes.test.ts`:

```ts
import { symlinkSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { paneChangeDiff, paneChanges, type ChangeDiffResult, type ChangesResult } from "./changes.ts";
```

Keep `join` on the existing `node:path` import. Add these tests inside the file, after the `paneChanges` describe:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `HERDR_TEST_MODE=unit bun test ./server/changes.test.ts`

Expected: FAIL. `paneChangeDiff` is not exported from `./changes.ts`.

- [ ] **Step 3: Write the minimal implementation**

Add these imports to `server/changes.ts`:

```ts
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import type { ChangeDiffResponse, ChangeEntry, ChangesResponse } from "../shared/protocol.ts";
```

Add the result type next to `ChangesResult`:

```ts
export type ChangeDiffResult =
  | ChangeDiffResponse
  | { error: "invalid_path" | "not_a_change" | GitErrorCode; message: string };
```

Add the rest at the bottom of `server/changes.ts`. Do not change `paneChanges` so that it calls the diff, and do not call `paneChanges` from `paneChangeDiff`.

```ts
type DiffBody =
  | { kind: "diff"; text: string; truncated: boolean }
  | { kind: "untracked"; text: string; truncated: boolean }
  | { kind: "binary"; text: ""; truncated: false }
  | { kind: "empty"; text: ""; truncated: false };

const DIFF_CAP = 256 * 1024;
const NUL_PROBE = 8192;

function lexicalChangePath(path: string): boolean {
  if (path.length === 0 || path.includes("\\") || path.includes("\0") || isAbsolute(path)) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "..");
}

function capDiffText(text: string): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= DIFF_CAP) return { text, truncated: false };
  let lastNl = -1;
  for (let i = 0; i < DIFF_CAP; i++) if (bytes[i] === 0x0a) lastNl = i;
  const cut = lastNl >= 0 ? lastNl + 1 : DIFF_CAP;
  let decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, cut), { stream: true });
  while (new TextEncoder().encode(decoded).byteLength > DIFF_CAP) decoded = decoded.slice(0, -1);
  return { text: decoded, truncated: true };
}

async function repositoryTop(cwd: string): Promise<{ top: string } | GitFailure> {
  const run = await runGit(cwd, ["-C", cwd, "--no-optional-locks", "rev-parse", "--show-toplevel"]);
  if ("error" in run) return run;
  const top = new TextDecoder().decode(run.stdout).trim();
  if (top.length === 0) return { error: "git_failed", message: "git failed" };
  return { top };
}

function insideFolder(fileReal: string, folderReal: string): boolean {
  if (fileReal === folderReal) return true;
  const prefix = folderReal.endsWith(sep) ? folderReal : folderReal + sep;
  return fileReal.startsWith(prefix);
}

function untrackedText(statusPath: string, contents: string): string {
  const header = `--- /dev/null\n+++ b/${statusPath}\n`;
  if (contents.length === 0) return header;
  const lines = contents.endsWith("\n") ? contents.slice(0, -1).split("\n") : contents.split("\n");
  return `${header}@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}\n`).join("")}`;
}

async function untrackedBody(top: string, paneFolder: string, statusPath: string): Promise<DiffBody | { error: "invalid_path"; message: "path is invalid" }> {
  const invalid = { error: "invalid_path" as const, message: "path is invalid" as const };
  let fileReal: string;
  let folderReal: string;
  try {
    fileReal = await realpath(join(top, statusPath));
    folderReal = await realpath(paneFolder);
  } catch {
    return invalid;
  }
  if (!insideFolder(fileReal, folderReal)) return invalid;
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(fileReal, "r");
  } catch {
    return invalid;
  }
  try {
    const probe = Buffer.alloc(NUL_PROBE);
    const first = await fh.read(probe, 0, NUL_PROBE, 0);
    const n = first.bytesRead;
    if (probe.subarray(0, n).includes(0)) return { kind: "binary", text: "", truncated: false };
    let buf = Buffer.from(probe.subarray(0, n));
    let position = n;
    const chunk = Buffer.alloc(64 * 1024);
    while (Buffer.byteLength(untrackedText(statusPath, new TextDecoder().decode(buf))) <= DIFF_CAP) {
      const more = await fh.read(chunk, 0, chunk.length, position);
      if (more.bytesRead === 0) break;
      buf = Buffer.concat([buf, chunk.subarray(0, more.bytesRead)]);
      position += more.bytesRead;
    }
    const capped = capDiffText(untrackedText(statusPath, new TextDecoder().decode(buf)));
    return { kind: "untracked", text: capped.text, truncated: capped.truncated };
  } catch {
    return invalid;
  } finally {
    await fh.close();
  }
}

async function trackedBody(top: string, statusPath: string): Promise<DiffBody | GitFailure> {
  const run = await runGit(top, ["-C", top, "--no-optional-locks", "diff", "--no-ext-diff", "--no-color", "-U3", "HEAD", "--", statusPath]);
  if ("error" in run) return run;
  const text = new TextDecoder().decode(run.stdout);
  if (run.stdout.length === 0) return { kind: "empty", text: "", truncated: false };
  for (const line of text.split("\n")) {
    if (line === "GIT binary patch" || line.startsWith("Binary files ")) return { kind: "binary", text: "", truncated: false };
  }
  const capped = capDiffText(text);
  return { kind: "diff", text: capped.text, truncated: capped.truncated };
}

export async function paneChangeDiff(cwd: string, path: string): Promise<ChangeDiffResult> {
  if (!lexicalChangePath(path)) return { error: "invalid_path", message: "path is invalid" };
  const run = await statusOf(cwd);
  if (run.type === "not_repository" || run.type === "failed") return run.failure;
  const row = run.rows.find((candidate) => candidate.path === path);
  if (row === undefined) return { error: "not_a_change", message: "path is not an uncommitted file" };
  const top = await repositoryTop(cwd);
  if ("error" in top) return top;
  const body = row.code === "??" ? await untrackedBody(top.top, cwd, row.path) : await trackedBody(top.top, row.path);
  if ("error" in body) return body;
  const response: ChangeDiffResponse = { path: row.path, code: row.code, kind: body.kind, truncated: body.truncated, text: body.text };
  if (row.form === "renamed") response.old_path = row.oldPath;
  return response;
}
```

`trackedBody` does not `realpath`. A deleted file has nothing to resolve. Classify binary markers before `capDiffText`. A line that only contains those words is not a marker. A submodule or an unmerged path uses `trackedBody` too. Do not enter a submodule. Later git uses `top`, never `join(paneFolder, statusPath)`.

`runGit` on a non-zero diff exit returns `GitFailure` and the caller does not read `stdout`. The `exitCode !== 0` arm in Task 1's `runGit` already does that. `trackedBody` therefore only sees stdout after a zero exit.

- [ ] **Step 4: Run the test to verify it passes**

Run: `HERDR_TEST_MODE=unit bun test ./server/changes.test.ts`

Expected: PASS. The Task 1 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add server/changes.ts server/changes.test.ts
git commit -m "feat(changes): diff one uncommitted path"
```

---

### Task 3: Serve the changes routes

**Files:**
- Modify: `server/index.ts` (import, `respondChanges`, handler after the `/api/pane/files` block)
- Modify: `server/machine-api.ts:7`
- Modify: `server/machines.test.ts:71-72`
- Modify: `server/api.contract.test.ts` (import types, new describe)
- Modify: `site/demo/transport.ts` (fixture immediately after the `/api/pane/files` block)
- Test: `server/machines.test.ts`, `server/api.contract.test.ts`

**Interfaces:**
- Consumes: `paneChanges(cwd: string)`, `paneChangeDiff(cwd: string, path: string)`, `ChangesResult`, `ChangeDiffResult`.
- Produces: `GET /api/pane/changes` and `GET /api/pane/changes/diff`. Local `respondChanges(result: ChangesResult | ChangeDiffResult): Response` in `server/index.ts`. Not exported from `server/changes.ts`.

`invalid_path` is 400. `not_a_change` is 404. `git_unavailable`, `git_timeout`, and `git_failed` are 502. Success is 200 and the result object. Missing or empty `pane_id` is 400 `missing_pane_id`, message `pane_id query parameter is required`. A non-GET is 400 `method_not_allowed`, message `use GET`. `pane_id` is `searchParams.get` with no trim. Unknown pane or a pane with no folder still throws `HerdrError` from `paneContext` and goes through `errorResponse`.

Do not require `x-herdr-machine` or `x-herdr-update`. A watch-role device may GET these routes. Do not add a `read_only` check. Do not edit the `/api/machines/local/` allow regex. Do not edit the 75_000 remote fetch timeout.

- [ ] **Step 1: Write the failing test**

In `server/machines.test.ts`, add `"pane/changes/extra"` and `"pane/changes/diff/extra"` to the reject list, and `"pane/changes"` and `"pane/changes/diff"` to the allow list, inside the existing `"proxies only pane/workspace data and never remote management credentials"` test:

```ts
for (const path of ["auth", "push", "updates/install", "machines/setup", "bridge", "../auth", "pane/../../auth", "pane/prompt/answer/extra", "tab/move", "tab/close/extra", "pane/changes/extra", "pane/changes/diff/extra"]) expect(MACHINE_PROXY_PATH.test(path)).toBe(false);
for (const path of ["session", "agents", "pane/files", "pane/image", "pane/prompt/answer", "workspace/create", "tab/create", "tab/rename", "tab/close", "pane/changes", "pane/changes/diff"]) expect(MACHINE_PROXY_PATH.test(path)).toBe(true);
```

In `server/api.contract.test.ts`, add `ChangeDiffResponse` and `ChangesResponse` to the type import from `../shared/protocol.ts`. Append this describe. `workspaceCreate` already sends `focus: false`. Use it. Do not call `herdr update`.

```ts
describe("GET /api/pane/changes", () => {
  const repo = mkdtempSync(join(tmpdir(), "herdr-web-ui-changes-"));
  let workspaceId: string | null = null;

  function git(...args: string[]): void {
    const result = Bun.spawnSync(
      ["git", "-c", "core.autocrlf=false", "-c", "user.name=herdr-web-ui test", "-c", "user.email=test@example.invalid", ...args],
      { cwd: repo, stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  }

  afterAll(async () => {
    if (workspaceId) await workspaceClose(workspaceId).catch(() => undefined);
    rmSync(repo, { recursive: true, force: true });
  });

  async function waitForFolder(paneId: string, folder: string): Promise<void> {
    const want = realpathSync(folder);
    const deadline = Date.now() + 10_000;
    for (;;) {
      const snapshot = await sessionSnapshot();
      const pane = snapshot.panes.find((candidate) => candidate.pane_id === paneId);
      const cwd = pane?.foreground_cwd ?? pane?.cwd;
      if (cwd && realpathSync(cwd) === want) return;
      if (Date.now() > deadline) throw new Error(`pane folder stayed ${cwd ?? "missing"}`);
      await Bun.sleep(50);
    }
  }

  it("lists an uncommitted edit and diffs it", async () => {
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "tracked.txt"), "before\n");
    git("add", "--", "tracked.txt");
    git("commit", "-q", "-m", "fixture");
    writeFileSync(join(repo, "tracked.txt"), "after\n");
    const created = await workspaceCreate({ cwd: repo, label: "herdr-web-ui-test-changes" });
    workspaceId = created.workspace.workspace_id;
    const paneId = created.root_pane.pane_id;
    await waitForFolder(paneId, repo);

    const list = await fetch(`${base()}/api/pane/changes?pane_id=${encodeURIComponent(paneId)}`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as ChangesResponse;
    expect(listed.git).toBe(true);
    const row = listed.changes.find((entry) => entry.path === "tracked.txt");
    expect(row?.code).toHaveLength(2);

    const diff = await fetch(`${base()}/api/pane/changes/diff?pane_id=${encodeURIComponent(paneId)}&path=${encodeURIComponent("tracked.txt")}`);
    expect(diff.status).toBe(200);
    expect(((await diff.json()) as ChangeDiffResponse).text).toContain("after");

    const missing = await fetch(`${base()}/api/pane/changes/diff?pane_id=${encodeURIComponent(paneId)}&path=${encodeURIComponent("nope.txt")}`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("not_a_change");
  }, 20_000);
});
```

`mkdtempSync`, `realpathSync`, `rmSync`, `writeFileSync`, `join`, `tmpdir`, `sessionSnapshot`, `workspaceCreate`, `workspaceClose`, and `base` are already in that file.

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `HERDR_TEST_MODE=unit bun test ./server/machines.test.ts -t "proxies only pane"`

Expected: FAIL. `MACHINE_PROXY_PATH` does not match `pane/changes`.

Do not run the contract test in unit mode.

- [ ] **Step 3: Write the minimal implementation**

In `server/machine-api.ts`, replace the `MACHINE_PROXY_PATH` line with:

```ts
export const MACHINE_PROXY_PATH = /^(?:session|agents|pane\/(?:read|scroll|selection|conversation(?:\/image|\/tool-output)?|commands|files|omo-tasks|prompt|prompt\/answer|input|keys|close|rename|image|changes\/diff|changes)|workspace\/(?:create|rename|move|close|directories)|worktree\/(?:create|list|open|remove)|tab\/(?:create|rename|close)|fs\/(?:stat|file))$/;
```

`changes\/diff` is a full alternative, written before `changes`. Do not write `changes(?:\/diff)?`.

In `server/index.ts`, add this import next to the `paneFiles` import:

```ts
import { paneChangeDiff, paneChanges, type ChangeDiffResult, type ChangesResult } from "./changes.ts";
```

Add this function next to `paneContext`. Do not export it.

```ts
function respondChanges(result: ChangesResult | ChangeDiffResult): Response {
  if ("error" in result) {
    const status = result.error === "invalid_path" ? 400 : result.error === "not_a_change" ? 404 : 502;
    return jsonResponse({ error: { code: result.error, message: result.message } }, status);
  }
  return jsonResponse(result);
}
```

Insert this handler immediately after the `/api/pane/commands` || `/api/pane/files` block, before `/api/pane/omo-tasks`, and before the `/api/*` 404:

```ts
if (pathname === "/api/pane/changes" || pathname === "/api/pane/changes/diff") {
  if (request.method !== "GET") return badRequest("method_not_allowed", "use GET");
  const paneId = url.searchParams.get("pane_id");
  if (!paneId) return badRequest("missing_pane_id", "pane_id query parameter is required");
  bunServer.timeout(request, pathname === "/api/pane/changes" ? 15 : 35);
  try {
    const { cwd } = await paneContext(paneId);
    const result = pathname === "/api/pane/changes"
      ? await paneChanges(cwd)
      : await paneChangeDiff(cwd, url.searchParams.get("path") ?? "");
    return respondChanges(result);
  } catch (error) {
    return errorResponse(error);
  }
}
```

The two pathnames are exact. `/api/pane/changes/diff` is not a prefix match on `/api/pane/changes`.

In `site/demo/transport.ts`, immediately after the `/api/pane/files` block, add:

```ts
if (path === "/api/pane/changes") return json({ git: true, changes: [{ path: "notes.txt", code: "??" }, { path: "src/app.ts", code: " M" }] });
if (path === "/api/pane/changes/diff") {
  const asked = query.get("path");
  if (asked === "src/app.ts") return json({ path: asked, code: " M", kind: "diff", truncated: false, text: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n" });
  if (asked === "notes.txt") return json({ path: asked, code: "??", kind: "untracked", truncated: false, text: "--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+hello\n" });
  return error("not_a_change", "path is not an uncommitted file", 404);
}
```

`notes.txt` then `src/app.ts` is `localeCompare` order. Do not sort in the demo. Do not spawn git. Paths under `/api/machines/` stay the existing demo 404.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `HERDR_TEST_MODE=unit bun test ./server/machines.test.ts -t "proxies only pane"`

Expected: PASS.

Run: `HERDR_TEST_MODE=unit bun test ./server/changes.test.ts`

Expected: PASS.

Run the contract file without `HERDR_TEST_MODE=unit`. The preload starts the isolated `herdr-web-ui-test` session. It does not use the user's herdr.

Run: `bun test --timeout 15000 ./server/api.contract.test.ts -t "lists an uncommitted edit"`

Expected: PASS. One test. If the pane folder never becomes the temp directory, the failure names the cwd it saw.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/machine-api.ts server/machines.test.ts server/api.contract.test.ts site/demo/transport.ts
git commit -m "feat(changes): serve pane changes over HTTP"
```

---

### Task 4: Settle the Changes lens

**Files:**
- Create: `src/lib/paneLens.ts`
- Create: `src/lib/paneLens.test.ts`
- Modify: `src/lib/actions.ts` (replace the `PaneView` declaration with a re-export)
- Modify: `src/lib/settings.test.ts` (one expect in the `"keeps only a known choice, auto by default"` test)
- Test: `src/lib/paneLens.test.ts`, `src/lib/settings.test.ts`

**Interfaces:**
- Consumes: `DefaultView` from `src/lib/settings.ts`. `paneStorageId` from `shared/machines.ts`.
- Produces:

```ts
export type PaneView = "chat" | "terminal" | "changes";
export type ChatOrTerminal = "chat" | "terminal";

export type PaneLens =
  | { paneKey: string; contextKey: string; view: ChatOrTerminal }
  | { paneKey: string; contextKey: string; view: "changes"; prior: ChatOrTerminal | null };

export type LensEvent =
  | { type: "press"; view: ChatOrTerminal }
  | { type: "press-changes" }
  | { type: "cycle" }
  | { type: "show-changes" };

export function reducePaneLens(lens: PaneLens, event: LensEvent, ctx: { hasPane: boolean; hasAgent: boolean }): PaneLens;
export function fallbackLens(hasAgent: boolean): ChatOrTerminal;
export function jTarget(lens: PaneLens, hasAgent: boolean): ChatOrTerminal;
export function storedPaneView(paneId: string, machineId: string, hasAgent: boolean | null, terminalAttach: boolean, defaultView: DefaultView): PaneView;
export function settlePaneLens(held: PaneLens, next: { paneKey: string; contextKey: string; stored: PaneView }): PaneLens;
```

`actions.ts` re-exports `PaneView`. Do not define a second `PaneView`. Do not add `showChanges` in this task. Nothing dispatches a lens event until Task 5.

`prior` exists only on `view: "changes"`. `press-changes` while already on Changes returns the same reference. `show-changes` with `hasPane: false` returns the same reference. `cycle` and `show-changes` from Changes both become `jTarget`. `show-changes` from chat or terminal is `press-changes`. `press` of the view already showing returns the same reference.

`fallbackLens` is `chat` when `hasAgent` is true, otherwise `terminal`. `jTarget` is `lens.prior ?? fallbackLens(hasAgent)` when `view` is `changes`, otherwise the other of chat and terminal.

`storedPaneView` reads `herdr-web-ui:view:` plus `paneStorageId`. Stored `changes` returns `changes` before the no-attach check. Stored `terminal` with no attach returns `chat`. Stored `chat` or `terminal` is used when that PC has an attach. The settings default is only `auto`, `chat`, or `terminal`. Auto does not return `changes`. `hasAgent === null` still counts as "not known to be a shell" (`!== false`), matching today's `storedView`.

`settlePaneLens`: a new `paneKey` takes `stored`, and a stored `changes` has `prior: null`. The same pane with a new `contextKey` takes `stored` and keeps `prior` only when both the held view and the stored view are `changes`. Same keys return `held`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/paneLens.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { reducePaneLens, settlePaneLens, storedPaneView, jTarget, type PaneLens } from "./paneLens.ts";

const chat: PaneLens = { paneKey: "p", contextKey: "c", view: "chat" };
const terminal: PaneLens = { paneKey: "p", contextKey: "c", view: "terminal" };
const fromChat: PaneLens = { paneKey: "p", contextKey: "c", view: "changes", prior: "chat" };
const restored: PaneLens = { paneKey: "p", contextKey: "c", view: "changes", prior: null };

const store = new Map<string, string>();
const originalStorage = globalThis.localStorage;
const originalMatch = globalThis.matchMedia;

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } },
  });
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: originalMatch });
});

describe("reducePaneLens", () => {
  const ctx = { hasPane: true, hasAgent: true };

  it("presses chat or terminal and drops prior", () => {
    expect(reducePaneLens(fromChat, { type: "press", view: "terminal" }, ctx)).toEqual({ paneKey: "p", contextKey: "c", view: "terminal" });
    expect(reducePaneLens(chat, { type: "press", view: "chat" }, ctx)).toBe(chat);
  });

  it("remembers the lens Changes was opened from and ignores a second press", () => {
    expect(reducePaneLens(terminal, { type: "press-changes" }, ctx)).toEqual({ paneKey: "p", contextKey: "c", view: "changes", prior: "terminal" });
    expect(reducePaneLens(fromChat, { type: "press-changes" }, ctx)).toBe(fromChat);
  });

  it("cycles chat and terminal, and leaves Changes for the remembered lens", () => {
    expect(reducePaneLens(chat, { type: "cycle" }, ctx).view).toBe("terminal");
    expect(reducePaneLens(terminal, { type: "cycle" }, ctx).view).toBe("chat");
    expect(reducePaneLens(fromChat, { type: "cycle" }, ctx).view).toBe("chat");
    expect(reducePaneLens(fromChat, { type: "show-changes" }, ctx).view).toBe("chat");
    expect(reducePaneLens(restored, { type: "cycle" }, { hasPane: true, hasAgent: true }).view).toBe("chat");
    expect(reducePaneLens(restored, { type: "show-changes" }, { hasPane: true, hasAgent: false }).view).toBe("terminal");
  });

  it("does nothing for G when no pane is selected", () => {
    expect(reducePaneLens(chat, { type: "show-changes" }, { hasPane: false, hasAgent: false })).toBe(chat);
    expect(reducePaneLens(fromChat, { type: "show-changes" }, { hasPane: false, hasAgent: true })).toBe(fromChat);
  });

  it("opens Changes from chat or terminal on show-changes", () => {
    expect(reducePaneLens(chat, { type: "show-changes" }, ctx)).toEqual({ paneKey: "p", contextKey: "c", view: "changes", prior: "chat" });
  });
});

describe("jTarget", () => {
  it("names the lens J would open", () => {
    expect(jTarget(chat, false)).toBe("terminal");
    expect(jTarget(terminal, true)).toBe("chat");
    expect(jTarget(fromChat, false)).toBe("chat");
    expect(jTarget(restored, true)).toBe("chat");
    expect(jTarget(restored, false)).toBe("terminal");
  });
});

describe("settlePaneLens", () => {
  it("returns the same reference when nothing changed", () => {
    expect(settlePaneLens(fromChat, { paneKey: "p", contextKey: "c", stored: "changes" })).toBe(fromChat);
  });

  it("drops prior on a pane change and keeps it when the same pane's context is re-read", () => {
    expect(settlePaneLens(fromChat, { paneKey: "other", contextKey: "c", stored: "changes" })).toEqual({
      paneKey: "other", contextKey: "c", view: "changes", prior: null,
    });
    expect(settlePaneLens(fromChat, { paneKey: "p", contextKey: "next", stored: "changes" })).toEqual({
      paneKey: "p", contextKey: "next", view: "changes", prior: "chat",
    });
    expect(settlePaneLens(fromChat, { paneKey: "p", contextKey: "next", stored: "terminal" })).toEqual({
      paneKey: "p", contextKey: "next", view: "terminal",
    });
  });
});

describe("storedPaneView", () => {
  it("opens a stored Changes lens before the no-attach rule", () => {
    store.set("herdr-web-ui:view:p1", "changes");
    expect(storedPaneView("p1", "local", true, false, "terminal")).toBe("changes");
    store.set("herdr-web-ui:view:p1", "terminal");
    expect(storedPaneView("p1", "local", true, false, "terminal")).toBe("chat");
    expect(storedPaneView("p1", "local", true, true, "auto")).toBe("terminal");
    store.set("herdr-web-ui:view:p1", "chat");
    expect(storedPaneView("p1", "local", false, true, "terminal")).toBe("chat");
  });

  it("never selects Changes from the settings default", () => {
    expect(storedPaneView("p1", "local", true, true, "auto")).toBe("terminal");
    expect(storedPaneView("p1", "local", true, true, "chat")).toBe("chat");
    expect(storedPaneView("p1", "local", false, true, "chat")).toBe("terminal");
    expect(storedPaneView("p1", "local", null, true, "auto")).toBe("terminal");
  });
});
```

In `src/lib/settings.test.ts`, inside `"keeps only a known choice, auto by default"`, add:

```ts
expect(sanitizeSettings({ defaultView: "changes" }).defaultView).toBe("auto");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `HERDR_TEST_MODE=unit bun test ./src/lib/paneLens.test.ts`

Expected: FAIL. Cannot find module `./paneLens.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/paneLens.ts`:

```ts
import { paneStorageId } from "../../shared/machines.ts";
import type { DefaultView } from "./settings.ts";

export type PaneView = "chat" | "terminal" | "changes";
export type ChatOrTerminal = "chat" | "terminal";

export type PaneLens =
  | { paneKey: string; contextKey: string; view: ChatOrTerminal }
  | { paneKey: string; contextKey: string; view: "changes"; prior: ChatOrTerminal | null };

export type LensEvent =
  | { type: "press"; view: ChatOrTerminal }
  | { type: "press-changes" }
  | { type: "cycle" }
  | { type: "show-changes" };

export function fallbackLens(hasAgent: boolean): ChatOrTerminal {
  return hasAgent ? "chat" : "terminal";
}

export function jTarget(lens: PaneLens, hasAgent: boolean): ChatOrTerminal {
  if (lens.view === "changes") return lens.prior ?? fallbackLens(hasAgent);
  return lens.view === "chat" ? "terminal" : "chat";
}

function withView(lens: PaneLens, view: ChatOrTerminal): PaneLens {
  return { paneKey: lens.paneKey, contextKey: lens.contextKey, view };
}

export function reducePaneLens(lens: PaneLens, event: LensEvent, ctx: { hasPane: boolean; hasAgent: boolean }): PaneLens {
  switch (event.type) {
    case "press":
      if (lens.view === event.view) return lens;
      return withView(lens, event.view);
    case "press-changes":
      if (lens.view === "changes") return lens;
      return { paneKey: lens.paneKey, contextKey: lens.contextKey, view: "changes", prior: lens.view };
    case "cycle":
      if (lens.view === "changes") return withView(lens, jTarget(lens, ctx.hasAgent));
      return withView(lens, lens.view === "chat" ? "terminal" : "chat");
    case "show-changes":
      if (!ctx.hasPane) return lens;
      if (lens.view === "changes") return withView(lens, jTarget(lens, ctx.hasAgent));
      return reducePaneLens(lens, { type: "press-changes" }, ctx);
  }
}

export function storedPaneView(paneId: string, machineId: string, hasAgent: boolean | null, terminalAttach: boolean, defaultView: DefaultView): PaneView {
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(`herdr-web-ui:view:${paneStorageId(machineId, paneId)}`) ?? null;
  } catch {
    /* private mode */
  }
  // Stored Changes wins before the no-attach rule. Stored terminal on a PC with no attach is still chat.
  if (stored === "changes") return "changes";
  if (!terminalAttach) return "chat";
  if (stored === "chat" || stored === "terminal") return stored;
  if (defaultView === "chat") return hasAgent !== false ? "chat" : "terminal";
  if (defaultView === "terminal") return "terminal";
  return hasAgent !== false && globalThis.matchMedia?.("(pointer: coarse)").matches === true ? "chat" : "terminal";
}

function taken(next: { paneKey: string; contextKey: string; stored: PaneView }, prior: ChatOrTerminal | null): PaneLens {
  if (next.stored === "changes") return { paneKey: next.paneKey, contextKey: next.contextKey, view: "changes", prior };
  return { paneKey: next.paneKey, contextKey: next.contextKey, view: next.stored };
}

export function settlePaneLens(held: PaneLens, next: { paneKey: string; contextKey: string; stored: PaneView }): PaneLens {
  if (held.paneKey === next.paneKey && held.contextKey === next.contextKey) return held;
  if (held.paneKey !== next.paneKey) return taken(next, null);
  return taken(next, held.view === "changes" && next.stored === "changes" ? held.prior : null);
}
```

`globalThis.localStorage` is `window.localStorage` in the browser. The unit test installs it without a DOM.

In `src/lib/actions.ts`, add this with the imports at the top of the file:

```ts
import type { PaneView } from "./paneLens.ts";
```

Replace `export type PaneView = "chat" | "terminal";` with:

```ts
export type { PaneView };
```

That re-export uses the import above. Do not also write `export type { PaneView } from "./paneLens.ts"`: the two forms together are a duplicate export, and the `from` form does not put `PaneView` in scope for `setView`. `setView` still takes `PaneView`. Do not add `showChanges` yet.

- [ ] **Step 4: Run the test to verify it passes**

Run: `HERDR_TEST_MODE=unit bun test ./src/lib/paneLens.test.ts ./src/lib/settings.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: exit 0. `PaneView` now includes `"changes"`, and existing `view === "chat"` checks still typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/lib/paneLens.ts src/lib/paneLens.test.ts src/lib/actions.ts src/lib/settings.test.ts
git commit -m "feat(changes): remember the lens Changes was opened from"
```

---

### Task 5: Open Changes from the header, palette, and shortcuts

**Files:**
- Modify: `src/lib/actions.ts` (add `showChanges`)
- Modify: `src/lib/shortcuts.ts`
- Modify: `src/lib/shortcutBindings.ts`
- Modify: `src/lib/shortcuts.test.ts`
- Modify: `src/lib/settings.test.ts` (shortcut override expect)
- Modify: `src/App.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/PaneTerminal.tsx`
- Modify: `src/components/PaneTerminal.css`
- Modify: `src/lib/headerCrumb.test.ts`
- Modify: `src/lib/i18n.ko.ts`, `src/lib/i18n.ja.ts`, `src/lib/i18n.zh.ts`
- Test: `src/lib/shortcuts.test.ts`, `src/lib/i18n.test.ts`, `src/lib/headerCrumb.test.ts`

**Interfaces:**
- Consumes: Task 4's `PaneLens`, `LensEvent`, `reducePaneLens`, `settlePaneLens`, `storedPaneView`, `jTarget`, `PaneView`.
- Produces: `showChanges(): void` on `AppActions`. Shortcut id `show-changes`. Header button order Chat, Terminal, Changes. `CommandPalette` prop `switchTo: "chat" | "terminal"` replaces `view` for the J label. `coversGrid` means `view !== "terminal"`.

Do not mount `ChangesView` in this task. Do not change `showsChat`. Do not change the Chat title `Chat transcript (⌘⇧J)` or either Terminal title. Do not add a Changes choice to Settings → Panes open in.

`toggleView` dispatches `cycle`. `showChanges` dispatches `show-changes`. `setView("changes")` dispatches `press-changes`. `setView("chat")` and `setView("terminal")` dispatch `press`. A reducer result that is the same reference does not write storage and does not remount. A real view change writes that `PaneView` to `herdr-web-ui:view:` plus `paneStorageId`. `prior` is not stored. A pane with no id does not write.

Every `chatViewRef` use that skips fit, skips focus, calls `keepSize`, or passes `keepSize` to `socket.attach` becomes `coversGridRef`. Terminal banners already gated on `!chatView`, the key bar, and the terminal input line use `coversGrid`. Transcript, composer, queue, prompt dock, and the `is-chat` class stay `chatView`.

- [ ] **Step 1: Write the failing test**

In `src/lib/shortcuts.test.ts`, inside `"matches every terminal-safe key"`, add:

```ts
expect(matchShortcut(keyEvent("g", { ctrlKey: true }), false)).toBe("show-changes");
```

In `src/lib/settings.test.ts`, next to the existing shortcut-override expect, add:

```ts
expect(sanitizeSettings({ shortcutOverrides: { "show-changes": "h" } }).shortcutOverrides).toEqual({ "show-changes": "h" });
```

In `src/lib/headerCrumb.test.ts`, inside the `showsChat` test, add:

```ts
expect(showsChat({}, "changes")).toBe(false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `HERDR_TEST_MODE=unit bun test ./src/lib/shortcuts.test.ts ./src/lib/settings.test.ts`

Expected: FAIL. `matchShortcut` does not return `show-changes`. The settings expect fails because `show-changes` is not in `CUSTOM_SHORTCUT_IDS`.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/shortcutBindings.ts`, add `"show-changes"` to `CUSTOM_SHORTCUT_IDS` immediately after `"toggle-view"`.

In `src/lib/shortcuts.ts`:

```ts
{ id: "show-changes", label: "Changes", keys: ["Mod", "Shift", "G"] },
```

Place that object immediately after the `toggle-view` entry. Add `g: "show-changes"` to `KEY_TO_ID`. In the switch inside `useShortcuts`, add:

```ts
case "show-changes":
  actions.showChanges();
  break;
```

`toggle-view` still calls `actions.toggleView()`.

In `src/lib/actions.ts`, add to `AppActions`, next to `toggleView`:

```ts
showChanges: () => void;
```

In `src/App.tsx`, import `FileDiff` from `lucide-react` and:

```ts
import { jTarget, reducePaneLens, settlePaneLens, storedPaneView, type LensEvent, type PaneLens } from "./lib/paneLens.ts";
```

Delete the `storedView` function. Replace the lens state:

```ts
const [lens, setLens] = useState<PaneLens>({ paneKey: "", contextKey: "", view: "terminal" });
```

Replace the `lensKey` / `setView` block with:

```ts
const paneKey = selectedPaneId === null ? "" : paneStorageId(selectedMachineId, selectedPaneId);
const contextKey = JSON.stringify([selectedPane !== null, selectedAgent !== null, terminalAttach, settings.defaultView]);
const stored = selectedPaneId === null
  ? lens.view
  : storedPaneView(selectedPaneId, selectedMachineId, selectedPane ? selectedAgent !== null : null, terminalAttach, settings.defaultView);
const settled = settlePaneLens(lens, { paneKey, contextKey, stored });
if (settled !== lens) setLens(settled);
const view = settled.view;
const switchTo = jTarget(settled, selectedAgent !== null);
const agentRef = useRef(selectedAgent !== null);
agentRef.current = selectedAgent !== null;

const applyLens = useCallback((event: LensEvent) => {
  setAutoSelected(false);
  setLens((current) => {
    const next = reducePaneLens(current, event, { hasPane: selectionRef.current.paneId !== null, hasAgent: agentRef.current });
    if (next === current) return current;
    const paneId = selectionRef.current.paneId;
    if (paneId !== null) {
      try {
        window.localStorage.setItem(`herdr-web-ui:view:${paneStorageId(selectionRef.current.machineId, paneId)}`, next.view);
      } catch {
        /* private mode: the lens just stops being remembered */
      }
    }
    return next;
  });
}, []);

const setView = useCallback((next: PaneView) => {
  applyLens(next === "changes" ? { type: "press-changes" } : { type: "press", view: next });
}, [applyLens]);
```

`useRef` is already imported. In the `actions` object, replace `toggleView` and add `showChanges`:

```ts
setView,
toggleView: () => applyLens({ type: "cycle" }),
showChanges: () => applyLens({ type: "show-changes" }),
```

Put `applyLens` in the `useMemo` dependency list and remove the old `view` dependency if `toggleView` no longer closes over `view`. Keep `setView`.

In the header switch, after the Terminal button and still inside `.view-switch`, add:

```tsx
<button type="button" aria-pressed={view === "changes"} onClick={() => setView("changes")} title={t("Changes (⌘⇧G)")}>
  <FileDiff />
  <span className="header-desktop-only">{t("Changes")}</span>
</button>
```

Leave the Chat and Terminal buttons as they are, including both Terminal title strings and the `soon` pill.

Pass `switchTo={switchTo}` to `CommandPalette` and remove the `view` prop.

In `src/components/CommandPalette.tsx`, import `FileDiff` from `lucide-react`. Replace the `view: PaneView` prop with `switchTo: "chat" | "terminal"`. Replace the J item and add the Changes item immediately after it:

```tsx
{ id: "view", label: t(switchTo === "terminal" ? "Switch to terminal" : "Switch to chat"), icon: SwitchCamera, shortcut: "toggle-view", run: actions.toggleView },
{ id: "changes", label: t("Changes"), icon: FileDiff, shortcut: "show-changes", run: actions.showChanges },
```

The `useMemo` dependency list uses `switchTo` instead of `view`. Drop the `PaneView` import if nothing else in the file uses it.

In `src/components/PaneTerminal.tsx`, next to `const chatView = view === "chat"`:

```ts
const coversGrid = view !== "terminal";
const changesView = view === "changes";
const coversGridRef = useRef(coversGrid);
coversGridRef.current = coversGrid;
```

Delete `chatViewRef`. Replace every `chatViewRef.current` with `coversGridRef.current`. Those sites are the role-ack fit, the pane-geometry early return, the upload paste guard, the ResizeObserver fit skip, the visibility refit, the font-change fit skip, `socket.attach`'s fourth argument, the focus after attach, and the `autoSelected` focus effect.

Replace the lens effect so it depends on `coversGrid`:

```ts
useEffect(() => {
  if (coversGrid) {
    const pane = paneRef.current;
    if (pane) socketRef.current?.keepSize(pane);
    const shared = sharedGridRef.current;
    const hidden = termRef.current;
    if (shared && hidden && !observeRef.current && (hidden.cols !== shared.cols || hidden.rows !== shared.rows)) hidden.resize(shared.cols, shared.rows);
    return;
  }
  if (observeRef.current || fixedGridRef.current) return;
  const term = termRef.current;
  try {
    fitRef.current?.fit();
  } catch {
    return;
  }
  const pane = paneRef.current;
  if (pane && term) socketRef.current?.resize(pane, term.cols, term.rows, true);
  if (!autoSelected && !coarseRef.current) term?.focus();
}, [coversGrid]);
```

Change `const inputLine = !directTyping && !chatView` to `const inputLine = !directTyping && !coversGrid`. In the direct-typing effect, change `!chatView` to `!coversGrid` and the dependency from `chatView` to `coversGrid`.

On the stack `className`, add `covers-grid` and `is-changes` without removing `is-chat` or `is-greeted`. The element today is `` `terminal-stack${chatView ? " is-chat" : ""}${greeted ? " is-greeted" : ""}` ``. It becomes:

```tsx
<div ref={stackRef} className={`terminal-stack${coversGrid ? " covers-grid" : ""}${chatView ? " is-chat" : ""}${changesView ? " is-changes" : ""}${greeted ? " is-greeted" : ""}`} data-direct-typing={coarse && directTyping && !coversGrid ? "" : undefined}>
```

Change banner conditions that are already `!chatView` (unsupported, input error, waiting for input, terminal ended, reconnecting) to `!coversGrid`. Change the KeyBar condition from `!chatView` to `!coversGrid`. Leave ChatView, the queue, the prompt dock, the composer, `answering`, `heldByOpenQueue`, and `greetingDue` on `chatView`. Leave SecretInput as it is.

`changesView` is only used for the class in this task. That is intentional. Task 6 mounts the view. `noUnusedLocals` allows a variable used in the class string.

In `src/components/PaneTerminal.css`, after the existing `.terminal-stack.is-chat .pane-terminal` rule, add the same declaration for the covered grid. Do not delete the `is-chat` rule.

```css
.terminal-stack.covers-grid .pane-terminal {
  content-visibility: hidden;
}
```

Insert these dictionary entries immediately after `"Chat transcript (⌘⇧J)"` in each file.

`src/lib/i18n.ko.ts`:

```ts
"Changes": "변경 사항",
"Changes (⌘⇧G)": "변경 사항 (⌘⇧G)",
```

`src/lib/i18n.ja.ts`:

```ts
"Changes": "変更",
"Changes (⌘⇧G)": "変更 (⌘⇧G)",
```

`src/lib/i18n.zh.ts`:

```ts
"Changes": "更改",
"Changes (⌘⇧G)": "更改 (⌘⇧G)",
```

Task 6 adds the rest of the keys beside these. The shortcut label `Changes` is the same key as the header label.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `HERDR_TEST_MODE=unit bun test ./src/lib/shortcuts.test.ts ./src/lib/settings.test.ts ./src/lib/i18n.test.ts ./src/lib/headerCrumb.test.ts ./src/lib/paneLens.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions.ts src/lib/shortcuts.ts src/lib/shortcutBindings.ts src/lib/shortcuts.test.ts src/lib/settings.test.ts src/App.tsx src/components/CommandPalette.tsx src/components/PaneTerminal.tsx src/components/PaneTerminal.css src/lib/headerCrumb.test.ts src/lib/i18n.ko.ts src/lib/i18n.ja.ts src/lib/i18n.zh.ts
git commit -m "feat(changes): open the Changes lens from the header and shortcuts"
```

---

### Task 6: Render the changes list and one diff

**Files:**
- Create: `src/components/ChangesView.tsx`
- Create: `src/components/ChangesView.css`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/machineContext.tsx`
- Modify: `src/components/PaneTerminal.tsx` (mount `ChangesView`)
- Modify: `src/components/PaneTerminal.css` (position the stack when Changes is showing)
- Modify: `src/lib/i18n.ko.ts`, `src/lib/i18n.ja.ts`, `src/lib/i18n.zh.ts`
- Test: `src/lib/i18n.test.ts`

**Interfaces:**
- Consumes: `fetchPaneChanges` and `fetchPaneChangeDiff` added in this task. `ChangeEntry`, `ChangesResponse`, `ChangeDiffResponse`. `useMachineApi`, `useMachineId`, `ApiError`, `useT`. `paneId` only. The parent does not pass rows, a path, or a timer.
- Produces:

```ts
export function fetchPaneChanges(paneId: string, machineId = "local"): Promise<ChangesResponse>;
export function fetchPaneChangeDiff(paneId: string, path: string, machineId = "local"): Promise<ChangeDiffResponse>;
```

`useMachineApi()` gains:

```ts
fetchPaneChanges: (pane: string) => api.fetchPaneChanges(pane, id),
fetchPaneChangeDiff: (pane: string, path: string) => api.fetchPaneChangeDiff(pane, path, id),
```

```tsx
export function ChangesView({ paneId }: { paneId: string }): JSX.Element;
```

Private to the component file, not exported:

```ts
type ListScreen =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "not_git" }
  | { kind: "update" }
  | { kind: "error"; message: string }
  | { kind: "rows"; rows: readonly ChangeEntry[]; error: string | null };

type ChangesScreen =
  | { mode: "list"; list: ListScreen }
  | {
      mode: "diff";
      path: string;
      diff:
        | { state: "loading" }
        | { state: "ready"; body: ChangeDiffResponse }
        | { state: "error"; message: string };
    };

function diffLineKind(line: string): "add" | "del" | "head" | "text";
```

`kind: "update"` has no rows. `kind: "rows"` is the only list that carries a poll error. `loading` is not a second flag on `rows`.

List transitions, the only ones:

- Mount, or `Back`: `{ mode: "list", list: { kind: "loading" } }`, then one fetch. `Back` is the only control that returns to the list while staying on Changes.
- `git: true` and at least one row: `kind: "rows"`, `error: null`. Heading `1 file` when the length is 1, otherwise `t("{count} files", { count })`. No heading when there are no rows.
- `git: true` and no rows: `kind: "empty"`. Copy `No uncommitted changes`.
- `git: false`: `kind: "not_git"`. Copy `This workspace is not a git checkout`.
- 404 whose `code` is `not_found`: `kind: "update"`. Copy `This PC needs an update to show changes.` Rows are dropped. This arms the 5 second timer like any other settled list response.
- Any other failure, including a network `Error`, when the screen is not `rows`: `kind: "error"`, `message: error.message` (the `ApiError` text, not `detail`).
- Any other failure when the screen is `rows`: stay `rows`, set `error` to `error.message`.
- A response whose generation is not current, or whose abort signal has fired, is ignored and does not arm the timer.
- A settled current list response, success or failure, including `not_found`, arms one 5 second timer. The timer starts when the promise settles, not when it starts. It fires only while `mode` is still `list`. Opening a diff, leaving the lens, changing pane or machine, or unmounting clears it. Abort is not a failed poll.
- A refresh does not move `rows` back to `loading`.
- Tap a row: `{ mode: "diff", path, diff: { state: "loading" } }`. One fetch. No timer. A later response for another path is ignored. The row opens `entry.path`. `from {path}` is text, `t("from {path}", { path: entry.old_path })`.
- Diff success: `state: "ready"`. `kind: "binary"` shows `Binary file` and no lines. `kind: "empty"` shows no lines and does not show `Binary file` or `Diff cut at 256 KB`. `truncated: true` shows `Diff cut at 256 KB` and the cut text. Other kinds render `diffLineKind`.
- Diff 404 `not_found`: `state: "error"` with the update sentence, translated at render. Other diff failures, including `not_a_change`: `state: "error"` with `error.message`. No retry. `Back` still works.
- `kind: "loading"` renders no heading, no rows, and no sentence. There is no retry button. Empty, not-git, update, and first-error have `role="status"`.

`diffLineKind` checks the prefix table first, so `+++` and `---` are headers, then a leading `+` is an addition and a leading `-` is a deletion. Everything else is text. Do not reuse `ChatView.css` class names. Do not sort.

The fetch signatures do not take an `AbortSignal`. The component aborts its own controller so a late settlement is ignored. The HTTP request may still finish.

- [ ] **Step 1: Write the failing component**

Create `src/components/ChangesView.tsx` with the `t("…")` literals below and do not add the dictionary entries yet. Create `src/components/ChangesView.css`. Add the fetches and mount the component. The i18n scan fails until step 3 adds the translations.

`src/lib/api.ts`, add `ChangeDiffResponse` and `ChangesResponse` to the protocol type import. After `fetchPaneFiles`:

```ts
/** GET /api/pane/changes: uncommitted files in the pane folder. */
export function fetchPaneChanges(paneId: string, machineId = "local"): Promise<ChangesResponse> {
  const params = new URLSearchParams({ pane_id: paneId });
  return getJson<ChangesResponse>(machinePath(machineId, `pane/changes?${params.toString()}`));
}

/** GET /api/pane/changes/diff: one uncommitted file. `path` is the status path. */
export function fetchPaneChangeDiff(paneId: string, path: string, machineId = "local"): Promise<ChangeDiffResponse> {
  const params = new URLSearchParams({ pane_id: paneId, path });
  return getJson<ChangeDiffResponse>(machinePath(machineId, `pane/changes/diff?${params.toString()}`));
}
```

In `src/lib/machineContext.tsx`, next to `fetchPaneFiles`:

```ts
fetchPaneChanges: (pane: string) => api.fetchPaneChanges(pane, id),
fetchPaneChangeDiff: (pane: string, path: string) => api.fetchPaneChangeDiff(pane, path, id),
```

Create `src/components/ChangesView.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ChangeDiffResponse, ChangeEntry, ChangesResponse } from "../../shared/protocol.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import "./ChangesView.css";

type ListScreen =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "not_git" }
  | { kind: "update" }
  | { kind: "error"; message: string }
  | { kind: "rows"; rows: readonly ChangeEntry[]; error: string | null };

type ChangesScreen =
  | { mode: "list"; list: ListScreen }
  | {
      mode: "diff";
      path: string;
      diff:
        | { state: "loading" }
        | { state: "ready"; body: ChangeDiffResponse }
        | { state: "error"; message: string };
    };

const LIST_POLL_MS = 5_000;
const UPDATE_SENTENCE = "This PC needs an update to show changes.";

const DIFF_HEADER_PREFIXES = [
  "diff ", "index ", "---", "+++", "@@", "\\",
  "rename ", "copy ", "old mode", "new mode",
  "deleted file", "new file", "similarity ", "dissimilarity ",
] as const;

function diffLineKind(line: string): "add" | "del" | "head" | "text" {
  for (const prefix of DIFF_HEADER_PREFIXES) if (line.startsWith(prefix)) return "head";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "text";
}

function listFromBody(body: ChangesResponse): ListScreen {
  if (!body.git) return { kind: "not_git" };
  if (body.changes.length === 0) return { kind: "empty" };
  return { kind: "rows", rows: body.changes, error: null };
}

function listFromFailure(current: ListScreen, error: unknown): ListScreen {
  if (error instanceof ApiError && error.status === 404 && error.code === "not_found") return { kind: "update" };
  const message = error instanceof Error ? error.message : String(error);
  if (current.kind === "rows") return { kind: "rows", rows: current.rows, error: message };
  return { kind: "error", message };
}

function diffLines(text: string): string[] {
  if (text.endsWith("\n")) return text.slice(0, -1).split("\n");
  return text.length === 0 ? [] : text.split("\n");
}

export function ChangesView({ paneId }: { paneId: string }): JSX.Element {
  const t = useT();
  const machineId = useMachineId();
  const { fetchPaneChanges, fetchPaneChangeDiff } = useMachineApi();
  const [screen, setScreen] = useState<ChangesScreen>({ mode: "list", list: { kind: "loading" } });
  const screenRef = useRef(screen);
  const generation = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchListRef = useRef(fetchPaneChanges);
  const fetchDiffRef = useRef(fetchPaneChangeDiff);
  fetchListRef.current = fetchPaneChanges;
  fetchDiffRef.current = fetchPaneChangeDiff;

  const commit = (next: ChangesScreen): void => {
    screenRef.current = next;
    setScreen(next);
  };

  const clearTimer = (): void => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const current = (ticket: number, controller: AbortController): boolean => ticket === generation.current && !controller.signal.aborted;

  const startListRef = useRef<(reset: boolean) => void>(() => {});
  startListRef.current = (reset: boolean): void => {
    if (!reset && screenRef.current.mode !== "list") return;
    clearTimer();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const ticket = ++generation.current;
    if (reset) commit({ mode: "list", list: { kind: "loading" } });
    const seen = screenRef.current.mode === "list" ? screenRef.current.list : { kind: "loading" as const };
    const arm = (): void => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (ticket !== generation.current) return;
        if (screenRef.current.mode !== "list") return;
        startListRef.current(false);
      }, LIST_POLL_MS);
    };
    void fetchListRef.current(paneId).then(
      (body) => {
        if (!current(ticket, controller)) return;
        commit({ mode: "list", list: listFromBody(body) });
        arm();
      },
      (error: unknown) => {
        if (!current(ticket, controller)) return;
        const list = screenRef.current.mode === "list" ? screenRef.current.list : seen;
        commit({ mode: "list", list: listFromFailure(list, error) });
        arm();
      },
    );
  };

  const openDiff = (path: string): void => {
    clearTimer();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const ticket = ++generation.current;
    commit({ mode: "diff", path, diff: { state: "loading" } });
    void fetchDiffRef.current(paneId, path).then(
      (body) => {
        if (!current(ticket, controller) || body.path !== path) return;
        commit({ mode: "diff", path, diff: { state: "ready", body } });
      },
      (error: unknown) => {
        if (!current(ticket, controller)) return;
        const message = error instanceof ApiError && error.status === 404 && error.code === "not_found"
          ? UPDATE_SENTENCE
          : error instanceof Error ? error.message : String(error);
        commit({ mode: "diff", path, diff: { state: "error", message } });
      },
    );
  };

  useEffect(() => {
    startListRef.current(true);
    return () => {
      generation.current += 1;
      abortRef.current?.abort();
      clearTimer();
    };
  }, [paneId, machineId]);

  if (screen.mode === "diff") {
    const diff = screen.diff;
    return (
      <div className="changes-view">
        <button type="button" className="btn changes-back" onClick={() => startListRef.current(true)}>{t("Back")}</button>
        {diff.state === "error" ? (
          <p role="status">{diff.message === UPDATE_SENTENCE ? t("This PC needs an update to show changes.") : diff.message}</p>
        ) : diff.state === "ready" ? <DiffBody body={diff.body} /> : null}
      </div>
    );
  }

  const list = screen.list;
  return (
    <div className="changes-view">
      {list.kind === "rows" && (
        <h2 className="changes-heading">{list.rows.length === 1 ? t("1 file") : t("{count} files", { count: list.rows.length })}</h2>
      )}
      {list.kind === "rows" && list.error !== null && <p className="changes-note" role="status">{list.error}</p>}
      {list.kind === "empty" && <p className="changes-note" role="status">{t("No uncommitted changes")}</p>}
      {list.kind === "not_git" && <p className="changes-note" role="status">{t("This workspace is not a git checkout")}</p>}
      {list.kind === "update" && <p className="changes-note" role="status">{t("This PC needs an update to show changes.")}</p>}
      {list.kind === "error" && <p className="changes-note" role="status">{list.message}</p>}
      {list.kind === "rows" && (
        <ul className="changes-list">
          {list.rows.map((entry) => (
            <li key={entry.path}>
              <button type="button" className="changes-row" onClick={() => openDiff(entry.path)}>
                <code className="changes-code">{entry.code}</code>
                <span className="changes-path">{entry.path}</span>
                {entry.old_path !== undefined && <span className="changes-from">{t("from {path}", { path: entry.old_path })}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiffBody({ body }: { body: ChangeDiffResponse }): JSX.Element | null {
  const t = useT();
  if (body.kind === "binary") return <p className="changes-note" role="status">{t("Binary file")}</p>;
  if (body.kind === "empty") return null;
  return (
    <>
      <pre className="changes-diff">
        {diffLines(body.text).map((line, index) => (
          <div key={index} className={`changes-line changes-line-${diffLineKind(line)}`}>{line.length === 0 ? " " : line}</div>
        ))}
      </pre>
      {body.truncated && <p className="changes-note" role="status">{t("Diff cut at 256 KB")}</p>}
    </>
  );
}
```

The server order is kept. Do not sort `list.rows`. An empty diff line renders a single space so the row still has height. That space is not a new `t()` string.

Create `src/components/ChangesView.css`:

```css
.changes-view {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  background: var(--bg);
  color: var(--text);
  padding: var(--space-3);
  gap: var(--space-2);
}

.changes-heading,
.changes-note {
  margin: 0;
  font-size: var(--fs-sm);
}

.changes-heading,
.changes-from,
.changes-line-head {
  color: var(--text-dim);
}

.changes-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.changes-row {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  width: 100%;
  text-align: start;
  background: var(--bg);
  color: inherit;
  border: 0;
  padding: var(--space-1) 0;
  font: inherit;
  cursor: pointer;
}

.changes-row:hover {
  background: var(--bg-hover);
}

.changes-code,
.changes-path,
.changes-diff {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
}

.changes-code,
.changes-diff {
  white-space: pre;
}

.changes-diff {
  margin: 0;
}

.changes-line-add {
  color: var(--status-done);
}

.changes-line-del {
  color: var(--status-blocked);
}

.changes-back {
  align-self: flex-start;
}
```

In `src/components/PaneTerminal.css`, add:

```css
.terminal-stack.is-changes {
  position: relative;
}
```

The Changes view is absolute so it does not take a flex row. A flex sibling would shrink the xterm mount and the fit addon would resize the pty.

In `src/components/PaneTerminal.tsx`, import `ChangesView` and, inside the stack, immediately after the `.terminal-surface` element, add:

```tsx
{changesView && paneId !== null && <ChangesView key={paneId} paneId={paneId} />}
```

`key={paneId}` remounts on a pane change, which drops the open diff. Leaving the lens unmounts it. Coming back mounts it on the list.

- [ ] **Step 2: Run the i18n test to verify it fails**

Run: `HERDR_TEST_MODE=unit bun test ./src/lib/i18n.test.ts`

Expected: FAIL. Missing keys include `No uncommitted changes`, `This workspace is not a git checkout`, `This PC needs an update to show changes.`, `1 file`, `{count} files`, `Back`, `Binary file`, `Diff cut at 256 KB`, and `from {path}`. `Changes` and `Changes (⌘⇧G)` are already present from Task 5.

- [ ] **Step 3: Add the translations**

Insert immediately after the Task 5 `"Changes (⌘⇧G)"` entry in each dictionary.

`src/lib/i18n.ko.ts`:

```ts
"No uncommitted changes": "커밋되지 않은 변경이 없습니다",
"This workspace is not a git checkout": "이 워크스페이스는 git 체크아웃이 아닙니다",
"This PC needs an update to show changes.": "변경을 보려면 이 PC를 업데이트해야 합니다.",
"1 file": "파일 1개",
"{count} files": "파일 {count}개",
"Back": "뒤로",
"Binary file": "바이너리 파일",
"Diff cut at 256 KB": "차이를 256 KB에서 잘랐습니다",
"from {path}": "{path}에서",
```

`src/lib/i18n.ja.ts`:

```ts
"No uncommitted changes": "未コミットの変更はありません",
"This workspace is not a git checkout": "このワークスペースは git のチェックアウトではありません",
"This PC needs an update to show changes.": "変更を表示するには、この PC の更新が必要です。",
"1 file": "1 ファイル",
"{count} files": "{count} ファイル",
"Back": "戻る",
"Binary file": "バイナリファイル",
"Diff cut at 256 KB": "差分は 256 KB で切れています",
"from {path}": "{path} から",
```

`src/lib/i18n.zh.ts`:

```ts
"No uncommitted changes": "没有未提交的更改",
"This workspace is not a git checkout": "此工作区不是 git 检出",
"This PC needs an update to show changes.": "此电脑需要更新才能显示更改。",
"1 file": "1 个文件",
"{count} files": "{count} 个文件",
"Back": "返回",
"Binary file": "二进制文件",
"Diff cut at 256 KB": "差异在 256 KB 处截断",
"from {path}": "来自 {path}",
```

Do not add any other `t()` key. Do not add a loading sentence or a retry label.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `HERDR_TEST_MODE=unit bun test ./src/lib/i18n.test.ts`

Expected: PASS. No missing key, no stale key, placeholders `{count}` and `{path}` present in each translation.

Run: `bun run typecheck`

Expected: exit 0.

Run: `bun run test:unit`

Expected: PASS. This does not run `server/api.contract.test.ts`. Do not run a bare `bun test`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChangesView.tsx src/components/ChangesView.css src/components/PaneTerminal.tsx src/components/PaneTerminal.css src/lib/api.ts src/lib/machineContext.tsx src/lib/i18n.ko.ts src/lib/i18n.ja.ts src/lib/i18n.zh.ts
git commit -m "feat(changes): show the uncommitted list and one diff"
```
