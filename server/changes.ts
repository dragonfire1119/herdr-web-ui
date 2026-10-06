import { constants } from "node:fs";
import { open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
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
const BLOCKED_GIT_ENV = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_EXTERNAL_DIFF",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
]);
const emptyTrees = new Map<string, string>();

function childEnv(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (BLOCKED_GIT_ENV.has(key) || key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
  }
  return env;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function gitFailedMessage(stderr: string): string {
  if (stderr.includes("attr-source") && (stderr.includes("unknown option") || stderr.includes("unrecognized argument"))) {
    return "git 2.43 or newer is required";
  }
  const line = stderr.split("\n", 1)[0] ?? "";
  const trimmed = line.trim().slice(0, 200);
  return trimmed.length === 0 ? "git failed" : trimmed;
}

type GitRun = { stdout: Uint8Array; stderr: string; exitCode: number; capped: boolean };

async function takeStdout(stream: ReadableStream<Uint8Array>, cap: number | undefined, stop: () => void): Promise<{ bytes: Uint8Array; capped: boolean }> {
  if (cap === undefined) {
    const buf = await new Response(stream).arrayBuffer();
    return { bytes: new Uint8Array(buf), capped: false };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let capped = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      if (value.byteLength === 0) continue;
      if (total + value.byteLength > cap) {
        const room = cap - total;
        if (room > 0) chunks.push(value.subarray(0, room));
        total = cap;
        capped = true;
        stop();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, capped };
}

const FILTER_COMMAND = /^filter\.([^.]+)\.(clean|smudge|process|required)$/;
const SAFE_FILTER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function spawnGit(
  cwd: string,
  args: readonly string[],
  options?: { env?: Record<string, string | undefined>; stdoutCap?: number; acceptExit?: readonly number[] },
): Promise<GitRun | GitFailure> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["git", "-c", "core.fsmonitor=", "-c", "core.hooksPath=/dev/null", "--no-pager", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: childEnv(options?.env),
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
      const [taken, stderr, exitCode] = await Promise.all([
        takeStdout(proc.stdout as ReadableStream<Uint8Array>, options?.stdoutCap, () => proc.kill()),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
        proc.exited,
      ]);
      if (timedOut) return { error: "git_timeout", message: "git timed out" };
      if (taken.capped) return { stdout: taken.bytes, stderr, exitCode, capped: true };
      if (exitCode !== 0 && !(options?.acceptExit?.includes(exitCode) ?? false)) return { error: "git_failed", message: gitFailedMessage(stderr) };
      return { stdout: taken.bytes, stderr, exitCode, capped: false };
    } catch (error) {
      if (timedOut) return { error: "git_timeout", message: "git timed out" };
      if (isEnoent(error)) return { error: "git_unavailable", message: "git is not installed" };
      return { error: "git_failed", message: "git failed" };
    } finally {
      clearTimeout(timer);
    }
  })();
}

async function filterPrefix(cwd: string): Promise<string[] | GitFailure> {
  const listed = await spawnGit(cwd, ["-C", cwd, "config", "--list", "--name-only"]);
  if ("error" in listed) return listed;
  const names = new Set<string>();
  for (const line of new TextDecoder().decode(listed.stdout).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("filter.")) continue;
    const match = FILTER_COMMAND.exec(trimmed);
    if (match === null) return { error: "git_failed", message: "git failed" };
    const name = match[1] ?? "";
    if (!SAFE_FILTER_NAME.test(name)) return { error: "git_failed", message: "git failed" };
    names.add(name);
  }
  const prefix = ["-c", "core.attributesFile=/dev/null"];
  for (const name of names) {
    prefix.push(
      "-c", `filter.${name}.clean=`,
      "-c", `filter.${name}.smudge=`,
      "-c", `filter.${name}.process=`,
      "-c", `filter.${name}.required=false`,
    );
  }
  return prefix;
}

function runGit(
  cwd: string,
  args: readonly string[],
  options?: { env?: Record<string, string | undefined>; stdoutCap?: number; acceptExit?: readonly number[] },
): Promise<GitRun | GitFailure> {
  return (async () => {
    const prefix = await filterPrefix(cwd);
    if (!Array.isArray(prefix)) return prefix;
    return spawnGit(cwd, [...prefix, ...args], options);
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

async function emptyTree(cwd: string): Promise<string | GitFailure> {
  const cached = emptyTrees.get(cwd);
  if (cached !== undefined) return cached;
  const hashed = await runGit(cwd, ["-C", cwd, "hash-object", "-t", "tree", "--stdin"]);
  if ("error" in hashed) return hashed;
  const source = new TextDecoder().decode(hashed.stdout).trim();
  if (!/^[0-9a-f]{40,64}$/i.test(source)) return { error: "git_failed", message: "git failed" };
  emptyTrees.set(cwd, source);
  return source;
}

async function statusOf(cwd: string): Promise<StatusRun> {
  const source = await emptyTree(cwd);
  if (typeof source !== "string") return { type: "failed", failure: source };
  const englishStatusStderr = { ...process.env, LC_ALL: "C" };
  const run = await runGit(
    cwd,
    ["-C", cwd, "--attr-source", source, "--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall", "--", "."],
    { env: englishStatusStderr },
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
  const bound = await repositoryBound(cwd);
  if ("error" in bound) return bound;
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

function capDiffText(text: string, overflow = false): { text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= DIFF_CAP && !overflow) return { text, truncated: false };
  let lastNl = -1;
  const limit = Math.min(bytes.byteLength, DIFF_CAP);
  for (let i = 0; i < limit; i++) if (bytes[i] === 0x0a) lastNl = i;
  const cut = lastNl >= 0 ? lastNl + 1 : limit;
  let decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, cut), { stream: true });
  while (new TextEncoder().encode(decoded).byteLength > DIFF_CAP) decoded = decoded.slice(0, -1);
  return { text: decoded, truncated: true };
}

async function repositoryBound(cwd: string): Promise<{ top: string } | GitFailure> {
  const failed: GitFailure = { error: "git_failed", message: "git failed" };
  const run = await runGit(cwd, ["-C", cwd, "--no-optional-locks", "rev-parse", "--show-toplevel", "--absolute-git-dir"]);
  if ("error" in run) return run;
  const [top, gitDir] = new TextDecoder().decode(run.stdout).trim().split("\n");
  if (top === undefined || gitDir === undefined || top.length === 0 || gitDir.length === 0) return failed;
  let topReal: string;
  let gitReal: string;
  try {
    topReal = await realpath(top);
    gitReal = await realpath(gitDir);
  } catch {
    return failed;
  }
  if (basename(gitReal) === ".git") {
    const owner = await realpath(dirname(gitReal));
    if (owner !== topReal) return failed;
    return { top };
  }
  try {
    const pointed = (await readFile(join(gitReal, "gitdir"), "utf8")).trim();
    if (pointed.length > 0 && pointed.length <= 4096) {
      const pointedReal = await realpath(pointed);
      const dotGit = await realpath(join(topReal, ".git"));
      if (pointedReal === dotGit) return { top };
    }
  } catch { /* submodule git dirs have no back-pointer file */ }
  const work = await runGit(cwd, ["-C", cwd, "config", "--get", "core.worktree"], { acceptExit: [1] });
  if ("error" in work) return work;
  const rel = new TextDecoder().decode(work.stdout).trim();
  if (rel.length === 0 || rel.length > 4096) return failed;
  try {
    const workReal = await realpath(resolve(gitReal, rel));
    if (workReal !== topReal) return failed;
  } catch {
    return failed;
  }
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
    fh = await open(fileReal, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return invalid;
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return { kind: "binary", text: "", truncated: false };
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
  const source = await emptyTree(top);
  if (typeof source !== "string") return source;
  const run = await runGit(
    top,
    ["-c", "diff.submodule=short", "-C", top, "--attr-source", source, "--no-optional-locks", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "-U3", "HEAD", "--", `:(literal)${statusPath}`],
    { stdoutCap: DIFF_CAP },
  );
  if ("error" in run) return run;
  const text = new TextDecoder().decode(run.stdout);
  if (run.stdout.length === 0 && !run.capped) return { kind: "empty", text: "", truncated: false };
  for (const line of text.split("\n")) {
    if (line === "GIT binary patch" || line.startsWith("Binary files ")) return { kind: "binary", text: "", truncated: false };
  }
  const capped = capDiffText(text, run.capped);
  return { kind: "diff", text: capped.text, truncated: capped.truncated };
}

export async function paneChangeDiff(cwd: string, path: string): Promise<ChangeDiffResult> {
  if (!lexicalChangePath(path)) return { error: "invalid_path", message: "path is invalid" };
  const run = await statusOf(cwd);
  if (run.type === "not_repository" || run.type === "failed") return run.failure;
  const row = run.rows.find((candidate) => candidate.path === path);
  if (row === undefined) return { error: "not_a_change", message: "path is not an uncommitted file" };
  const top = await repositoryBound(cwd);
  if ("error" in top) return top;
  const body = row.code === "??" ? await untrackedBody(top.top, cwd, row.path) : await trackedBody(top.top, row.path);
  if ("error" in body) return body;
  const response: ChangeDiffResponse = { path: row.path, code: row.code, kind: body.kind, truncated: body.truncated, text: body.text };
  if (row.form === "renamed") response.old_path = row.oldPath;
  return response;
}
