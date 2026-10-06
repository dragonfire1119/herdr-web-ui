# Changes view

Date: 2026-10-06
Branch: `feat/add-worktree-changes`

## Problem

herdr web shows a pane as Chat or Terminal. Chat lists files an agent touched in a turn. Nothing lists the git checkout's uncommitted files. Orca's Changes panel does that for the open checkout. This app will show the same fact, and only that fact: the files in the focused pane's folder that are not in `HEAD`, and the diff of one file.

## Terms

- **Pane folder.** `foreground_cwd`, or `cwd` when the foreground folder is absent. Same folder `/api/pane/files` already uses.
- **Changes.** Uncommitted git status of the pane folder. The header label is "Changes".
- **Worktree.** Already means a git worktree herdr opened as a workspace. This feature does not create, open, or delete one.
- **Status path.** The path `git status --porcelain=v1` prints. It is relative to the repository root, not to the pane folder. The pane folder may be that root or a subdirectory of it. A rename's `path` is the new path. `old_path` is the previous path, also relative to the repository root.
- **Not committed.** The file on disk differs from `HEAD`, or git status lists it (including a staged edit the file on disk no longer holds). The diff is the file on disk against `HEAD`, not the index against `HEAD`. `git diff HEAD` with no stdout is an empty diff: the list still shows the porcelain code.

## Out of scope

No stage, unstage, discard, commit, push, pull, sync, history, branch compare, or pull request. No three-section list. No side-by-side diff. No submodule recursion. No new default lens. Changes is never the lens a pane opens on until the user has opened it there. No extra rename detection: an unstaged `mv` that git status reports as a deletion plus an untracked file stays two rows.

## Screen

The header switch is Chat, Terminal, Changes, in that order. Terminal stays the middle button. Chat's title stays `Chat transcript (⌘⇧J)`. Terminal's titles stay the two strings they use today. Changes uses `Changes (⌘⇧G)`. The visible label is `Changes`, in an element with the same `header-desktop-only` class Chat and Terminal use, so a narrow header hides it the same way. The icon is lucide `FileDiff`. The pressed button is the lens on screen, including when a diff is open. Pressing Changes while it is already pressed does not close the diff. Pressing Chat or Terminal leaves the lens. `Back` is the only control that returns to the list while staying on Changes. Leaving the lens discards the open diff.

The lens is remembered per pane, in the same localStorage key Chat and Terminal already use (`herdr-web-ui:view:` plus `paneStorageId`). The stored string for this lens is `changes`. Reading it:

- Stored `changes` opens Changes even when that PC has no terminal attach.
- Stored `terminal` on a PC with no attach still opens Chat, as it does today.
- Otherwise a stored `chat` or `terminal` is used when that PC has a terminal attach.
- The settings default stays `auto`, `chat`, or `terminal`. Auto does not pick Changes. The settings control does not gain a Changes choice.

`Mod+Shift+J` still swaps Chat and Terminal. From Changes it returns to the lens the user left. Opening Changes from the header, from the palette, or from `Mod+Shift+G` remembers the Chat or Terminal lens being left. That memory is component state, not storage. When it was not kept (the pane was restored from storage already on Changes, or the pane or machine changed), J opens Chat if `pane.agent` is not null and Terminal otherwise. `Mod+Shift+G` opens Changes from Chat or Terminal. From Changes, G returns to that same remembered lens, using the same fallback when none was kept. With no pane selected, G does not change the lens. J keeps the behavior it has today.

The command palette keeps one J item. Its label names the lens J would open from here: `Switch to terminal` or `Switch to chat`. From Changes that is the remembered lens, or the same fallback J uses. A second item, label `Changes`, runs G. The settings shortcut list includes Changes because it is in `SHORTCUTS`.

The list is flat. The server sorts it. The client does not sort it again. Each row shows the two-character `code` in a preformatted run (`white-space: pre`) so a leading or trailing space stays visible, then the path. A row with `old_path` also shows `from {path}` with that old path. The old path is text, not a second target. Tapping the row opens `path`. The heading is shown only when there is at least one row: `1 file` when the count is 1, otherwise `{count} files`.

These successful list states have no heading and no rows:

- Empty git checkout: `No uncommitted changes`.
- Pane folder is not a checkout: `This workspace is not a git checkout`.

The route is missing (404 `not_found`, an older remote bridge or a connection server that does not proxy the route): `This PC needs an update to show changes.` No heading and no rows. That is an error, not a successful empty list.

`pane_not_found` and `cwd_not_found` are the existing 404 envelopes. The list or the diff shows that error's `Error.message` (the `ApiError` text, which includes the server message). They do not use the update sentence.

Tap a row. The pane shows that file's diff. `Back` returns to the list and starts a new list load. The header switch stays. The open path is component state, not pane storage. It is cleared when the lens leaves Changes, when the pane or machine changes, and when `Back` runs. Leaving to Chat or Terminal and coming back opens the list, not the last diff.

The list loads when the list is shown (Changes opened on the list, or `Back`) and again 5 seconds after that request settles, while the list stays on screen. Settled means the request's promise resolved or rejected. The timer starts then, not when the request started. At most one list request is in flight. Opening a diff, leaving the lens, changing pane or machine, or unmounting clears the timer. A response that arrives after the list left the screen is ignored and does not restart the timer.

A failed list request keeps the last successful list when there is one, shows `Error.message` above the rows, and still schedules the next poll. The first failure, with no successful list yet, shows `Error.message` and no rows. A 404 whose code is `not_found` replaces the list with the update sentence and does not keep a stale list. `git: false` and a clean checkout are successes, not errors.

A diff loads once when opened. It does not refresh. A failed diff shows `Error.message` and no diff lines. It does not retry. `Back` still works. A response that arrives after the user left that diff is ignored.

Diff text is rendered line by line in a preformatted block (`white-space: pre`):

- A line whose first character is `+`, and that does not start with `+++`, is an addition, color `--status-done`.
- A line whose first character is `-`, and that does not start with `---`, is a deletion, color `--status-blocked`.
- A line that starts with `diff `, `index `, `---`, `+++`, `@@`, `\`, `rename `, `copy `, `old mode`, `new mode`, `deleted file`, `new file`, `similarity `, or `dissimilarity ` is a header, color `--text-dim`.
- Every other line uses the default text color.

`kind: "binary"` shows `Binary file` and no diff lines. `kind: "empty"` shows no diff lines, and does not show `Binary file` or `Diff cut at 256 KB`. `truncated: true` shows `Diff cut at 256 KB` as well as the cut text. `kind: "binary"` and `kind: "empty"` have `truncated: false`.

Colors reuse the chat diff tokens. No new color token. Component CSS is colocated and uses tokens only.

## API

Both routes are GET. They use the same auth as `/api/pane/files`: the existing `/api/*` gate, including 401 `unauthorized`. A watch-role device that may call `/api/pane/files` may call the list. The diff is file contents, so that role gets the same `read_only` refusal as `/api/fs/`. They do not require `x-herdr-machine` or `x-herdr-update`. They take `pane_id`, a non-empty string, the same parameter `/api/pane/files` accepts. There is no integer query parameter. Shapes live in `shared/protocol.ts`. Error bodies use `server/http.ts` only. Handlers are registered beside `/api/pane/files`, before the `/api/*` 404.

`MACHINE_PROXY_PATH` includes `pane/changes` and `pane/changes/diff`, and does not include a longer path under them. The local `/api/machines/local/` alias already allows the `pane/` prefix. The remote proxy's existing 75 second fetch timeout stays.

Each git process is killed at 10 seconds. The list route calls `bunServer.timeout(request, 15)` and the diff route calls `bunServer.timeout(request, 35)`, so a killed git still returns JSON 502 instead of the server's default idle timeout dropping the socket.

`GET /api/pane/changes?pane_id=`

```ts
interface ChangeEntry {
  path: string;
  /** Two porcelain characters, such as " M", "M ", "MM", "??", "R ", "D ". Not trimmed. */
  code: string;
  /** Set only for a rename or copy. The previous path. */
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
The array is sorted by `path` with `localeCompare` and no locale argument. The client shows that order.

`GET /api/pane/changes/diff?pane_id=&path=`

The client sends `path` with `URLSearchParams`. The server reads the decoded `searchParams.get("path")`. Comparison with a status path is exact string equality, with no Unicode normalization.

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

`code` and `old_path` are copied from the matching status row.

Missing or empty `pane_id`: 400 `missing_pane_id`, message `pane_id query parameter is required`.
A non-GET: 400 `method_not_allowed`, message `use GET`.
Unknown pane or a pane with no folder: the existing `HerdrError` (`pane_not_found`, `cwd_not_found`), 404, through `errorResponse`.
Missing `path`, or a decoded path that is empty, absolute, contains a backslash, contains NUL, contains an empty segment, or contains a `..` segment: 400 `invalid_path`, message `path is invalid`.
A path that is not a current status path (the new path, for a rename): 404 `not_a_change`, message `path is not an uncommitted file`.
git missing from `PATH` (`ENOENT` on spawn): 502 `git_unavailable`, message `git is not installed`.
git killed at 10 seconds: 502 `git_timeout`, message `git timed out`.
git exits non-zero for any other reason, except "not a git repository" on the list route: 502 `git_failed`. `message` is git's first stderr line, split on `\n`, trimmed, then `slice(0, 200)`. When that is empty, the message is `git failed`. When the stderr says `attr-source` is an unknown option or an unrecognized argument, the message is `git 2.43 or newer is required`.
A status record that is not the porcelain shape below: 502 `git_failed`, message `git failed`. No partial list.
Unreadable untracked file, or a real path outside the pane folder: 400 `invalid_path`, message `path is invalid`. The body does not contain file bytes.

The list route treats a non-zero exit whose stderr contains `not a git repository` as `{ git: false, changes: [] }`. It does not treat a missing binary, a timeout, or any other failure as that state. The diff route does not: the same stderr is `git_failed`. A repository with no commit yet still lists status. `??` diffs by reading the file. Any other code runs `git diff HEAD`, which exits non-zero when `HEAD` does not exist, and that is `git_failed`.

## Git

The server runs git itself. No herdr RPC, no pty, no keys sent to the pane. No persistent git process, no connection pool, no status cache. Arguments are an array, never a shell. Every spawn gets the 10 second kill, `--no-pager`, `-c core.fsmonitor=`, and `-c core.hooksPath=/dev/null`. The child environment drops `GIT_DIR`, `GIT_WORK_TREE`, and the other git directory and config overrides. Before each command the server lists config names. A `filter.<name>.clean`, `smudge`, `process`, or `required` key whose name is a single safe segment is blanked with `-c` and `required=false`. Any other `filter.` key fails the request with `git_failed` before status or diff. `core.attributesFile` is set to `/dev/null`. Status and tracked diff also pass `--attr-source` of the empty tree, so checkout attributes do not select a filter. Git older than 2.43 rejects `--attr-source` and the routes return the 2.43 message above.

List command:

`git -C <pane folder> --attr-source <empty tree> --no-optional-locks status --porcelain=v1 -z -uall -- .`

The pathspec `.` limits the list to the pane folder. Paths in the output stay relative to the repository root. `--no-optional-locks` skips the optional index update and lets the command fail instead of waiting when a required lock is held. The command does not stage, unstage, commit, checkout, or write the worktree.

Parse `-z` porcelain v1. Paths are not quoted. A NUL ends a path field. An ordinary record is two status characters, a space, the path, then NUL. When either status character is `R` or `C`, the record is two characters, a space, the new path, NUL, the old path, NUL (porcelain `-z` reverses the human `old -> new` order). `-uall` lists files inside untracked directories, not the directory as one row. Ignored files are absent. A clean checkout is empty stdout and exit 0.

Sort after parse, by `path`, with `localeCompare` and no locale argument.

The diff route runs that same status command. A not-a-repository exit is `git_failed` here, not `{ git: false }`. Any other git error from status is returned as that error and rev-parse does not run. Otherwise it accepts `path` only when it equals a row's `path`, then runs:

`git -C <pane folder> --no-optional-locks rev-parse --show-toplevel`

The trimmed stdout is the repository toplevel. Empty stdout is `git_failed`. Diff and untracked reads use the toplevel. They do not join a repository-root path onto the pane folder.

- Code `??`: resolve the path under the toplevel. `realpath` the file and the pane folder. When `realpath` throws, or the file's real path is not the pane folder's real path and is not inside it (a prefix bounded by the platform path separator, not a string prefix of a sibling directory), return `invalid_path` and do not return bytes. Read at most the first 8192 bytes to look for a NUL. A NUL makes `kind: "binary"`, `text: ""`, `truncated: false`, and the rest of the file is not read. Otherwise `kind: "untracked"`. `text` is `--- /dev/null\n+++ b/<path>\n`, then, when the file is not empty, one hunk `@@ -0,0 +1,<N> @@\n` and one `+<line>\n` per line. Lines are `contents.split("\n")`, dropping a single trailing empty piece when the file ends in `\n`. `N` is that count. A zero-byte file has no hunk. Stop reading once `text` exceeds 256 KB and do not read the remainder. Apply the cap below.
- Any other code, including a submodule or an unmerged path: run `git -c diff.submodule=short -C <toplevel> --attr-source <empty tree> --no-optional-locks diff --no-ext-diff --no-textconv --no-color -U3 HEAD -- :(literal)<path>`. `diff.submodule=short` keeps a submodule diff from recursing into that submodule's `diff.external`. Exit 0 and zero stdout bytes is `kind: "empty"`, `text: ""`, `truncated: false`. Stdout is `kind: "binary"` and `text: ""` when any line is exactly `GIT binary patch` or starts with `Binary files `. A changed line that merely contains those words is not that marker. Other stdout is `kind: "diff"`. Apply the cap to `text`. `truncated` is true only when the cap cut the text.
- A deleted tracked file has no file to `realpath`. The lexical path check and the status-list check are enough, and the diff command shows the deletion.

A diff longer than 256 KB (`256 * 1024` bytes of UTF-8) is cut at the last newline whose byte offset fits, or at the byte cap when the first line does not fit. That last cut may split a code point. The returned byte length is at most 256 KB. The view shows `Diff cut at 256 KB` when `truncated` is true.

A modified submodule stays one row. The diff is the short submodule summary, not the files inside it. The server does not enter the submodule.

## Client

The browser loads both routes through `useMachineApi()`, the same way `fetchPaneFiles` does. A thrown `ApiError` or `Error` is shown as `error.message`, except a list or diff 404 whose code is `not_found`, which shows the update sentence. `not_a_change` shows on the diff screen as that error. Network failure keeps the last successful list under the same rule as any other failed poll.

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

Each gets an entry in `src/lib/i18n.ko.ts`, `src/lib/i18n.ja.ts`, and `src/lib/i18n.zh.ts`. `{count}` and `{path}` are `t()` variables, and the English string is the key.

Shortcut id `show-changes`, label `Changes`, keys Mod Shift G. `KEY_TO_ID` maps `g` to it. Register it in `SHORTCUTS`, `KEY_TO_ID`, the switch in `src/lib/shortcuts.ts`, and `CUSTOM_SHORTCUT_IDS`, so a settings override for it persists. The switch calls a new action for G. `toggleView` remains J and gains the Changes behavior above.

`PaneView` becomes `"chat" | "terminal" | "changes"`.

## Demo

`site/demo/transport.ts` answers both routes. The fixture list is `git: true` and, in `localeCompare` order, `notes.txt` (`??`) then `src/app.ts` (` M`). The diff route returns a short unified diff for `src/app.ts` (`kind: "diff"`, text contains a `+` line), an untracked diff for `notes.txt` (`kind: "untracked"`, text contains a `+` line), and 404 `not_a_change` for any other path. The demo does not run git.

## Server module

`server/changes.ts` exports `paneChanges(cwd)` and `paneChangeDiff(cwd, path)`. They return a result. They do not throw for a bad path, a missing binary, a timeout, a git failure, or a status record they cannot parse. The route maps the result. Pane lookup stays in the route and still throws the existing `HerdrError`.

`paneChanges` returns `{ git: false, changes: [] }`, `{ git: true, changes: ChangeEntry[] }`, or `{ error: "git_unavailable" | "git_timeout" | "git_failed", message: string }`.

`paneChangeDiff` returns `ChangeDiffResponse` or `{ error: "invalid_path" | "not_a_change" | "git_unavailable" | "git_timeout" | "git_failed", message: string }`.

Exit whose stderr contains `not a git repository` is `{ git: false, changes: [] }` on the list route only. Spawn `ENOENT` is `git_unavailable`. A killed process is `git_timeout`. Any other non-zero exit is `git_failed`.

The route maps `invalid_path` to 400, `not_a_change` to 404, and the three git errors to 502, with the messages named above.

## Tests

Unit, `HERDR_TEST_MODE=unit`, temp git repo, no herdr. File `server/changes.test.ts` calls `paneChanges` and `paneChangeDiff`:

- A rename comes back with `path` equal to the new path and `old_path` equal to the old path.
- A filename that contains a newline and a double quote round-trips as that filename.
- A folder that is not a checkout returns `{ git: false, changes: [] }`.
- A clean checkout returns `{ git: true, changes: [] }`.
- A worktree-only edit has code ` M`, `kind: "diff"`, and the text contains the new line.
- A staged edit whose worktree matches the index, and whose bytes differ from `HEAD`, has code `M ` and the diff text contains that staged line.
- A staged edit whose worktree was put back to the `HEAD` bytes has code `MM`, `kind: "empty"`, and `text` `""`.
- An untracked text file comes back as `kind: "untracked"` with a `+` line for each of its lines.
- A file whose first bytes contain NUL comes back as `kind: "binary"` and `text` `""`.
- A diff larger than 256 KB sets `truncated: true` and the returned text is at most 256 KB.
- A path with a `..` segment returns `invalid_path` and does not read outside the repo.
- A path absent from status returns `not_a_change`.
- The pane folder is a subdirectory of the checkout: a dirty file outside that folder is absent, and the diff of a dirty file inside it contains the change.

Contract, `server/api.contract.test.ts`: create a workspace with `focus: false` and `cwd` set to a fresh `git init` temp directory that contains one committed file and one uncommitted edit. Wait until that pane's folder is the temp directory. The list is 200, `git: true`, and includes that edit's path and a two-character code. The diff is 200 and its `text` contains the edited line. A path that is not in the status returns 404 `not_a_change`.

`server/machines.test.ts` asserts `MACHINE_PROXY_PATH` matches `pane/changes` and `pane/changes/diff` and rejects `pane/changes/diff/extra`.

`src/lib/i18n.test.ts` already fails a missing translation. No new i18n test file.

Existing Playwright scripts find Chat by the exact title `Chat transcript (⌘⇧J)`. That title does not change.

## Acceptance

- With a pane whose folder has one modified tracked file and one untracked file, Changes lists both, with their porcelain codes, and no other files.
- Opening the modified file shows a unified diff against `HEAD` that contains the change.
- Opening a short untracked file shows each of its lines as an addition. A file whose diff text exceeds 256 KB is cut and shows `Diff cut at 256 KB`.
- A staged edit whose bytes on disk match `HEAD` shows its porcelain code and no diff lines.
- A pane folder that is a subdirectory lists a change inside it, omits a change outside it, and the inside file's diff contains the change.
- A clean checkout shows `No uncommitted changes`.
- A pane folder that is not a checkout shows `This workspace is not a git checkout`.
- The view has no control that stages, discards, commits, or pushes.
- Chat and Terminal titles used by the current Playwright scripts stay exact.
