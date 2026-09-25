#!/bin/sh
# Run on the camera after uploading the project to /tmp/wyze-car-deploy.
set -eu

SOURCE=/tmp/wyze-car-deploy
[ -f "$SOURCE/car-daemon.sh" ]
[ -f "$SOURCE/car.cgi" ]
[ -f "$SOURCE/S95wyze-car" ]
[ -f "$SOURCE/index.html" ]
[ -f "$SOURCE/car.css" ]
[ -f "$SOURCE/car.js" ]
[ -f /var/www/x/auth.sh ]
probe_file=$(mktemp /tmp/wyze-car-random.XXXXXX)
trap 'rm -f "$probe_file"' EXIT
dd if=/dev/urandom of="$probe_file" bs=32 count=1 2>/dev/null
probe_size=$(wc -c < "$probe_file")
token_probe=$(sha256sum "$probe_file")
token_probe=${token_probe%% *}
[ "$probe_size" -eq 32 ] && [ "${#token_probe}" -eq 64 ] || {
    printf 'This Thingino build lacks the required random-byte tools.\n' >&2
    exit 1
}
rm -f "$probe_file"
trap - EXIT

mkdir -p /opt/wyze-car /var/www/car /var/www/x /etc/init.d
if [ -x /etc/init.d/S95wyze-car ]; then
    /etc/init.d/S95wyze-car stop
fi

cp "$SOURCE/car-daemon.sh" /opt/wyze-car/car-daemon.sh
cp "$SOURCE/car.cgi" /var/www/x/car.cgi
cp "$SOURCE/S95wyze-car" /etc/init.d/S95wyze-car
cp "$SOURCE/index.html" /var/www/car/index.html
cp "$SOURCE/car.css" /var/www/car/car.css
cp "$SOURCE/car.js" /var/www/car/car.js
chmod 700 /opt/wyze-car/car-daemon.sh
chmod 755 /var/www/x/car.cgi
chmod 755 /etc/init.d/S95wyze-car
chmod 644 /var/www/car/index.html /var/www/car/car.css /var/www/car/car.js

/etc/init.d/S95wyze-car start
printf 'Installed. Open http://<camera-address>/car/ after logging in to Thingino.\n'
