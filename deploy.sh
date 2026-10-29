#!/bin/sh
# Copy and install the controller on a Thingino camera using OpenSSH.
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
    printf 'Usage: sh deploy.sh CAMERA_IP [SSH_USER]\n' >&2
    exit 2
fi

CAMERA_IP=$1
SSH_USER=${2:-root}
SSH_TARGET=$SSH_USER@$CAMERA_IP
PROJECT_ROOT=$(CDPATH= cd "$(dirname "$0")" && pwd)

cd "$PROJECT_ROOT"
UPLOAD_DIR=$(ssh "$SSH_TARGET" 'mktemp -d /tmp/wyze-car-deploy.XXXXXX')
case "$UPLOAD_DIR" in /tmp/wyze-car-deploy.*) ;; *)
    printf 'Camera did not return a safe upload directory.\n' >&2
    exit 1
    ;;
esac
UPLOAD_ID=${UPLOAD_DIR#/tmp/wyze-car-deploy.}
case "$UPLOAD_ID" in ''|*[!A-Za-z0-9]*)
    printf 'Camera did not return a safe upload directory.\n' >&2
    exit 1
    ;;
esac
printf 'Upload directory on camera: %s\n' "$UPLOAD_DIR"
scp -O camera/car-daemon.sh camera/car.cgi camera/S95wyze-car \
    camera/install-camera.sh web/index.html web/car.css web/car.js web/car-logo.svg web/car-logo.js \
    "$SSH_TARGET:$UPLOAD_DIR/"
ssh "$SSH_TARGET" "sh $UPLOAD_DIR/install-camera.sh $UPLOAD_DIR"

printf 'Open http://%s/car/ and log in to Thingino.\n' "$CAMERA_IP"
