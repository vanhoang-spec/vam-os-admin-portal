#!/usr/bin/env bash
# VAM OS V5 metadata capture wrapper -- the SOLE current execution authority for the
# read-only staging catalog capture. Every Bash wrapper embedded in
# docs/audits/VAM_OS_V5_SCHEMA_AUTHORITY_DECISION_PACK_2026-08-01.md is superseded by
# this file. Execution is authorized only by this file's own exact SHA-256, recorded in
# that decision pack. This file being present in the repository does NOT authorize
# running it -- it must still be run only after explicit human approval.
set -u
set -o pipefail
set +x
umask 077

# Remove any inherited libpq environment variables before anything else runs, so a
# stray value from the parent process cannot silently redirect the connection target
# or combine unexpectedly with the URI this wrapper sets up further below.
unset PGDATABASE
unset PGHOST
unset PGHOSTADDR
unset PGPORT
unset PGUSER
unset PGPASSWORD
unset PGPASSFILE
unset PGSERVICE
unset PGSERVICEFILE
unset PGOPTIONS

export PGSSLMODE=require
export PGCONNECT_TIMEOUT=10

PSQL="/c/Program Files/PostgreSQL/17/bin/psql.exe"
BASE="/c/Users/THIS PC/Desktop/VAM 2026/VAM_OS_Admin_Portal"
SQLFILE="$BASE/docs/audits/sql/design_only/VAM_OS_V5_METADATA_EVIDENCE_CAPTURE.sql"
SANITIZER="$BASE/scripts/vam_v5_metadata_evidence_sanitizer.mjs"
TEMPLATE="$BASE/docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json"
FINAL="$BASE/docs/audits/evidence/VAM_OS_V5_STAGING_SCHEMA_EVIDENCE_2026-08-01.json"
APPROVED_REF="ljfneyuvpxrmejpxsmpz"
EXCLUDED_PROD_REF="qkkroesfiazsejkzflcd"
REPO_PARENT_DIR="$(dirname "$BASE")"

# Expected SHA-256 of each dependency, pinned at the end of the local-only review turn
# that produced this file. Compared against the ACTUAL hash of each file immediately
# below, before STAGING_DATABASE_URL is touched in any way.
EXPECTED_SANITIZER_SHA256="c9d0f3d3473fdc95045b439fb88a6e49bb80d9b09e69feed4cbed92a35114494"
EXPECTED_CAPTURE_SQL_SHA256="b8315d1bb6d89ff482d20ccccc8e659f9f5ebd2f9f5b57dee092aa70dfac9c56"
EXPECTED_TEMPLATE_SHA256="fc675160638dc0d978be0d1f5dddf13ec12ca4a7ca97f7ea5ec19378a47da3bd"

TMPDIR_CANDIDATE=""
CANDIDATE=""
DB_URI=""

# ---------------------------------------------------------------------------------
# Signal safety: EXIT and the three signals get SEPARATE handlers, never one shared
# function. The EXIT trap trusts $? (well-defined there). Each signal handler ignores
# $? entirely, disables every trap so the EXIT trap cannot re-fire and clobber the
# code, then exits with a hardcoded, signal-specific non-zero status. No interruption
# can ever produce a zero exit code or print CAPTURE_OK.
# ---------------------------------------------------------------------------------
remove_temp_state() {
  if [ -n "$CANDIDATE" ] && [ -f "$CANDIDATE" ]; then
    rm -f "$CANDIDATE" "$CANDIDATE.writing"
  fi
  if [ -n "$TMPDIR_CANDIDATE" ] && [ -d "$TMPDIR_CANDIDATE" ]; then
    rm -rf "$TMPDIR_CANDIDATE"
  fi
  unset DB_URI
  unset STAGING_DATABASE_URL
  unset PGDATABASE
  unset PGPASSWORD
}

cleanup_on_exit() {
  local ec=$?
  remove_temp_state
  exit "$ec"
}

cleanup_on_signal() {
  local signal_name="$1"
  local signal_exit_code="$2"
  remove_temp_state
  trap - EXIT HUP INT TERM
  echo "CAPTURE_FAILED reason=interrupted_by_signal signal=$signal_name"
  exit "$signal_exit_code"
}

trap cleanup_on_exit EXIT
trap 'cleanup_on_signal HUP 129' HUP
trap 'cleanup_on_signal INT 130' INT
trap 'cleanup_on_signal TERM 143' TERM

# ---------------------------------------------------------------------------------
# Hash pinning. Runs before anything touches STAGING_DATABASE_URL. Fails closed with
# only a non-secret artifact name -- never a hash value, a path's contents, or any
# variable that could carry a credential.
# ---------------------------------------------------------------------------------
if ! command -v sha256sum >/dev/null 2>&1; then
  echo "CAPTURE_FAILED reason=sha256sum_unavailable"
  exit 1
fi

compute_sha256() {
  sha256sum "$1" 2>/dev/null | cut -d' ' -f1
}

ACTUAL_SANITIZER_SHA256="$(compute_sha256 "$SANITIZER")"
if [ "$ACTUAL_SANITIZER_SHA256" != "$EXPECTED_SANITIZER_SHA256" ]; then
  echo "CAPTURE_FAILED reason=artifact_hash_mismatch artifact=sanitizer"
  exit 1
fi

ACTUAL_CAPTURE_SQL_SHA256="$(compute_sha256 "$SQLFILE")"
if [ "$ACTUAL_CAPTURE_SQL_SHA256" != "$EXPECTED_CAPTURE_SQL_SHA256" ]; then
  echo "CAPTURE_FAILED reason=artifact_hash_mismatch artifact=capture_sql"
  exit 1
fi

ACTUAL_TEMPLATE_SHA256="$(compute_sha256 "$TEMPLATE")"
if [ "$ACTUAL_TEMPLATE_SHA256" != "$EXPECTED_TEMPLATE_SHA256" ]; then
  echo "CAPTURE_FAILED reason=artifact_hash_mismatch artifact=template_json"
  exit 1
fi

# ---------------------------------------------------------------------------------
# Non-printing target preflight. Pure shell builtins only -- [ ] and case never
# fork/exec an external process, so STAGING_DATABASE_URL's value is never placed in
# any process's argv. Only the four named booleans (and a static reason= on failure)
# are ever printed.
# ---------------------------------------------------------------------------------
STAGING_VAR_PRESENT=false
POSTGRES_URI_SHAPE=false
APPROVED_STAGING_REF_PRESENT=false
PRODUCTION_REF_ABSENT=false

if [ -n "${STAGING_DATABASE_URL:-}" ]; then
  STAGING_VAR_PRESENT=true
fi

if [ "$STAGING_VAR_PRESENT" = true ]; then
  case "$STAGING_DATABASE_URL" in
    postgres://*|postgresql://*) POSTGRES_URI_SHAPE=true ;;
  esac
  case "$STAGING_DATABASE_URL" in
    *"$APPROVED_REF"*) APPROVED_STAGING_REF_PRESENT=true ;;
  esac
  case "$STAGING_DATABASE_URL" in
    *"$EXCLUDED_PROD_REF"*) PRODUCTION_REF_ABSENT=false ;;
    *) PRODUCTION_REF_ABSENT=true ;;
  esac
fi

PREFLIGHT_MSG="TARGET_PREFLIGHT stagingVariablePresent=$STAGING_VAR_PRESENT"
PREFLIGHT_MSG="$PREFLIGHT_MSG postgresUriShape=$POSTGRES_URI_SHAPE"
PREFLIGHT_MSG="$PREFLIGHT_MSG approvedStagingRefPresent=$APPROVED_STAGING_REF_PRESENT"
PREFLIGHT_MSG="$PREFLIGHT_MSG productionRefAbsent=$PRODUCTION_REF_ABSENT"
echo "$PREFLIGHT_MSG"

if [ "$STAGING_VAR_PRESENT" != true ] || [ "$POSTGRES_URI_SHAPE" != true ] || \
   [ "$APPROVED_STAGING_REF_PRESENT" != true ] || [ "$PRODUCTION_REF_ABSENT" != true ]; then
  echo "CAPTURE_FAILED reason=target_preflight_failed"
  exit 1
fi

# ---------------------------------------------------------------------------------
# Temporary directory: checked mktemp, created as a hidden sibling of the repository
# root (same parent directory), which is guaranteed to be on the same filesystem/
# volume as the final evidence file by construction, not by assumption.
# ---------------------------------------------------------------------------------
TMPDIR_CANDIDATE="$(mktemp -d "$REPO_PARENT_DIR/.vam_v5_capture_tmp.XXXXXXXXXX")"
if [ $? -ne 0 ] || [ -z "$TMPDIR_CANDIDATE" ] || [ ! -d "$TMPDIR_CANDIDATE" ]; then
  echo "CAPTURE_FAILED reason=tempdir_creation_failed"
  exit 1
fi
CANDIDATE="$TMPDIR_CANDIDATE/candidate_evidence.json"

# DB_URI is a plain, never-exported shell variable -- it is not itself inherited by any
# child process. STAGING_DATABASE_URL is unset immediately so exactly one copy of the
# credential exists in this shell's own state from this point on.
DB_URI="$STAGING_DATABASE_URL"
unset STAGING_DATABASE_URL

# PGDATABASE="$DB_URI" is a simple-command prefix assignment: bash scopes it to psql's
# own child-process environment only. It is never exported into this wrapper's own
# environment, never appears in any argv, and is not inherited by the sanitizer side of
# the pipe below. `env -u ...` on the sanitizer side is an additional, explicit,
# self-documenting guarantee that none of the four credential-bearing variable names can
# reach node, even though none of them are exported here to begin with. Raw psql
# stdout+stderr is streamed directly into the sanitizer and never printed, redirected to
# a file, or persisted anywhere else.
PGDATABASE="$DB_URI" "$PSQL" -X -q -v ON_ERROR_STOP=1 -f "$SQLFILE" 2>&1 \
  | env -u PGDATABASE -u DB_URI -u STAGING_DATABASE_URL -u PGPASSWORD \
      node "$SANITIZER" "$TEMPLATE" "$CANDIDATE" "$SQLFILE" "$APPROVED_REF" \
      "$EXCLUDED_PROD_REF"

# Captured in one atomic array assignment immediately after the pipeline, before any
# other command can run and overwrite PIPESTATUS.
PIPE_CODES=("${PIPESTATUS[@]}")
unset DB_URI
PSQL_EXIT="${PIPE_CODES[0]:-999}"
NODE_EXIT="${PIPE_CODES[1]:-999}"

if [ "$PSQL_EXIT" != "0" ] || [ "$NODE_EXIT" != "0" ]; then
  echo "CAPTURE_FAILED psql_exit=$PSQL_EXIT node_exit=$NODE_EXIT"
  exit 1
fi

if [ ! -s "$CANDIDATE" ]; then
  echo "CAPTURE_FAILED reason=candidate_missing_or_empty"
  exit 1
fi

if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$CANDIDATE"; then
  echo "CAPTURE_FAILED reason=candidate_not_valid_json"
  exit 1
fi

# publicationValidation.allPassed is the sanitizer's single aggregate gate: it already
# requires (among other things) production ref absent, transaction_read_only=on,
# bounded statement/lock timeouts, and every expected section resolved -- see
# scripts/vam_v5_metadata_evidence_sanitizer.mjs. This wrapper does not duplicate that
# logic; it only reads the one aggregate result.
ALLPASSED="$(node -e "
  const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
  console.log(c.publicationValidation && c.publicationValidation.allPassed === true);
" "$CANDIDATE")"

if [ "$ALLPASSED" != "true" ]; then
  echo "CAPTURE_FAILED reason=validation_failed"
  exit 1
fi

# Same-filesystem proof immediately before the only step that touches $FINAL. Defense
# in depth on top of the by-construction guarantee above (temp dir is a sibling of the
# repository root); fails closed if it cannot be proven, rather than assuming it.
if ! command -v stat >/dev/null 2>&1; then
  echo "CAPTURE_FAILED reason=same_filesystem_unproven"
  exit 1
fi

CANDIDATE_DEV="$(stat -c %d "$(dirname "$CANDIDATE")" 2>/dev/null)"
FINAL_DEV="$(stat -c %d "$(dirname "$FINAL")" 2>/dev/null)"
if [ -z "$CANDIDATE_DEV" ] || [ -z "$FINAL_DEV" ] || [ "$CANDIDATE_DEV" != "$FINAL_DEV" ]; then
  echo "CAPTURE_FAILED reason=same_filesystem_unproven"
  exit 1
fi

# The ONLY step that ever touches $FINAL. Every failure path above returns before this
# line, so the previous final evidence file is preserved on every failure.
if ! mv -f "$CANDIDATE" "$FINAL"; then
  echo "CAPTURE_FAILED reason=publish_rename_failed"
  exit 1
fi

CANDIDATE=""
echo "CAPTURE_OK"
exit 0
