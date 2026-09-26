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
ssh "$SSH_TARGET" 'mkdir -p /tmp/wyze-car-deploy'
scp -O camera/car-daemon.sh camera/car.cgi camera/S95wyze-car \
    camera/install-camera.sh web/index.html web/car.css web/car.js web/car-mark.svg \
    "$SSH_TARGET:/tmp/wyze-car-deploy/"
ssh "$SSH_TARGET" 'sh /tmp/wyze-car-deploy/install-camera.sh'

printf 'Open http://%s/car/ and log in to Thingino.\n' "$CAMERA_IP"
