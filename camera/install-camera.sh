#!/bin/sh
# Run on the camera after uploading the project to a temporary directory.
set -eu
umask 077

SOURCE=${1:-/tmp/wyze-car-deploy}
ROOT=${CAR_INSTALL_ROOT:-}
SERVICE=${CAR_INSTALL_SERVICE:-${ROOT}/etc/init.d/S95wyze-car}
TEMP_ROOT=${ROOT}/tmp
LOCK_DIR=$TEMP_ROOT/wyze-car-install.lock

set -- \
    'car-daemon.sh|/opt/wyze-car/car-daemon.sh|700' \
    'car.cgi|/var/www/x/car.cgi|755' \
    'S95wyze-car|/etc/init.d/S95wyze-car|755' \
    'index.html|/var/www/car/index.html|644' \
    'car.css|/var/www/car/car.css|644' \
    'car.js|/var/www/car/car.js|644' \
    'car-logo.svg|/var/www/car/car-logo.svg|644' \
    'car-logo.js|/var/www/car/car-logo.js|644'

for spec do
    name=${spec%%|*}
    [ -f "$SOURCE/$name" ] || {
        printf 'Missing deployment file: %s\n' "$name" >&2
        exit 1
    }
done
[ -f "${ROOT}/var/www/x/auth.sh" ] || {
    printf 'Thingino auth.sh was not found.\n' >&2
    exit 1
}

mkdir -p "$TEMP_ROOT"
probe_file=$(mktemp "$TEMP_ROOT/wyze-car-random.XXXXXX")
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

mkdir "$LOCK_DIR" 2>/dev/null || {
    printf 'Another installation is running, or an interrupted install left a lock. Reboot the camera before retrying.\n' >&2
    exit 1
}
BACKUP=$(mktemp -d "$TEMP_ROOT/wyze-car-backup.XXXXXX") || {
    rm -rf "$LOCK_DIR"
    exit 1
}
# Confirm the generated backup is a child of the intended temporary directory
# before any recursive cleanup (also when tests run on Windows through Git Bash).
TEMP_ROOT_RESOLVED=$(cd "$TEMP_ROOT" && pwd -P)
BACKUP_PARENT_RESOLVED=$(cd "$BACKUP/.." && pwd -P)
BACKUP_ID=${BACKUP##*/}
safe_backup=1
case "$BACKUP_ID" in wyze-car-backup.*) ;; *) safe_backup=0 ;; esac
case "${BACKUP_ID#wyze-car-backup.}" in ''|*[!A-Za-z0-9]*) safe_backup=0 ;; esac
[ "$BACKUP_PARENT_RESOLVED" = "$TEMP_ROOT_RESOLVED" ] || safe_backup=0
if [ "$safe_backup" -ne 1 ]; then
    printf 'Temporary backup path is invalid; installation was not started.\n' >&2
    rm -rf "$LOCK_DIR"
    exit 1
fi
stopped=0
had_service=0
keep_backup=0

cleanup() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$result" -ne 0 ] && [ "$stopped" -eq 1 ]; then
        # Never replace files beneath a daemon that may still be running.
        if [ -x "$SERVICE" ] && ! "$SERVICE" stop; then
            printf 'Rollback could not stop the controller; do not drive. Temporary backup: %s\n' "$BACKUP" >&2
            keep_backup=1
        else
            restored=1
            for spec do
                name=${spec%%|*}
                rest=${spec#*|}
                dest=${rest%%|*}
                target=${ROOT}${dest}
                if [ -f "$BACKUP/$name.absent" ]; then
                    rm -f "$target" || restored=0
                elif [ -f "$BACKUP/$name" ]; then
                    cp -p "$BACKUP/$name" "$target.wyze-car-restore" &&
                        mv -f "$target.wyze-car-restore" "$target" || restored=0
                else
                    restored=0
                fi
            done
            if [ "$restored" -eq 1 ]; then
                if [ "$had_service" -eq 1 ]; then
                    "$SERVICE" start || printf 'Previous controller could not be restarted.\n' >&2
                fi
                printf 'Installation failed; previous files restored.\n' >&2
            else
                printf 'Rollback was incomplete; do not drive. Temporary backup: %s\n' "$BACKUP" >&2
                keep_backup=1
            fi
        fi
    fi
    for spec do
        rest=${spec#*|}
        dest=${rest%%|*}
        rm -f "${ROOT}${dest}.wyze-car-new" "${ROOT}${dest}.wyze-car-restore" || :
    done
    if [ "$keep_backup" -eq 0 ]; then
        rm -rf "$BACKUP" || :
    fi
    rm -rf "$LOCK_DIR" || :
    exit "$result"
}
trap 'cleanup "$@"' EXIT
trap 'exit 1' HUP INT TERM

mkdir -p "${ROOT}/opt/wyze-car" "${ROOT}/var/www/car" "${ROOT}/var/www/x" "${ROOT}/etc/init.d"

# Prepare every replacement and backup before stopping the running controller.
for spec do
    name=${spec%%|*}
    rest=${spec#*|}
    dest=${rest%%|*}
    mode=${rest#*|}
    target=${ROOT}${dest}
    rm -f "$target.wyze-car-new"
    cp "$SOURCE/$name" "$target.wyze-car-new"
    chmod "$mode" "$target.wyze-car-new"
    if [ -e "$target" ]; then
        cp -p "$target" "$BACKUP/$name"
    else
        : > "$BACKUP/$name.absent"
    fi
done

if [ -x "$SERVICE" ]; then
    "$SERVICE" stop
    had_service=1
fi
stopped=1
for spec do
    rest=${spec#*|}
    dest=${rest%%|*}
    target=${ROOT}${dest}
    mv -f "$target.wyze-car-new" "$target"
done
"$SERVICE" start
printf 'Installed. Open http://<camera-address>/car/ after logging in to Thingino.\n'
