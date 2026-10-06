import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceStore } from "./devices.ts";
import { createServer } from "./index.ts";

it("a watch device can ask for the change list and cannot read a diff", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-changes-watch-"));
  const store = new DeviceStore(root);
  const watch = store.pair(store.startPairing().code, "Watch", "watch");
  expect(watch).not.toBeNull();
  const server = createServer({ port: 0, stateDir: root, token: "test-watch", tailscaleOwner: null, machines: false });
  const base = `http://127.0.0.1:${server.port}`;
  const headers = { cookie: `herdr_web_device=${watch!.token}` };
  try {
    for (const path of ["pane/changes/diff?pane_id=absent&path=secret.txt", "machines/pc1/pane/changes/diff?pane_id=absent&path=secret.txt", "machines/pc1/pane/changes/diff/?pane_id=absent&path=secret.txt"]) {
      const response = await fetch(`${base}/api/${path}`, { headers });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "read_only" } });
    }
    const list = await fetch(`${base}/api/pane/changes?pane_id=absent`, { headers });
    expect(list.status).not.toBe(403);
  } finally {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
