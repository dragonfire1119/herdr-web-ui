# Changes view

Date: 2026-10-06
Branch: `feat/add-worktree-changes`

## Problem

herdr web shows a pane as Chat or Terminal. Chat lists files an agent touched in a turn. Nothing lists the git checkout's uncommitted files. Orca's Changes panel does that for the open checkout. This app will show the same fact, and only that fact: the files in the focused pane's folder that are not in `HEAD`, and the diff of one file.

## Terms

- **Pane folder.** `foreground_cwd`, or `cwd` when the foreground folder is absent. Same folder `/api/pane/files` already uses.
- **Changes.** Uncommitted git status of the pane folder. The header label is "Changes".
- **Worktree.** Already means a git worktree herdr opened as a workspace. This feature does not create, open, or delete one.
- **Not committed.** The file on disk differs from `HEAD`, or git status lists it (including a staged edit the file on disk no longer holds). The diff is the file on disk against `HEAD`, not the index against `HEAD`.

## Out of scope

No stage, unstage, discard, commit, push, pull, sync, history, branch compare, or pull request. No three-section list. No side-by-side diff. No submodule recursion. No new default lens. Changes is never the lens a pane opens on until the user has opened it there.

## Screen

The header switch is Chat, Terminal, Changes, in that order. Terminal stays the middle button. Chat's title stays `Chat transcript (⌘⇧J)`. Terminal's titles stay the two strings they use today. Changes uses `Changes (⌘⇧G)`. The visible label is `Changes`. On a narrow header the label hides the same way Chat and Terminal hide theirs. The icon is lucide `FileDiff`.

The lens is remembered per pane, the same way Chat and Terminal are. A stored `changes` opens Changes even when that PC has no terminal attach. A stored `terminal` on a PC with no attach still opens Chat, as it does today. The settings default stays Chat, Terminal, or auto. Auto does not pick Changes.

`Mod+Shift+J` still swaps Chat and Terminal. From Changes it returns to the lens the user left. When that lens was not kept (the pane was restored from storage already on Changes), J opens Chat if the pane has an agent and Terminal otherwise. `Mod+Shift+G` opens Changes from Chat or Terminal and remembers the lens it left. From Changes, G returns to that same lens.

The command palette keeps one J item. Its label names the lens J would open: `Switch to terminal`, `Switch to chat`. A second item, `Changes`, runs G.

The list is flat, sorted by path with `localeCompare`. Each row shows the two status characters git printed, including a leading space, then the path. A rename or copy also shows `from {path}` with the old path. The heading is `1 file` or `{count} files`.

Empty git checkout: `No uncommitted changes`.
Pane folder is not a checkout: `This workspace is not a git checkout`.
The route is missing (an older remote bridge): `This PC needs an update to show changes.`
`pane_not_found` and `cwd_not_found` stay the pane errors the other pane routes already show.

Tap a row. The pane shows that file's diff. `Back` returns to the list. The header switch stays. Leaving to Chat or Terminal and coming back opens the list, not the last diff.

The list loads when Changes opens and again 5 seconds after each settled load, while the list is on screen. Polling stops when the user opens a diff, leaves the lens, or unmounts. A failed poll keeps the last list and shows the error. The next poll still runs.

A diff loads once when opened. It does not refresh. A later load error stays on the diff. `Back` still works.

A diff longer than 256 KB (`256 * 1024` bytes) is cut at the last newline that fits, or at the cap when the first line does not fit. The view shows `Diff cut at 256 KB`. A binary file shows `Binary file` and no bytes.

Colors reuse the chat diff tokens: additions `--status-done`, deletions `--status-blocked`, headers `--text-dim`. No new color token. Component CSS is colocated and uses tokens only.

## API

Both routes are GET. They use the same auth as `/api/pane/files`. They take `pane_id`. Shapes live in `shared/protocol.ts`. Error bodies use `server/http.ts` only.

`GET /api/pane/changes?pane_id=`

```ts
interface ChangeEntry {
  path: string;
  /** Two porcelain characters, such as " M", "M ", "MM", "??", "R ", "D ". */
  code: string;
  /** Set only for a rename or copy. */
  old_path?: string;
}

interface ChangesResponse {
  /** False when the pane folder is not a git checkout. */
  git: boolean;
  changes: ChangeEntry[];
}
```

`git: false` and `changes: []` is 200. That is the not-a-checkout state.
`git: true` and `changes: []` is 200. That is the empty state.

`GET /api/pane/changes/diff?pane_id=&path=`

```ts
interface ChangeDiffResponse {
  path: string;
  old_path?: string;
  code: string;
  /** "diff" is unified text. "untracked" is unified text of a new file. "binary" and "empty" have text "". */
  kind: "diff" | "untracked" | "binary" | "empty";
  truncated: boolean;
  text: string;
}
```

Missing `pane_id`, a non-GET, or a non-integer where one is not accepted: 400, same codes as `/api/pane/files` (`missing_pane_id`, `method_not_allowed`).
Unknown pane or a pane with no folder: the existing `HerdrError` (`pane_not_found`, `cwd_not_found`), 404.
A path that is empty, absolute, contains a backslash, contains NUL, contains an empty segment, or contains a `..` segment: 400 `invalid_path`.
A path that is not a current status path (the new path, for a rename): 404 `not_a_change`.
git missing from `PATH`: 502 `git_unavailable`, message `git is not installed`.
git killed at 10 seconds: 502 `git_timeout`, message `git timed out`.
git exits non-zero for any other reason, except "not a git repository" on the list route: 502 `git_failed`. `message` is git's first stderr line, trimmed, at most 200 characters. When stderr is empty, the message is `git failed`.

The list route treats git's "not a git repository" exit as `{ git: false, changes: [] }`. It does not treat a missing binary or a timeout as that state.

## Git

The server runs git itself. No herdr RPC, no pty, no keys sent to the pane. One process per call. No connection pool. No status cache.

List command, arguments, no shell:

`git -C <pane folder> --no-optional-locks status --porcelain=v1 -z -uall`

Diff command, for a tracked path:

`git -C <pane folder> --no-optional-locks diff --no-ext-diff --no-color -U3 HEAD -- <path>`

`--no-optional-locks` lets the read fail instead of waiting when an agent holds the index lock. When git can take the lock, the commands refresh the index stat cache. They do not stage, unstage, commit, checkout, or write the worktree.

Parse `-z` porcelain v1. Each record is two status characters, a space, then a path, then NUL. When the first character is `R` or `C`, the record is two characters, a space, the old path, NUL, the new path, NUL. Paths are not quoted. A NUL inside a path is impossible in this format and ends the field. `-uall` lists files inside untracked directories, not the directory as one row. Ignored files are absent.

Sort after parse, by `path`.

The diff route runs status again and accepts `path` only when it equals a row's `path`. Then:

- Code `??`: read the file. A NUL in the first 8192 bytes makes `kind: "binary"`. Otherwise `kind: "untracked"` and `text` is a unified diff against `/dev/null` (`---` / `+++` / one hunk / `+` lines). Apply the 256 KB cap to `text`.
- Any other code: run the diff command. Exit 0 and empty stdout is `kind: "empty"`. Stdout that git marks binary (`Binary files` or `GIT binary patch`) is `kind: "binary"` and `text: ""`. Other stdout is `kind: "diff"`. Apply the cap to `text`. `truncated` is true only when the cap cut the text.
- Before reading an untracked file, resolve it under the pane folder. `realpath` the file and the repository toplevel (`git rev-parse --show-toplevel`). When the file's real path is outside that toplevel, return 400 `invalid_path` and do not return bytes. A deleted tracked file has no file to realpath; the lexical `..` check and the status-list check are enough.

A modified submodule stays one row. The diff is whatever `git diff HEAD` prints for that path. The server does not enter the submodule.

## Client

The browser loads Changes through `useMachineApi()`, like the other pane reads. A 404 whose code is `not_found` on the list route is the update message. `not_a_change` on the diff route shows that error on the diff screen. Network failure keeps the last list.

The open file is component state. It is not written to pane storage.

Strings added for `t()`:

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

Each gets an entry in `src/lib/i18n.ko.ts`, `src/lib/i18n.ja.ts`, and `src/lib/i18n.zh.ts`.

Shortcut id `show-changes`, label `Changes`, keys Mod Shift G. Register it in `SHORTCUTS`, `KEY_TO_ID`, and the switch in `src/lib/shortcuts.ts`.

`PaneView` becomes `"chat" | "terminal" | "changes"`.

## Demo

`site/demo/transport.ts` answers both routes. The fixture list has one modified file and one untracked file. The diff route returns a short unified diff for the modified path, an untracked diff for the other, and 404 `not_a_change` for any other path. The demo does not run git.

## Server module

`server/changes.ts` exports `paneChanges(cwd)` and `paneChangeDiff(cwd, path)`. They return a result. They do not throw for a bad path, a missing binary, a timeout, or a git failure. The route maps the result.

`paneChanges` returns `{ git: false, changes: [] }`, `{ git: true, changes: ChangeEntry[] }`, or `{ error: "git_unavailable" | "git_timeout" | "git_failed", message: string }`.

`paneChangeDiff` returns `ChangeDiffResponse` or `{ error: "invalid_path" | "not_a_change" | "git_unavailable" | "git_timeout" | "git_failed", message: string }`.

Exit 128 whose stderr contains `not a git repository` is `{ git: false, changes: [] }` on the list route. Spawn `ENOENT` is `git_unavailable`. A killed process is `git_timeout`. Any other non-zero exit is `git_failed`.

The route maps `invalid_path` to 400, `not_a_change` to 404, and the three git errors to 502. Messages are the ones named above.

## Tests

Unit, `HERDR_TEST_MODE=unit`, temp git repo, no herdr. File `server/changes.test.ts` calls `paneChanges` and `paneChangeDiff`:

- A rename comes back with `path` and `old_path`.
- A filename that contains a newline and a double quote round-trips as that filename.
- A folder that is not a checkout returns `{ git: false, changes: [] }`.
- A clean checkout returns `{ git: true, changes: [] }`.
- An untracked text file comes back as `kind: "untracked"` with `+` lines.
- A file whose first bytes contain NUL comes back as `kind: "binary"`.
- A tracked edit comes back as `kind: "diff"` and includes the new line.
- A diff larger than 256 KB sets `truncated: true` and the returned text is at most 256 KB.
- A path with a `..` segment returns `invalid_path` and does not read outside the repo.
- A path absent from status returns `not_a_change`.

Contract, `server/api.contract.test.ts`: create a workspace with `cwd` set to a fresh `git init` temp directory that contains one committed file and one uncommitted edit. Both routes return the shapes above for that pane. A path that is not in the status returns 404 `not_a_change`.

`src/lib/i18n.test.ts` already fails a missing translation. No new i18n test file.

Existing Playwright scripts find Chat by the exact title `Chat transcript (⌘⇧J)`. That title does not change.

## Acceptance

- With a pane whose folder has one modified tracked file and one untracked file, Changes lists both, with their porcelain codes, and no other files.
- Opening the modified file shows a unified diff against `HEAD` that contains the change.
- Opening a short untracked file shows each of its lines as an addition. A file whose diff text exceeds 256 KB is cut and shows `Diff cut at 256 KB`.
- A clean checkout shows `No uncommitted changes`.
- A pane folder that is not a checkout shows `This workspace is not a git checkout`.
- The view has no control that stages, discards, commits, or pushes.
- Chat and Terminal titles used by the current Playwright scripts stay exact.
