# UEHM S12 Renewal P0 — Browser UAT

Run this checklist in an approved non-production environment using synthetic people. Do not generate real Production invites.

For every case, record the invite ID, application ID (when accepted), person ID, mentor profile ID, membership ID, and screenshots of the admin field diff. Never record the raw token in logs or shared test notes.

## Case A — Existing active S12 membership

1. Choose a synthetic returning mentor with exactly one canonical mentor profile and one active UEHM-S12 mentor membership.
2. Create a 14-day invite from `/admin/renewals`; copy the newly shown link once and reload the admin page. Confirm the raw link is no longer visible.
3. Open the link, verify the canonical identity/profile and read-only lineage fields, submit acceptance with one changed profile field.
4. In the admin console, verify the exact FIELD / CURRENT / PROPOSED diff and confirm.
5. Verify membership remains active (no duplicate), the application is approved, and the same person/profile rows are reused.

## Case B — Historical profile, no S12 membership

1. Choose a synthetic mentor with one historical canonical profile and no UEHM-S12 membership.
2. Accept and admin-confirm the renewal.
3. Verify exactly one active UEHM-S12 mentor membership is added through `vam063_add_membership_role`, then the application is approved.
4. Verify no duplicate person, mentor profile, membership, or application exists.

## Case C — Previously opted out

1. Choose a synthetic mentor whose UEHM-S12 mentor membership is `opted_out`.
2. Create a new invite, accept, inspect the diff, and confirm.
3. Verify the existing membership is reactivated through `vam063_reactivate_membership`; its ID is unchanged and no second membership exists.
4. Verify the application is approved only after the `confirm_renewal` audit exists.

## Decline

1. Open a fresh invite and choose “không tiếp tục”.
2. Verify the mentor receives a controlled acknowledgement and no application is created.
3. Verify eligible membership is opted out. If the issuing actor is no longer authorized, verify `/admin/renewals` prominently shows operator attention and does not silently force another mutation.

## Expired and revoked links

1. Open an expired invite and a revoked invite.
2. Verify both show the same public invalid/expired message, expose no identity, and cannot submit.
3. Verify response headers include `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## Double-submit and replay

1. Double-click acceptance (or send two requests concurrently), then reload and submit again.
2. Verify exactly one accepted invite binding and one renewal application exist.
3. Verify the completed link is read-only and replay cannot create another application.

## Direct legacy approval refusal

1. Attempt to approve an accepted renewal application through the ordinary application approval action before admin renewal confirmation.
2. Verify refusal occurs before person/profile/application/audit writes.
3. Repeat with a deliberately malformed application `source` while retaining its invite binding; verify it is still guarded.
4. Confirm through `/admin/renewals`, then verify approval can proceed.

## Profile drift between view and confirm

1. Open an accepted renewal in `/admin/renewals` and note its field diff.
2. In another admin session, change one displayed CURRENT field on the canonical mentor profile.
3. Submit the stale confirmation.
4. Verify M071 refuses it, membership and application approval do not run, and the console asks the admin to reload/re-review.
5. Reload, verify the updated CURRENT value and new diff, then confirm successfully.

## Regenerate and revoke

1. Revoke a live invite and verify the old link stops resolving.
2. Regenerate another live invite; verify the old invite is revoked before a new link is created.
3. Verify the new raw link is shown once only and a reload cannot recover it.

## Final duplicate audit

For Cases A–C and double-submit, query/inspect by the recorded IDs and verify no duplicates in:

- `people`;
- `mentor_profiles`;
- `person_season_memberships` for person + season + role;
- `applications` for the accepted invite/replay.

Confirm ordinary new-mentor applications remain unaffected. Do not deploy or issue real invitations as part of this UAT.
