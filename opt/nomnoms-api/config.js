// All settings come from the environment. On the VM they are set in
// /etc/nomnoms/api.env, which systemd loads (see nomnoms-api.service).

const env = process.env;

const bool = (v, fallback) => (v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v));
const num = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);

export const config = {
  host: env.HOST || '127.0.0.1',
  port: num(env.PORT, 3000),

  recipesDir: env.RECIPES_DIR || '/var/www/nomnoms/recipes',
  usersFile: env.USERS_FILE || '/var/lib/nomnoms/users.json',

  // Admin page settings (appearance, Claude key/model/effort), and the public folder
  // the service writes the generated theme.css, site.json and favicon into.
  settingsFile: env.SETTINGS_FILE || '/var/lib/nomnoms/settings.json',
  themeDir: env.THEME_DIR || '/var/www/nomnoms/theme',

  // TLS ends at Traefik, so the service can't tell whether the browser used HTTPS.
  // Keep this on in production; turn it off only for local testing over plain http.
  cookieSecure: bool(env.COOKIE_SECURE, true),
  sessionHours: num(env.SESSION_HOURS, 24 * 7),

  // Only trust X-Real-IP when the request comes from these addresses (nginx on the same host).
  trustedProxies: (env.TRUSTED_PROXIES || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map((s) => s.trim()),

  maxUploadBytes: num(env.MAX_UPLOAD_MB, 20) * 1024 * 1024,
  maxFetchBytes: num(env.MAX_FETCH_MB, 5) * 1024 * 1024,

  // Claude fallback for PDFs, photos, plain text and pages without recipe markup.
  // A key, model or effort set on the admin page overrides these (see settings.js).
  apiKey: env.ANTHROPIC_API_KEY || '',
  model: env.MODEL || 'claude-sonnet-5-5',
  effort: env.EFFORT || 'medium',
  aiFallbacks: bool(env.AI_FALLBACKS, true),

  // Local testing only: serve the static site from this folder as well, so no nginx is needed.
  devStaticRoot: env.DEV_STATIC_ROOT || ''
};
