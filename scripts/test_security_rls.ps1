<#
.SYNOPSIS
    VAM OS Security RLS Testing Matrix Execution
.DESCRIPTION
    Tests RLS rules on the vam-os-security-test environment for anon, authenticated, and service_role.
#>
param(
    [Parameter(Mandatory=$true)][string]$DbUrl,
    [Parameter(Mandatory=$true)][string]$ExpectedProjectRef
)

$ErrorActionPreference = "Stop"

# Safety Guards
$PROD_REF = "qkkroesfiazsejkzflcd"
$STAG_REF = "ljfneyuvpxrmejpxsmpz"

if ($DbUrl -match $PROD_REF -or $ExpectedProjectRef -eq $PROD_REF) {
    Write-Error "CRITICAL: DbUrl contains Production project ref!"
    exit 1
}
if ($DbUrl -match $STAG_REF -or $ExpectedProjectRef -eq $STAG_REF) {
    Write-Error "CRITICAL: DbUrl contains Staging project ref!"
    exit 1
}
if ($DbUrl -notmatch $ExpectedProjectRef) {
    Write-Error "CRITICAL: DbUrl does not match the ExpectedProjectRef ($ExpectedProjectRef)!"
    exit 1
}

$PG_EXEC = "C:\Program Files\PostgreSQL\17\bin\psql.exe"

function Test-Access($role, $query, $expectedCount, $desc) {
    Write-Host "Testing $desc as $role..."
    
    $sql = "SET ROLE $role; $query;"
    $out = & $PG_EXEC -d $DbUrl -c $sql -t -A 2>&1
    
    # Mask password if DbUrl is printed in error
    if ($DbUrl -match "://[^:]+:(.+)@") {
        $pwd = [regex]::Escape($matches[1])
        $out = $out -replace $pwd, "***"
    }

    if ($LASTEXITCODE -ne 0) {
        if ($expectedCount -eq "ERROR") {
            Write-Host "  [PASS] Successfully blocked/errored as expected." -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] Unexpected error: $out" -ForegroundColor Red
        }
    } else {
        if ($expectedCount -eq "ERROR") {
            Write-Host "  [FAIL] Query succeeded but should have been blocked!" -ForegroundColor Red
        } elseif ($out -match $expectedCount) {
            Write-Host "  [PASS] Result matched expected count/behavior." -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] Expected $expectedCount, got $out" -ForegroundColor Red
        }
    }
}

Write-Host "Executing RLS Test Matrix on Security Test Environment..."

# 1. ANON Access Tests
Test-Access "anon" "SELECT count(*) FROM public.event_links" "ERROR" "Anon SELECT event_links"
Test-Access "anon" "SELECT count(*) FROM public.event_registrations" "ERROR" "Anon SELECT event_registrations"
Test-Access "anon" "SELECT public.is_active_admin()" "ERROR" "Anon EXECUTE is_active_admin()"
Test-Access "anon" "SELECT public.current_admin_context()" "ERROR" "Anon EXECUTE current_admin_context()"

# 2. AUTHENTICATED Access Tests
# Note: For real tests, we would simulate an authenticated JWT via set_config
# Here we just verify that authenticated CAN execute the functions and read the tables (if is_active_admin is true)
Test-Access "authenticated" "SELECT public.is_active_admin()" "f" "Auth EXECUTE is_active_admin (returns false if no JWT)"
# The SELECT tests for authenticated will return 0 because is_active_admin() is false without a JWT
Test-Access "authenticated" "SELECT count(*) FROM public.event_links" "0" "Auth SELECT event_links (returns 0 rows because not admin)"

# 3. SERVICE ROLE Access Tests
# Service role bypasses RLS, so it should read all rows
Test-Access "service_role" "SELECT count(*) >= 0 FROM public.event_links" "t" "Service Role SELECT event_links (bypasses RLS)"
Test-Access "service_role" "SELECT count(*) >= 0 FROM public.event_registrations" "t" "Service Role SELECT event_registrations (bypasses RLS)"

Write-Host "Test Matrix Complete."
