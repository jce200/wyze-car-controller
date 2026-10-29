"""Installer checks in an isolated filesystem, without a camera or serial port."""

from pathlib import Path
import subprocess
import tempfile
import unittest

from test_controller import CAMERA, SH, shell_env


FILES = {
    "car-daemon.sh": "opt/wyze-car/car-daemon.sh",
    "car.cgi": "var/www/x/car.cgi",
    "S95wyze-car": "etc/init.d/S95wyze-car",
    "index.html": "var/www/car/index.html",
    "car.css": "var/www/car/car.css",
    "car.js": "var/www/car/car.js",
    "car-logo.svg": "var/www/car/car-logo.svg",
    "car-logo.js": "var/www/car/car-logo.js",
}


@unittest.skipUnless(SH, "POSIX shell is required")
class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "root"
        self.source = self.base / "upload"
        self.source.mkdir()
        self.log = self.base / "service.log"
        self.lock = self.root / "tmp/wyze-car-install.lock"
        for name, relative in FILES.items():
            (self.source / name).write_text(f"new:{name}\n")
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f"old:{name}\n")
        (self.root / "var/www/x/auth.sh").write_text("require_auth() { :; }\n")
        self.service = self.base / "service.sh"
        self.service.write_text("""#!/bin/sh
printf '%s\\n' "$1" >> "$CAR_INSTALL_TEST_LOG"
if [ "$1" = start ] && [ "$CAR_INSTALL_FAIL_START" = 1 ] &&
   grep -q '^new:' "$CAR_INSTALL_ROOT/var/www/car/car.js"; then
    exit 1
fi
""", newline="\n")
        self.service.chmod(0o755)

    def install(self, **extra):
        options = dict(CAR_INSTALL_ROOT=self.root, CAR_INSTALL_SERVICE=self.service,
                       CAR_INSTALL_TEST_LOG=self.log,
                       CAR_INSTALL_FAIL_START="0")
        options.update(extra)
        env = shell_env(**options)
        return subprocess.run([SH, str(CAMERA / "install-camera.sh"), str(self.source)],
                              capture_output=True, text=True, env=env, timeout=10)

    def contents(self, prefix):
        for name, relative in FILES.items():
            self.assertEqual((self.root / relative).read_text(), f"{prefix}:{name}\n")

    def test_success_replaces_all_files_after_stop(self):
        result = self.install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.contents("new")
        self.assertEqual(self.log.read_text().splitlines(), ["stop", "start"])
        self.assertFalse(self.lock.exists())

    def test_missing_upload_file_does_not_stop_existing_controller(self):
        (self.source / "car.js").unlink()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing deployment file: car.js", result.stderr)
        self.contents("old")
        self.assertFalse(self.log.exists())

    def test_staging_copy_failure_does_not_stop_existing_controller(self):
        (self.root / "var/www/car/car.css.wyze-car-new").mkdir()
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.contents("old")
        self.assertFalse(self.log.exists())
        self.assertFalse(self.lock.exists())

    def test_failed_start_restores_previous_files_and_service(self):
        result = self.install(CAR_INSTALL_FAIL_START="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("previous files restored", result.stderr)
        self.contents("old")
        self.assertEqual(self.log.read_text().splitlines(), ["stop", "start", "stop", "start"])
        self.assertFalse(self.lock.exists())


if __name__ == "__main__":
    unittest.main()
