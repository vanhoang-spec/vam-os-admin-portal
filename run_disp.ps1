$branches = Get-Content branch_audit.json -Raw | ConvertFrom-Json
$protected = @(
    "origin/main",
    "origin/staging",
    "origin/s12-phase3-interviews",
    "origin/s12-phase4-ai-matching",
    "origin/s12-phase5-post-match-comms",
    "origin/s12-phase6-recap-collection",
    "origin/s12-phase7-participant-login",
    "origin/s12-phase8-cross-mentoring",
    "origin/s12-phase9-mkt-plan"
)

$report = @()

foreach ($b in $branches) {
    $name = $b.Name
    $ahead = $b.Ahead
    $behind = $b.Behind
    $merged = $b.Merged
    $head = $b.Head
    
    $disp = "UNKNOWN_KEEP"
    $reason = ""
    
    if ($protected -contains $name) {
        if ($name -eq "origin/main" -or $name -eq "origin/staging") {
            $disp = "KEEP_ACTIVE"
            $reason = "Protected core branch"
        } else {
            $disp = "KEEP_PARKED_S12_SOURCE"
            $reason = "Protected parked phase branch with unique S12 code"
        }
    } elseif ($merged) {
        # Fully merged into main
        if ($name -match "feat/|fix/|chore/|release/|review/") {
            $disp = "SAFE_TO_DELETE"
            $reason = "Fully merged review/feature branch (Rule A)"
        } elseif ($name -match "auth-|ham-|batch-|portfolio-") {
            $disp = "KEEP_AUDIT_EVIDENCE"
            $reason = "Merged but contains historical audit evidence"
        } else {
            $disp = "KEEP_PRODUCTION_HISTORY"
            $reason = "Merged history, keeping for safety"
        }
    } else {
        # Not merged
        if ($name -match "auth-rls-readonly-verification-v2|auth-emergency|ham-s6") {
            $disp = "SAFE_TO_DELETE"
            $reason = "Diagnostic/audit branch superseded by main (Rule B)"
        } elseif ($name -match "s12-m09X") {
            $disp = "SAFE_TO_DELETE"
            $reason = "Superseded by merged S12 operations on main (Rule B)"
        } elseif ($name -match "s12-phase1-mentor-confirmation") {
            $disp = "KEEP_PARKED_S12_SOURCE"
            $reason = "Contains unmerged unique S12 confirm tokens/rate limits"
        } elseif ($name -match "uat/") {
            $disp = "SAFE_TO_DELETE"
            $reason = "Old UAT branch, exact tree now on main (Rule C)"
        } elseif ($name -match "batch-") {
            $disp = "KEEP_AUDIT_EVIDENCE"
            $reason = "Unmerged historical batch work"
        } else {
            $disp = "UNKNOWN_KEEP"
            $reason = "Uncertain unmerged branch"
        }
    }
    
    $report += [PSCustomObject]@{
        Name = $name
        Head = $head
        Ahead = $ahead
        Behind = $behind
        Merged = $merged
        Disp = $disp
        Reason = $reason
    }
}
$report | ConvertTo-Json -Depth 2 | Out-File disposition.json -Encoding utf8
