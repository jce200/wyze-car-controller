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

const driveFields = (h) => h.requests.filter((r) => r.action === "drive")
  .map((r) => Object.fromEntries(new URLSearchParams(r.body)));
const ok = { status: 200, body: { ok: true } };

test("arrow release sends neutral before a delayed motion response, without repeat backlog", async () => {
  const h = await harness();
  await h.click();
  let finishMotion;
  h.reply("drive", new Promise((resolve) => { finishMotion = resolve; }));
  await h.document.emit("keydown", { key: "ArrowUp" });
  for (let i = 0; i < 30; i++) {
    await h.document.emit("keydown", { key: "ArrowUp", repeat: true });
    await h.tick(120);
  }
  assert.equal(driveFields(h).length, 1, "holding the key does not build a request queue");
  await h.document.emit("keyup", { key: "ArrowUp" });
  assert.deepEqual(driveFields(h).map(({ throttle, seq }) => [throttle, seq]), [["1", "1"], ["0", "2"]]);
  assert.equal(h.state(), "Ready to drive");
  finishMotion(ok);
  await flush();
  await h.tick(120);
  assert.equal(driveFields(h).length, 2, "a late motion response must not replay movement");
});

test("joystick release also bypasses a delayed motion response", async () => {
  const h = await harness();
  await h.click();
  let finishMotion;
  h.reply("drive", new Promise((resolve) => { finishMotion = resolve; }));
  await h.nodes.get("joystick").emit("pointerdown", { pointerId: 1, clientX: 100, clientY: 20 });
  await h.nodes.get("joystick").emit("pointerup", { pointerId: 1 });
  assert.deepEqual(driveFields(h).map(({ throttle, seq }) => [throttle, seq]), [["1", "1"], ["0", "2"]]);
  finishMotion(ok);
  await flush();
});

test("rapid changes keep two requests at most and never replay a released direction", async () => {
  const h = await harness();
  await h.click();
  let finishMotion, finishNeutral;
  h.reply("drive", new Promise((resolve) => { finishMotion = resolve; }));
  h.reply("drive", new Promise((resolve) => { finishNeutral = resolve; }));
  await h.document.emit("keydown", { key: "ArrowUp" });
  await h.document.emit("keyup", { key: "ArrowUp" });
  for (let i = 0; i < 10; i++) {
    await h.document.emit("keydown", { key: "ArrowDown" });
    await h.tick(120);
    await h.document.emit("keyup", { key: "ArrowDown" });
  }
  assert.equal(driveFields(h).length, 2);
  finishNeutral(ok);
  await flush();
  assert.equal(driveFields(h).length, 2);
  finishMotion(ok);
  await flush();
  assert.deepEqual(driveFields(h).map(({ throttle }) => throttle), ["1", "0", "0"]);
});

test("only the current held direction is sent after the priority stop completes", async () => {
  const h = await harness();
  await h.click();
  let finishMotion, finishNeutral;
  h.reply("drive", new Promise((resolve) => { finishMotion = resolve; }));
  h.reply("drive", new Promise((resolve) => { finishNeutral = resolve; }));
  await h.document.emit("keydown", { key: "ArrowUp" });
  await h.document.emit("keyup", { key: "ArrowUp" });
  await h.document.emit("keydown", { key: "ArrowLeft" });
  await h.document.emit("keyup", { key: "ArrowLeft" });
  await h.document.emit("keydown", { key: "ArrowDown" });
  finishMotion(ok);
  await flush();
  assert.equal(driveFields(h).length, 2, "wait for neutral acknowledgement before new motion");
  finishNeutral(ok);
  await flush();
  assert.deepEqual(driveFields(h).map(({ steer, throttle, seq }) => [steer, throttle, seq]),
    [["0", "1", "1"], ["0", "0", "2"], ["0", "-1", "3"]]);
});

test("failure of superseded movement does not erase an acknowledged stop", async () => {
  const h = await harness();
  await h.click();
  let finishMotion;
  h.reply("drive", new Promise((resolve) => { finishMotion = resolve; }));
  await h.document.emit("keydown", { key: "ArrowUp" });
  await h.document.emit("keyup", { key: "ArrowUp" });
  finishMotion({ status: 503, body: { ok: false, message: "Old response failed" } });
  await flush();
  assert.equal(h.state(), "Ready to drive");
  assert.equal(h.nodes.get("arm-label").textContent, "Stop control");
  assert.equal(h.requests.filter((r) => r.action === "stop").length, 0);
});

test("a failed priority stop disarms and sends the independent emergency stop", async () => {
  const h = await harness();
  await h.click();
  let finishMotion;
  h.reply("drive", new Promise((resolve) => { finishMotion = resolve; }));
  h.reply("drive", { status: 503, body: { ok: false, message: "Stop unavailable" } });
  await h.document.emit("keydown", { key: "ArrowUp" });
  await h.document.emit("keyup", { key: "ArrowUp" });
  assert.equal(h.state(), "Stop unavailable");
  assert.equal(h.nodes.get("arm-label").textContent, "Start control");
  assert.equal(h.requests.filter((r) => r.action === "stop").length, 1);
  finishMotion(ok);
  await flush();
  await h.tick(120);
  assert.equal(driveFields(h).length, 2);
});

for (const firstReply of ["motion", "neutral"]) {
  test(`a new session ignores old ${firstReply} failure and the other late success`, async () => {
    const h = await harness();
    await h.click();
    const finish = {};
    h.reply("drive", new Promise((resolve) => { finish.motion = resolve; }));
    h.reply("drive", new Promise((resolve) => { finish.neutral = resolve; }));
    await h.document.emit("keydown", { key: "ArrowUp" });
    await h.document.emit("keyup", { key: "ArrowUp" });
    await h.document.emit("keydown", { key: "ArrowRight" });
    assert.equal(driveFields(h).length, 2, "old motion and neutral are both outstanding");

    await h.click();
    const nextToken = "b".repeat(64);
    h.reply("arm", { status: 200, body: { ok: true, token: nextToken } });
    await h.click();
    assert.equal(h.state(), "Ready to drive");

    // New input is also released before either old request completes.
    await h.document.emit("keydown", { key: "ArrowDown" });
    await h.document.emit("keyup", { key: "ArrowDown" });
    finish[firstReply]({ status: 503, body: { ok: false, message: "Previous session failed" } });
    await flush();
    assert.equal(h.state(), "Ready to drive", "a previous session failure cannot disarm the new session");
    assert.equal(h.nodes.get("arm-label").textContent, "Stop control");
    assert.equal(driveFields(h).length, 2, "wait for both old requests before using their slots");

    finish[firstReply === "motion" ? "neutral" : "motion"](ok);
    await flush();
    assert.equal(h.state(), "Ready to drive");
    assert.equal(h.nodes.get("arm-label").textContent, "Stop control");
    assert.equal(h.requests.filter((r) => r.action === "stop").length, 1, "only the explicit session stop was sent");
    assert.deepEqual(driveFields(h).map(({ token: session, steer, throttle, seq }) => [session, steer, throttle, seq]), [
      [token, "0", "1", "1"],
      [token, "0", "0", "2"],
      [nextToken, "0", "0", "1"],
    ], "the new session starts at sequence one and sends only the current neutral input");
    await h.tick(120);
    assert.equal(driveFields(h).length, 3, "released input from either session is not replayed");

    await h.document.emit("keydown", { key: "ArrowLeft" });
    assert.deepEqual(driveFields(h).at(-1), {
      action: "drive", token: nextToken, steer: "-1", throttle: "0", speed: "slow", seq: "2",
    }, "new input continues the new session sequence");
  });
}
