# Wyze Car Controller for Thingino

An experimental browser alternative to the Wyze Car app for a Car with a
Thingino camera. Open the page hosted on the camera from a phone or computer
to watch live video and drive. It uses the Car's existing USB connection;
normal operation on a local network needs no Wyze account, cloud service, or
additional server.

**Hardware status:** Installation, live video, Slow driving, and stopping on
release have been confirmed with a physical Wyze Car and a Thingino Wyze Cam v2.
Fast mode, physical gamepad control, Wyze Cam v3 compatibility, and actual
stopping delay or distance have not been verified. Serial commands, input
validation, and the motor watchdog pass tests with a simulated serial device.
Treat this as experimental software and start in a clear area.

## Features

- Live video from Thingino's MJPEG stream.
- Touch joystick, keyboard (WASD or arrow keys), and gamepad controls when the
  browser exposes a gamepad.
- Slow/fast speed selection, headlights, and a prominent emergency stop button.
- A camera-side motor watchdog sends a stop frame after 450 ms without a fresh
  drive request. Releasing the controls, hiding the tab, and connection loss
  also request a stop.
- Emergency stop invalidates all active control sessions. Late commands from
  an earlier session are rejected. The button remains available after a status
  error; if a stop request cannot be confirmed, the page says so.
- Releasing the controls sends neutral immediately, even if a movement request
  is still awaiting its response. Per-session sequence numbers prevent an older
  request from overwriting a newer stop. Input changes are coalesced rather than
  queued for later playback.
- Drive requests use Thingino's existing `require_auth` rules. The page contains
  no embedded password or API key. Thingino may also allow API keys or a
  configured trusted-IP bypass, so review your camera's settings.
- On a phone held sideways, video and controls sit side by side and fit the
  screen without scrolling.
- An optional [Android app](#android-app) shows the controller full screen and
  adds gamepad support.
- Black interface with Wyze mint accents and a rotating SVG Car logo. Aptos is
  used when available on the viewing device, with system-font fallbacks.

## How it connects

The camera mounts on the Wyze Car and uses the same camera-to-Car USB connection
as the original setup. Your phone or computer connects to the Thingino camera
over the local network. Provide power to both the camera and the Car; the camera
can use a wall outlet while testing or a power bank for untethered driving.
Internet access is not needed for normal operation.

The controller expects the Car's CP210x serial interface at `/dev/ttyUSB0`.
Keep any other process that writes to this device, including Thingino's
`car_control`, stopped while using the web controller.

## Install

Requirements: a working Thingino camera, root SSH access, Thingino's web UI
with `/var/www/x/auth.sh`, and `ssh`/`scp` on your computer. You can install
the software before attaching the Car. To drive, connect the Wyze Car to the
camera's USB port and power both; no separate USB serial adapter is needed.
Log in to the Thingino web UI once before opening the controller.

### Install a release (recommended)

Download the ZIP (Windows) or tar.gz (macOS/Linux) installation package from
[Releases](https://github.com/jce200/wyze-car-controller/releases), together
with `SHA256SUMS`. Verify and extract the archive, then follow the included
[INSTALL.md](INSTALL.md). Release packages do not require Git, Python, or Node.js.

### Install from source

To install the current development version instead, use the commands below.

#### Windows PowerShell

```powershell
git clone https://github.com/jce200/wyze-car-controller.git
cd wyze-car-controller
.\deploy.ps1 -Camera 192.168.1.123
```

#### macOS or Linux

```sh
git clone https://github.com/jce200/wyze-car-controller.git
cd wyze-car-controller
sh ./deploy.sh 192.168.1.123
```

Replace the example IP address with your camera's address. Both scripts copy
the project to a unique temporary directory over SSH and run the camera
installer. They use `scp -O` because Thingino's SSH server may not support
SFTP. Enter the camera's root password when SSH asks for it; do not put it
into the script.

Open `http://<camera-ip>/car/` after installation. If the camera already runs
Thingino, no further firmware flashing is needed. The installer places the page
in `/var/www/car/`, the CGI endpoint in
`/var/www/x/`, the motor service in `/opt/wyze-car/`, and the startup script
in `/etc/init.d/`. Thingino retains those files in its
[writable overlay](https://github.com/themactep/thingino-firmware/blob/stable/docs/overlayfs.md).
Runtime state is kept in `/tmp`.
The installer prepares all replacement files and backs up the existing ones
before stopping the controller. If the install or restart fails normally, it
tries to restore the previous files and restart the previous service. An
interrupted install or a daemon that will not stop may still require a reboot.
If rollback is reported incomplete, disconnect the Car and save the error and
temporary backup path before rebooting; a reboot clears `/tmp`.

## Android app

The `android/` directory contains a small Android app (Android 8.0 or newer).
It is a full-screen shell around the controller page that the camera hosts, so
the controller must be installed on the camera first, as described above. All
drive and safety logic stays in that page and on the camera. The app adds:

- A setup screen for the camera address, which it remembers.
- Full-screen display that keeps the screen on while you drive.
- A sign-in dialog when the camera asks for HTTP authentication. Thingino's own
  sign-in page also works inside the app; use **Open Car controller** to return.
- Gamepad support (Bluetooth or USB): left stick, D-pad or triggers drive, and
  **B** is the emergency stop. The app passes these to the page as its keyboard
  controls, because Android WebView does not reliably expose gamepads to a page
  served over plain HTTP.
- Clear messages when the camera is unreachable or the controller is missing.

Press **Back** for the menu: reload, change the camera address, open the
Thingino web interface, or exit. Leaving the app, locking the phone, or opening
the menu pauses control just like hiding a browser tab, and the camera's 450 ms
watchdog still applies. The app only needs the network permission and allows
plain HTTP because that is what Thingino serves; keep using it on a trusted
local network. English and Dutch are included.

**Status:** the app builds and its unit tests pass, and its gamepad-to-keyboard
bridge has been checked against the controller page in desktop Chromium. It has
not yet been run on an Android device or with a physical Car or gamepad.

### Get the app

Each push builds a debug APK in GitHub Actions: open the latest **CI** run under
the repository's **Actions** tab and download the `wyze-car-android-debug`
artifact. To build it yourself you need JDK 17 and the Android SDK
(`ANDROID_HOME` set, or simply open `android/` in Android Studio):

```sh
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
Copy it to the phone and open it, allowing installation from that source when
Android asks. Debug builds from different machines are signed with different
keys; uninstall the old app before installing one built elsewhere.

### Signed release build

A release build signed with your own key is smaller and can be updated in
place, because every build carries the same signature. Create a keystore once
and keep it and its password somewhere safe; a lost key cannot be replaced, and
apps signed with a new key will not install over the old one.

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore wyze-car-release.p12 \
  -alias wyze-car -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Wyze Car Controller"
```

Never commit the keystore; `android/.gitignore` excludes `*.p12`, `*.jks`, and
`*.keystore`. To build locally:

```sh
cd android
export WYZE_CAR_KEYSTORE=/path/to/wyze-car-release.p12
export WYZE_CAR_KEYSTORE_PASSWORD='your keystore password'
export WYZE_CAR_KEY_ALIAS=wyze-car
export WYZE_CAR_KEY_PASSWORD="$WYZE_CAR_KEYSTORE_PASSWORD"
./gradlew assembleRelease
```

The APK is written to `android/app/build/outputs/apk/release/app-release.apk`.

To let GitHub Actions build it, add three repository secrets under **Settings
→ Secrets and variables → Actions**:

- `WYZE_CAR_KEYSTORE_BASE64`: the output of `base64 -w0 wyze-car-release.p12`
  (on macOS: `base64 -i wyze-car-release.p12`).
- `WYZE_CAR_KEYSTORE_PASSWORD`: the keystore password.
- `WYZE_CAR_KEY_ALIAS`: `wyze-car`.

Pushes to `main` and tags starting with `v` then also produce a
`wyze-car-android-release` artifact. Pull requests never receive the key.

## First drive and safety

Put the Car on the floor with open space around it. Open the controller page,
press **Start control**, select **Slow**, and try each direction briefly. Use
**Emergency stop** if movement is unexpected. Confirm that releasing a control
stops the Car before trying Fast.

The 450 ms watchdog is a software limit while the camera and motor service
are running. Physical stopping distance and video delay have not been measured
on a real Car. Keep the camera web interface on a trusted local network:
Thingino serves this page over plain HTTP. Do not forward its web or SSH ports
to the public internet.

## Troubleshooting

If the Car keeps driving briefly after you release a key or joystick, update
the controller and reload the page. Earlier versions waited for the current
movement response before sending neutral. The current version sends neutral
independently and rejects commands that arrive out of order. This removes that
browser-side wait; Wi-Fi, the roughly 100 ms motor loop, video latency, and
physical stopping distance still affect the result. Actual stopping delay has
not yet been measured on the Car.

The update changes the drive protocol, so refresh any open controller tabs.
An old tab reports "Missing command sequence; refresh the controller page"
instead of sending unordered movement. If the controller repeatedly reports a
busy command lock after a process was forcibly killed, reboot the camera to
clear the temporary lock.
Emergency stop and the motor watchdog do not wait for that lock.

Switching to another window or hiding the controller tab deliberately stops
control. The page now shows a persistent pause reason; return to the controller
and press **Start control** to resume. It never resumes driving automatically.

If an older version intermittently reports that the controller is unavailable,
update it. A timing race could incorrectly reject a newly updated heartbeat.
The fix keeps the 450 ms drive watchdog and does not extend delayed commands.
If interruptions continue, note the exact message and whether live video also
freezes, then check USB, Wi-Fi, and the service log below.

If **Start control** reports HTTP 403 on an older installation, update the
controller and reload the page. Some Thingino uhttpd builds omit custom CGI
headers; the current controller also sends a dedicated Content-Type that
those builds support. Authentication stays required.

An older daemon can also hang during shutdown on BusyBox ash. The current
release avoids that shell issue. If an upgrade stops at "controller did not
stop", use the temporary upload directory printed by the deployment script
to install the new daemon under a temporary name and reboot once. Replace the
example directory below with the one printed during your install:

```sh
cp /tmp/wyze-car-deploy.ABC123/car-daemon.sh /opt/wyze-car/car-daemon.sh.new
chmod 700 /opt/wyze-car/car-daemon.sh.new
mv /opt/wyze-car/car-daemon.sh.new /opt/wyze-car/car-daemon.sh
reboot
```

Then run the normal deployment again to update the remaining files.

Run these commands in an SSH shell on the camera:

```sh
ls -l /dev/ttyUSB0
lsmod | grep cp210x
cat /tmp/wyze-car-controller.log
cat /tmp/wyze-car-controller/heartbeat
/etc/init.d/S95wyze-car restart
```

If `/dev/ttyUSB0` is missing, check the camera-to-Car USB connection, Car
power, and CP210x driver. The page can load while the Car is disconnected, but
it cannot arm the motors. If the service reports a stale lock after a forced
process stop, reboot the camera to clear `/tmp`; do not start a second writer
to the serial port.

The authenticated status endpoint is `/x/car.cgi?action=status`. Motor
commands require authenticated POST requests with the custom content type
`application/x-wyze-car-control`. The legacy `X-Car-Control: 1` header is also
accepted, but some Thingino uhttpd builds do not pass custom headers to CGI.
Ordinary HTML form requests remain rejected. Start control creates a temporary session token; emergency stop invalidates all
current drive commands.

Each drive POST includes a per-session `seq` integer from 1 through 999999999,
increasing with each dispatched command (including neutral). The camera accepts
only a sequence newer than the last saved command for that session. Older or
duplicate commands return `{"ok":true,"ignored":true}` without updating the
motor watchdog timestamp. Releasing the controls uses a separate request slot;
there are at most two drive requests outstanding and no movement history queue.

## Development and sources

On a computer with Python, Node.js, and a POSIX shell (Git Bash on Windows):

```sh
python -m unittest discover -s tests -v
node --test tests/test_car_ui.mjs
```

These tests simulate serial output and cannot replace a physical driving test.

The Android app has its own unit tests:

```sh
cd android
./gradlew testDebugUnitTest lintDebug
```

To rebuild an installation release from its exact committed source:

```sh
python tools/build-release.py --version v0.2.0 --ref v0.2.0 --output dist
```

The standard-library builder reads a fixed list of files from Git, verifies
both archives against those committed files, and writes ZIP, tar.gz,
`INSTALL.md`, and `SHA256SUMS`. Each archive includes `VERSION` and
`BUILDINFO.json` with the source commit. It excludes local previews and old logos.

The serial frames are based on Thingino's
[`car_control`](https://github.com/themactep/thingino-firmware/blob/stable/package/wyze-accessory/files/car_control).
The video and authentication use Thingino's existing
[MJPEG endpoint](https://github.com/themactep/thingino-firmware/blob/stable/package/thingino-webui/files/www/x/ch0.mjpg)
and [`auth.sh`](https://github.com/themactep/thingino-firmware/blob/stable/package/thingino-webui/files/www/x/auth.sh).
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution.

This project is released under the [MIT License](LICENSE). It is an
independent community project and is not affiliated with Wyze Labs or the
Thingino maintainers.
