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
        new Response(proc.stdout as ReadableStream<Uint8Array>).arrayBuffer(),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
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
