(() => {
  "use strict";

  const API = "/x/car.cgi";
  const VIDEO = "/x/ch0.mjpg";
  const DRIVE_INTERVAL_MS = 120;
  const STATUS_INTERVAL_MS = 2500;
  const REQUEST_TIMEOUT_MS = 1800;

  const el = {
    connection: document.getElementById("connection"),
    connectionText: document.getElementById("connection-text"),
    authBanner: document.getElementById("auth-banner"),
    driveState: document.getElementById("drive-state"),
    armButton: document.getElementById("arm-button"),
    armLabel: document.getElementById("arm-label"),
    stopButton: document.getElementById("stop-button"),
    speedSlow: document.getElementById("speed-slow"),
    speedFast: document.getElementById("speed-fast"),
    lights: document.getElementById("lights-toggle"),
    joystick: document.getElementById("joystick"),
    thumb: document.getElementById("joystick-thumb"),
    direction: document.getElementById("direction-label"),
    image: document.getElementById("camera-image"),
    frame: document.getElementById("camera-frame"),
    liveLabel: document.getElementById("live-label-text"),
    videoMessage: document.getElementById("video-message"),
    cameraCaption: document.getElementById("camera-caption"),
    reloadVideo: document.getElementById("reload-video"),
  };

  let connected = false;
  let videoReady = false;
  let armed = false;
  let controlToken = null;
  let arming = false;
  let driveError = null;
  let armVersion = 0;
  let stopping = false;
  let lightsOn = false;
  let speed = "slow";
  let pointerId = null;
  let pointerVector = { steer: 0, throttle: 0 };
  let keys = new Set();
  let driveInFlight = false;
  let driveQueued = false;
  let lastVector = { steer: 0, throttle: 0 };
  let statusInFlight = false;
  let videoRetryTimer = null;
  let gamepadVector = { steer: 0, throttle: 0 };
  let gamepadStopDown = false;

  function updateAvailability() {
    el.armButton.disabled = !connected || !videoReady || arming || stopping;
    el.stopButton.disabled = !connected;
    el.lights.disabled = !connected;
    el.joystick.classList.toggle("disabled", !connected || !videoReady || !armed);
    if (!armed) setDriveState(driveError || (!connected ? "No connection" : !videoReady ? "Waiting for video" : arming ? "Starting session..." : "Not started"));
  }

  function setAuthRequired(required) {
    el.authBanner.hidden = !required;
  }

  function setConnection(state, label, kind = "") {
    if (!state) armVersion += 1;
    connected = state;
    el.connection.classList.toggle("connected", state);
    el.connection.classList.toggle("error", kind === "error");
    el.connectionText.textContent = label;
    updateAvailability();
    if (!state && armed) disarm(true);
  }

  function setVideoReady(ready) {
    if (!ready) armVersion += 1;
    videoReady = ready;
    el.liveLabel.textContent = ready ? "LIVE" : "OFFLINE";
    updateAvailability();
    if (!ready && armed) disarm(true);
  }

  function setDriveState(label, active = false) {
    el.driveState.textContent = label;
    el.driveState.classList.toggle("active", active);
  }

  function setDriveError(message) {
    driveError = message;
    setDriveState(message);
  }

  function setArmed(value) {
    armed = value;
    if (value) driveError = null;
    el.armButton.classList.toggle("armed", value);
    el.armLabel.textContent = value ? "Stop control" : "Start control";
    updateAvailability();
    if (value) {
      setDriveState("Ready to drive", true);
    } else {
      keys.clear();
      resetPointer();
      lastVector = { steer: 0, throttle: 0 };
      driveQueued = false;
    }
  }

  async function apiPost(fields, timeoutMs = REQUEST_TIMEOUT_MS) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "X-Car-Control": "1", "Content-Type": "application/x-wyze-car-control" },
        body: new URLSearchParams(fields).toString(),
        credentials: "same-origin",
        cache: "no-store",
        signal: abort.signal,
      });
      if (response.status === 401) {
        setAuthRequired(true);
        throw new Error("Sign in to Thingino");
      }
      let result = null;
      if (response.headers.get("content-type")?.includes("application/json")) {
        try {
          result = await response.json();
        } catch {
          if (response.ok) throw new Error("Invalid response from camera");
        }
      }
      const message = [result?.message, result?.error?.message, result?.error]
        .find((value) => typeof value === "string" && value.trim());
      if (!response.ok || result?.ok === false || result?.error) {
        const error = new Error(message || (response.ok ? "Command rejected" : `HTTP ${response.status}`));
        error.status = response.status;
        throw error;
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function stopToken(token) {
    stopping = true;
    updateAvailability();
    try {
      await apiPost(token ? { action: "stop", token } : { action: "stop" });
      return true;
    } catch (error) {
      if (error.status === 409) return true;
      return false;
    } finally {
      stopping = false;
      updateAvailability();
    }
  }

  function stopOnExit() {
    armVersion += 1;
    if (!controlToken) return;
    const token = controlToken;
    controlToken = null;
    armed = false;
    try {
      void fetch(API, {
        method: "POST",
        headers: { "X-Car-Control": "1", "Content-Type": "application/x-wyze-car-control" },
        body: new URLSearchParams({ action: "stop", token }).toString(),
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {});
    } catch { /* The camera watchdog also stops after input ends. */ }
  }

  function disarm(sendStop = true) {
    armVersion += 1;
    const token = controlToken;
    controlToken = null;
    setArmed(false);
    if (sendStop && token) void stopToken(token);
  }

  function normalizeKey(key) {
    if (key.startsWith("Arrow")) return key;
    return key.toLowerCase();
  }

  function keyboardVector() {
    const left = keys.has("a") || keys.has("ArrowLeft");
    const right = keys.has("d") || keys.has("ArrowRight");
    const forward = keys.has("w") || keys.has("ArrowUp");
    const reverse = keys.has("s") || keys.has("ArrowDown");
    return { steer: Number(right) - Number(left), throttle: Number(forward) - Number(reverse) };
  }

  function pollGamepad() {
    let pad = null;
    try {
      if (typeof navigator.getGamepads === "function") {
        pad = Array.from(navigator.getGamepads()).find((item) => item && item.connected && item.mapping === "standard") || null;
      }
    } catch { /* The browser may disable Gamepad API on an HTTP camera address. */ }

    const stopDown = Boolean(pad?.buttons?.[1]?.pressed);
    if (stopDown && !gamepadStopDown && controlToken) disarm(true);
    gamepadStopDown = stopDown;

    let next = { steer: 0, throttle: 0 };
    if (pad) {
      const axisX = Number.isFinite(pad.axes?.[0]) ? pad.axes[0] : 0;
      const axisY = Number.isFinite(pad.axes?.[1]) ? pad.axes[1] : 0;
      const left = Boolean(pad.buttons?.[14]?.pressed) || axisX < -.38;
      const right = Boolean(pad.buttons?.[15]?.pressed) || axisX > .38;
      const forward = Boolean(pad.buttons?.[12]?.pressed) || (pad.buttons?.[7]?.value || 0) > .4 || axisY < -.38;
      const reverse = Boolean(pad.buttons?.[13]?.pressed) || (pad.buttons?.[6]?.value || 0) > .4 || axisY > .38;
      next = { steer: Number(right) - Number(left), throttle: Number(forward) - Number(reverse) };
    }
    if (next.steer !== gamepadVector.steer || next.throttle !== gamepadVector.throttle) {
      gamepadVector = next;
      if (armed && pointerId === null && keys.size === 0) showVector();
    }
  }

  function currentVector() {
    if (pointerId !== null) return pointerVector;
    if (keys.size) return keyboardVector();
    return gamepadVector;
  }

  function describeDirection({ steer, throttle }) {
    if (!steer && !throttle) return "IDLE";
    const vertical = throttle > 0 ? "FORWARD" : throttle < 0 ? "REVERSE" : "";
    const horizontal = steer > 0 ? "RIGHT" : steer < 0 ? "LEFT" : "";
    return [vertical, horizontal].filter(Boolean).join(" / ");
  }

  function showVector() {
    const vector = armed ? currentVector() : { steer: 0, throttle: 0 };
    const moving = Boolean(vector.steer || vector.throttle);
    const changed = vector.steer !== lastVector.steer || vector.throttle !== lastVector.throttle;
    el.direction.textContent = describeDirection(vector);
    if (armed) setDriveState(moving ? "Driving" : "Ready to drive", true);
    lastVector = vector;
    if (armed && changed) void sendDrive(true);
  }

  async function sendDrive(force = false) {
    if (!armed || !connected || !controlToken) return;
    if (driveInFlight) { if (force) driveQueued = true; return; }
    const { steer, throttle } = currentVector();
    if (!force && !steer && !throttle) return;
    const token = controlToken;
    driveInFlight = true;
    try {
      await apiPost({ action: "drive", token, steer: String(steer), throttle: String(throttle), speed });
    } catch (error) {
      if (token === controlToken) {
        if (error.status === 409) {
          disarm(false);
          setDriveError(error.message === "HTTP 409" ? "Drive session expired" : error.message || "Drive session expired");
        } else {
          disarm(true);
          setConnection(false, error.message === "Sign in to Thingino" ? "Sign in to Thingino" : "Controller unavailable", "error");
          setDriveError(error.message || "Drive command failed");
        }
      }
    } finally {
      driveInFlight = false;
      if (driveQueued) { driveQueued = false; void sendDrive(true); }
    }
  }

  async function pollStatus() {
    if (statusInFlight || document.hidden) return;
    statusInFlight = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API}?action=status`, {
        credentials: "same-origin", cache: "no-store", signal: abort.signal,
      });
      if (response.status === 401) throw new Error("Sign in to Thingino");
      if (!response.ok) throw new Error(`Controller: HTTP ${response.status}`);
      const status = await response.json();
      if (status.ok === false || !status.connected) {
        setConnection(false, status.message || "Car not connected", "error");
      } else {
        setAuthRequired(false);
        setConnection(true, "Car connected");
        if (typeof status.lights === "boolean") updateLights(status.lights);
      }
    } catch (error) {
      setAuthRequired(error.message === "Sign in to Thingino");
      setConnection(false, error.message || "No connection", "error");
    } finally {
      clearTimeout(timer);
      statusInFlight = false;
    }
  }

  function updateLights(on) {
    lightsOn = on;
    el.lights.setAttribute("aria-checked", String(on));
    el.lights.setAttribute("aria-label", on ? "Headlights on" : "Headlights off");
  }

  function setSpeed(next) {
    speed = next;
    const slow = next === "slow";
    el.speedSlow.classList.toggle("selected", slow);
    el.speedFast.classList.toggle("selected", !slow);
    el.speedSlow.setAttribute("aria-pressed", String(slow));
    el.speedFast.setAttribute("aria-pressed", String(!slow));
  }

  function updatePointer(clientX, clientY) {
    const box = el.joystick.getBoundingClientRect();
    const maxOffset = box.width / 2 - 36;
    let x = (clientX - (box.left + box.width / 2)) / maxOffset;
    let y = ((box.top + box.height / 2) - clientY) / maxOffset;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    el.thumb.style.setProperty("--jx", `${Math.round(x * maxOffset)}px`);
    el.thumb.style.setProperty("--jy", `${Math.round(-y * maxOffset)}px`);
    pointerVector = {
      steer: x > .32 ? 1 : x < -.32 ? -1 : 0,
      throttle: y > .32 ? 1 : y < -.32 ? -1 : 0,
    };
    showVector();
  }

  function resetPointer() {
    pointerId = null;
    pointerVector = { steer: 0, throttle: 0 };
    el.thumb.style.setProperty("--jx", "0px");
    el.thumb.style.setProperty("--jy", "0px");
    el.joystick.classList.remove("engaged");
    el.direction.textContent = "IDLE";
  }

  function loadVideo() {
    clearTimeout(videoRetryTimer);
    setVideoReady(false);
    el.frame.classList.remove("video-error", "video-ready");
    el.videoMessage.textContent = "Loading video stream…";
    el.cameraCaption.textContent = "Waiting for camera";
    const query = new URLSearchParams({ f: "12", q: "70", w: "960", h: "540", t: String(Date.now()) });
    el.image.src = `${VIDEO}?${query}`;
  }

  el.image.addEventListener("load", () => {
    setVideoReady(true);
    el.videoMessage.textContent = "";
    el.frame.classList.add("video-ready");
    el.frame.classList.remove("video-error");
    el.cameraCaption.textContent = "Stream from Thingino";
  });
  el.image.addEventListener("error", () => {
    setVideoReady(false);
    el.frame.classList.remove("video-ready");
    el.frame.classList.add("video-error");
    el.videoMessage.textContent = "No video. Check the Thingino stream.";
    el.cameraCaption.textContent = "Stream interrupted";
    videoRetryTimer = setTimeout(loadVideo, 5000);
  });
  el.reloadVideo.addEventListener("click", loadVideo);

  el.joystick.addEventListener("pointerdown", (event) => {
    if (!armed || !connected || !videoReady || pointerId !== null) return;
    event.preventDefault();
    pointerId = event.pointerId;
    el.joystick.setPointerCapture(pointerId);
    el.joystick.classList.add("engaged");
    updatePointer(event.clientX, event.clientY);
  });
  el.joystick.addEventListener("pointermove", (event) => {
    if (event.pointerId === pointerId) updatePointer(event.clientX, event.clientY);
  });
  function releasePointer(event) {
    if (event.pointerId !== pointerId) return;
    resetPointer();
    showVector();
  }
  el.joystick.addEventListener("pointerup", releasePointer);
  el.joystick.addEventListener("pointercancel", releasePointer);
  el.joystick.addEventListener("lostpointercapture", releasePointer);

  document.addEventListener("keydown", (event) => {
    if (event.key === " " || event.code === "Space") {
      if (connected || controlToken || arming) {
        event.preventDefault();
        if (controlToken || arming) disarm(true);
        else void stopToken(null);
      }
      return;
    }
    if (!armed || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = normalizeKey(event.key);
    if (!["w", "a", "s", "d", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(key)) return;
    event.preventDefault();
    keys.add(key);
    showVector();
  });
  document.addEventListener("keyup", (event) => {
    const key = normalizeKey(event.key);
    if (keys.delete(key)) { event.preventDefault(); showVector(); }
  });

  el.armButton.addEventListener("click", async () => {
    if (!connected || !videoReady || arming || stopping) return;
    if (armed) { disarm(true); return; }
    driveError = null;
    pollGamepad();
    const input = currentVector();
    if (input.steer || input.throttle) {
      setDriveError("Release the controls first");
      return;
    }
    if (gamepadStopDown) {
      setDriveError("Release the emergency stop button");
      return;
    }
    arming = true;
    const version = ++armVersion;
    updateAvailability();
    setDriveState("Starting session…");
    let startError = null;
    try {
      const result = await apiPost({ action: "arm" });
      if (!/^[0-9a-f]{64}$/i.test(result?.token || "")) throw new Error("Invalid session from camera");
      if (version === armVersion && connected && videoReady && !document.hidden) {
        controlToken = result.token;
        setArmed(true);
      } else {
        void stopToken(result.token);
      }
    } catch (error) {
      startError = error.message || "Could not start";
      if (error.message === "Sign in to Thingino") setConnection(false, "Sign in to Thingino", "error");
    } finally {
      arming = false;
      updateAvailability();
      if (startError) setDriveError(startError);
    }
  });
  el.stopButton.addEventListener("click", () => {
    if (controlToken || arming) disarm(true);
    else void stopToken(null);
  });
  el.speedSlow.addEventListener("click", () => setSpeed("slow"));
  el.speedFast.addEventListener("click", () => setSpeed("fast"));
  el.lights.addEventListener("click", async () => {
    if (!connected) return;
    const next = !lightsOn;
    el.lights.disabled = true;
    try {
      await apiPost({ action: "lights", on: next ? "1" : "0" });
      updateLights(next);
    } catch (error) {
      setConnection(false, error.message === "Sign in to Thingino" ? "Sign in to Thingino" : "Headlights unavailable", "error");
    } finally {
      el.lights.disabled = !connected;
    }
  });

  window.addEventListener("blur", () => disarm(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) disarm(true);
    else { void pollStatus(); if (el.frame.classList.contains("video-error")) loadVideo(); }
  });
  window.addEventListener("pagehide", stopOnExit);

  loadVideo();
  void pollStatus();
  setInterval(() => { if (armed) void sendDrive(); }, DRIVE_INTERVAL_MS);
  setInterval(() => {
    if (!videoReady && el.image.naturalWidth > 0 && !el.frame.classList.contains("video-error")) {
      setVideoReady(true);
      el.videoMessage.textContent = "";
      el.frame.classList.add("video-ready");
      el.cameraCaption.textContent = "Stream from Thingino";
    }
  }, 250);
  setInterval(pollGamepad, 50);
  setInterval(() => { void pollStatus(); }, STATUS_INTERVAL_MS);
})();
