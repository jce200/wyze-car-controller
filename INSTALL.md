# Install Wyze Car Controller v0.1.0

This is an experimental pre-release for a Wyze Car connected to a Thingino
camera. It installs the controller on an existing Thingino system; it is not
a firmware image and does not flash the camera.

## Before you start

- A powered camera running Thingino, with its web UI working.
- The camera's IP address and root SSH password.
- OpenSSH `ssh` and `scp` available on your computer.
- Your computer and camera on the same local network.

You can install before connecting the Car. To drive, connect the Wyze Car to
the camera's USB port and provide power to both. The Car's built-in USB serial
interface must appear as `/dev/ttyUSB0`; no separate USB serial adapter is
needed. The installer requires Thingino's `/var/www/x/auth.sh`.

## 1. Download and verify

From the [v0.1.0 release](https://github.com/jce200/wyze-car-controller/releases/tag/v0.1.0),
download one of these installation packages and `SHA256SUMS`:

- **Windows:** `wyze-car-controller-v0.1.0.zip`
- **macOS/Linux:** `wyze-car-controller-v0.1.0.tar.gz`

Calculate the archive's SHA-256 and compare it with the line for that filename
in `SHA256SUMS`. Continue only if they match.

Windows PowerShell:

```powershell
Get-FileHash .\wyze-car-controller-v0.1.0.zip -Algorithm SHA256
```

macOS:

```sh
shasum -a 256 wyze-car-controller-v0.1.0.tar.gz
```

Linux:

```sh
sha256sum wyze-car-controller-v0.1.0.tar.gz
```

## 2. Extract and install

Replace `192.168.1.123` below with your camera's IP address. Run these commands
on your computer. Git, Python, and Node.js are not needed to install a release.

Windows PowerShell:

```powershell
Expand-Archive .\wyze-car-controller-v0.1.0.zip -DestinationPath .
cd .\wyze-car-controller-v0.1.0
.\deploy.ps1 -Camera 192.168.1.123
```

If PowerShell marks this downloaded script as untrusted, verify the checksum
and inspect `deploy.ps1`, then unblock that file and run it again:

```powershell
Unblock-File .\deploy.ps1
```

If PowerShell instead says that running scripts is disabled, after verifying
and reviewing the script you can allow it for this one PowerShell process:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Camera 192.168.1.123
```

This does not change your saved execution policy. An organization-managed
policy may still prevent execution.

macOS/Linux:

```sh
tar -xzf wyze-car-controller-v0.1.0.tar.gz
cd wyze-car-controller-v0.1.0
sh ./deploy.sh 192.168.1.123
```

SSH may ask you to verify the camera's host key on the first connection.
Enter the camera's root password when prompted; do not put it in a script or
share it in a GitHub issue. Both deployment scripts use legacy SCP (`scp -O`)
for compatibility with Thingino's SSH server.

## 3. Open the controller

1. Open `http://<camera-ip>/` and sign in to Thingino.
2. Open `http://<camera-ip>/car/`.
3. Connect and power the Car if it is not already attached.
4. Put it on the floor with open space around it, choose **Slow**, and press
   **Start control**. Briefly try moving and confirm that releasing the control
   stops it. **Emergency stop** is always available in the UI.

Another program, including Thingino's `car_control`, must not write to the
same USB serial device while this controller is running.

## Updates and limitations

Install a newer release using its deployment script, then reload every open
controller tab. The installer restarts the controller service. See the included
`README.md` for older-daemon shutdown problems and other troubleshooting.

Slow driving and stopping on release have been confirmed by the owner on a
Thingino Wyze Cam v2 and a physical Wyze Car. Wyze Cam v3, Fast mode, and physical
gamepad control have not been verified. Actual stopping delay and distance have
not been measured. The software watchdog is not a guarantee of physical
stopping distance. Keep the camera on a trusted local network.

When reporting a problem, include `v0.1.0`, your camera model, Thingino version,
and the message shown by the controller. The archive's `BUILDINFO.json` records
the exact source commit. Do not include passwords or control-session tokens.

This is an independent community project, not an official Wyze or Thingino
release. Source and issues: https://github.com/jce200/wyze-car-controller
