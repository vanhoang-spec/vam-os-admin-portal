# PHASE D: Event & Activity Tracking Blueprint

This blueprint details the capabilities for managing auxiliary events, workshops, and training sessions within the VAM OS platform.

## Create Event/Training
- **Functionality**: Admins can create new scheduled events, specifying Title, Description, Date, Time, Location (or Link), Event Type (e.g., Training, Workshop, Social), and linking it to a specific `program_id` and `season_id`.

## Track Registration
- **Process**: Users can register (RSVP) for upcoming events.
- **Management**: Admins can view a roster of registered participants and manually add or remove registrations.

## Attendance Statuses
- **Attended**: The participant was present at the event.
- **Registered but did not attend**: The participant RSVP'd but was marked absent.
- **Tracking Mechanism**: Admins can use a bulk check-in interface or scan QR codes (future phase) to update statuses efficiently post-event.

## Feedback Collection
- **Distribution**: Automated or manual dispatch of feedback forms to users marked as "Attended."
- **Aggregation**: Collect ratings and qualitative comments linked to the specific event record.

## Event KPI Cards
- **Visibility**: Dashboard components specifically dedicated to event health, strictly filtered by `program_id` and `season_id`.
- **Metrics**: Total Events Held, Total Unique Attendees, Average Registration-to-Attendance Rate, Average Event Satisfaction Score.

## Monthly Event Reporting
- **Integration**: Event statistics are aggregated alongside mentoring recaps in the official monthly Operations report, providing a holistic view of community engagement.
