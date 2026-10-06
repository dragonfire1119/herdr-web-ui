import { useEffect, useRef, useState } from "react";
import type { ChangeDiffResponse, ChangeEntry, ChangesResponse } from "../../shared/protocol.ts";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import "./ChangesView.css";

type ListScreen =
  | { kind: "loading" }
  | { kind: "empty"; error: string | null }
  | { kind: "not_git"; error: string | null }
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
  if (!body.git) return { kind: "not_git", error: null };
  if (body.changes.length === 0) return { kind: "empty", error: null };
  return { kind: "rows", rows: body.changes, error: null };
}

function listFromFailure(current: ListScreen, error: unknown): ListScreen {
  if (error instanceof ApiError && error.status === 404 && error.code === "not_found") return { kind: "update" };
  const message = error instanceof Error ? error.message : String(error);
  if (current.kind === "rows") return { kind: "rows", rows: current.rows, error: message };
  if (current.kind === "empty") return { kind: "empty", error: message };
  if (current.kind === "not_git") return { kind: "not_git", error: message };
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
    void fetchListRef.current(paneId, controller.signal).then(
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
    void fetchDiffRef.current(paneId, path, controller.signal).then(
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
      {(list.kind === "empty" || list.kind === "not_git") && list.error !== null && <p className="changes-note" role="status">{list.error}</p>}
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
