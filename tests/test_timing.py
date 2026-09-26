"""Deterministic monotonic-clock races; no hardware or wall-clock sleeps."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_controller import CAMERA, SH, shell_env


TOKEN = "a" * 64


@unittest.skipUnless(SH, "POSIX shell is required")
class TimingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        self.device = self.root / "ttyUSB0"
        self.device.touch()
        self.uptime = self.root / "uptime"
        self.uptime.write_text("10.00 0\n")
        self.auth = self.root / "auth.sh"
        # The CGI itself is the live PID for this isolated health fixture.
        # dd performs real body parsing, then models a concurrent heartbeat
        # update before the CGI resumes. Only the clock source is replaced.
        self.auth.write_text(
            'require_auth() { printf "%s\\n" "$$" > "$CAR_STATE_DIR/pid"; }\n'
            'dd() {\n'
            '    command dd "$@" || return $?\n'
            '    printf "%s 0\\n" "$CAR_TEST_LATER_UPTIME" > "$CAR_TEST_UPTIME"\n'
            '    printf "%s\\n" "$CAR_TEST_HEARTBEAT" > "$CAR_STATE_DIR/heartbeat"\n'
            '}\n'
        )
        (self.state / "heartbeat").write_text("1000\n")
        (self.state / "session").write_text(f"{TOKEN} boot\n")
        (self.state / "global-stop").write_text("boot\n")
        self.env = shell_env(
            CAR_STATE_DIR=self.state, CAR_DEVICE=self.device, CAR_TEST_MODE="1",
            CAR_AUTH_FILE=self.auth, CAR_TEST_UPTIME=self.uptime,
        )

    def clock_fixture_source(self, name):
        source = (CAMERA / name).read_text()
        self.assertIn("< /proc/uptime", source)
        return source.replace("< /proc/uptime", '< "$CAR_TEST_UPTIME"')

    def drive_request(self, later_uptime, heartbeat):
        script = self.root / "car.cgi"
        script.write_text(self.clock_fixture_source("car.cgi"), newline="\n")
        body = f"action=drive&token={TOKEN}&steer=0&throttle=1&speed=slow"
        env = self.env.copy()
        env.update(
            REQUEST_METHOD="POST", CONTENT_LENGTH=str(len(body)),
            CONTENT_TYPE="application/x-wyze-car-control", HTTP_X_CAR_CONTROL="1",
            CAR_TEST_LATER_UPTIME=later_uptime, CAR_TEST_HEARTBEAT=str(heartbeat),
        )
        result = subprocess.run(
            [SH, str(script)], input=body.encode(), capture_output=True,
            env=env, timeout=3, check=True,
        )
        head, payload = result.stdout.split(b"\r\n\r\n", 1)
        return head.decode(), json.loads(payload)

    def test_heartbeat_advancing_during_post_does_not_disconnect(self):
        head, data = self.drive_request("10.12", 1012)
        self.assertIn("200 OK", head, data)
        self.assertTrue(data["ok"])
        self.assertEqual((self.state / "drive").read_text().split()[0], "1000")

    def test_heartbeat_that_expires_during_post_is_rejected(self):
        head, data = self.drive_request("11.50", 1000)
        self.assertIn("503 Service Unavailable", head, data)
        self.assertFalse((self.state / "drive").exists())

    def test_delayed_post_preserves_original_command_age(self):
        head, data = self.drive_request("11.00", 1100)
        self.assertIn("200 OK", head, data)
        stamp = int((self.state / "drive").read_text().split()[0])
        self.assertEqual(stamp, 1000)
        self.assertGreaterEqual(1100 - stamp, 45, "A delayed request must stay expired")

    def first_daemon_frame(self, drive_stamp):
        # Publish a command after the daemon sampled its loop heartbeat.
        # Stop after one loop, recording its frame before EXIT sends neutral.
        # Keep lights unchanged so the fake serial file contains the motor frame.
        hooks = r'''
mv() {
    command mv "$@" || return $?
    if [ "$3" = "$CAR_STATE_DIR/heartbeat" ]; then
        printf '10.05 0\n' > "$CAR_TEST_UPTIME"
        printf '%s %s 0 1 slow\n' "$CAR_TEST_DRIVE_STAMP" "$CAR_TEST_TOKEN" > "$CAR_STATE_DIR/drive"
        printf '%s boot\n' "$CAR_TEST_TOKEN" > "$CAR_STATE_DIR/session"
        was_connected=1
        last_lights='0:0'
    fi
}
sleep() { cat "$CAR_DEVICE"; exit 0; }
'''
        source = hooks + self.clock_fixture_source("car-daemon.sh")
        script = self.root / "daemon.sh"
        script.write_text(source, newline="\n")
        env = self.env.copy()
        env.update(CAR_TEST_TOKEN=TOKEN, CAR_TEST_DRIVE_STAMP=str(drive_stamp))
        result = subprocess.run([SH, str(script)], capture_output=True, env=env,
                                timeout=3, check=True)
        return result.stdout.hex()

    def test_command_arriving_after_heartbeat_is_not_replaced_by_neutral(self):
        self.assertEqual(self.first_daemon_frame(1005), "aa5543062980ca0002bb")

    def test_daemon_still_stops_at_450ms(self):
        self.assertEqual(self.first_daemon_frame(960), "aa554306298080000271")


if __name__ == "__main__":
    unittest.main()
