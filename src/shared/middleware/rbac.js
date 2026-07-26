'use strict';

/**
 * src/shared/middleware/rbac.js
 *
 * Role-based access control. Expects an upstream auth middleware (not
 * included in this scope) to have already populated `req.user` with at
 * least `{ id, role }` — e.g. from a verified JWT.
 *
 * Role hierarchy (low -> high privilege):
 *   VOLUNTEER < ELDER < PASTOR < ADMIN
 *
 * Higher roles automatically satisfy lower-role requirements, i.e.
 * requireRole('ELDER') also admits PASTOR and ADMIN.
 */

const ROLES = Object.freeze({
  VOLUNTEER: 'volunteer',
  ELDER: 'elder',
  PASTOR: 'pastor',
  ADMIN: 'admin',
});

// Rank determines the privilege hierarchy used by requireRole().
const ROLE_RANK = Object.freeze({
  [ROLES.VOLUNTEER]: 0,
  [ROLES.ELDER]: 1,
  [ROLES.PASTOR]: 2,
  [ROLES.ADMIN]: 3,
});

/**
 * Build Express middleware that requires the authenticated user to hold
 * at least the given role (by rank), or one of an explicit set of roles.
 *
 * @param {string} minimumRole - one of ROLES; user's rank must be >= this rank.
 * @returns {import('express').RequestHandler}
 */
function requireRole(minimumRole) {
  if (!(minimumRole in ROLE_RANK)) {
    throw new Error(`[rbac] Unknown role passed to requireRole: ${minimumRole}`);
  }

  return function rbacMiddleware(req, res, next) {
    const user = req.user;

    if (!user || !user.role) {
      return res.status(401).json({ error: 'Unauthorized: no authenticated user context.' });
    }

    const userRank = ROLE_RANK[user.role];
    if (userRank === undefined) {
      return res.status(403).json({ error: `Forbidden: unrecognized role '${user.role}'.` });
    }

    if (userRank < ROLE_RANK[minimumRole]) {
      return res.status(403).json({
        error: `Forbidden: this resource requires role '${minimumRole}' or higher.`,
      });
    }

    return next();
  };
}

/**
 * Middleware that restricts access to a specific, exact set of roles
 * rather than a rank threshold — useful for pastorally sensitive data
 * (e.g. Churn Alerts) that should not simply cascade to Admin by rank
 * alone without explicit intent, or should exclude a role even though
 * it outranks another for most purposes.
 *
 * @param {...string} allowedRoles
 * @returns {import('express').RequestHandler}
 */
function requireExactRole(...allowedRoles) {
  return function rbacExactMiddleware(req, res, next) {
    const user = req.user;
    if (!user || !user.role) {
      return res.status(401).json({ error: 'Unauthorized: no authenticated user context.' });
    }
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: `Forbidden: requires one of [${allowedRoles.join(', ')}].`,
      });
    }
    return next();
  };
}

module.exports = { ROLES, ROLE_RANK, requireRole, requireExactRole };