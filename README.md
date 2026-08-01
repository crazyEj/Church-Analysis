# Church Analytics App — Backend Analytics Layer

An enterprise-grade backend analytics layer for a Church Ministry
Dashboard, built as a modular monolith following domain-driven design
principles. This delivery implements **two** fully-built modules:

1. **Attendance Analytics** (`src/modules/attendance/`) — unique
   attendance counting, multi-dimensional slicing, and time
   intelligence (rolling averages, Easter-aware YoY comparisons).
2. **Sticky Analytics** (`src/modules/sticky_analytics/`) — stickiness
   ratio, pastoral churn alerts, and the new visitor assimilation
   (cohort retention) pipeline.

Everything else in the folder structure (`forecasting/`, the
`api/planning_center|pushpay|tithely` ingestion stubs) is scaffolded to
match the target repository layout but intentionally left as
documented placeholders — see the `README.md` inside each of those
directories for what's needed to build them out next.

## Architecture
