# Changes view

Sketch only. The spec at `docs/bigbear/specs/2026-10-06-worktree-changes-design.md` is the contract. This file does not add behavior, routes, or copy.

**Organizing structure:** a private `StatusRun` union (`status` | `not_repository` | `failed`) is the only git outcome `paneChanges` and `paneChangeDiff` consume; `PaneLens` and `ListScreen` are the client sums, so a remembered lens and a stale list cannot sit on the wrong screen.

## Grounding

The pane column is two lenses over one mounted terminal. `App` stores `lens` as `{ key, view }` with `view: "chat" | "terminal"` and settles it during render, not in an effect: `PaneTerminal` attaches in a layout effect, and a late lens change resizes a pane whose lens is chat (`src/App.tsx`, `storedView`, the `lensKey` block). The storage key is `herdr-web-ui:view:` plus `paneStorageId(machineId, paneId)` (`shared/machines.ts`). `storedView` returns `"chat"` before it reads storage when `terminalAttach` is false, then accepts only `"chat"` or `"terminal"`. Settings `defaultView` is `"auto" | "chat" | "terminal"` and never selects anything else. `toggleView` is `view === "chat" ? "terminal" : "chat"`. The palette has one J item whose label is that same binary (`src/components/CommandPalette.tsx`). Shortcuts dispatch `toggleView` from `KEY_TO_ID["j"]` (`src/lib/shortcuts.ts`). `CUSTOM_SHORTCUT_IDS` is the allowlist that keeps a settings override (`src/lib/shortcutBindings.ts`).

`PaneTerminal` sets `chatView = view === "chat"`. Every other view is the live grid: focus, fit, resize, and the terminal banners (`src/components/PaneTerminal.tsx`, including the effect keyed on `chatView` that calls `keepSize` while covered and `fit` plus `focus` when it returns). Chat is an overlay. The xterm stays mounted. `.terminal-stack.is-chat .pane-terminal` uses `content-visibility: hidden` so the grid is not drawn and is not refit to zero (`src/components/PaneTerminal.css`). `showsChat` is `view === "chat"` and only then adds `is-chat` on the header (`src/lib/headerCrumb.ts`). The header switch is Chat then Terminal, labels in `header-desktop-only`, titles `Chat transcript (⌘⇧J)` and the two terminal strings already in `App`.

`GET /api/pane/files` is the pattern the new routes join (`server/index.ts`, beside that handler, before the `/api/*` 404). Method must be GET (`use GET`). `pane_id` comes from `searchParams.get` with no trim; a missing or empty value is 400 `missing_pane_id`, message `pane_id query parameter is required`. `paneContext` loads one session snapshot, throws `HerdrError` `pane_not_found` or `cwd_not_found` when the pane or the folder is missing, and sets `cwd` to `foreground_cwd ?? cwd`. `errorResponse` (`server/http.ts`) maps those HerdrError codes to 404 and maps any other thrown `Error` to 500 `internal_error`. Git failures must not be thrown or they become that 500. The watch role may GET `/api/pane/files`: read-only denial is `/api/fs/` and mutating methods, not pane GETs. These routes do not take `x-herdr-machine` or `x-herdr-update`. Auth is the existing `/api/*` gate, 401 `unauthorized`.

`/api/machines/local/` rewrites any `pane/` path onto `/api/` before the handlers run. A remote PC is different: `handleMachineRequest` forwards only when `MACHINE_PROXY_PATH` matches the whole remainder (`server/machine-api.ts`). The regex is anchored. `pane/files` does not imply `pane/files/extra`, and `pane/changes` will not imply `pane/changes/diff` unless that alternative is written out. A miss is 404 `not_found`, message `Unknown PC endpoint`, from the connection server, without contacting the bridge. An older bridge that has no such route answers its own 404 `not_found`. The client already turns a non-2xx body into `ApiError`, whose `message` is `` `${url} failed (${status}): ${detail}` `` and whose `code` is the envelope code (`src/lib/api.ts`). `useMachineApi` binds `machineId` into each fetch the way `fetchPaneFiles` does. `machinePath` uses `/api/...` for local and `/api/machines/:id/...` otherwise.

`server/files.ts` already spawns `git` for `ls-files`, kills it at 3 seconds, ignores stderr, and caches the inventory for 5 seconds. Changes does not share that helper, that timeout, or that cache. The spec forbids a status cache and a persistent git process. `site/demo/transport.ts` answers `/api/pane/files` with a fixture and never runs git; a path under `/api/machines/` that is not the machines list is a demo 404.

What this feature must not disturb: the terminal stays mounted under the new lens, or opening Changes detaches and reattaches the pty. `chatView` must not be the test for "cover the grid", or Changes falls through to the live terminal. Storage for `changes` must be read before the no-attach early return, or a remembered Changes lens opens Chat on a PC with no attach. The diff route must not call `paneChanges` for its status step, or a missing repository becomes `{ git: false }` instead of `git_failed`.

## Candidate 1 — deepest module

### Problem

Git's exit codes mean different things for the list and the diff, porcelain `-z` renames are ordered new-then-old, and the lens rules are easy to copy wrong into `App`, the palette, and the shortcut switch. The existing `chat` / `terminal` boolean is the shape a third lens would extend. The public surface has to stay the two functions the spec names, with the route doing HTTP and nothing about git.

### Usage (caller's view)

The route looks up the pane, then makes one call. It does not read stderr, spawn git, or classify paths.

```ts
const { cwd } = await paneContext(paneId);
const result = pathname === "/api/pane/changes/diff"
  ? await paneChangeDiff(cwd, url.searchParams.get("path") ?? "")
  : await paneChanges(cwd);
return respondChanges(result);
```

The shell holds a lens port and asks it what to do. Prior is not a field `App` can set.

```ts
lens.press("changes");
lens.cycle();
lens.showChanges(selectedPaneId !== null);
const label = lens.switchTo() === "terminal" ? "Switch to terminal" : "Switch to chat";
```

`ChangesView` is mounted with the pane id only. The parent does not pass rows, a path, or a timer.

```tsx
{view === "changes" && paneId !== null && <ChangesView key={paneId} paneId={paneId} />}
```

### Shape

Organizing structure: one deep module, `server/changes.ts`. Callers see the spec result types and nothing else. Straight-line private procedures interpret each git exit where they run. There is no shared outcome union.

```ts
export type ChangesResult =
  | ChangesResponse
  | { error: "git_unavailable" | "git_timeout" | "git_failed"; message: string };

export type ChangeDiffResult =
  | ChangeDiffResponse
  | { error: "invalid_path" | "not_a_change" | "git_unavailable" | "git_timeout" | "git_failed"; message: string };

export function paneChanges(cwd: string): Promise<ChangesResult> {
  not implemented
}

export function paneChangeDiff(cwd: string, path: string): Promise<ChangeDiffResult> {
  not implemented
}

function runGit(cwd: string, args: readonly string[]): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number } | { error: "git_unavailable" | "git_timeout" | "git_failed"; message: string }> {
  not implemented
}
```

`paneChanges` and `paneChangeDiff` each decide what a non-zero status means. A missing repository is `{ git: false, changes: [] }` in the first and `git_failed` in the second. The string `not a git repository` is checked in both.

The lens port hides the remembered Chat or Terminal lens inside the module. `view` is still React state, because the header has to render it.

```ts
export type LensPort = {
  view(): PaneView;
  switchTo(): "chat" | "terminal";
  press(view: PaneView): void;
  cycle(): void;
  showChanges(hasPane: boolean): void;
  retarget(paneKey: string, stored: PaneView): void;
};

export function createPaneLens(initial: PaneView): LensPort {
  not implemented
}
```

`ChangesView` keeps `path: string | null`, `rows: ChangeEntry[] | null`, `error: string | null`, `notGit: boolean`, and `needsUpdate: boolean`. Only the component writes them. Opening a row sets `path`. `Back` clears it. The poll timer is a ref in the component.

Interface depth: the route and `App` learn two functions and a port. They do not learn porcelain, the kill timer, or the J-from-Changes fallback. The port is larger than a value, because the caller has to use the methods in the right order (`retarget` on a pane change, or `press` clobbers the new pane).

### Tradeoffs accepted

- We accept two copies of the not-a-repository test in exchange for not introducing a git type the route could start switching on.
- We accept a pile of booleans inside `ChangesView` in exchange for not making the parent pass a screen model.
- We accept a lens object beside React state in exchange for keeping `prior` out of `App`.

## Candidate 2 — invalid states unrepresentable

### Problem

The same constraints as Candidate 1. The failures to make unrepresentable are specific: a rename row with no `old_path`, an ordinary row with one, `truncated: true` on a binary or empty diff, `{ git: false }` from the diff path, a remembered lens while Chat is showing, and a stale list kept under the update sentence.

### Usage (caller's view)

The route still calls the two spec functions. It does not see `StatusRun`. The shell stores one `PaneLens` value and folds events into it during render, the way it already settles `lens` during render.

```ts
const next = reducePaneLens(lens, { type: "show-changes" }, { hasPane: selectedPaneId !== null, hasAgent: selectedAgent !== null });
const switchTo = jTarget(next, selectedAgent !== null);
```

```tsx
<button type="button" onClick={() => actions.showChanges()}>{t("Changes")}</button>
```

```tsx
{changesView && paneId !== null && <ChangesView key={paneId} paneId={paneId} />}
```

A list the parent could store does not exist. `ChangesView` holds a `ListScreen` value.

### Shape

Organizing structure: three sums. `StatusRun` is the git outcome. `PaneLens` is the lens. `ListScreen` is the list on screen. A prefix table classifies diff lines. No phase modules.

`StatusRun` is private to `server/changes.ts`. `not_repository` carries the `git_failed` message the diff path returns, so the stderr rule lives in one function. The list path throws that message away and returns `{ git: false, changes: [] }`.

```ts
type GitFailure = { error: "git_unavailable" | "git_timeout" | "git_failed"; message: string };

type StatusRow =
  | { form: "ordinary"; code: string; path: string }
  | { form: "renamed"; code: string; path: string; oldPath: string };

type StatusRun =
  | { type: "status"; rows: readonly StatusRow[] }
  | { type: "not_repository"; failure: GitFailure }
  | { type: "failed"; failure: GitFailure };

type DiffBody =
  | { kind: "diff"; text: string; truncated: boolean }
  | { kind: "untracked"; text: string; truncated: boolean }
  | { kind: "binary"; text: ""; truncated: false }
  | { kind: "empty"; text: ""; truncated: false };

function statusOf(cwd: string): Promise<StatusRun> {
  not implemented
}

function parsePorcelain(stdout: Uint8Array): StatusRow[] | GitFailure {
  not implemented
}
```

`ordinary` has no `oldPath`. `renamed` requires one. The parser is the only constructor: either status character `R` or `C` builds `renamed` (new path, then old path, which is the `-z` order), anything else that is two characters, a space, and a NUL-terminated path builds `ordinary`. A short record, a missing NUL, or a rename with no old path fails the whole parse as `{ error: "git_failed", message: "git failed" }`. No partial list. The code alphabet stays open. An unknown porcelain letter in a well-shaped record is still a row.

`DiffBody` cannot say a binary file was truncated or give an empty diff a body. The wire `ChangeDiffResponse` stays the flat interface the spec names. The module maps `DiffBody` onto it at the return.

```ts
export type PaneLens =
  | { paneKey: string; contextKey: string; view: "chat" | "terminal" }
  | { paneKey: string; contextKey: string; view: "changes"; prior: "chat" | "terminal" | null };

export type LensEvent =
  | { type: "press"; view: "chat" | "terminal" }
  | { type: "press-changes" }
  | { type: "cycle" }
  | { type: "show-changes" };

export function reducePaneLens(lens: PaneLens, event: LensEvent, ctx: { hasPane: boolean; hasAgent: boolean }): PaneLens {
  not implemented
}

export function jTarget(lens: PaneLens, hasAgent: boolean): "chat" | "terminal" {
  not implemented
}

export function settlePaneLens(held: PaneLens, next: { paneKey: string; contextKey: string; stored: PaneView }): PaneLens {
  not implemented
}
```

`prior` exists only on `view: "changes"`. `press-changes` while already on Changes returns the same reference, so the diff does not remount. `show-changes` with `hasPane: false` returns the same reference. `cycle` and `show-changes` from Changes both become `prior ?? (hasAgent ? "chat" : "terminal")`.

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
  | { mode: "diff"; path: string; diff: { state: "loading" } | { state: "ready"; body: ChangeDiffResponse } | { state: "error"; message: string } };
```

`kind: "update"` has no rows, so a stale list under the update sentence does not typecheck. `kind: "rows"` is the only place a poll error sits above rows. `loading` is not a second boolean on `rows`.

Diff lines go through one table, first match wins, then `+` / `-`:

```ts
const DIFF_HEADER_PREFIXES = [
  "diff ", "index ", "---", "+++", "@@", "\\",
  "rename ", "copy ", "old mode", "new mode",
  "deleted file", "new file", "similarity ", "dissimilarity ",
] as const;

function diffLineKind(line: string): "add" | "del" | "head" | "text" {
  not implemented
}
```

Interface depth: `statusOf` hides spawn, kill, porcelain, and the stderr test. The two public functions hide which arm becomes `{ git: false }` versus `git_failed`. `reducePaneLens` hides the fallback. What stays exposed is the spec wire types and `PaneLens`, because `App` has to store the lens. The git unions stay unexported. Exporting them would make the route a second interpreter.

### Tradeoffs accepted

- We accept a private union the tests never name in exchange for one not-a-repository policy.
- We accept that the wire `ChangeDiffResponse` can still say `kind: "binary", truncated: true` in exchange for leaving the spec's JSON shape alone. The domain type cannot.
- We accept `settlePaneLens` as a separate function from `reducePaneLens` in exchange for keeping the render-time storage re-read out of the event reducer.

## Red-flag screen

### Candidate 1

- Information leakage. Both public functions interpret `not a git repository`. A change to that test, or to "timeout wins over that stderr", is two edits. The procedural module does not remove the leak; it hides it.
- Two writers. `LensPort` owns `prior` and React owns `view`. `App` already settles the lens during render. A method object updated from that render is a second store. A pane change that calls `retarget` late leaves `prior` on the new pane.
- Invalid states inside the deep module. `notGit`, `needsUpdate`, `rows`, and `error` can all be set together. Callers cannot see the booleans, so the public surface is not shallow, but the next edit inside `ChangesView` adds another flag. That fails the "shortest path that compiles" test.
- Not a pass-through. `runGit` does not have the same shape as `paneChanges`. The route mapper adds HTTP status. Those are fine.
- Not temporal decomposition, as long as the procedures stay in `server/changes.ts`. Splitting spawn, parse, and diff into files would be. This candidate does not.

Keep the boundary (two functions, route maps HTTP, one view component, parent does not hold rows). Do not keep the port or the booleans.

### Candidate 2

- Shallow if exported. `StatusRun`, `StatusRow`, and `DiffBody` on the route, or in `shared/protocol.ts`, would leak git stages into HTTP and the client. The candidate keeps them private. `PaneLens` is exported because the shell has to store it. That is the lens, not a porcelain record.
- Pass-through check. `paneChanges` mapping `not_repository` to `{ git: false, changes: [] }` is the list policy, not a forward of `statusOf`. `paneChangeDiff` must not call `paneChanges`.
- Temporal decomposition check. `statusOf`, then toplevel, then diff, is one function's sequence inside one module. Separate `parse.ts` / `diff.ts` / `cap.ts` would repeat `StatusRow` at each boundary. The candidate does not split them.
- The prefix table is private to the view. Exporting `diffLineKind` would be a surface with no second caller.
- `ListScreen` living only in `ChangesView` is the deep part of the client. `App` dispatching `LensEvent` does not reimplement poll rules.

No reject. Do not widen the exports.

## Synthesis

### Problem

Show the focused pane folder's uncommitted files, and the diff of one of them, without staging, committing, or talking to herdr. The folder is the one `/api/pane/files` already uses (`foreground_cwd`, else `cwd`). The list and the diff disagree about a missing repository. The lens is a third value in a store that today is a boolean, settled during render, and the terminal under it must stay mounted or the pty drops. `chatView === (view === "chat")` currently means both "show the transcript" and "do not fit the grid". A third lens that only extends `PaneView` paints the live terminal.

### Usage (caller's view)

Route, next to `/api/pane/files`, exact paths, diff not a prefix of the list. `paneContext` still throws `HerdrError`. Git results are returned, never thrown.

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

function respondChanges(result: ChangesResult | ChangeDiffResult): Response {
  not implemented
}
```

`respondChanges` is local to the route. It is not an export of `server/changes.ts`. `invalid_path` is 400, `not_a_change` is 404, and the three git codes are 502, each `{ error: { code, message } }` with the message on the result. Success is 200 and the result object.

Client fetches go through `useMachineApi`, query built with `URLSearchParams`, same as `fetchPaneFiles`.

```ts
export function fetchPaneChanges(paneId: string, machineId = "local"): Promise<ChangesResponse> {
  not implemented
}

export function fetchPaneChangeDiff(paneId: string, path: string, machineId = "local"): Promise<ChangeDiffResponse> {
  not implemented
}
```

```ts
fetchPaneChanges: (pane: string) => api.fetchPaneChanges(pane, id),
fetchPaneChangeDiff: (pane: string, path: string) => api.fetchPaneChangeDiff(pane, path, id),
```

The shell does not fetch changes itself.

```tsx
const settled = settlePaneLens(lens, { paneKey, contextKey, stored: storedPaneView(selectedPaneId, selectedMachineId, selectedPane ? selectedAgent !== null : null, terminalAttach, settings.defaultView) });
const switchTo = jTarget(settled, selectedAgent !== null);
```

```tsx
<button type="button" aria-pressed={view === "chat"} onClick={() => setView("chat")} title={t("Chat transcript (⌘⇧J)")}>
  <MessageSquare />
  <span className="header-desktop-only">{t("Chat")}</span>
</button>
<button type="button" aria-pressed={view === "terminal"} onClick={() => setView("terminal")} title={terminalAttach ? t("Live terminal (⌘⇧J)") : t("Live terminal: coming to Windows PCs once herdr can attach there")}>
  <SquareTerminal />
  <span className="header-desktop-only">{t("Terminal")}</span>
  {!terminalAttach && <span className="pill pill-soon">{t("soon")}</span>}
</button>
<button type="button" aria-pressed={view === "changes"} onClick={() => setView("changes")} title={t("Changes (⌘⇧G)")}>
  <FileDiff />
  <span className="header-desktop-only">{t("Changes")}</span>
</button>
```

Chat, Terminal, Changes. Terminal stays the middle button. `setView("changes")` dispatches `press-changes`. While the lens is already Changes, that returns the same `PaneLens` reference and does not remount the view, so the open diff stays. `toggleView` dispatches `cycle`. `showChanges` dispatches `show-changes`. With no pane, `show-changes` does not change the lens. Leaving to Chat or Terminal unmounts `ChangesView`, which drops the diff. Coming back mounts it on the list.

```tsx
{ id: "view", label: t(switchTo === "terminal" ? "Switch to terminal" : "Switch to chat"), icon: SwitchCamera, shortcut: "toggle-view", run: actions.toggleView },
{ id: "changes", label: t("Changes"), icon: FileDiff, shortcut: "show-changes", run: actions.showChanges },
```

One J item. Its label is the lens J would open from here, including from Changes. The Changes item runs G.

```tsx
const coversGrid = view !== "terminal";
const chatView = view === "chat";
const changesView = view === "changes";
```

```tsx
<div className={`terminal-stack${coversGrid ? " covers-grid" : ""}${chatView ? " is-chat" : ""}${changesView ? " is-changes" : ""}`}>
  {/* xterm stays mounted */}
  {changesView && paneId !== null && <ChangesView key={paneId} paneId={paneId} />}
</div>
```

Every `chatView` test that means "skip fit, skip focus, hide terminal banners, `keepSize`" becomes `coversGrid`. Transcript, composer, queue, and prompt dock stay `chatView`. `showsChat` stays `view === "chat"`. Changes does not add `is-chat`.

Demo, no git. `localeCompare` order is `notes.txt` then `src/app.ts`.

```ts
if (path === "/api/pane/changes") return json({ git: true, changes: [{ path: "notes.txt", code: "??" }, { path: "src/app.ts", code: " M" }] });
if (path === "/api/pane/changes/diff") {
  const asked = query.get("path");
  if (asked === "src/app.ts") return json({ path: asked, code: " M", kind: "diff", truncated: false, text: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n" });
  if (asked === "notes.txt") return json({ path: asked, code: "??", kind: "untracked", truncated: false, text: "--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+hello\n" });
  return error("not_a_change", "path is not an uncommitted file", 404);
}
```

Tests call the two functions, not the parser. `HERDR_TEST_MODE=unit`, temp git repo, no herdr (`server/changes.test.ts`). The contract test creates a `focus: false` workspace whose `cwd` is a fresh `git init`, waits until that pane's folder is the temp directory, and hits the HTTP routes (`server/api.contract.test.ts`). `server/machines.test.ts` expects `MACHINE_PROXY_PATH` to match `pane/changes` and `pane/changes/diff` and to reject `pane/changes/diff/extra`.

### Shape

Organizing structure: `StatusRun`, private to `server/changes.ts`, plus `PaneLens` and `ListScreen` on the client. `StatusRun` is the single git outcome. The list and the diff are two maps off it, not two parsers. `PaneLens` puts `prior` only on Changes. `ListScreen` puts a stale list only on `rows`, and the update sentence only on `update`.

Wire types live in `shared/protocol.ts`, next to the `/api/pane/files` comment. They are the spec's interfaces, not the domain sums. A binary diff with `truncated: true` is representable on the wire and is not representable in `DiffBody`.

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

Public module surface. Result unions are exported because the route names them. Nothing else is.

```ts
export type GitErrorCode = "git_unavailable" | "git_timeout" | "git_failed";

export type ChangesResult =
  | ChangesResponse
  | { error: GitErrorCode; message: string };

export type ChangeDiffResult =
  | ChangeDiffResponse
  | { error: "invalid_path" | "not_a_change" | GitErrorCode; message: string };

export function paneChanges(cwd: string): Promise<ChangesResult> {
  not implemented
}

export function paneChangeDiff(cwd: string, path: string): Promise<ChangeDiffResult> {
  not implemented
}
```

Private git model. Not exported. Not imported by the route, the tests, or the client.

```ts
type GitFailure = { error: GitErrorCode; message: string };

type StatusRow =
  | { form: "ordinary"; code: string; path: string }
  | { form: "renamed"; code: string; path: string; oldPath: string };

type StatusRun =
  | { type: "status"; rows: readonly StatusRow[] }
  | { type: "not_repository"; failure: GitFailure }
  | { type: "failed"; failure: GitFailure };

type DiffBody =
  | { kind: "diff"; text: string; truncated: boolean }
  | { kind: "untracked"; text: string; truncated: boolean }
  | { kind: "binary"; text: ""; truncated: false }
  | { kind: "empty"; text: ""; truncated: false };

function runGit(cwd: string, args: readonly string[]): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number } | GitFailure> {
  not implemented
}

function gitFailedMessage(stderr: string): string {
  not implemented
}

function statusOf(cwd: string): Promise<StatusRun> {
  not implemented
}

function parsePorcelain(stdout: Uint8Array): StatusRow[] | GitFailure {
  not implemented
}

function lexicalChangePath(path: string): boolean {
  not implemented
}

function capDiffText(text: string): { text: string; truncated: boolean } {
  not implemented
}

function repositoryTop(cwd: string): Promise<{ top: string } | GitFailure> {
  not implemented
}

function untrackedBody(top: string, paneFolder: string, statusPath: string): Promise<DiffBody | { error: "invalid_path"; message: "path is invalid" }> {
  not implemented
}

function trackedBody(top: string, statusPath: string): Promise<DiffBody | GitFailure> {
  not implemented
}
```

`runGit` spawns an argument array, never a shell. Each call is one process, killed at 10 seconds. No pool and no cache. `ENOENT` is `{ error: "git_unavailable", message: "git is not installed" }`, whether spawn throws or the exit reports it, and it is classified before the exit code. A kill is `{ error: "git_timeout", message: "git timed out" }` even when the exit is also non-zero and stderr contains `not a git repository`. Any other non-zero exit is `{ error: "git_failed", message: gitFailedMessage(stderr) }`. `gitFailedMessage` is the first stderr line split on `\n`, trimmed, then `slice(0, 200)`, or `git failed` when that is empty.

`statusOf` runs `git -C <cwd> --no-optional-locks status --porcelain=v1 -z -uall -- .`. Exit 0 parses. A non-zero exit whose stderr contains `not a git repository` is `{ type: "not_repository", failure }` with that `git_failed` message. Any other `runGit` failure is `{ type: "failed", failure }`. `parsePorcelain` splits stdout on NUL bytes and does not unquote. An ordinary record is two characters, a space, the path, NUL. When either character is `R` or `C`, the next NUL field is `oldPath` (`-z` prints the new path first). Anything else is `git_failed` / `git failed` and no rows. `paneChanges` maps `not_repository` to `{ git: false, changes: [] }`, `failed` to that failure, and `status` to `{ git: true, changes }` sorted by `path.localeCompare(path)` with no locale argument. `renamed` sets `old_path`. `ordinary` omits the key. The client does not sort again.

`paneChangeDiff` rejects with `{ error: "invalid_path", message: "path is invalid" }` before any spawn when `lexicalChangePath` is false. That is: missing or empty, absolute, contains a backslash, contains NUL, an empty segment, or a `..` segment. No Unicode normalization. `.` is allowed and then fails the status match. It does not read outside the repo. Then it uses `statusOf`. `not_repository` and `failed` return that `GitFailure` unchanged, so a missing repository on this path is `git_failed`, not `{ git: false }`. A path that is not some row's `path` (exact string equality; for a rename, the new path) is `{ error: "not_a_change", message: "path is not an uncommitted file" }`. Otherwise `repositoryTop` runs `git -C <cwd> --no-optional-locks rev-parse --show-toplevel`. Empty stdout is `git_failed`. Later git uses that toplevel, never `join(paneFolder, repoRelativePath)`.

Code `??` uses `untrackedBody`. `realpath` the file and the pane folder. A throw, or a file real path that is not the pane folder and not inside it (prefix bounded by the platform path separator, not a string prefix of a sibling), is `invalid_path` and no bytes. Read at most 8192 bytes looking for a NUL. A NUL is `kind: "binary"`, `text: ""`, `truncated: false`, and the rest is not read. Otherwise `kind: "untracked"`. `text` is `--- /dev/null\n+++ b/<path>\n`, then, when the file is not empty, `@@ -0,0 +1,<N> @@\n` and one `+<line>\n` per line. Lines are `contents.split("\n")`, dropping one trailing empty piece when the file ends in `\n`. `N` is that count. A zero-byte file has no hunk and stays `untracked`, not `empty`. Stop reading once `text` exceeds 256 KB. Do not read the remainder. Then `capDiffText`.

Any other code, including a submodule or an unmerged path, uses `trackedBody`: `git -C <toplevel> --no-optional-locks diff --no-ext-diff --no-color -U3 HEAD -- <path>`. A deleted tracked file is this path too. It has nothing to `realpath`. The lexical check and the status match are enough. Exit 0 and zero stdout bytes is `kind: "empty"`, `text: ""`, `truncated: false`. Stdout whose any line is exactly `GIT binary patch`, or starts with `Binary files `, is `kind: "binary"`, `text: ""`, `truncated: false`. A changed line that merely contains those words is not a marker. Classify markers before the cap, so a long binary patch is not returned as a cut `diff`. Other stdout is `kind: "diff"`, then `capDiffText`. A non-zero diff exit is `git_failed` and the stdout is not returned. A repository with no commit still lists status. `??` reads the file. Any other code runs `git diff HEAD`, which fails when `HEAD` does not exist, and that failure is `git_failed`. A submodule stays one row. The server does not enter it.

`capDiffText` cuts at 256 * 1024 UTF-8 bytes. The cut is the last newline whose byte offset fits, or the byte cap when the first line does not fit. The returned text encodes back to at most 256 KB. A replacement character must not push it over the cap. A cut may split a code point. `truncated` is true only when the cap cut the text. Mapping to `ChangeDiffResponse` copies `code` and, for `renamed`, `old_path` from the matched row.

`paneChanges` returns `{ git: false, changes: [] }`, `{ git: true, changes }`, or a `GitFailure`. `paneChangeDiff` returns a `ChangeDiffResponse` or `{ error, message }`. Neither throws for a bad path, a missing binary, a timeout, a git failure, or a record it cannot parse.

Lens. `src/lib/paneLens.ts`. Pure values. `App` stores one `PaneLens` the way it stores `lens` today, and settles it during render.

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

export function reducePaneLens(lens: PaneLens, event: LensEvent, ctx: { hasPane: boolean; hasAgent: boolean }): PaneLens {
  not implemented
}

export function fallbackLens(hasAgent: boolean): ChatOrTerminal {
  not implemented
}

export function jTarget(lens: PaneLens, hasAgent: boolean): ChatOrTerminal {
  not implemented
}

export function storedPaneView(paneId: string, machineId: string, hasAgent: boolean | null, terminalAttach: boolean, defaultView: DefaultView): PaneView {
  not implemented
}

export function settlePaneLens(held: PaneLens, next: { paneKey: string; contextKey: string; stored: PaneView }): PaneLens {
  not implemented
}
```

`storedPaneView` reads `herdr-web-ui:view:` plus `paneStorageId`. Stored `changes` returns `changes` before the no-attach check. Stored `terminal` with no attach still returns `chat`. Stored `chat` or `terminal` is used when that PC has an attach. The settings default stays `auto`, `chat`, or `terminal` and never returns `changes`. Auto does not pick Changes.

`fallbackLens` is `chat` when `hasAgent` is true, otherwise `terminal`. `jTarget` is `lens.prior ?? fallbackLens(hasAgent)` when `view` is `changes`, otherwise the other of chat and terminal. That is the palette label and the lens J and G open from Changes.

`reducePaneLens`: `press` of chat or terminal sets that view and drops `prior`. `press-changes` from chat or terminal sets `view: "changes"` and `prior` to the view being left. `press-changes` when `view` is already `changes` returns the same reference. `cycle` swaps chat and terminal. From Changes, `cycle` and `show-changes` both return `jTarget`. `show-changes` with `hasPane: false` returns the same reference. `show-changes` from chat or terminal is `press-changes`. No-ops do not write storage again and do not remount. A real view change writes that `PaneView` to the same localStorage key. `prior` is not stored. A pane with no id does not write.

`settlePaneLens`: a new `paneKey` takes `stored` and `prior: null` (a stored `changes` is the changes variant with a null prior). The same pane with a new `contextKey` (agent, attach, or default view, which is today's `lensKey`) takes `stored` and keeps `prior` only when both the held view and the stored view are `changes`. Same keys return `held`. This is why an agent arriving does not forget that the user left Terminal to open Changes, and a pane change does.

`AppActions` keeps `setView` and `toggleView`. It gains `showChanges(): void`. The shortcut id is `show-changes`, label `Changes`, keys Mod Shift G. `KEY_TO_ID` maps `g` to it. Register it in `SHORTCUTS`, `KEY_TO_ID`, the switch in `src/lib/shortcuts.ts` (the new action, not `toggleView`), and `CUSTOM_SHORTCUT_IDS`. `toggle-view` stays J. The header title string is the literal `Changes (⌘⇧G)`, not a string built from `formatKeys`. The settings list shows Changes because it is in `SHORTCUTS`. The settings control does not gain a Changes choice.

Screen model, private to `src/components/ChangesView.tsx`. The parent never stores it.

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

export function ChangesView({ paneId }: { paneId: string }): JSX.Element {
  not implemented
}

const DIFF_HEADER_PREFIXES = [
  "diff ", "index ", "---", "+++", "@@", "\\",
  "rename ", "copy ", "old mode", "new mode",
  "deleted file", "new file", "similarity ", "dissimilarity ",
] as const;

function diffLineKind(line: string): "add" | "del" | "head" | "text" {
  not implemented
}
```

`diffLineKind` checks the prefix table first, so `+++` and `---` are headers, then a leading `+` is an addition and a leading `-` is a deletion. Everything else is text. Colors are `--status-done`, `--status-blocked`, and `--text-dim` in `ChangesView.css`. No new token. No color literal. No `!important`. The code run uses `white-space: pre`. The diff block uses `white-space: pre`. Do not reuse `ChatView.css` class names.

List transitions, the only ones. A generation ref and an abort controller sit beside the screen. They are not fields of `ListScreen`. At most one list request is in flight.

- Mount, or `Back`: `{ mode: "list", list: { kind: "loading" } }`, start a fetch. `Back` is the only control that returns to the list while staying on Changes.
- `git: true` and at least one row: `kind: "rows"`, `error: null`. Heading `1 file` when the length is 1, otherwise `t("{count} files", { count })`. No heading when there are no rows.
- `git: true` and no rows: `kind: "empty"`. Copy `No uncommitted changes`.
- `git: false`: `kind: "not_git"`. Copy `This workspace is not a git checkout`.
- 404 whose `code` is `not_found`: `kind: "update"`. Copy `This PC needs an update to show changes.` Rows are dropped. This is an error, not an empty success.
- Any other failure, including a network `Error`, when no successful list is on screen: `kind: "error"`, `message: error.message` (the `ApiError` text, not `detail`).
- Any other failure when the screen is `rows`: stay `rows`, set `error` to `error.message` above the rows.
- A response whose generation is not current is ignored and does not arm the timer. That includes a list response that arrives after a diff opened, after the lens unmounted, or after the pane id changed.
- A settled current list response, success or failure, including `not_found`, arms one 5 second timer. The timer starts when the promise settles, not when it starts. It fires only while `mode` is still `list`. Opening a diff, leaving the lens, changing pane or machine, or unmounting clears it. Abort is not a failed poll and does not arm a timer.
- A refresh does not move `rows` back to `loading`.
- Tap a row: `{ mode: "diff", path, diff: { state: "loading" } }`. One fetch. No timer. A later response for another path is ignored.
- Diff success: `state: "ready"`. `kind: "binary"` shows `Binary file` and no lines. `kind: "empty"` shows no lines and does not show `Binary file` or `Diff cut at 256 KB`. `truncated: true` shows `Diff cut at 256 KB` and the cut text. Other kinds render `diffLineKind`.
- Diff 404 `not_found`: `state: "error"` with the update sentence. Other diff failures, including `not_a_change`: `state: "error"` with `error.message`. No retry. `Back` still works.
- `from {path}` is text on a rename row, `t("from {path}", { path: entry.old_path })`. It is not a second target. The row opens `entry.path`.

`kind: "loading"` has no heading, no rows, and no invented sentence. There is no retry button. Empty, not-git, update, and first-error have no heading and no rows. Those lines are `role="status"`.

Strings passed to `t()`, each a literal, each with an entry in `src/lib/i18n.ko.ts`, `src/lib/i18n.ja.ts`, and `src/lib/i18n.zh.ts`. `{count}` and `{path}` are `t()` variables. The English string is the key.

- `Changes`
- `Changes (⌘⇧G)`
- `No uncommitted changes`
- `This workspace is not a git checkout`
- `This PC needs an update to show changes.`
- `1 file`
- `{count} files`
- `Back`
- `Binary file`
- `Diff cut at 256 KB`
- `from {path}`

`Switch to chat` and `Switch to terminal` already exist. No new i18n test file.

Module map. New files are the ones marked new. Existing files change only at the seams above.

| File | Owns |
| --- | --- |
| `shared/protocol.ts` | Wire `ChangeEntry`, `ChangesResponse`, `ChangeDiffResponse`, and the route comments |
| `server/changes.ts` | New. `StatusRun`, `DiffBody`, `paneChanges`, `paneChangeDiff` |
| `server/index.ts` | Exact GET handlers, `paneContext`, `bunServer.timeout`, `respondChanges` |
| `server/machine-api.ts` | `MACHINE_PROXY_PATH` alternatives `changes\/diff` and `changes` inside the `pane/` group. `changes\/diff` is written in full so a longer path does not match. The local alias already allows `pane/` |
| `server/changes.test.ts` | New. The spec's unit cases, calling only the two functions |
| `server/api.contract.test.ts` | List 200, diff 200, other path 404 `not_a_change` |
| `server/machines.test.ts` | Proxy allow and deny lines the spec names |
| `src/lib/paneLens.ts` | New. `PaneLens`, `reducePaneLens`, `settlePaneLens`, `storedPaneView` |
| `src/lib/actions.ts` | `PaneView` includes `changes`. `showChanges` |
| `src/lib/api.ts`, `src/lib/machineContext.tsx` | The two fetches |
| `src/lib/shortcuts.ts`, `src/lib/shortcutBindings.ts` | `show-changes` |
| `src/App.tsx` | Third header button, settle during render, dispatch events, storage write |
| `src/components/CommandPalette.tsx` | J label from `switchTo`, Changes item |
| `src/components/PaneTerminal.tsx`, `PaneTerminal.css` | `covers-grid` versus `chatView`, mount `ChangesView`, keep the xterm mounted |
| `src/components/ChangesView.tsx`, `ChangesView.css` | New. `ListScreen`, poll, diff lines |
| `src/lib/i18n.ko.ts`, `i18n.ja.ts`, `i18n.zh.ts` | The new keys |
| `site/demo/transport.ts` | Fixture list and diff, no git |

Interface depth. Two functions hide spawn, the 10 second kill, porcelain `-z`, rename field order, the lexical jail, `realpath`, untracked synthesis, binary markers, the 256 KB cap, and the fact that a missing repository is success on the list and failure on the diff. The route learns a result and a status code. `ChangesView` hides the poll generation, the stale list, and the one-shot diff. `App` learns `PaneLens` events and does not learn git or the timer. `switchTo` is one value so the palette does not reimplement the fallback. The surface is those two functions, the lens reducer, and `{ paneId }`. It is no larger: the spec already requires the wire types, the shortcut id, and the route mapper.

What the system deliberately does not do: stage, unstage, discard, commit, push, pull, history, branch compare, pull requests, a three-section list, a side-by-side diff, submodule recursion, extra rename detection, a Changes default, a Changes lens on first open, a status cache, a herdr RPC, keys sent to the pane, a new color token, a loading sentence, a retry button.

### Synthesis decision

Candidate 1 is the base for the boundary. `server/changes.ts` exports `paneChanges` and `paneChangeDiff` and the result types the route has to name. The route maps HTTP. `ChangesView` takes `paneId`. `App` does not hold rows, a path, or a timer. Git stays out of `herdr/` and out of the wire file.

Candidate 2 supplies the data. `StatusRun` replaces the duplicated stderr test. `StatusRow` makes `old_path` required exactly on a rename or copy. `DiffBody` makes `truncated: true` on binary or empty unrepresentable until the wire mapping. `PaneLens` replaces the lens port, which would have been a second store next to the render-settled state. `ListScreen` replaces the boolean pile. `settlePaneLens` is how the existing `lensKey` re-read keeps `prior` across an agent update and drops it on a pane or machine change.

Rejected from Candidate 1: the mutable `LensPort`, and `notGit` / `needsUpdate` / `rows` / `error` as independent fields. Rejected from Candidate 2: exporting `StatusRun` or `DiffBody` to the route or to `shared/protocol.ts`. Rejected as a shape: one HTTP handler in place of the two functions. The spec says the functions return results and the route maps them. Also rejected: calling `paneChanges` from `paneChangeDiff`, and treating `view !== "chat"` as the terminal.

### Tradeoffs accepted

- We accept the flat wire `ChangeDiffResponse` in exchange for not changing the spec's JSON. Invalid combinations die in `DiffBody` before that mapping.
- We accept a 5 second poll of a missing route while the update sentence is up in exchange for one settle rule. `not_found` does not stop the timer. Leaving the list does.
- We accept the header staying on the terminal surface (`showsChat` stays chat-only) in exchange for not inventing a header treatment the spec does not name. The Changes surface covers the grid with `covers-grid` and uses `--bg` in its own CSS.
- We accept no first-load sentence in exchange for not adding a `t()` key the spec does not list. `kind: "loading"` is blank.
- We accept that a `foreground_cwd` change under an open diff does not clear it in exchange for the spec's rule that the diff loads once and clears on pane, machine, lens leave, or `Back`. The next list request resolves the folder again.
- We accept `localeCompare` with no locale, including its platform differences, because the spec says no locale argument and the client must not sort again.
- We accept re-reading storage when agent, attach, or the default view changes, because that is the current `lensKey` behavior. `prior` survives that re-read only while the stored view is still `changes`.

### Alternatives considered

- Candidate 1's lens port and boolean screen. Smaller-looking call sites, worse depth once `prior` and `view` can diverge, and the not-a-repository rule lives twice. Lost on interface depth and on invalid states.
- A third export `handleChangesRoute` that returns `Response`. Smaller route, and it puts HTTP status in the git module. The spec puts pane lookup and the status map in the route, and `errorResponse` must stay the only path for `HerdrError`. A thrown git error would become 500.
- Phase files `porcelain.ts`, `diff.ts`, `cap.ts` sharing `StatusRow`. Temporal decomposition. The same record shape would cross three boundaries.
- Closing the porcelain alphabet to `M`, `A`, `D`, `R`, `C`, `?`, space. An unknown letter would 502 the whole list. The spec fails a record for shape, not for an unknown letter.
- Overlaying Changes by setting `chatView` true. That mounts the transcript and the composer and skips the grid for the wrong reason.

### Open questions and risks

- The spec does not say the header tints for Changes the way `is-chat` tints it for the transcript. This sketch leaves `showsChat` alone. If that seam is wrong, it is a product change, not a follow-up inside `PaneTerminal`.
- The spec does not name a placeholder for the first list request. This sketch renders nothing until it settles. A spinner needs a new string and three translations. Step 5 does not add one.
- No other product choice is open. Step 5 does not add a retry control, a Changes default, a status cache, case-folding on the `realpath` prefix, or a second sort.

### Next implementation step

Implement `server/changes.ts`: private `StatusRun` and `DiffBody`, and `paneChanges` / `paneChangeDiff` returning those results without throwing.
