#!/usr/bin/env bash
# VAM OS V5 minimal staging connection diagnostic -- the sole execution authority for
# the tiny read-only connectivity probe described in
# docs/audits/VAM_OS_V5_SCHEMA_AUTHORITY_DECISION_PACK_2026-08-01.md section 20. This
# file being present in the repository does NOT authorize running it -- it must still
# be run only after explicit, separate human approval, exactly like
# scripts/vam_v5_metadata_capture_wrapper.sh. It does not authorize, perform, or
# retry the full metadata capture, and it does not authorize migration 062 under any
# outcome.
set -u
set -o pipefail
set +x
umask 077

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
unset PGSSLNEGOTIATION
unset PGSSLMODE
unset PGREQUIRESSL
unset PGSSLCOMPRESSION
unset PGSSLCERT
unset PGSSLKEY
unset PGSSLCERTMODE
unset PGSSLROOTCERT
unset PGSSLCRL
unset PGSSLCRLDIR
unset PGSSLSNI
unset PGSSLMINPROTOCOLVERSION
unset PGSSLMAXPROTOCOLVERSION
unset PGGSSENCMODE
unset PGCHANNELBINDING
unset PGREQUIREAUTH
unset PGKRBSRVNAME
unset PGGSSLIB
unset PGGSSDELEGATION
unset PGAPPNAME
unset PGTARGETSESSIONATTRS
unset PGLOADBALANCEHOSTS

# Explicit, minimal SSL/GSS posture for a clean traditional-negotiation TLS attempt.
# Never sslmode=disable/allow/prefer (all weaker than require); never
# sslnegotiation=direct here (that is Variant B, a separate, not-yet-authorized probe
# -- see docs/audits/VAM_OS_V5_SCHEMA_AUTHORITY_DECISION_PACK_2026-08-01.md section 20).
export PGSSLMODE=require
export PGSSLNEGOTIATION=postgres
export PGGSSENCMODE=disable
export PGSSLCERTMODE=disable
export PGSSLSNI=1
export PGCONNECT_TIMEOUT=10
export PGAPPNAME=vam_os_artifact0_diagnostic

PSQL="/c/Program Files/PostgreSQL/17/bin/psql.exe"
BASE="/c/Users/THIS PC/Desktop/VAM 2026/VAM_OS_Admin_Portal"
CLASSIFIER="$BASE/scripts/vam_v5_psql_diagnostic_classifier.mjs"
APPROVED_REF="ljfneyuvpxrmejpxsmpz"
EXCLUDED_PROD_REF="qkkroesfiazsejkzflcd"

# Pinned at the end of the local-only review turn that produced this file. Compared
# against the classifier's ACTUAL hash immediately below, before STAGING_DATABASE_URL
# is touched in any way.
EXPECTED_CLASSIFIER_SHA256="29a253bb763865445c3de8e7ec34dc4a3b2b17c0bc1e196596b424f2f05dacf6"

DB_URI=""

# ---------------------------------------------------------------------------------
# Signal safety: EXIT and the three signals get SEPARATE handlers, never one shared
# function, exactly mirroring scripts/vam_v5_metadata_capture_wrapper.sh. The EXIT
# handler trusts $? (well-defined there). Each signal handler ignores $? entirely,
# disables every trap so the EXIT handler cannot re-fire and overwrite the code, and
# exits with a hardcoded, signal-specific non-zero status. No interruption can ever
# produce a zero exit code or a DIAGNOSTIC_OK-shaped line.
# ---------------------------------------------------------------------------------
release_credentials() {
  unset DB_URI
  unset STAGING_DATABASE_URL
  unset PGDATABASE
  unset PGPASSWORD
}

cleanup_on_exit() {
  local ec=$?
  release_credentials
  exit "$ec"
}

cleanup_on_signal() {
  local signal_name="$1"
  local signal_exit_code="$2"
  release_credentials
  trap - EXIT HUP INT TERM
  echo "DIAGNOSTIC_REFUSED reason=interrupted_by_signal signal=$signal_name"
  exit "$signal_exit_code"
}

trap cleanup_on_exit EXIT
trap 'cleanup_on_signal HUP 129' HUP
trap 'cleanup_on_signal INT 130' INT
trap 'cleanup_on_signal TERM 143' TERM

# ---------------------------------------------------------------------------------
# Hash pinning. Runs before anything touches STAGING_DATABASE_URL. Fails closed with
# only a non-secret reason -- never a hash value or file content.
# ---------------------------------------------------------------------------------
if ! command -v sha256sum >/dev/null 2>&1; then
  echo "DIAGNOSTIC_REFUSED reason=sha256sum_unavailable"
  exit 1
fi

ACTUAL_CLASSIFIER_SHA256="$(sha256sum "$CLASSIFIER" 2>/dev/null | cut -d' ' -f1)"
if [ "$ACTUAL_CLASSIFIER_SHA256" != "$EXPECTED_CLASSIFIER_SHA256" ]; then
  echo "DIAGNOSTIC_REFUSED reason=classifier_hash_mismatch"
  exit 1
fi

# ---------------------------------------------------------------------------------
# Non-printing target preflight. Pure shell builtins only -- [ ] and case never
# fork/exec an external process, so STAGING_DATABASE_URL's value is never placed in
# any process's argv. Only the four named booleans are ever printed.
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
  echo "DIAGNOSTIC_REFUSED reason=target_preflight_failed"
  exit 1
fi

DB_URI="$STAGING_DATABASE_URL"
unset STAGING_DATABASE_URL

# Step 1: run psql alone, in a plain (non-piped) command substitution, so its exit
# status is unambiguous and directly readable via $? immediately afterward -- no
# reliance on PIPESTATUS propagating through a substitution boundary (verified in this
# environment not to be reliable for that specific case).
PSQL_OUTPUT="$(PGDATABASE="$DB_URI" "$PSQL" -X -q --csv -v ON_ERROR_STOP=1 2>&1 <<'DIAG_SQL'
begin transaction read only;
set local statement_timeout = '10s';
set local lock_timeout = '3s';
select
  current_database() as database_name,
  current_setting('transaction_read_only') as transaction_read_only,
  current_setting('server_version') as server_version,
  current_setting('statement_timeout') as statement_timeout,
  current_setting('lock_timeout') as lock_timeout;
rollback;
DIAG_SQL
)"
PSQL_EXIT=$?

# Step 2: feed the captured output to the classifier through a pipe inside its own
# substitution. With `set -o pipefail`, a piped substitution's own $? is the rightmost
# non-zero exit code among its stages (verified in this environment), so this reliably
# reflects the classifier's own exit status even though PIPESTATUS itself does not
# propagate through the substitution boundary. The classifier never inherits
# PGDATABASE, DB_URI, STAGING_DATABASE_URL, or PGPASSWORD.
CLASSIFIER_OUTPUT="$(printf '%s' "$PSQL_OUTPUT" \
  | env -u PGDATABASE -u DB_URI -u STAGING_DATABASE_URL -u PGPASSWORD \
      node "$CLASSIFIER")"
CLASSIFIER_EXIT=$?

unset DB_URI

echo "$CLASSIFIER_OUTPUT"
echo "DIAGNOSTIC_RESULT psql_exit=$PSQL_EXIT classifier_exit=$CLASSIFIER_EXIT"

# Cross-check: a sql_script_error category alongside a connection-level psql exit code
# (2) is an internally inconsistent combination -- psql's own documented exit statuses
# make exit 3, not exit 2, the one associated with a script error under
# ON_ERROR_STOP=1. Flagging this costs nothing extra to compute and never touches raw
# input; it only inspects the classifier's own already-sanitized output line.
if [ "$PSQL_EXIT" = "2" ]; then
  case "$CLASSIFIER_OUTPUT" in
    *category=sql_script_error*)
      echo "DIAGNOSTIC_INCONSISTENT reason=sql_script_error_with_connection_level_exit_code"
      ;;
  esac
fi

if [ "$PSQL_EXIT" = "0" ] && [ "$CLASSIFIER_EXIT" = "0" ]; then
  exit 0
fi
exit 1
