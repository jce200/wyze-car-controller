"""Daemon lifecycle using POSIX signals, including from a Windows test host."""

from pathlib import Path
import subprocess
import tempfile
import time
import unittest

from test_controller import CAMERA, SH, shell_env


@unittest.skipUnless(SH, "POSIX shell is required")
class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.device = self.root / "ttyUSB0"
        self.device.touch()
        self.env = shell_env(CAR_STATE_DIR=self.state, CAR_DEVICE=self.device,
                             CAR_TEST_MODE="1")
        self.processes = []
        self.addCleanup(self.stop_remaining)
        self.start_daemon()

    def start_daemon(self, script=None):
        self.daemon = subprocess.Popen([SH, str(script or CAMERA / "car-daemon.sh")],
                                       env=self.env, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.PIPE)
        self.processes.append(self.daemon)
        self.wait_for(lambda: (self.state / "heartbeat").exists())
        self.wait_for(lambda: self.device.read_bytes().hex() == "aa554306298080000271")

    def stop_remaining(self):
        for process in self.processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)
            if process.stderr:
                process.stderr.close()

    def wait_for(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.02)
        self.fail("Timed out waiting for daemon lifecycle state")

    def shell(self, source):
        return subprocess.run([SH, "-c", source], env=self.env, check=True,
                              capture_output=True, timeout=3)

    def simulate_driving(self):
        token = "a" * 64
        (self.state / "session").write_text(f"{token} boot\n", newline="\n")
        self.shell(
            'read -r stamp < "$CAR_STATE_DIR/heartbeat"; '
            f'printf "%s {token} 0 1 slow\\n" "$stamp" > "$CAR_STATE_DIR/drive"'
        )
        self.wait_for(lambda: self.device.read_bytes().hex() == "aa5543062980ca0002bb")

    def signal(self, name):
        # Popen.terminate() on Windows skips POSIX shell traps. Resolve and
        # signal the PID within the same shell runtime used by the daemon.
        self.shell(f'read -r p < "$CAR_STATE_DIR/pid"; kill -{name} "$p"')
        self.wait_for(lambda: self.daemon.poll() is not None)
        self.assertEqual(self.daemon.returncode, 0, self.daemon.stderr.read().decode())

    def assert_clean_shutdown(self):
        self.assertFalse((self.state / "pid").exists())
        self.assertFalse((self.state / "heartbeat").exists())
        self.assertFalse((self.state / "daemon.lock").exists())
        self.assertEqual(self.device.read_bytes().hex(), "aa554306298080000271")

    def test_sigterm_stops_and_cleans_up(self):
        self.simulate_driving()
        self.signal("TERM")
        self.assert_clean_shutdown()

    def test_sighup_stops_and_cleans_up(self):
        self.simulate_driving()
        self.signal("HUP")
        self.assert_clean_shutdown()

    def test_restart_after_sigterm_starts_neutral(self):
        self.simulate_driving()
        self.signal("TERM")
        self.assert_clean_shutdown()
        self.start_daemon()
        self.assertEqual((self.state / "session").read_text().strip(), "none boot")
        self.signal("TERM")
        self.assert_clean_shutdown()

    def test_cleanup_preserves_state_if_lock_owner_changed(self):
        (self.state / "daemon.lock" / "pid").write_text("999999\n")
        self.signal("TERM")
        self.assertTrue((self.state / "pid").exists())
        self.assertTrue((self.state / "heartbeat").exists())
        self.assertEqual((self.state / "daemon.lock" / "pid").read_text(), "999999\n")
        self.assertEqual(self.device.read_bytes().hex(), "aa554306298080000271")

    def test_cleanup_does_not_require_rmdir_applet(self):
        self.signal("TERM")
        self.assert_clean_shutdown()
        marker = self.root / "rmdir-called"
        wrapper = self.root / "without-rmdir.sh"
        wrapper.write_text(
            'rmdir() { printf called > "$CAR_RMDIR_MARKER"; return 127; }\n'
            '. "$CAR_REAL_DAEMON"\n', newline="\n",
        )
        self.env.update(CAR_RMDIR_MARKER=str(marker).replace("\\", "/"),
                        CAR_REAL_DAEMON=str(CAMERA / "car-daemon.sh").replace("\\", "/"))
        self.start_daemon(wrapper)
        self.signal("TERM")
        self.assert_clean_shutdown()
        self.assertFalse(marker.exists(), "Cleanup must not call the absent rmdir applet")


if __name__ == "__main__":
    unittest.main()
