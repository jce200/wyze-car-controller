"""Drive request ordering and lock cleanup without a connected Car."""

import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

from test_controller import CAMERA, SH, shell_env


TOKEN = "a" * 64


@unittest.skipUnless(SH, "POSIX shell is required")
class OrderingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.state.mkdir()
        self.device = self.root / "ttyUSB0"
        self.device.touch()
        self.uptime = self.root / "uptime"
        self.set_clock(1000)
        (self.state / "pid").write_text("42\n", newline="\n")
        (self.state / "session").write_text(f"{TOKEN} boot\n", newline="\n")
        (self.state / "global-stop").write_text("boot\n", newline="\n")
        self.auth = self.root / "auth.sh"
        self.auth.write_text(r'''
require_auth() {
    [ -z "$CAR_TEST_PID_FILE" ] || printf '%s\n' "$$" > "$CAR_TEST_PID_FILE"
    return 0
}
kill() { [ "$1" = -0 ] || command kill "$@"; }
mkdir() {
    command mkdir "$@"
    result=$?
    if [ "$1" = "$CAR_STATE_DIR/drive.lock" ] && [ "$result" -ne 0 ]; then
        : > "$CAR_STATE_DIR/lock-waiting"
    fi
    return "$result"
}
mv() {
    if [ "$CAR_TEST_PAUSE_MOVE" = 1 ] && [ "$3" = "$CAR_STATE_DIR/drive" ]; then
        : > "$CAR_STATE_DIR/move-paused"
        while [ ! -f "$CAR_STATE_DIR/resume-move" ]; do sleep 0.01; done
    fi
    if [ "$CAR_TEST_FAIL_MOVE" = 1 ] && [ "$3" = "$CAR_STATE_DIR/drive" ]; then
        return 1
    fi
    command mv "$@"
}
''', newline="\n")
        self.script = self.root / "car.cgi"
        self.script.write_text((CAMERA / "car.cgi").read_text().replace(
            "< /proc/uptime", '< "$CAR_TEST_UPTIME"'), newline="\n")
        self.env = shell_env(CAR_STATE_DIR=self.state, CAR_DEVICE=self.device,
                             CAR_TEST_MODE="1", CAR_AUTH_FILE=self.auth,
                             CAR_TEST_UPTIME=self.uptime)
        self.processes = []
        self.addCleanup(self.stop_processes)

    def stop_processes(self):
        (self.state / "resume-move").touch()
        for process in self.processes:
            if process.poll() is None:
                try:
                    process.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=2)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream and not stream.closed:
                    stream.close()

    def set_clock(self, ticks):
        self.uptime.write_text(f"{ticks // 100}.{ticks % 100:02d} 0\n", newline="\n")
        (self.state / "heartbeat").write_text(f"{ticks}\n", newline="\n")

    def drive_body(self, seq, throttle=1, token=TOKEN):
        return f"action=drive&token={token}&steer=0&throttle={throttle}&speed=slow&seq={seq}"

    def start_request(self, body, **extra_env):
        env = self.env.copy()
        env.update(REQUEST_METHOD="POST", CONTENT_LENGTH=str(len(body)),
                   CONTENT_TYPE="application/x-wyze-car-control")
        env.update({key: str(value).replace("\\", "/") for key, value in extra_env.items()})
        process = subprocess.Popen([SH, str(self.script)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.processes.append(process)
        process.stdin.write(body.encode())
        process.stdin.close()
        process.stdin = None
        return process

    def finish_request(self, process):
        output, errors = process.communicate(timeout=3)
        self.assertEqual(process.returncode, 0, errors.decode())
        head, payload = output.split(b"\r\n\r\n", 1)
        return head.decode(), json.loads(payload)

    def request(self, body, **extra_env):
        return self.finish_request(self.start_request(body, **extra_env))

    def wait_for(self, predicate):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.005)
        self.fail("Timed out waiting for CGI test barrier")

    def state_fields(self):
        return (self.state / "drive").read_text().split()

    def assert_unlocked(self):
        self.assertFalse((self.state / "drive.lock").exists())

    def test_delayed_movement_cannot_overwrite_release(self):
        self.request(self.drive_body(1))
        self.request(self.drive_body(3, throttle=0))
        head, result = self.request(self.drive_body(2))
        self.assertIn("200 OK", head)
        self.assertTrue(result["ignored"])
        self.assertEqual(self.state_fields()[2:], ["0", "0", "slow", "3"])
        self.assert_unlocked()

    def test_delayed_release_cannot_cancel_newer_movement_or_release(self):
        self.request(self.drive_body(4))
        _, result = self.request(self.drive_body(3, throttle=0))
        self.assertTrue(result["ignored"])
        self.assertEqual(self.state_fields()[3:], ["1", "slow", "4"])
        self.request(self.drive_body(6, throttle=0))
        self.request(self.drive_body(5, throttle=0))
        self.assertEqual(self.state_fields()[3:], ["0", "slow", "6"])

    def test_duplicate_does_not_refresh_timestamp_or_change_vector(self):
        self.request(self.drive_body(1))
        original = (self.state / "drive").read_bytes()
        self.set_clock(1040)
        _, result = self.request(self.drive_body(1, throttle=0))
        self.assertTrue(result["ignored"])
        self.assertEqual((self.state / "drive").read_bytes(), original)

    def test_new_session_restarts_sequence(self):
        self.request(self.drive_body(999999999))
        new_token = "b" * 64
        (self.state / "session").write_text(f"{new_token} boot\n", newline="\n")
        head, data = self.request(self.drive_body(1, token=new_token))
        self.assertIn("200 OK", head, data)
        self.assertNotIn("ignored", data)
        self.assertEqual(self.state_fields()[1], new_token)
        self.assertEqual(self.state_fields()[-1], "1")

    def test_sequences_are_required_and_canonical_bounded_decimals(self):
        head, data = self.request(self.drive_body(1).rsplit("&seq=", 1)[0])
        self.assertIn("400 Bad Request", head)
        self.assertIn("refresh", data["message"])
        for seq in ("", "0", "01", "-1", "+1", "1.0", "1e2", "1000000000",
                    "9999999999999999999", "1%32", "1&seq=2"):
            with self.subTest(seq=seq):
                head, _ = self.request(self.drive_body(seq))
                self.assertIn("400 Bad Request", head)
                self.assertFalse((self.state / "drive").exists())
                self.assert_unlocked()

    def test_sequence_is_rejected_for_non_drive_actions(self):
        for body in ("action=arm&seq=1", "action=stop&seq=1", "action=lights&on=1&seq=1"):
            head, _ = self.request(body)
            self.assertIn("400 Bad Request", head)

    def test_overlapping_writes_are_serialized_and_newer_neutral_wins(self):
        move = self.start_request(self.drive_body(1), CAR_TEST_PAUSE_MOVE="1")
        self.wait_for(lambda: (self.state / "move-paused").exists())
        neutral = self.start_request(self.drive_body(2, throttle=0))
        self.wait_for(lambda: (self.state / "lock-waiting").exists())
        self.assertFalse((self.state / "drive").exists())
        (self.state / "resume-move").touch()
        self.assertIn("200 OK", self.finish_request(move)[0])
        self.assertIn("200 OK", self.finish_request(neutral)[0])
        self.assertEqual(self.state_fields()[2:], ["0", "0", "slow", "2"])
        self.assert_unlocked()

    def test_lock_wait_rechecks_stopped_session(self):
        move = self.start_request(self.drive_body(1), CAR_TEST_PAUSE_MOVE="1")
        self.wait_for(lambda: (self.state / "move-paused").exists())
        neutral = self.start_request(self.drive_body(2, throttle=0))
        self.wait_for(lambda: (self.state / "lock-waiting").exists())
        (self.state / "global-stop").write_text("stopped\n", newline="\n")
        (self.state / "resume-move").touch()
        self.finish_request(move)
        head, _ = self.finish_request(neutral)
        self.assertIn("409 Conflict", head)
        self.assert_unlocked()

    def test_busy_lock_is_bounded_and_does_not_block_global_stop(self):
        lock = self.state / "drive.lock"
        lock.mkdir()
        marker = lock / "owner"
        marker.write_text("another request\n")
        started = time.monotonic()
        head, data = self.request(self.drive_body(1))
        self.assertIn("503 Service Unavailable", head, data)
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(marker.read_text(), "another request\n")
        head, _ = self.request("action=stop")
        self.assertIn("200 OK", head)
        self.assertNotEqual((self.state / "global-stop").read_text().strip(), "boot")
        self.assertTrue(marker.exists(), "A failed lock attempt must not remove another owner's lock")

    def test_lock_cleanup_after_error_and_signal(self):
        head, _ = self.request(self.drive_body(1), CAR_TEST_FAIL_MOVE="1")
        self.assertIn("500 Internal Server Error", head)
        self.assert_unlocked()
        pid_file = self.root / "cgi-pid"
        process = self.start_request(self.drive_body(2), CAR_TEST_PAUSE_MOVE="1",
                                     CAR_TEST_PID_FILE=pid_file)
        self.wait_for(lambda: (self.state / "move-paused").exists())
        subprocess.run([SH, "-c", 'read -r p < "$CAR_TEST_PID_FILE"; kill -TERM "$p"'],
                       env=shell_env(CAR_TEST_PID_FILE=pid_file), capture_output=True,
                       check=True, timeout=2)
        process.communicate(timeout=2)
        self.assert_unlocked()


if __name__ == "__main__":
    unittest.main()
