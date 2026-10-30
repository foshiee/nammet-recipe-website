// DEMO_MODE: a public demo hands out a shared admin login, so these routes are turned
// off. They would let a visitor lock others out, add accounts, spend or swap the API
// key, empty the site, or publish their own text and images to everyone else. Imports
// still work, since they only return a draft and save nothing. The site name and icon
// are kept as they are on appearance saves (see server.js). server.js checks this after the CSRF header and gives 401
// when signed out, 403 otherwise. tools/add-user.js edits the users file directly, so
// a reset script can still create the demo user.

import { config } from './config.js';

export const DEMO_BLOCKED = new Set([
  'POST /api/password',
  'POST /api/admin/users',
  'POST /api/admin/users/update',
  'POST /api/admin/users/delete',
  'POST /api/admin/api-key',
  'POST /api/admin/ai',
  'POST /api/admin/favicon',
  'POST /api/recipes',
  'POST /api/recipes/photo',
  'POST /api/recipes/photo/delete',
  'POST /api/recipes/delete'
]);

export function demoBlocked(routeKey, demo = config.demo) {
  return demo && DEMO_BLOCKED.has(routeKey);
}
