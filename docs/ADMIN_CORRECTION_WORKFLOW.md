# PHASE C: Admin Correction Workflow

This document outlines the procedures and requirements for data correction within the Admin portal, ensuring data integrity is maintained while correcting operational errors.

## Data Issue Queue
- **Purpose**: A centralized inbox displaying flagged data anomalies (e.g., mismatched IDs, failed imports, incomplete records).
- **Process**: Administrators claim issues, review the flagged discrepancy, apply the fix, and mark the issue as resolved.

## Manual Recap Creation
- **Capability**: Admins can manually log a mentoring recap on behalf of a user if standard submission fails.
- **Requirements**: Must enforce the same validation rules as the standard intake form (valid mentor, valid mentee, valid dates).

## Recap Correction
- **Capability**: Edit existing recaps to fix typos, incorrect dates, or misassigned statuses.
- **Guardrails**: Edits to historical closed-month data may require special authorization or trigger a recalculation of specific KPIs.

## Duplicate Recap Handling
- **Detection**: System identifies potential duplicates based on mentor/mentee pairs and meeting dates.
- **Resolution**: Admins review side-by-side comparisons of potential duplicates and merge or delete the redundant record.

## Missing Mentor/Mentee Handling
- **Process**: If a recap references an unrecognized user, the system flags it. Admins can link the recap to an existing profile or initiate the creation of a new profile if the user was omitted from the initial season import.

## Audit Log Requirement
- **Tracking**: Every creation, modification, or deletion action taken during the correction workflow must be logged.
- **Data Points**: The log must capture the Admin User ID, Timestamp, Target Record ID, Original Value, and New Value.

## Role Permissions
- **Access Control**: Only designated "Data Admins" or "Super Admins" should have write access to the correction workflows. Standard viewers are restricted to read-only access.
