# PHASE B: Monthly Operations Workflow (SOP)

This Standard Operating Procedure (SOP) defines the official monthly workflow for processing data, reviewing issues, and calculating closed-month KPIs. It ensures the dashboard reflects accurate, verified data.

## 1. Open Month Data Collection
- Continuously gather data from active mentoring sessions, events, and system interactions throughout the current (open) month.
- Data remains in a dynamic state and is not yet considered "official" for high-level governance reporting.

## 2. Recap Import/Manual Entry
- At the end of the month, operational teams perform bulk imports of mentoring recaps.
- Missing or ad-hoc recaps are entered manually via the system's data entry interface.

## 3. Data Issue Review
- Administrators review the system-generated data issue queue.
- Common issues (e.g., missing participant information, invalid dates, duplicate entries) are investigated and corrected using the admin correction workflow.

## 4. Follow-up Queue Review
- Review the queue for relationships that require intervention (e.g., matches with zero activity, low feedback scores).
- Assign action items or contact relevant mentors/mentees.

## 5. Closed-Month KPI Calculation
- Once all imports are complete and major data issues are resolved, trigger the system process to calculate the final KPIs for the month that just closed.

## 6. Insert/Update `season_monthly_kpis`
- The system commits the calculated metrics to the `season_monthly_kpis` database table. This finalizes the data for that period.

## 7. Dashboard Finalization
- The Home Dashboard and official Operations reports update to read exclusively from the newly generated closed-month snapshot, ensuring executive visibility is based on a stable, verified foundation rather than fluctuating open-month data.
