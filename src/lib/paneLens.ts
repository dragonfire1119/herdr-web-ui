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
