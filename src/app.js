'use strict';

/**
 * src/app.js
 *
 * Application entrypoint. Wires up the two in-scope modules
 * (Attendance Analytics, Sticky Analytics) behind Express, with a
 * centralized error handler that respects `err.statusCode` set by
 * controllers/services (see attendance.controller.js / sticky.controller.js).
 *
 * NOTE: This app expects an upstream auth middleware to populate
 * `req.user = { id, role }` before requests reach the RBAC-protected
 * routes below (e.g. a JWT-verification middleware). That auth layer
 * is intentionally out of scope for this delivery — see
 * src/shared/middleware/rbac.js for the role contract it must satisfy.
 */

const express = require('express');

const attendanceController = require('./modules/attendance/attendance.controller');
const stickyController = require('./modules/sticky_analytics/sticky.controller');

function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'church-analytics-app', timestamp: new Date().toISOString() });
  });

  app.use('/api/attendance', attendanceController);
  app.use('/api/sticky', stickyController);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  // Centralized error handler. Controllers/services attach `statusCode`
  // to validation errors; anything without one is treated as a 500 and
  // logged (but never leaks internals to the client).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) {
      // eslint-disable-next-line no-console
      console.error('[app] Unhandled error:', err);
    }
    res.status(statusCode).json({
      error: statusCode >= 500 ? 'Internal server error' : err.message,
    });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[app] church-analytics-app listening on port ${port}`);
  });
}

module.exports = { createApp };