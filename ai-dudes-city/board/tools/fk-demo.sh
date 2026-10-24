#!/usr/bin/env bash
# Start or stop a lane's demo server (Finders Keepers board, BOARD.md -> Worktrees and demo servers).
#   board/tools/fk-demo.sh <a|b|c|d|e|p|s>        start in tmux session fk-demo-<lane>
#   board/tools/fk-demo.sh <a|b|c|d|e|p|s> stop   stop it (frees its slot)
# Lane S (sound) has no port of its own: `s` borrows one of the two slots on 4616 when it needs a server.
# Fixtures on, Kick off, Kick replies off, the lane's own port and data dir, under nice.
# At most two demo servers run at once: each holds one of two slot locks for as long as it runs.
set -euo pipefail
lane=${1:-}; action=${2:-start}
case $lane in
  a) port=4611 ;; b) port=4612 ;; c) port=4613 ;; d) port=4614 ;; e) port=4615 ;; p) port=4610 ;; s) port=4616 ;;
  *) echo "usage: $0 <a|b|c|d|e|p|s> [stop]" >&2; exit 2 ;;
esac
wt=/home/sami/workspace/fk-wt/$lane/ai-dudes-city
sess=fk-demo-$lane
if [[ $action == stop ]]; then
  tmux kill-session -t "$sess" 2>/dev/null && echo "$sess stopped" || echo "$sess was not running"
  exit 0
fi
[[ -d $wt ]] || { echo "no worktree at $wt (the coordinator sets them up)" >&2; exit 1; }
if tmux has-session -t "$sess" 2>/dev/null; then echo "$sess is already up on http://localhost:$port"; exit 0; fi
for slot in 1 2; do
  lock=/tmp/fk-demo-$slot.lock
  if flock -n "$lock" true; then
    tmux new -d -s "$sess" "export PATH=\$HOME/.local/bin:\$PATH; cd $wt && flock $lock env DUDES_FIXTURES=1 KICK_DISABLED=true KICK_REPLIES_ENABLED=false DATA_DIR=data/demo-$lane PORT=$port nice -n 10 npm start 2>&1 | tee -a /tmp/fk-demo-$lane.log"
    echo "$sess starting on http://localhost:$port (slot $slot, log /tmp/fk-demo-$lane.log); stop with: $0 $lane stop"
    exit 0
  fi
done
echo "two demo servers are already up (tmux ls | grep fk-demo): stop one or wait" >&2
exit 3
