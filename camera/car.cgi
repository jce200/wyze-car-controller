#!/bin/sh
# Protected same-origin API for the Wyze Car controller.

. "${CAR_AUTH_FILE:-/var/www/x/auth.sh}"
require_auth
set -f

STATE_DIR=${CAR_STATE_DIR:-/tmp/wyze-car-controller}
DEVICE=${CAR_DEVICE:-/dev/ttyUSB0}
TEST_MODE=${CAR_TEST_MODE:-0}
umask 077

reply() {
    printf 'Status: %s\r\n' "$1"
    printf 'Content-Type: application/json\r\n'
    printf 'Cache-Control: no-store\r\n'
    printf 'X-Content-Type-Options: nosniff\r\n\r\n'
    printf '%s\n' "$2"
    exit 0
}

bad_request() { reply '400 Bad Request' '{"ok":false,"message":"Invalid control request"}'; }

ticks_now() {
    read -r uptime ignored < /proc/uptime || return 1
    seconds=${uptime%%.*}
    hundredths=${uptime#*.}
    hundredths=${hundredths#0}
    [ -n "$hundredths" ] || hundredths=0
    CLOCK_TICKS=$((seconds * 100 + hundredths))
}

read_number_file() {
    VALUE=0
    if [ -f "$1" ]; then
        read -r VALUE < "$1" || VALUE=0
    fi
    case "$VALUE" in ''|*[!0-9]*) VALUE=0 ;; esac
}

device_ready() {
    [ -c "$DEVICE" ] || { [ "$TEST_MODE" = 1 ] && [ -f "$DEVICE" ]; }
}

controller_connected() {
    device_ready || return 1
    [ ! -e "$STATE_DIR/serial-error" ] || return 1
    [ -f "$STATE_DIR/pid" ] || return 1
    read_number_file "$STATE_DIR/pid"
    [ "$VALUE" -gt 1 ] && kill -0 "$VALUE" 2>/dev/null || return 1
    read_number_file "$STATE_DIR/heartbeat"
    # Sample after the heartbeat: it can advance while a request is parsed.
    # Keep NOW as the receipt time so delayed drive requests stay expired.
    ticks_now || return 1
    heartbeat_age=$((CLOCK_TICKS - VALUE))
    [ "$heartbeat_age" -ge 0 ] && [ "$heartbeat_age" -lt 100 ]
}

valid_token() {
    [ "${#token}" -eq 64 ] || return 1
    case "$token" in *[!0-9a-f]*) return 1 ;; esac
}

random_token() {
    mkdir -p "$STATE_DIR" || return 1
    random_file=$(mktemp "$STATE_DIR/.random.XXXXXX") || return 1
    if ! dd if=/dev/urandom of="$random_file" bs=32 count=1 2>/dev/null; then
        rm -f "$random_file"
        return 1
    fi
    random_size=$(wc -c < "$random_file") || {
        rm -f "$random_file"
        return 1
    }
    if [ "$random_size" -ne 32 ]; then
        rm -f "$random_file"
        return 1
    fi
    RANDOM_TOKEN=$(sha256sum "$random_file" 2>/dev/null) || {
        rm -f "$random_file"
        return 1
    }
    rm -f "$random_file"
    RANDOM_TOKEN=${RANDOM_TOKEN%% *}
    [ "${#RANDOM_TOKEN}" -eq 64 ] || return 1
    case "$RANDOM_TOKEN" in *[!0-9a-f]*) return 1 ;; esac
}

write_state() {
    mkdir -p "$STATE_DIR" || return 1
    temp=$(mktemp "$STATE_DIR/.$1.XXXXXX") || return 1
    if ! printf '%s\n' "$2" > "$temp" || ! mv -f "$temp" "$STATE_DIR/$1"; then
        rm -f "$temp"
        return 1
    fi
}

ticks_now || reply '500 Internal Server Error' '{"ok":false,"message":"Clock unavailable"}'
NOW=$CLOCK_TICKS

case "$REQUEST_METHOD" in
    GET)
        [ "$QUERY_STRING" = 'action=status' ] || bad_request
        connected=false armed=false lights=false age_json=null
        message='Wyze Car USB device not found'
        if device_ready; then
            message='Controller is not running'
            if [ -e "$STATE_DIR/serial-error" ]; then
                message='USB write error'
            elif controller_connected; then
                connected=true
                message='Ready to drive'
            fi
        fi

        drive_stamp=0 drive_token='' steer=0 throttle=0 speed=slow
        session='none' session_epoch='boot' stop_epoch='boot'
        if [ -f "$STATE_DIR/drive" ]; then
            read -r drive_stamp drive_token steer throttle speed < "$STATE_DIR/drive"
        fi
        [ -f "$STATE_DIR/session" ] && read -r session session_epoch < "$STATE_DIR/session"
        [ -f "$STATE_DIR/global-stop" ] && read -r stop_epoch < "$STATE_DIR/global-stop"
        case "$drive_stamp" in ''|*[!0-9]*) drive_stamp=0 ;; esac
        if [ "$drive_stamp" -gt 0 ]; then
            age=$((NOW - drive_stamp))
            [ "$age" -ge 0 ] && age_json=$((age * 10))
            if [ "$connected" = true ] && [ "$drive_token" = "$session" ] &&
               [ "$session" != none ] && [ "$session_epoch" = "$stop_epoch" ] &&
               [ "$age" -ge 0 ] && [ "$age" -lt 45 ] &&
               { [ "$steer" != 0 ] || [ "$throttle" != 0 ]; }; then
                armed=true
            fi
        fi
        lights_stamp=0 lights_on=0
        if [ -f "$STATE_DIR/lights" ]; then
            read -r lights_stamp lights_on < "$STATE_DIR/lights"
        fi
        [ "$lights_on" = 1 ] && lights=true
        reply '200 OK' "{\"ok\":true,\"connected\":$connected,\"armed\":$armed,\"lights\":$lights,\"lastCommandAgeMs\":$age_json,\"device\":\"$DEVICE\",\"message\":\"$message\"}"
        ;;
    POST)
        # uhttpd forwards Content-Type but may omit arbitrary X-* CGI headers.
        # Both accepted markers require a CORS preflight from another origin.
        # Never accept the safelisted types sent by cross-origin HTML forms.
        if [ "$HTTP_X_CAR_CONTROL" != 1 ] &&
           [ "$CONTENT_TYPE" != application/x-wyze-car-control ]; then
            reply '403 Forbidden' '{"ok":false,"message":"Missing control request marker; refresh the controller page"}'
        fi
        case "$CONTENT_LENGTH" in ''|*[!0-9]*) bad_request ;; esac
        [ "$CONTENT_LENGTH" -gt 0 ] && [ "$CONTENT_LENGTH" -le 160 ] || bad_request
        body=$(dd bs=1 count="$CONTENT_LENGTH" 2>/dev/null) || bad_request
        action='' steer='' throttle='' speed='' on='' token=''
        previous_ifs=$IFS
        IFS='&'
        for field in $body; do
            case "$field" in
                action=*) [ -z "$action" ] || bad_request; action=${field#action=} ;;
                steer=*) [ -z "$steer" ] || bad_request; steer=${field#steer=} ;;
                throttle=*) [ -z "$throttle" ] || bad_request; throttle=${field#throttle=} ;;
                speed=*) [ -z "$speed" ] || bad_request; speed=${field#speed=} ;;
                on=*) [ -z "$on" ] || bad_request; on=${field#on=} ;;
                token=*) [ -z "$token" ] || bad_request; token=${field#token=} ;;
                *) bad_request ;;
            esac
        done
        IFS=$previous_ifs

        case "$action" in
            arm)
                [ -z "$steer$throttle$speed$on$token" ] || bad_request
                controller_connected || reply '503 Service Unavailable' '{"ok":false,"message":"Wyze Car or controller unavailable"}'
                random_token || reply '500 Internal Server Error' '{"ok":false,"message":"Session token unavailable"}'
                token=$RANDOM_TOKEN
                stop_epoch='boot'
                [ -f "$STATE_DIR/global-stop" ] && read -r stop_epoch < "$STATE_DIR/global-stop"
                write_state session "$token $stop_epoch" ||
                    reply '500 Internal Server Error' '{"ok":false,"message":"Could not start control session"}'
                reply '200 OK' "{\"ok\":true,\"token\":\"$token\"}"
                ;;
            drive)
                [ -z "$on" ] || bad_request
                valid_token || bad_request
                case "$steer" in -1|0|1) ;; *) bad_request ;; esac
                case "$throttle" in -1|0|1) ;; *) bad_request ;; esac
                case "$speed" in slow|fast) ;; *) bad_request ;; esac
                controller_connected || reply '503 Service Unavailable' '{"ok":false,"message":"Wyze Car or controller unavailable"}'
                session='none' session_epoch='boot' stop_epoch='boot'
                [ -f "$STATE_DIR/session" ] && read -r session session_epoch < "$STATE_DIR/session"
                [ -f "$STATE_DIR/global-stop" ] && read -r stop_epoch < "$STATE_DIR/global-stop"
                if [ "$token" != "$session" ] || [ "$session_epoch" != "$stop_epoch" ]; then
                    reply '409 Conflict' '{"ok":false,"message":"Control session ended"}'
                fi
                write_state drive "$NOW $token $steer $throttle $speed" ||
                    reply '500 Internal Server Error' '{"ok":false,"message":"Could not save drive command"}'
                reply '200 OK' '{"ok":true}'
                ;;
            stop)
                [ -z "$steer$throttle$speed$on" ] || bad_request
                [ -z "$token" ] || valid_token || bad_request
                random_token || reply '500 Internal Server Error' '{"ok":false,"message":"Stop token unavailable"}'
                write_state global-stop "$RANDOM_TOKEN" ||
                    reply '500 Internal Server Error' '{"ok":false,"message":"Could not save stop command"}'
                reply '200 OK' '{"ok":true}'
                ;;
            lights)
                [ -z "$steer$throttle$speed$token" ] || bad_request
                case "$on" in 0|1) ;; *) bad_request ;; esac
                controller_connected || reply '503 Service Unavailable' '{"ok":false,"message":"Wyze Car or controller unavailable"}'
                write_state lights "$NOW $on" ||
                    reply '500 Internal Server Error' '{"ok":false,"message":"Could not save lights command"}'
                reply '200 OK' '{"ok":true}'
                ;;
            *) bad_request ;;
        esac
        ;;
    *) reply '405 Method Not Allowed' '{"ok":false,"message":"Unsupported method"}' ;;
esac
