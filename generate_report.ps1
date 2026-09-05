$branches = Get-Content branches.json -Raw | ConvertFrom-Json
$migrations = Get-Content migrations.json -Raw | ConvertFrom-Json

$mainSha = $branches | ? { $_.Name -eq 'origin/main' } | Select -ExpandProperty Head
$branchCount = $branches.Count
$migCount = $migrations.Count

Set-Content report_draft.md "ANTI_FULL_GITHUB_FORENSIC_AUDIT=COMPLETE" -Encoding utf8
Add-Content report_draft.md "" -Encoding utf8
Add-Content report_draft.md "AUDIT_MAIN_SHA=$mainSha" -Encoding utf8
Add-Content report_draft.md "REMOTE_BRANCH_COUNT=$branchCount" -Encoding utf8
Add-Content report_draft.md "PR_COUNT=UNKNOWN (gh cli missing)" -Encoding utf8
Add-Content report_draft.md "UNIQUE_CAPABILITY_COUNT=TBD" -Encoding utf8
Add-Content report_draft.md "MIGRATION_COUNT=$migCount" -Encoding utf8
Add-Content report_draft.md "" -Encoding utf8

Add-Content report_draft.md "## BRANCH FAMILY LEDGER" -Encoding utf8
Add-Content report_draft.md "" -Encoding utf8
Add-Content report_draft.md "| Branch | HEAD | Ahead | Behind | Capability family |" -Encoding utf8
Add-Content report_draft.md "|---|---|---|---|---|" -Encoding utf8

foreach ($b in ($branches | Sort Name)) {
    $name = $b.Name
    if ($name -like "origin/*") {
        $name = $name.Substring(7)
    }
    $family = "UNKNOWN"
    if ($name -match "s12-m\d") { $family = "recruitment assignment" }
    elseif ($name -match "autosave") { $family = "autosave" }
    elseif ($name -match "renewal") { $family = "mentor renewal" }
    elseif ($name -match "auth|rls") { $family = "auth / access" }
    elseif ($name -match "recap") { $family = "recap" }
    elseif ($name -match "interview") { $family = "interview scheduling" }
    elseif ($name -match "comms|email") { $family = "email" }
    elseif ($name -match "matching") { $family = "matching" }
    elseif ($name -match "ops") { $family = "operations" }
    elseif ($name -match "ham") { $family = "ham" }
    
    Add-Content report_draft.md "| $name | $($b.Head.Substring(0,7)) | $($b.Ahead) | $($b.Behind) | $family |" -Encoding utf8
}
