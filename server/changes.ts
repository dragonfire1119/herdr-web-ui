import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import type { ChangeDiffResponse, ChangeEntry, ChangesResponse } from "../shared/protocol.ts";

export type GitErrorCode = "git_unavailable" | "git_timeout" | "git_failed";

export type ChangesResult =
  | ChangesResponse
  | { error: GitErrorCode; message: string };

export type ChangeDiffResult =
  | ChangeDiffResponse
  | { error: "invalid_path" | "not_a_change" | GitErrorCode; message: string };

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

function runGit(
  cwd: string,
  args: readonly string[],
  env?: Record<string, string | undefined>,
): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number } | GitFailure> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      ...(env === undefined ? {} : { env }),
    });
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
  const englishStatusStderr = { ...process.env, LC_ALL: "C" };
  const run = await runGit(
    cwd,
    ["-C", cwd, "--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall", "--", "."],
    englishStatusStderr,
  );
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
