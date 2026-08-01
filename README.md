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
<img width="727" height="611" alt="image" src="https://github.com/user-attachments/assets/f7eb243b-5445-419e-a194-c13e8b4a7c9e" />


### Why a modular monolith

Each feature module (`attendance`, `sticky_analytics`) owns its own
`*.controller.js` (HTTP layer), `*.service.js` (business logic), and,
where needed, sub-processors (`cohort.processor.js`). Shared math lives
one layer down in `src/core/`, so both modules — and the future
`forecasting` module — reuse the same rolling-average, YoY, and
statistics primitives instead of re-implementing them.

## Data model

Four tables, provisioned via `scripts/provision-schema.js`:

- **campuses** — physical/online campus records
- **households** — family units, anchored to a primary campus
- **individuals** — people; carries `first_visit_date` used by the
  cohort pipeline, and `birthdate` used for age-bracket classification
- **check_ins** — the fact table (TimescaleDB hypertable, partitioned
  on `checkin_date`), one row per person per service attended

See `src/core/models/*.js` for full DDL and field-level validation.

## Time intelligence: why Easter-aware matching matters

Naively comparing "ISO Week 23 this year" to "ISO Week 23 last year"
breaks whenever Easter shifts years — Easter moves by up to five weeks
year over year, and it drags Palm Sunday/Holy Week attendance spikes
with it. `src/shared/utils/liturgicalCalendar.js` computes Easter
(Meeus/Jones/Butcher algorithm), Thanksgiving, Palm Sunday, and the
Sunday nearest Christmas for any year, then `core/aggregation/yoyComparison.js`
matches weeks by **offset in days from Easter** rather than by raw ISO
week number — so "this week" always maps to the liturgically
equivalent week a year ago, and anomalous weeks are flagged rather than
silently averaged in.

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Postgres/TimescaleDB credentials
node scripts/provision-schema.js   # creates campuses, households, individuals, check_ins
npm start                # or: npm run dev (auto-restart on change)
npm test                 # runs the pure-function unit suite (no DB required)
```

## API surface

All routes are mounted under `/api`. Authentication (populating
`req.user = { id, role }`) is expected to happen in upstream middleware
not included in this delivery — `src/shared/middleware/rbac.js`
documents the exact `role` contract it expects (`volunteer` < `elder` 
`pastor` < `admin`).

### Attendance (`/api/attendance`) — requires `elder` role or higher

| Method | Path | Description |
|---|---|---|
| GET | `/weekend` | Total unique weekend attendance, sliceable by campus/serviceTime/attendanceType/ageBracket |
| GET | `/breakdown` | Multi-dimensional Campus × ServiceTime × Type × AgeBracket matrix |
| GET | `/in-person-vs-online` | Single-weekend in-person vs. online split |
| GET | `/rolling-average` | 4-week and 12-week trailing rolling averages |
| GET | `/yoy` | Single-week YoY comparison (Easter-aligned) |
| GET | `/yoy-series` | Full date-range YoY trend (Easter-aligned) |

### Sticky Analytics (`/api/sticky`)

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/ratio` | elder+ | Stickiness Ratio for a single month |
| GET | `/ratio-trend` | elder+ | Stickiness Ratio across a month range |
| GET | `/churn-alerts` | pastor+ | Pastoral Churn Alert list with anomaly scores |
| GET | `/cohort-matrix` | elder+ | New Visitor Assimilation cohort matrix + decay curve |

`churn-alerts` is intentionally gated to `pastor` and above (not just
`elder`) since it surfaces individually identifiable pastoral-care
information.

## Key algorithms implemented

- **Rolling averages**: Postgres window functions (`AVG() OVER (... ROWS BETWEEN N PRECEDING AND CURRENT ROW)`), plus a pure-JS equivalent for post-processing.
- **YoY Matching Weeks**: Easter-offset week alignment (see above).
- **Stickiness Ratio**: `AVG(unique weekly attendees in month) / (distinct individuals active in month)`.
- **Pastoral Churn Alert**: flags individuals with 6-month baseline attendance frequency > 0.5 whose trailing 4-week attendance has dropped to 0, scored 0-100 by a recency- and baseline-weighted anomaly formula (`src/core/statistics/anomalyDetection.js`).
- **Cohort / Assimilation Pipeline**: per-individual Week 1/2/3/6 return flags aggregated into a cohort matrix and a church-wide decay curve (`src/modules/sticky_analytics/cohort.processor.js`).

## Testing

```bash
npm test
```

`tests/core_math.test.js` and `tests/sticky_logic.test.js` are pure
unit tests validating the math (rolling averages, Easter/Thanksgiving
computation, churn scoring, cohort decay) without requiring a live
database. SQL-backed integration tests against a real/test Postgres
instance are the natural next addition once CI has a database fixture.
