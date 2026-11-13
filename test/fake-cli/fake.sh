#!/bin/sh
if [ -n "$FAKE_ARGS_FILE" ]; then printf '%s\n' "$@" > "$FAKE_ARGS_FILE"; fi
if [ -n "$FAKE_INPUT_FILE" ]; then /bin/cat > "$FAKE_INPUT_FILE"; else /bin/cat >/dev/null; fi
if [ -n "$FAKE_CHILD_PID_FILE" ]; then
  /bin/sh -c 'trap "" TERM; while :; do /bin/sleep 1; done' &
  echo "$!" > "$FAKE_CHILD_PID_FILE"
fi
if [ -n "$FAKE_TICKS" ]; then
  count=0
  while [ "$count" -lt "$FAKE_TICKS" ]; do
    printf '.'
    /bin/sleep "${FAKE_TICK_SLEEP:-0.1}"
    count=$((count + 1))
  done
  printf '\n'
fi
if [ -n "$FAKE_SLEEP" ]; then /bin/sleep "$FAKE_SLEEP"; fi
if [ -n "$FAKE_FIXTURE" ]; then /bin/cat "$FAKE_FIXTURE"; fi
if [ "$FAKE_HANG" = "1" ]; then
  while :; do /bin/sleep 1; done
fi
if [ "$FAKE_REMOVE_LAST" = "1" ]; then
  remove_next=0
  for arg in "$@"; do
    if [ "$remove_next" = "1" ]; then /bin/rm -f "$arg"; break; fi
    if [ "$arg" = "--output-last-message" ]; then remove_next=1; fi
  done
fi
exit "${FAKE_EXIT:-0}"
