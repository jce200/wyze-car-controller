# Wyze Car Controller for Thingino

An experimental, self-hosted browser controller for a Wyze Car with a Thingino
camera. The camera talks directly to the Car over its USB serial connection;
your phone or computer only needs a browser on the same local network. No Wyze
app, cloud service, or separate server is required.

**Hardware status (2026-09-26):** Installation, live video, USB detection,
and starting/stopping a control session have been checked on a Thingino Wyze
Cam v2 connected to a physical Wyze Car. The user also confirmed driving in
Slow mode and stopping when the joystick is released. Fast mode, gamepad
operation, and the physical stopping delay still need hardware testing.
Serial packets, input validation, and the 450 ms motor watchdog pass local
tests using a simulated serial device. Treat this as experimental software
and test it in a clear, controlled area.

| Camera | Current status |
| --- | --- |
| Wyze Cam v2 with Thingino | Installation, live video and control sessions checked; user confirmed Slow driving and stopping on release with a physical Car. |
| Wyze Cam v3 with Thingino | Untested with this controller. Thingino has [Car accessory and USB OTG options](https://github.com/themactep/thingino-firmware/blob/stable/configs/cameras/wyze_cam3_t31x_gc2053_atbm6031/wyze_cam3_t31x_gc2053_atbm6031_defconfig), but the USB connection and serial port still need verification on a real v3/Car combination. |

## Features

- Live video from Thingino's MJPEG stream.
- A black interface with Wyze mint (`#1DF0BB`), purple accents, and a supplied
  transparent SVG Wyze Car logo. Hover to rotate, drag to turn it manually,
  or tap to toggle rotation on touchscreens. The renderer runs during interaction
  and settling, and pauses when hidden or offscreen. All logo files are hosted
  locally on the camera; a static SVG serves as the favicon. Light text and a
  distinct red emergency stop keep controls readable.
- Aptos typography when installed on the viewing device, with system sans-serif
  fallbacks. The camera does not need to download or host font files.
- Touch joystick, keyboard (WASD or arrow keys), and gamepad controls when the
  browser exposes a gamepad.
- Slow/fast speed selection, headlights, and a prominent emergency stop button.
- A camera-side motor watchdog sends a stop frame after 450 ms without a fresh
  drive request. Releasing the controls, hiding the tab, and connection loss
  also request a stop.
- Emergency stop invalidates all active control sessions. Late commands from
  an earlier session are rejected.
- Releasing the controls sends neutral immediately, even if a movement request
  is still awaiting its response. Per-session sequence numbers prevent an older
  request from overwriting a newer stop. Input changes are coalesced rather than
  queued for later playback.
- Drive requests use Thingino's existing `require_auth` rules. The page contains
  no embedded password or API key. Thingino may also allow API keys or a
  configured trusted-IP bypass, so review your camera's settings.

## How it connects

The camera mounts on the Wyze Car and connects to it through the Car's USB
connector. That USB link carries motor commands; it is not a cable to your
phone or computer. The Car and camera need their normal battery power. Your
phone/computer connects to the camera over Wi-Fi through the same local network.
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
the project over SSH and run the camera installer. They use `scp -O` because
Thingino's SSH server may not support SFTP. Enter the camera's root password
when SSH asks for it; do not put it into the script.

Open `http://<camera-ip>/car/` after installation. No firmware reflashing is
needed. The installer places the page in `/var/www/car/`, the CGI endpoint in
`/var/www/x/`, the motor service in `/opt/wyze-car/`, and the startup script
in `/etc/init.d/`. Thingino retains those files in its
[writable overlay](https://github.com/themactep/thingino-firmware/blob/stable/docs/overlayfs.md).
Runtime state is kept in `/tmp`.

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
stop", after the deployment files have been copied to `/tmp/wyze-car-deploy`,
install the new daemon under a temporary name and reboot once:

```sh
cp /tmp/wyze-car-deploy/car-daemon.sh /opt/wyze-car/car-daemon.sh.new
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

To rebuild an installation release from its exact committed source:

```sh
python tools/build-release.py --version v0.1.0 --ref v0.1.0 --output dist
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
