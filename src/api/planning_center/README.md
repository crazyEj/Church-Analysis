# planning_center Ingestion — Out of Scope for This Delivery

This directory is scaffolded to match the target repository structure.
Webhook ingestion for planning_center is not implemented in this delivery, which
is scoped exclusively to the Attendance Analytics and Sticky Analytics
engines under `src/modules/`.

Both analytics engines are written against the `check_ins`,
`individuals`, `households`, and `campuses` tables defined in
`src/core/models/`. Any ingestion pipeline built here should write
into those tables using the `validate()` helper exported by each
model before insert, and should set `check_ins.source_system` to
'planning_center' so downstream analytics can trace data provenance back to the
originating platform if needed.