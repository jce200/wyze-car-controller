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
- Touch joystick, keyboard (WASD or arrow keys), and gamepad controls when the
  browser exposes a gamepad.
- Slow/fast speed selection, headlights, and a prominent emergency stop button.
- A camera-side motor watchdog sends a stop frame after 450 ms without a fresh
  drive request. Releasing the controls, hiding the tab, and connection loss
  also request a stop.
- Emergency stop invalidates all active control sessions. Late commands from
  an earlier session are rejected.
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
the software before attaching the Car; the USB serial device is required to
drive. Log in to the Thingino web UI once before opening the controller.

### Windows PowerShell

```powershell
git clone https://github.com/jce200/wyze-car-controller.git
cd wyze-car-controller
.\deploy.ps1 -Camera 192.168.1.123
```

### macOS or Linux

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

If **Start control** reports HTTP 403 on an older installation, update the
controller and reload the page. Some Thingino uhttpd builds omit custom CGI
headers; the current controller also sends a dedicated Content-Type that
those builds support. Authentication stays required.

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

## Development and sources

On a computer with Python, Node.js, and a POSIX shell (Git Bash on Windows):

```sh
python -m unittest discover -s tests -v
node --test tests/test_car_ui.mjs
```

These tests simulate serial output and cannot replace a physical driving test.
The serial frames are based on Thingino's
[`car_control`](https://github.com/themactep/thingino-firmware/blob/stable/package/wyze-accessory/files/car_control).
The video and authentication use Thingino's existing
[MJPEG endpoint](https://github.com/themactep/thingino-firmware/blob/stable/package/thingino-webui/files/www/x/ch0.mjpg)
and [`auth.sh`](https://github.com/themactep/thingino-firmware/blob/stable/package/thingino-webui/files/www/x/auth.sh).
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution.

This project is released under the [MIT License](LICENSE). It is an
independent community project and is not affiliated with Wyze Labs or the
Thingino maintainers.
