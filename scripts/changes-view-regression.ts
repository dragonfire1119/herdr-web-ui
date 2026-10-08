/** Changes lens: real git list and diff, a folder that is not a checkout, and chat Stop. */
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";
import { herdrRpc } from "../server/herdr/client.ts";

export async function checkChangesView(browser: Browser, origin: string, dirtyPane: string, plainPane: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors: string[] = [];
  const sent: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(String(payload)) as { type?: string; text?: string };
      if (message.type === "input" && typeof message.text === "string") sent.push(message.text);
    });
  });
  page.setDefaultTimeout(10_000);
  await context.addInitScript(() => {
    if (!localStorage.getItem("herdr-web-ui:settings")) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
  });
  try {
    await page.goto(`${origin}/?pane=${encodeURIComponent(dirtyPane)}`);
    await page.locator(".conn-live").waitFor();
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    await page.locator(".changes-path", { hasText: "notes.txt" }).waitFor();
    assert.match(await page.locator(".changes-row", { hasText: "notes.txt" }).innerText(), /\?\?/);
    await page.locator(".changes-row", { hasText: "notes.txt" }).click();
    await page.locator(".changes-diff").waitFor();
    assert.match(await page.locator(".changes-diff").innerText(), /herdr-changes-line/);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.locator(".changes-path", { hasText: "notes.txt" }).waitFor();
    await page.getByTitle("Live terminal (⌘⇧J)", { exact: true }).click();
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    await page.locator(".changes-view").waitFor();
    await page.keyboard.press("ControlOrMeta+Shift+KeyJ");
    await page.getByTitle("Live terminal (⌘⇧J)", { exact: true }).waitFor();
    assert.equal(await page.getByTitle("Live terminal (⌘⇧J)", { exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    await page.locator(".changes-view").waitFor();
    await page.keyboard.press("ControlOrMeta+Shift+KeyG");
    assert.equal(await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    assert.equal(await page.getByTitle("Changes (⌘⇧G)", { exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Close changes", exact: true }).click();
    await page.locator(".changes-view").waitFor({ state: "detached" });
    assert.equal(await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    await page.locator(".changes-view").waitFor();
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    await page.locator(".changes-view").waitFor({ state: "detached" });
    assert.equal(await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    assert.equal(await page.getByTitle("Changes (⌘⇧G)", { exact: true }).getAttribute("aria-pressed"), "true");
    await page.reload();
    await page.locator(".conn-live").waitFor();
    assert.equal(await page.getByTitle("Changes (⌘⇧G)", { exact: true }).getAttribute("aria-pressed"), "true");
    await page.locator(".changes-view").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Close changes", exact: true }).click();
    await page.locator(".changes-view").waitFor({ state: "detached" });
    assert.equal(await page.getByTitle("Changes (⌘⇧G)", { exact: true }).getAttribute("aria-pressed"), "false");
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(`${origin}/?pane=${encodeURIComponent(plainPane)}`);
    await page.locator(".conn-live").waitFor();
    await page.getByTitle("Changes (⌘⇧G)", { exact: true }).click();
    await page.getByText("This workspace is not a git checkout", { exact: true }).waitFor();

    await page.goto(`${origin}/?pane=${encodeURIComponent(dirtyPane)}`);
    await page.locator(".conn-live").waitFor();
    await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
    await herdrRpc("pane.report_agent", { pane_id: dirtyPane, source: "manual", agent: "claude", state: "working" });
    const stop = page.getByRole("button", { name: "Stop agent", exact: true });
    await stop.waitFor();
    const before = sent.length;
    const deadline = Date.now() + 15_000;
    while (!sent.slice(before).includes("\u001b")) {
      assert(Date.now() < deadline, "Stop did not send Escape while chat covers the grid");
      await stop.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.deepEqual(errors, []);
    console.log("PASS changes view: list, diff, non-git folder, lens return, close, Stop sends Escape");
  } finally {
    await context.close();
  }
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { createServer } = await import("../server/index.ts");
  const { workspaceCreate, workspaceClose } = await import("../server/herdr/client.ts");
  const { chromium } = await import("playwright-core");
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "herdr-changes-view-"));
  const owned: string[] = [];
  const server = createServer({ port: 0, stateDir: join(root, "state"), token: "" });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
    headless: true,
    args: ["--no-sandbox", "--accept-lang=en-US"],
  });
  try {
    const dirty = join(root, "dirty");
    const plain = join(root, "plain");
    mkdirSync(dirty);
    mkdirSync(plain);
    const init = Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dirty });
    if (init.exitCode !== 0) throw new Error(init.stderr.toString());
    writeFileSync(join(dirty, "notes.txt"), "herdr-changes-line\n");
    const dirtyWorkspace = await workspaceCreate({ cwd: dirty, label: "herdr-web-ui-test-changes-view" });
    const plainWorkspace = await workspaceCreate({ cwd: plain, label: "herdr-web-ui-test-changes-plain" });
    owned.push(dirtyWorkspace.workspace.workspace_id, plainWorkspace.workspace.workspace_id);
    await checkChangesView(browser, `http://127.0.0.1:${server.port}`, dirtyWorkspace.root_pane.pane_id, plainWorkspace.root_pane.pane_id);
  } finally {
    await browser.close();
    server.stop();
    for (const id of owned) await workspaceClose(id);
    rmSync(root, { recursive: true, force: true });
  }
}
