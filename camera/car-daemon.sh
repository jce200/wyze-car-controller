#!/bin/sh
# Wyze Car motor loop for Thingino. Keep this process as the only writer to
# the Car's CP210x serial port. State lives in /tmp, never in flash.

STATE_DIR=${CAR_STATE_DIR:-/tmp/wyze-car-controller}
DEVICE=${CAR_DEVICE:-/dev/ttyUSB0}
TEST_MODE=${CAR_TEST_MODE:-0}
DEADMAN_TICKS=45  # /proc/uptime centiseconds: stop after 450 ms.
LOCK_DIR=$STATE_DIR/daemon.lock

umask 077
mkdir -p "$STATE_DIR" || exit 1

# A pre-existing lock is treated as active, even without a PID. That can
# require a manual restart after SIGKILL, but never permits two serial writers.
mkdir "$LOCK_DIR" 2>/dev/null || exit 1
printf '%s\n' "$$" > "$LOCK_DIR/pid"

ticks_now() {
    read -r uptime ignored < /proc/uptime || return 1
    seconds=${uptime%%.*}
    hundredths=${uptime#*.}
    hundredths=${hundredths#0}
    [ -n "$hundredths" ] || hundredths=0
    NOW=$((seconds * 100 + hundredths))
}

# Frames are from Thingino's wyze-accessory/car_control. The last byte is
# the 8-bit checksum. Octal escapes work with both BusyBox ash and POSIX sh.
drive_frame() {
    case "$1,$2,$3" in
        0,0,*)  printf '\252\125\103\006\051\200\200\000\002\161' ;;
        0,1,slow)  printf '\252\125\103\006\051\200\312\000\002\273' ;;
        0,1,fast)  printf '\252\125\103\006\051\200\343\000\002\324' ;;
        0,-1,slow) printf '\252\125\103\006\051\200\073\000\002\054' ;;
        0,-1,fast) printf '\252\125\103\006\051\200\066\000\002\047' ;;
        -1,0,*) printf '\252\125\103\006\051\166\201\000\002\150' ;;
        1,0,*)  printf '\252\125\103\006\051\212\201\000\002\174' ;;
        -1,1,slow)  printf '\252\125\103\006\051\166\312\000\002\261' ;;
        -1,1,fast)  printf '\252\125\103\006\051\166\343\000\002\312' ;;
        1,1,slow)   printf '\252\125\103\006\051\212\312\000\002\305' ;;
        1,1,fast)   printf '\252\125\103\006\051\212\343\000\002\336' ;;
        -1,-1,slow) printf '\252\125\103\006\051\166\073\000\002\042' ;;
        -1,-1,fast) printf '\252\125\103\006\051\166\066\000\002\035' ;;
        1,-1,slow)  printf '\252\125\103\006\051\212\073\000\002\066' ;;
        1,-1,fast)  printf '\252\125\103\006\051\212\066\000\002\061' ;;
        *)          printf '\252\125\103\006\051\200\200\000\002\161' ;;
    esac
}

device_ready() {
    [ -c "$DEVICE" ] || { [ "$TEST_MODE" = 1 ] && [ -f "$DEVICE" ]; }
}

remove_ghost_port() {
    # A shell redirection can create a file if USB vanishes between -c and
    # open(). Remove that file immediately so CP210x can reappear on replug.
    if [ "$TEST_MODE" != 1 ] && [ "$DEVICE" = /dev/ttyUSB0 ] && [ -f "$DEVICE" ]; then
        rm -f "$DEVICE"
        return 1
    fi
}

send_drive() {
    device_ready || return 1
    drive_frame "$1" "$2" "$3" > "$DEVICE"
    write_result=$?
    remove_ghost_port || write_result=1
    return "$write_result"
}

send_lights() {
    device_ready || return 1
    case "$1" in
        1) printf '\252\125\103\004\036\001\001\145' > "$DEVICE" ;;
        0) printf '\252\125\103\004\036\002\001\146' > "$DEVICE" ;;
        *) return 1 ;;
    esac
    write_result=$?
    remove_ghost_port || write_result=1
    return "$write_result"
}

cleanup() {
    trap - EXIT HUP INT TERM
    send_drive 0 0 slow 2>/dev/null || :
    # BusyBox ash can spin in builtin read when EXIT follows a signal trap.
    owner=$(cat "$LOCK_DIR/pid" 2>/dev/null) || owner=0
    if [ "$owner" = "$$" ]; then
        rm -f "$STATE_DIR/pid" "$STATE_DIR/heartbeat"
        # Some Thingino builds provide rm but omit the rmdir applet.
        rm -rf "$LOCK_DIR"
    fi
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM

printf '%s\n' "$$" > "$STATE_DIR/pid"
ticks_now || exit 1
printf '%s\n' 'boot' > "$STATE_DIR/global-stop"
printf '%s\n' 'none boot' > "$STATE_DIR/session"
last_lights=''
was_connected=0

while :; do
    ticks_now || exit 1
    printf '%s\n' "$NOW" > "$STATE_DIR/.heartbeat.$$"
    mv -f "$STATE_DIR/.heartbeat.$$" "$STATE_DIR/heartbeat"

    if device_ready; then
        if [ "$was_connected" -eq 0 ]; then
            was_connected=1
            last_lights=''
        fi

        drive_stamp=0 drive_token='' steer=0 throttle=0 speed=slow drive_seq=0
        session='none' session_epoch='boot' stop_epoch='boot'
        [ -f "$STATE_DIR/drive" ] && read -r drive_stamp drive_token steer throttle speed drive_seq < "$STATE_DIR/drive"
        [ -f "$STATE_DIR/session" ] && read -r session session_epoch < "$STATE_DIR/session"
        [ -f "$STATE_DIR/global-stop" ] && read -r stop_epoch < "$STATE_DIR/global-stop"
        case "$drive_stamp" in ''|*[!0-9]*) drive_stamp=0 ;; esac
        # A request may arrive after this loop's heartbeat was sampled.
        ticks_now || exit 1
        age=$((NOW - drive_stamp))
        serial_ok=1
        if [ -n "$session" ] && [ "$drive_token" = "$session" ] && [ "$session" != none ] &&
           [ "$session_epoch" = "$stop_epoch" ] &&
           [ "$age" -ge 0 ] && [ "$age" -lt "$DEADMAN_TICKS" ]; then
            send_drive "$steer" "$throttle" "$speed" 2>/dev/null || serial_ok=0
        else
            send_drive 0 0 slow 2>/dev/null || serial_ok=0
        fi

        lights_stamp=0 lights_on=0
        [ -f "$STATE_DIR/lights" ] && read -r lights_stamp lights_on < "$STATE_DIR/lights"
        case "$lights_on" in 0|1) ;; *) lights_on=0 ;; esac
        lights_state="$lights_stamp:$lights_on"
        if [ "$lights_state" != "$last_lights" ]; then
            if send_lights "$lights_on" 2>/dev/null; then
                last_lights=$lights_state
            else
                serial_ok=0
            fi
        fi
        if [ "$serial_ok" -eq 1 ]; then
            rm -f "$STATE_DIR/serial-error"
        else
            : > "$STATE_DIR/serial-error"
        fi
    else
        was_connected=0
        : > "$STATE_DIR/serial-error"
    fi

    sleep 0.1
done
