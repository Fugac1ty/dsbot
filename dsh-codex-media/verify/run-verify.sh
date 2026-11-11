#!/usr/bin/env bash
# dsh-codex-media — isolated DSH profile integration verification.
#
# Proves that this plugin's bundle is really loaded by the real `dsh`
# installation inside a throwaway DSH_HOME confined to this repository's
# verify/ directory, and that BOTH tools are registered in the live tool
# registry (`codex_imagegen`, `codex_vision`).
#
# Evidence collected:
#   1. `--dump-config` composition contains the bundle entry.
#   2. A real `dsh --profile web` boot on 127.0.0.1:3199 prints the plugin's
#      activation marker (console.log; ctx.logger.* is NOT visible on stdout).
#   3. A verify-only probe entry loads after the plugin and queries the real
#      `ctx.tools` registry for both tool names (+ ctx.tools.schemas()).
#   4. SIGTERM shuts the app down; no process residue and the port is released.
#   5. Negative control: a broken copy of the plugin makes boot print a clear
#      "did not activate / failed to import" diagnostic (plugin files untouched).
#
# It NEVER touches the production DSH_HOME (/home/ubuntu/dsh-agentchat/dsh-0.2-home)
# and NEVER uses the production port 3102.
#
# Usage:
#   ./verify/run-verify.sh                  # dump-config + real boot + probe
#   ./verify/run-verify.sh --reset          # wipe verify/.dsh-home first, then the above
#   ./verify/run-verify.sh --with-negative  # also run the broken-plugin negative control
#   ./verify/run-verify.sh --negative-only  # only the negative control (harness self-check)
#   ./verify/run-verify.sh --dump-only      # only the config-composition steps (no boot)
#   ./verify/run-verify.sh --no-probe       # boot without the registry probe entry
#
# Env overrides (defaults match the current plugin):
#   BUNDLE_NAME=dsh-codex-media BUNDLE_ID=dsh-codex-media
#   TOOL_NAMES="codex_imagegen codex_vision"
#   MARKER_ENV=DSH_CODEX_MEDIA_BOOT_MARKER
#   BOOT_PORT=3199
#
# Exit code: 0 = every selected check passed, 1 = at least one check failed.

set -uo pipefail

# ---- layout (derived from this script, so a repository rename keeps working) --
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$PLUGIN"
DSH_BIN="${DSH_BIN:-/home/ubuntu/dsh-agentchat/dsh-0.2-trial/node_modules/@deepseek-ai/dsh/lib/bin.js}"
PROD_DSH_HOME="/home/ubuntu/dsh-agentchat/dsh-0.2-home"

# ---- isolated harness -------------------------------------------------------
export DSH_HOME="$SCRIPT_DIR/.dsh-home"
PROFILE_DIR="$DSH_HOME/profiles/web"
PROFILE_PKG="$PROFILE_DIR/package.json"
PROFILE_MODULES="$PROFILE_DIR/node_modules"
PROFILE_PATCH="$PROFILE_DIR/cordis.patch.yml"
PROBE_SRC="$PROFILE_DIR/verify-probe.mjs"
PROBE_BACKUP="$SCRIPT_DIR/.probe-patch.bak"
BROKEN_PLUGIN="$SCRIPT_DIR/.broken-plugin"
LOGDIR="$SCRIPT_DIR/logs"
PORT="${BOOT_PORT:-3199}"
HOST=127.0.0.1
BUNDLE_NAME="${BUNDLE_NAME:-dsh-codex-media}"
BUNDLE_ID="${BUNDLE_ID:-dsh-codex-media}"
TOOL_NAMES="${TOOL_NAMES:-codex_imagegen codex_vision}"
MARKER_ENV="${MARKER_ENV:-DSH_CODEX_MEDIA_BOOT_MARKER}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-90}"   # seconds, per the task budget

MODE="full"
WANT_PROBE=1
DO_RESET=0
for arg in "$@"; do
  case "$arg" in
    --with-negative) MODE="full-negative" ;;
    --negative-only) MODE="negative" ;;
    --dump-only)     MODE="dump" ;;
    --no-probe)      WANT_PROBE=0 ;;
    --reset)         DO_RESET=1 ;;
    -h|--help)       sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOGDIR"
FAILS=0
pass() { printf 'PASS  %s\n' "$*" | tee -a "$LOGDIR/summary.txt"; }
fail() { printf 'FAIL  %s\n' "$*" | tee -a "$LOGDIR/summary.txt"; FAILS=$((FAILS+1)); }
info() { printf 'INFO  %s\n' "$*" | tee -a "$LOGDIR/summary.txt"; }
: > "$LOGDIR/summary.txt"

# ---- safety guards ----------------------------------------------------------
guard() {
  case "$DSH_HOME" in
    "$PROD_DSH_HOME"|"$PROD_DSH_HOME"/*) echo "refusing to use production DSH_HOME" >&2; exit 2 ;;
  esac
  case "$SCRIPT_DIR" in "$PROD_DSH_HOME"*) echo "refusing to run from production DSH_HOME" >&2; exit 2 ;; esac
  if [ ! -f "$DSH_BIN" ]; then echo "dsh bin.js not found: $DSH_BIN" >&2; exit 2; fi
  if [ ! -f "$PLUGIN/package.json" ]; then echo "plugin package.json not found under $PLUGIN" >&2; exit 2; fi
  if ss -ltn 2>/dev/null | grep -qE "[:.]$PORT[[:space:]]"; then
    echo "port $PORT is already in use; refusing to interfere" >&2
    exit 2
  fi
}

# ---- helpers ----------------------------------------------------------------
run_dsh() { node "$DSH_BIN" "$@"; }

# A marker line must name the bundle AND every registered tool on one line.
find_marker_line() {
  local log="$1" line t ok
  while IFS= read -r line; do
    ok=1
    case "$line" in *"$BUNDLE_NAME"*) ;; *) ok=0 ;; esac
    if [ "$ok" = 1 ]; then
      for t in $TOOL_NAMES; do
        case "$line" in *"$t"*) ;; *) ok=0 ;; esac
      done
    fi
    if [ "$ok" = 1 ]; then printf '%s\n' "$line"; return 0; fi
  done < "$log"
  return 1
}

any_tool_line() { # any line naming at least one tool + the bundle
  local log="$1" line
  while IFS= read -r line; do
    case "$line" in *"$BUNDLE_NAME"*) ;; *) continue ;; esac
    for t in "$@"; do :; done
    for t in $TOOL_NAMES; do case "$line" in *"$t"*) printf '%s\n' "$line"; return 0 ;; esac; done
  done < "$log"
  return 1
}

ensure_profile() {
  if [ "$DO_RESET" = "1" ]; then
    case "$DSH_HOME" in
      "$SCRIPT_DIR"/*) info "resetting isolated DSH_HOME: $DSH_HOME" ; rm -rf "$DSH_HOME" ;;
      *) echo "refusing to reset DSH_HOME outside verify/: $DSH_HOME" >&2; exit 2 ;;
    esac
  fi
  mkdir -p "$DSH_HOME"
  if [ ! -f "$PROFILE_PKG" ]; then
    info "profile web missing; initializing baseline via --dump-config"
    run_dsh --profile web --dump-config > "$LOGDIR/00-baseline-dump.log" 2>&1 \
      || { fail "baseline --dump-config failed; see $LOGDIR/00-baseline-dump.log"; return 1; }
    pass "baseline profile web initialized (dump-config exit 0)"
  else
    info "profile web already initialized at $PROFILE_DIR"
  fi

  # bundles: drop any stale plugin bundle name, put the current one last
  node - "$PROFILE_PKG" "$BUNDLE_NAME" <<'NODE' || return 1
const fs = require("node:fs");
const [pkgPath, bundle] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const shipped = new Set(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-acp-app",
  "@deepseek-ai/dsh-headless", "@deepseek-ai/dsh-sdk-app", "@deepseek-ai/dsh-sdk-minimal"]);
m.dsh ??= {}; m.dsh.profile ??= {}; m.dsh.profile.bundles ??= [];
m.dsh.profile.bundles = m.dsh.profile.bundles.filter((b) => shipped.has(b) || b === bundle);
if (!m.dsh.profile.bundles.includes(bundle)) m.dsh.profile.bundles.push(bundle);
fs.writeFileSync(pkgPath, JSON.stringify(m, null, 2) + "\n");
NODE
  pass "profile bundles: $(node -e 'console.log(JSON.stringify(require(process.argv[1]).dsh.profile.bundles))' "$PROFILE_PKG")"

  # profile-local package link: profiles/web/node_modules/<pkg> -> plugin dir
  mkdir -p "$PROFILE_MODULES"
  rm -f "$PROFILE_MODULES"/dsh-codex-vision "$PROFILE_MODULES"/dsh-codex-media 2>/dev/null
  ln -sfn "$PLUGIN" "$PROFILE_MODULES/$BUNDLE_NAME"
  if [ "$(readlink -f "$PROFILE_MODULES/$BUNDLE_NAME")" = "$(readlink -f "$PLUGIN")" ]; then
    pass "profile node_modules/$BUNDLE_NAME -> $PLUGIN"
  else
    fail "profile node_modules/$BUNDLE_NAME symlink wrong: $(readlink -f "$PROFILE_MODULES/$BUNDLE_NAME")"
    return 1
  fi
}

step_dump_config() {
  local log="$LOGDIR/01-dump-config.log"
  run_dsh --profile web --dump-config > "$log" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then pass "--dump-config exit 0"; else fail "--dump-config exit $rc (see $log)"; return 1; fi
  local ok=1
  if grep -qE "^# == $BUNDLE_NAME$" "$log"; then pass "--dump-config layer header '# == $BUNDLE_NAME'"; else fail "--dump-config missing layer header for $BUNDLE_NAME"; ok=0; fi
  if grep -qE "^- id: $BUNDLE_ID$" "$log"; then pass "--dump-config entry '- id: $BUNDLE_ID'"; else fail "--dump-config missing '- id: $BUNDLE_ID'"; ok=0; fi
  if grep -qE "^  name: $BUNDLE_NAME$" "$log"; then pass "--dump-config entry 'name: $BUNDLE_NAME'"; else fail "--dump-config missing 'name: $BUNDLE_NAME'"; ok=0; fi
  # nothing from the old identity may linger in the composed tree
  if grep -qE "dsh-codex-vision" "$log"; then fail "--dump-config still references the old dsh-codex-vision identity"; ok=0; else pass "--dump-config has no stale dsh-codex-vision entry"; fi
  [ "$ok" = 1 ]
}

# ---- probe entry (verify-only, lives inside verify/.dsh-home) ----------------
write_probe() {
  cat > "$PROBE_SRC" <<'JS'
// Verify-only probe bundle entry: loads after dsh-codex-media and reads the
// real tool registry. Never part of the plugin package.
export const name = 'verify-probe'
export const inject = ['tools']

export function apply(ctx) {
  let attempts = 0
  const report = () => {
    attempts += 1
    let imagegen, vision, names = [], err = ''
    try {
      imagegen = ctx.tools.get('codex_imagegen')
      vision = ctx.tools.get('codex_vision')
      names = ctx.tools.schemas().map((schema) => schema.name)
    } catch (error) {
      err = String((error && error.message) || error)
    }
    if ((!imagegen || !vision) && attempts < 40) {
      setTimeout(report, 250)
      return
    }
    const has = (n) => (names.includes(n) ? 'yes' : 'no')
    console.log(`VERIFY-PROBE codex_imagegen=${imagegen ? 'registered' : 'missing'} codex_vision=${vision ? 'registered' : 'missing'}`)
    console.log(`VERIFY-PROBE schemas codex_imagegen=${has('codex_imagegen')} codex_vision=${has('codex_vision')} total=${names.length} names=${names.join(',')}`)
    if (imagegen) console.log(`VERIFY-PROBE codex_imagegen_description=${JSON.stringify(String(imagegen.description || '').slice(0, 120))}`)
    if (vision) console.log(`VERIFY-PROBE codex_vision_description=${JSON.stringify(String(vision.description || '').slice(0, 120))}`)
    if (err) console.log(`VERIFY-PROBE error=${JSON.stringify(err)}`)
  }
  report()
}
JS
  [ -f "$PROFILE_PATCH" ] && cp "$PROFILE_PATCH" "$PROBE_BACKUP"
  cat > "$PROFILE_PATCH" <<'YML'
# verify-only layer: loaded exclusively inside verify/.dsh-home
- insert:
    - id: verify-probe
      name: ./verify-probe.mjs
YML
}

uninstall_probe() {
  if [ -f "$PROBE_BACKUP" ]; then mv "$PROBE_BACKUP" "$PROFILE_PATCH"; else rm -f "$PROFILE_PATCH"; fi
  rm -f "$PROBE_SRC"
}

# ---- boot -------------------------------------------------------------------
# boot_and_collect <label> <logfile> <positive|negative>
boot_and_collect() {
  local label="$1" log="$2" expect="$3"
  : > "$log"
  local start_ts=$SECONDS
  env "$MARKER_ENV=1" DSH_HOME="$DSH_HOME" \
    node "$DSH_BIN" --profile web --host "$HOST" --port "$PORT" --no-open \
    > "$log" 2>&1 &
  local pid=$!
  info "[$label] pid=$pid port=$PORT log=$log (marker env $MARKER_ENV=1)"

  local saw_marker=0 saw_url=0 saw_fail=0 saw_probe=0 port_listening=0
  local i
  for i in $(seq 1 "$BOOT_TIMEOUT"); do
    find_marker_line "$log" >/dev/null 2>&1 && saw_marker=1
    grep -qE '^dsh web: ' "$log" && saw_url=1
    grep -qE '^VERIFY-PROBE codex_imagegen=.*codex_vision=' "$log" && saw_probe=1
    if grep -qi "$BUNDLE_NAME" "$log" && grep -qiE 'did not activate|failed to (import|activate|load)|cannot find module' "$log"; then saw_fail=1; fi
    ss -ltn 2>/dev/null | grep -qE "[:.]$PORT[[:space:]]" && port_listening=1

    if [ "$expect" = "positive" ] && [ "$saw_marker" = "1" ] && [ "$saw_url" = "1" ] && { [ "$WANT_PROBE" = "0" ] || [ "$saw_probe" = "1" ]; }; then
      info "[$label] ready after ${SECONDS}s: marker=$saw_marker url=$saw_url probe=$saw_probe"
      sleep 1
      break
    fi
    if [ "$expect" = "negative" ] && [ "$saw_fail" = "1" ]; then
      info "[$label] failure diagnostic observed after ${SECONDS}s"
      sleep 2
      break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      info "[$label] process exited on its own after ${SECONDS}s"
      break
    fi
    sleep 1
  done
  local elapsed=$((SECONDS - start_ts))

  if [ "$port_listening" = "1" ]; then pass "[$label] port $PORT was listening"; else info "[$label] port $PORT was never observed listening"; fi

  # ---- clean shutdown -------------------------------------------------------
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    if kill -0 "$pid" 2>/dev/null; then
      info "[$label] SIGTERM did not stop pid=$pid; sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null
      sleep 1
    fi
  fi
  wait "$pid" 2>/dev/null
  local rc=$?
  local residue=0
  kill -0 "$pid" 2>/dev/null && residue=1
  pgrep -f "bin\.js --profile web --host $HOST --port $PORT" >/dev/null 2>&1 && residue=1
  if [ "$residue" = "0" ]; then
    pass "[$label] process exited cleanly (wait rc=$rc, ${elapsed}s); no residue"
  else
    fail "[$label] process residue after shutdown (pid=$pid)"
  fi
  local port_busy=0
  for _ in $(seq 1 10); do
    if ss -ltn 2>/dev/null | grep -qE "[:.]$PORT[[:space:]]"; then port_busy=1; sleep 1; else port_busy=0; break; fi
  done
  if [ "$port_busy" = "0" ]; then pass "[$label] port $PORT released"; else fail "[$label] port $PORT still listening after shutdown"; fi

  if [ "$expect" = "positive" ]; then
    local marker
    if marker="$(find_marker_line "$log")"; then
      pass "[$label] activation marker: $marker"
    else
      fail "[$label] no single log line names $BUNDLE_NAME and all of: $TOOL_NAMES (see $log)"
      any_tool_line "$log" | head -3
    fi
    if [ "$saw_fail" = "1" ]; then fail "[$label] activation-failure diagnostics present (see $log)"; else pass "[$label] no activation-failure diagnostic"; fi
    if [ "$saw_url" = "1" ]; then pass "[$label] web app reached steady state ('dsh web:' line)"; else info "[$label] no 'dsh web:' line (not required for the marker check)"; fi
    if [ "$WANT_PROBE" = "1" ]; then
      local pline
      if pline="$(grep -E '^VERIFY-PROBE codex_imagegen=' "$log" | head -1)" && [ -n "$pline" ]; then
        case "$pline" in
          *codex_imagegen=registered*codex_vision=registered*) pass "[$label] probe registry: $pline" ;;
          *) fail "[$label] probe registry missing a tool: $pline" ;;
        esac
      else
        fail "[$label] probe produced no registry line (see $log)"
      fi
      local sline
      if sline="$(grep -E '^VERIFY-PROBE schemas ' "$log" | head -1)" && [ -n "$sline" ]; then
        case "$sline" in
          *codex_imagegen=yes*codex_vision=yes*) pass "[$label] probe schemas: $sline" ;;
          *) fail "[$label] probe schemas missing a tool: $sline" ;;
        esac
      else
        fail "[$label] probe produced no schemas line (see $log)"
      fi
      grep -E '^VERIFY-PROBE .*description=' "$log" | sed 's/^/      /' || true
    fi
    [ "$saw_marker" = "1" ] && [ "$saw_fail" = "0" ] && [ "$saw_url" = "1" ]
    if [ "$WANT_PROBE" = "1" ]; then grep -qE '^VERIFY-PROBE codex_imagegen=registered codex_vision=registered$' "$log" || return 1; fi
    return
  fi

  # negative expectations
  if [ "$saw_marker" = "0" ]; then pass "[$label] plugin did not activate (import failed as intended)"; else fail "[$label] broken plugin still activated"; fi
  if grep -qiE "cannot find module|ERR_MODULE_NOT_FOUND|does-not-exist|failed to (load|activate|import)|did not activate" "$log"; then
    pass "[$label] boot log contains a load-failure diagnostic"
  else
    fail "[$label] boot log lacks a readable load-failure diagnostic (see $log)"
  fi
  if grep -qi "$BUNDLE_NAME" "$log"; then pass "[$label] diagnostic names the failing plugin ($BUNDLE_NAME)"; else fail "[$label] diagnostic does not name $BUNDLE_NAME"; fi
}

make_broken_plugin() {
  rm -rf "$BROKEN_PLUGIN"
  mkdir -p "$BROKEN_PLUGIN/lib"
  cp "$PLUGIN/package.json" "$BROKEN_PLUGIN/package.json"
  cp "$PLUGIN/cordis.patch.yml" "$BROKEN_PLUGIN/cordis.patch.yml"
  ln -sfn "$PLUGIN/node_modules" "$BROKEN_PLUGIN/node_modules"
  cat > "$BROKEN_PLUGIN/lib/index.js" <<'JS'
// Intentionally broken copy used by verify/run-verify.sh to prove that a
// failing plugin import surfaces a readable boot diagnostic.
import { missing } from "./does-not-exist.mjs";
export const name = "dsh-codex-media";
export function apply() { missing(); }
JS
}

step_negative() {
  info "negative control: broken plugin copy at $BROKEN_PLUGIN"
  make_broken_plugin
  ln -sfn "$BROKEN_PLUGIN" "$PROFILE_MODULES/$BUNDLE_NAME"
  boot_and_collect "negative" "$LOGDIR/03-negative-boot.log" negative
  local rc=$?
  ln -sfn "$PLUGIN" "$PROFILE_MODULES/$BUNDLE_NAME"
  info "restored profile symlink -> $PLUGIN"
  return $rc
}

step_positive() {
  if [ ! -f "$PLUGIN/lib/index.js" ]; then
    fail "positive boot: lib/index.js does not exist"
    return 1
  fi
  ln -sfn "$PLUGIN" "$PROFILE_MODULES/$BUNDLE_NAME"
  if [ "$WANT_PROBE" = "1" ]; then write_probe; info "installed verify-only registry probe entry"; fi
  boot_and_collect "positive" "$LOGDIR/02-positive-boot.log" positive
  local rc=$?
  if [ "$WANT_PROBE" = "1" ]; then uninstall_probe; info "removed verify-only registry probe entry"; fi
  return $rc
}

main() {
  guard
  info "plugin dir: $PLUGIN"
  info "isolated DSH_HOME: $DSH_HOME"
  info "dsh bin: $DSH_BIN"
  info "mode=$MODE bundle=$BUNDLE_NAME tools='$TOOL_NAMES' port=$PORT probe=$WANT_PROBE reset=$DO_RESET"

  ensure_profile || return 1
  case "$MODE" in
    dump) step_dump_config ;;
    negative)
      make_broken_plugin
      ln -sfn "$BROKEN_PLUGIN" "$PROFILE_MODULES/$BUNDLE_NAME"
      boot_and_collect "negative" "$LOGDIR/03-negative-boot.log" negative
      ln -sfn "$PLUGIN" "$PROFILE_MODULES/$BUNDLE_NAME"
      ;;
    full)          step_dump_config && step_positive ;;
    full-negative) step_dump_config && step_positive && step_negative ;;
  esac
  local rc=$?
  echo
  if [ "$FAILS" -eq 0 ] && [ "$rc" -eq 0 ]; then
    pass "RESULT: all selected checks passed"
    exit 0
  fi
  fail "RESULT: $FAILS failing check(s) — see $LOGDIR/summary.txt and $LOGDIR/*.log"
  exit 1
}

main
