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
