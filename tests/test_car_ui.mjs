import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../web/car.js", import.meta.url), "utf8");
const token = "a".repeat(64);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function target() {
  const listeners = new Map();
  const classes = new Set();
  return {
    textContent: "", disabled: false, hidden: false, naturalWidth: 0,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    style: { setProperty() {} },
    setAttribute() {}, setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 200 }; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    async emit(name, fields = {}) {
      await listeners.get(name)?.({ preventDefault() {}, ...fields });
      await flush();
    },
  };
}

async function harness() {
  const nodes = new Map();
  const document = { ...target(), hidden: false, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, target());
    return nodes.get(id);
  } };
  const window = target();
  const intervals = new Map();
  const requests = [];
  const replies = new Map();
  const fetch = async (url, options = {}) => {
    const action = options.method === "POST" ? new URLSearchParams(options.body).get("action") : "status";
    requests.push({ action, url, ...options });
    const reply = await (replies.get(action)?.shift() || {
      status: 200,
      body: action === "status" ? { ok: true, connected: true, lights: false }
        : action === "arm" ? { ok: true, token } : { ok: true },
    });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get() { return reply.type || "application/json"; } },
      async json() { if (reply.malformed) throw new SyntaxError("Invalid JSON"); return reply.body; },
    };
  };
  vm.runInNewContext(source, {
    document, window, navigator: {}, fetch, URLSearchParams, AbortController,
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval(fn, delay) { intervals.set(delay, fn); },
  });
  await flush();
  await nodes.get("camera-image").emit("load");
  return {
    nodes, document, window, requests,
    reply(action, response) {
      if (!replies.has(action)) replies.set(action, []);
      replies.get(action).push(response);
    },
    async tick(delay) { intervals.get(delay)(); await flush(); },
    click() { return nodes.get("arm-button").emit("click"); },
    state() { return nodes.get("drive-state").textContent; },
  };
}

for (const [name, response, message] of [
  ["controller JSON", { status: 403, body: { ok: false, message: "Custom control header missing" } }, "Custom control header missing"],
  ["Thingino string", { status: 403, body: { error: "CSRF check failed" } }, "CSRF check failed"],
  ["Thingino object", { status: 403, body: { error: { message: "Permission denied" } } }, "Permission denied"],
  ["unsuccessful JSON with HTTP 200", { status: 200, body: { ok: false, message: "Serial device unavailable" } }, "Serial device unavailable"],
  ["malformed error JSON", { status: 502, malformed: true }, "HTTP 502"],
  ["non-string message", { status: 403, body: { message: { unsafe: "object" } } }, "HTTP 403"],
]) {
  test(`start error survives polling and blur: ${name}`, async () => {
    const h = await harness();
    h.reply("arm", response);
    await h.click();
    assert.equal(h.state(), message);
    await h.tick(2500);
    await h.window.emit("blur");
    assert.equal(h.state(), message);
    assert.equal(h.requests.filter((r) => r.action === "arm").length, 1, "no automatic retry");
    await h.click();
    assert.equal(h.state(), "Ready to drive", "deliberate retry clears the error on success");
  });
}

test("drive failure stays visible after automatic stop and recovered status; no motion retry", async () => {
  const h = await harness();
  await h.click();
  h.reply("drive", { status: 503, body: { ok: false, message: "Serial write failed" } });
  await h.document.emit("keydown", { key: "w" });
  assert.equal(h.state(), "Serial write failed");
  await h.tick(2500);
  await h.tick(120);
  await h.window.emit("blur");
  assert.equal(h.state(), "Serial write failed");
  assert.equal(h.nodes.get("arm-label").textContent, "Start control");
  assert.equal(h.requests.filter((r) => r.action === "drive").length, 1);
  assert.equal(h.requests.filter((r) => r.action === "stop").length, 1);
});

test("arm and keepalive stop send the custom MIME type and legacy header with encoded text", async () => {
  const h = await harness();
  await h.click();
  await h.window.emit("pagehide");
  const arm = h.requests.find((r) => r.action === "arm");
  const stop = h.requests.find((r) => r.action === "stop");
  for (const request of [arm, stop]) {
    assert.equal(request.headers["Content-Type"], "application/x-wyze-car-control");
    assert.equal(request.headers["X-Car-Control"], "1");
    assert.equal(typeof request.body, "string");
  }
  assert.equal(stop.keepalive, true);
  assert.equal(new URLSearchParams(stop.body).get("token"), token);
});

for (const [name, message, pause] of [
  ["window blur", "Paused: controller lost focus", (h) => h.window.emit("blur")],
  ["hidden tab", "Paused: controller tab hidden", async (h) => {
    h.document.hidden = true;
    await h.document.emit("visibilitychange");
  }],
]) {
  test(`${name} stops active control and keeps its reason until an explicit restart`, async () => {
    const h = await harness();
    await h.click();
    await h.document.emit("keydown", { key: "w" });
    assert.equal(h.state(), "Driving");
    await pause(h);
    assert.equal(h.state(), message);
    assert.equal(h.nodes.get("arm-label").textContent, "Start control");
    assert.equal(h.requests.filter((r) => r.action === "stop").length, 1);
    const stop = h.requests.find((r) => r.action === "stop");
    assert.equal(new URLSearchParams(stop.body).get("token"), token);
    await h.tick(120);
    assert.equal(h.requests.filter((r) => r.action === "drive").length, 1, "no more drive requests after pause");
    h.document.hidden = false;
    await h.document.emit("visibilitychange");
    await h.tick(2500);
    assert.equal(h.state(), message, "status recovery does not erase the pause reason");
    assert.equal(h.requests.filter((r) => r.action === "arm").length, 1, "no automatic restart");
    await h.click();
    assert.equal(h.state(), "Ready to drive");
  });

  test(`${name} preserves an existing error while inactive`, async () => {
    const h = await harness();
    h.reply("arm", { status: 503, body: { ok: false, message: "Serial device unavailable" } });
    await h.click();
    await pause(h);
    assert.equal(h.state(), "Serial device unavailable");
    assert.equal(h.requests.filter((r) => r.action === "stop").length, 0);
  });

  test(`${name} during arming rejects the late session and preserves its reason`, async () => {
    const h = await harness();
    let reply;
    h.reply("arm", new Promise((resolve) => { reply = resolve; }));
    const arming = h.click();
    await flush();
    assert.match(h.state(), /Starting session/);
    await pause(h);
    assert.equal(h.state(), message);
    // Restore visibility before the late reply to ensure the version check protects it.
    h.document.hidden = false;
    reply({ status: 200, body: { ok: true, token } });
    await arming;
    assert.equal(h.state(), message);
    assert.equal(h.nodes.get("arm-label").textContent, "Start control");
    assert.equal(h.requests.filter((r) => r.action === "stop").length, 1);
    await h.tick(120);
    assert.equal(h.requests.filter((r) => r.action === "drive").length, 0);
    await h.click();
    assert.equal(h.state(), "Ready to drive");
  });
}

test("an explicit Stop control remains a normal stop", async () => {
  const h = await harness();
  await h.click();
  await h.click();
  await h.window.emit("blur");
  assert.equal(h.state(), "Not started");
  assert.equal(h.requests.filter((r) => r.action === "stop").length, 1);
});
