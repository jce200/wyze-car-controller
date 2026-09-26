#!/usr/bin/env python3
"""Build deterministic installation archives from one Git commit (Python 3.10+)."""

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import zipfile


PAYLOAD = (
    'README.md', 'INSTALL.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'deploy.ps1', 'deploy.sh',
    'camera/car-daemon.sh', 'camera/car.cgi', 'camera/S95wyze-car',
    'camera/install-camera.sh',
    'web/index.html', 'web/car.css', 'web/car.js',
    'web/car-logo.svg', 'web/car-logo.js',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True, help='Release tag, e.g. v0.1.0')
    parser.add_argument('--ref', default='HEAD', help='Git commit or tag to package')
    parser.add_argument('--output', type=Path, default=Path('dist'))
    args = parser.parse_args()
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', args.version):
        parser.error('--version must be a version tag such as v0.1.0')
    repo = Path(__file__).resolve().parents[1]

    def git(*argv):
        return subprocess.check_output(['git', '-C', str(repo), *argv])

    commit = git('rev-parse', '--verify', args.ref + '^{commit}').decode().strip()
    # Read committed blobs, so local files, secrets, and old logos cannot leak in.
    files = {name: git('show', f'{commit}:{name}') for name in PAYLOAD}
    for name, data in files.items():
        if name.startswith('camera/') or name == 'deploy.sh':
            if b'\r' in data:
                raise SystemExit(f'{name}: shell files must use LF line endings')
    files['VERSION'] = (args.version + '\n').encode()
    files['BUILDINFO.json'] = (json.dumps({
        'version': args.version,
        'commit': commit,
        'repository': 'https://github.com/jce200/wyze-car-controller',
    }, indent=2) + '\n').encode()
    root = 'wyze-car-controller-' + args.version
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archives = [output / (root + '.zip'), output / (root + '.tar.gz')]

    def mode(name):
        return 0o755 if name.startswith('camera/') or name == 'deploy.sh' else 0o644

    with zipfile.ZipFile(archives[0], 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(root + '/' + name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100000 | mode(name)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    with archives[1].open('wb') as raw:
        with gzip.GzipFile(fileobj=raw, filename='', mode='wb', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
                for name, data in sorted(files.items()):
                    info = tarfile.TarInfo(root + '/' + name)
                    info.size = len(data)
                    info.mode = mode(name)
                    info.mtime = 0
                    archive.addfile(info, io.BytesIO(data))

    # Re-open both formats and compare every entry with the committed payload.
    expected = {root + '/' + name: data for name, data in files.items()}
    with zipfile.ZipFile(archives[0]) as archive:
        assert set(archive.namelist()) == set(expected)
        assert archive.testzip() is None
        assert all(archive.read(name) == data for name, data in expected.items())
    with tarfile.open(archives[1], 'r:gz') as archive:
        assert set(archive.getnames()) == set(expected)
        assert all(archive.extractfile(name).read() == data for name, data in expected.items())
        assert all(archive.getmember(root + '/' + name).mode == mode(name) for name in files)
    instructions = output / 'INSTALL.md'
    instructions.write_bytes(files['INSTALL.md'])
    sums = ''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n'
                   for path in [*archives, instructions])
    (output / 'SHA256SUMS').write_text(sums, encoding='ascii', newline='\n')
    print(f'Built {args.version} from {commit}: {len(files)} files per archive')
    print(sums, end='')


if __name__ == '__main__':
    main()
