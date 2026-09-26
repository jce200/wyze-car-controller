"""Protocol and watchdog checks using a regular file as fake serial port."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
CAMERA = ROOT / "camera"
GIT_SH = Path(r"C:\Program Files\Git\usr\bin\sh.exe")
SH = str(GIT_SH) if GIT_SH.exists() else shutil.which("sh")


def shell_env(**kwargs):
    env = os.environ.copy()
    if GIT_SH.exists():
        env["PATH"] = "/usr/bin:/bin"
    env.update({key: str(value).replace("\\", "/") for key, value in kwargs.items()})
    return env


@unittest.skipUnless(SH, "POSIX shell is required")
class ProtocolTests(unittest.TestCase):
    def test_all_motor_frames_match_thingino(self):
        source = (CAMERA / "car-daemon.sh").read_text()
        function = source[source.index("drive_frame() {") : source.index("\nsend_drive() {")]
        expected = {
            (0, 0, "slow"): "aa554306298080000271",
            (0, 1, "slow"): "aa5543062980ca0002bb",
            (0, 1, "fast"): "aa5543062980e30002d4",
            (0, -1, "slow"): "aa55430629803b00022c",
            (0, -1, "fast"): "aa554306298036000227",
            (-1, 0, "slow"): "aa554306297681000268",
            (1, 0, "slow"): "aa554306298a8100027c",
            (-1, 1, "slow"): "aa5543062976ca0002b1",
            (-1, 1, "fast"): "aa5543062976e30002ca",
            (1, 1, "slow"): "aa554306298aca0002c5",
            (1, 1, "fast"): "aa554306298ae30002de",
            (-1, -1, "slow"): "aa55430629763b000222",
            (-1, -1, "fast"): "aa55430629763600021d",
            (1, -1, "slow"): "aa554306298a3b000236",
            (1, -1, "fast"): "aa554306298a36000231",
        }
        for (steer, throttle, speed), packet in expected.items():
            with self.subTest(steer=steer, throttle=throttle, speed=speed):
                command = f"{function}\ndrive_frame {steer} {throttle} {speed}\n"
                result = subprocess.run([SH, "-c", command], capture_output=True, check=True, env=shell_env())
                self.assertEqual(result.stdout.hex(), packet)

    def test_headlight_frames_match_thingino(self):
        source = (CAMERA / "car-daemon.sh").read_text()
        function = source[source.index("send_lights() {") : source.index("\ncleanup() {")]
        function = "device_ready() { :; }\nremove_ghost_port() { :; }\n" + function
        with tempfile.TemporaryDirectory() as temp_dir:
            port = Path(temp_dir) / "ttyUSB0"
            port.touch()
            for on, expected in [(1, "aa5543041e010165"), (0, "aa5543041e020166")]:
                with self.subTest(on=on):
                    command = f"{function}\nsend_lights {on}\n"
                    subprocess.run([SH, "-c", command], check=True, env=shell_env(DEVICE=port))
                    self.assertEqual(port.read_bytes().hex(), expected)

    def test_incomplete_daemon_lock_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state = Path(temp_dir) / "state"
            (state / "daemon.lock").mkdir(parents=True)
            port = Path(temp_dir) / "ttyUSB0"
            port.touch()
            env = shell_env(CAR_STATE_DIR=state, CAR_DEVICE=port, CAR_TEST_MODE="1")
            process = subprocess.run([SH, str(CAMERA / "car-daemon.sh")],
                                     env=env, capture_output=True, timeout=2)
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse((state / "pid").exists())


@unittest.skipUnless(SH, "POSIX shell is required")
class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        temp_path = Path(self.temp.name)
        self.state = temp_path / "state"
        self.device = temp_path / "ttyUSB0"
        self.device.touch()
        self.auth = temp_path / "auth.sh"
        self.auth.write_text("require_auth() { :; }\n")
        self.env = shell_env(CAR_STATE_DIR=self.state, CAR_DEVICE=self.device,
                             CAR_AUTH_FILE=self.auth, CAR_TEST_MODE="1")
        self.daemon = subprocess.Popen([SH, str(CAMERA / "car-daemon.sh")], env=self.env,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.addCleanup(self.stop_daemon)
        self.wait_for(lambda: (self.state / "heartbeat").exists())
        self.wait_for(lambda: self.device.read_bytes().hex() == "aa554306298080000271")

    def stop_daemon(self):
        if self.daemon.poll() is None:
            self.daemon.terminate()
            try:
                self.daemon.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.daemon.kill()
                self.daemon.wait(timeout=2)
        if self.daemon.stderr:
            self.daemon.stderr.close()

    def wait_for(self, predicate, timeout=2):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.02)
        self.fail("Timed out waiting for controller state")

    def request(self, method, body="", header=True, query="", content_type=""):
        env = self.env.copy()
        env.update(REQUEST_METHOD=method, QUERY_STRING=query, CONTENT_LENGTH=str(len(body)),
                   CONTENT_TYPE=content_type)
        env.pop("HTTP_X_CAR_CONTROL", None)
        if header:
            env["HTTP_X_CAR_CONTROL"] = "1"
        response = subprocess.run([SH, str(CAMERA / "car.cgi")], input=body.encode(),
                                  capture_output=True, env=env, timeout=3, check=True)
        head, payload = response.stdout.split(b"\r\n\r\n", 1)
        return head.decode(), json.loads(payload)

    def debug_state(self):
        checks = subprocess.run(
            [SH, "-c", 'read p < "$CAR_STATE_DIR/pid"; read h < "$CAR_STATE_DIR/heartbeat"; '
             'read u rest < /proc/uptime; kill -0 "$p" 2>/dev/null; '
             'printf "pid=%s heartbeat=%s uptime=%s kill=%s\\n" "$p" "$h" "$u" "$?"'],
            env=self.env, capture_output=True, text=True,
        )
        return {"daemon_exit": self.daemon.poll(), "checks": checks.stdout, "files": {
            path.name: path.read_text(errors="replace") if path.is_file() else "<directory>"
            for path in self.state.iterdir()
        }}

    def test_drive_stop_and_deadman(self):
        head, data = self.request("GET", query="action=status")
        self.assertIn("200 OK", head)
        self.assertTrue(data["connected"])

        head, data = self.request("POST", "action=arm")
        self.assertIn("200 OK", head, (head, data, self.debug_state()))
        token = data["token"]
        self.assertEqual(len(token), 64)
        head, data = self.request("POST", f"action=drive&steer=0&throttle=1&speed=slow&token={token}")
        self.assertTrue(data["ok"])
        forward = "aa5543062980ca0002bb"
        stopped = "aa554306298080000271"
        self.wait_for(lambda: self.device.read_bytes().hex() == forward)
        self.wait_for(lambda: self.device.read_bytes().hex() == stopped, timeout=1.2)

        self.request("POST", f"action=drive&steer=-1&throttle=1&speed=fast&token={token}")
        self.wait_for(lambda: self.device.read_bytes().hex() == "aa5543062976e30002ca")
        self.request("POST", f"action=stop&token={token}")
        self.wait_for(lambda: self.device.read_bytes().hex() == stopped)
        head, _ = self.request("POST", f"action=drive&steer=0&throttle=1&speed=fast&token={token}")
        self.assertIn("409 Conflict", head)
        second_reply = self.request("POST", "action=arm")
        self.assertIn("token", second_reply[1], (second_reply, self.request("GET", query="action=status"), self.debug_state()))
        second_token = second_reply[1]["token"]
        self.assertNotEqual(token, second_token)
        self.request("POST", f"action=stop&token={token}")
        head, response_data = self.request("POST", f"action=drive&steer=0&throttle=1&speed=slow&token={second_token}")
        self.assertIn("409 Conflict", head, (head, response_data, self.debug_state()))
        self.wait_for(lambda: self.device.read_bytes().hex() == stopped)

        third_reply = self.request("POST", "action=arm")
        self.assertIn("token", third_reply[1], (third_reply, self.request("GET", query="action=status"), self.debug_state()))
        third_token = third_reply[1]["token"]
        self.request("POST", "action=stop")
        head, _ = self.request("POST", f"action=drive&steer=0&throttle=1&speed=slow&token={third_token}")
        self.assertIn("409 Conflict", head)

    def test_bad_requests_never_write_a_drive(self):
        head, _ = self.request("POST", "action=arm", header=False)
        self.assertIn("403 Forbidden", head)
        arm_reply = self.request("POST", "action=arm")
        self.assertIn("token", arm_reply[1], arm_reply)
        token = arm_reply[1]["token"]
        head, _ = self.request("POST", f"action=drive&steer=2&throttle=1&speed=fast&token={token}")
        self.assertIn("400 Bad Request", head)
        head, _ = self.request("GET", query="action=drive")
        self.assertIn("400 Bad Request", head)
        self.assertFalse((self.state / "drive").exists())

    def test_uhttpd_content_type_without_custom_header(self):
        # Reproduce uhttpd's CGI environment: Content-Type survives, X-* may not.
        mime = "application/x-wyze-car-control"
        head, data = self.request("POST", "action=arm", header=False, content_type=mime)
        self.assertIn("200 OK", head, data)
        token = data["token"]
        head, data = self.request("POST", f"action=drive&steer=0&throttle=0&speed=slow&token={token}",
                                  header=False, content_type=mime)
        self.assertIn("200 OK", head, data)
        head, data = self.request("POST", f"action=stop&token={token}",
                                  header=False, content_type=mime)
        self.assertIn("200 OK", head, data)
        head, _ = self.request("POST", f"action=drive&steer=0&throttle=1&speed=slow&token={token}",
                               header=False, content_type=mime)
        self.assertIn("409 Conflict", head)

    def test_cross_origin_form_types_and_preflight_are_rejected(self):
        for mime in ("", "text/plain", "application/x-www-form-urlencoded",
                     "multipart/form-data; boundary=test", "application/json",
                     "application/x-wyze-car-control-extra"):
            with self.subTest(content_type=mime):
                head, _ = self.request("POST", "action=arm", header=False, content_type=mime)
                self.assertIn("403 Forbidden", head)
        head, _ = self.request("OPTIONS", header=False)
        self.assertIn("405 Method Not Allowed", head)
        self.assertNotIn("Access-Control-Allow-Origin", head)
        self.assertEqual((self.state / "session").read_text().strip(), "none boot")
        self.assertFalse((self.state / "drive").exists())

    def test_disconnect_and_single_daemon(self):
        duplicate = subprocess.run([SH, str(CAMERA / "car-daemon.sh")], env=self.env,
                                   capture_output=True, timeout=2)
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIsNone(self.daemon.poll())

        self.device.unlink()
        self.wait_for(lambda: not self.request("GET", query="action=status")[1]["connected"])
        self.assertFalse(self.device.exists(), "A missing serial port must not be recreated")

        self.device.touch()
        self.wait_for(lambda: self.request("GET", query="action=status")[1]["connected"])
        self.wait_for(lambda: self.device.read_bytes().hex() == "aa554306298080000271")


if __name__ == "__main__":
    unittest.main()
