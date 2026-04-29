// Praeventio Guard — Round 18 Phase 3 split.
//
// Google OAuth (Calendar/Fit/Drive) endpoints extracted from server.ts.
// Closes the OAuth surface migration alongside curriculum + projects.
//
// Mount strategy (in server.ts):
//   • app.use('/api', oauthGoogleApiRouter)        ← /api/* paths
//   • app.use('/auth', oauthGoogleAuthRouter)      ← /auth/google/callback
//
// TWO routers because `/auth/google/callback` is the redirect URI registered
// in the Google Cloud Console for the app's OAuth client. Changing the path
// would require a Console update and break in-flight OAuth popups; keeping
// it root-mounted preserves the byte-identical URL while letting the rest
// of the OAuth surface live cleanly under `/api/...`.
//
// Final paths preserved verbatim — DO NOT change:
//   • POST /api/oauth/unlink
//   • GET  /api/auth/google/url
//   • GET  /auth/google/callback                  (root mount)
//   • GET  /api/calendar/list
//   • POST /api/calendar/sync
//   • POST /api/fitness/sync                      (DEPRECATED, sunset 2026-12-31)
//   • GET  /api/drive/auth/url
//   • GET  /api/drive/auth/callback
//
// Why this lives in ONE module despite spanning 3 logical surfaces (Calendar,
// Fit, Drive): all 8 endpoints share the same OAuth client configuration
// (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), the same token store
// (`oauthTokenStore.saveTokens` / `getValidAccessToken`), and the same
// session-bound CSRF state machinery. Splitting them would duplicate the
// 30 lines of OAuth boilerplate three times.

import { Router } from 'express';
import crypto from 'crypto';

import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  saveTokens,
  getValidAccessToken,
  revokeTokens,
} from '../../services/oauthTokenStore.js';
import { logger } from '../../utils/logger.js';

// ───────────────────────────────────────────────────────────────────────────
// OAuth client configuration. Mirrors server.ts; resolved at module-load
// from the same env vars. Empty-string fallback maintains the original
// behavior — Google rejects the token-exchange call which surfaces as a
// 5xx with the upstream error logged. We do NOT crash on missing creds at
// boot because dev environments commonly run without OAuth set up.
// ───────────────────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
  'https://www.googleapis.com/auth/fitness.body.read',
].join(' ');

// PORT mirrors server.ts — used to construct fallback APP_URL when env is
// not set. Local dev defaults to 3000 (matches server.ts listen()).
const PORT = 3000;

// ───────────────────────────────────────────────────────────────────────────
// Main /api/* router — covers unlink, URL issuance, list/sync proxies.
// ───────────────────────────────────────────────────────────────────────────
export const oauthGoogleApiRouter = Router();

// Server-side OAuth unlink: invoked by client logout flow before signOut.
// Deletes stored tokens for both Google providers. Idempotent — safe to call
// when no tokens exist.
oauthGoogleApiRouter.post('/oauth/unlink', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid;
  try {
    await Promise.all([
      revokeTokens({ uid, provider: 'google' }),
      revokeTokens({ uid, provider: 'google-drive' }),
    ]);
    // Round 17 R1 — audit row for revocation. Defensively wrapped so a
    // stale Firestore handle can't 5xx an otherwise successful unlink.
    try {
      await auditServerEvent(req, 'oauth.unlink', 'oauth', {
        providers: ['google', 'google-drive'],
      });
    } catch {
      /* observability never breaks request path */
    }
    res.json({ success: true });
  } catch (error: any) {
    logger.error('oauth_unlink_failed', { uid, message: error?.message });
    res.status(500).json({
      error: 'Failed to unlink OAuth tokens',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// API Routes
oauthGoogleApiRouter.get('/auth/google/url', verifyAuth, (req, res) => {
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/auth/google/callback`;

  const state = crypto.randomBytes(16).toString('hex');
  const sess = req.session as any;
  sess.oauthState = state;
  // Bind this OAuth flow to the authenticated user. The callback runs in a
  // popup that shares the session cookie, so we recover the UID there
  // without ever exposing it (or the resulting tokens) to the browser.
  sess.oauthInitiator = { uid: (req as any).user.uid, provider: 'google' as const };

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

// Proxy for Google Calendar API to avoid CORS.
// Uses tokens stored server-side via /auth/google/callback; the client never
// holds an OAuth access_token or refresh_token.
// List upcoming Calendar events (next 30 days) for predictive features.
// Used by useCalendarPredictions to detect already-scheduled CPHS meetings,
// ODI trainings, etc. and suppress duplicate suggestions.
oauthGoogleApiRouter.get('/calendar/list', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid;
  const accessToken = await getValidAccessToken(
    { uid, provider: 'google' },
    GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET || '',
  );
  if (!accessToken) {
    // Caller treats empty list as "no calendar" — return 200 with [] so the
    // predictions hook doesn't surface a noisy error to the user when they
    // haven't linked Google Calendar yet.
    return res.json({ items: [] });
  }
  try {
    const now = new Date();
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: in30Days.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      logger.warn('calendar_list_upstream_failed', { uid, status: response.status });
      return res.json({ items: [] });
    }
    const data = await response.json();
    res.json({ items: data.items ?? [] });
  } catch (error: any) {
    logger.error('calendar_list_failed', { uid, message: error?.message });
    res.json({ items: [] }); // graceful degradation
  }
});

oauthGoogleApiRouter.post('/calendar/sync', verifyAuth, async (req, res) => {
  const { challenges } = req.body;
  const uid = (req as any).user.uid;

  const accessToken = await getValidAccessToken(
    { uid, provider: 'google' },
    GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET || '',
  );
  if (!accessToken) {
    return res.status(401).json({ error: 'Google account not linked' });
  }

  try {
    const results = [];
    for (const challenge of challenges) {
      const event = {
        summary: `Desafío Praeventio: ${challenge}`,
        description:
          'Objetivo de seguridad y salud en el trabajo planificado desde Praeventio Guard.',
        start: {
          dateTime: new Date().toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
          timeZone: 'UTC',
        },
      };

      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        },
      );

      const data = await response.json();
      results.push(data);
    }

    // Round 17 R1 — audit the sync. Body shape: { challenges } (no PII
    // beyond the challenge titles) — we record the count, not the raw text.
    try {
      await auditServerEvent(req, 'calendar.sync', 'calendar', {
        count: Array.isArray(challenges) ? challenges.length : 0,
      });
    } catch {
      /* observability never breaks request path */
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error syncing with Google Calendar:', error);
    res.status(500).json({ error: 'Failed to sync with Google Calendar' });
  }
});

// Proxy for Google Fit API.
// Uses tokens stored server-side via /auth/google/callback; the client never
// holds an OAuth access_token or refresh_token.
//
// DEPRECATED — Round 3 of HEALTH_CONNECT_MIGRATION.md.
// Google Fit REST sunsets in 2026; the on-device replacements (Health
// Connect on Android, HealthKit on iOS) are already wired through
// `src/services/health/`. This endpoint stays alive as a web/legacy fallback
// until 2026-12-31, after which the route is removed entirely.
oauthGoogleApiRouter.post('/fitness/sync', verifyAuth, async (req, res) => {
  // Sunset / Deprecation signaling per RFC 8594. Clients that honor these
  // headers can surface their own deprecation UI; we also instrument every
  // hit so we can quantify residual call volume before the hard cutoff.
  res.setHeader('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
  res.setHeader('Deprecation', 'Wed, 31 Dec 2026 23:59:59 GMT');
  res.setHeader('Link', '</api/health-data>; rel="successor-version"');

  const uid = (req as any).user?.uid;

  // Structured deprecation log so we can quantify residual usage of the
  // legacy endpoint and confirm Telemetry.tsx truly stopped calling it.
  logger.warn('fitness_sync_deprecated_called', {
    uid,
    userAgent: req.header('user-agent') ?? 'unknown',
    sunset: '2026-12-31',
    successor: 'health-connect|healthkit (on-device, no server hop)',
  });

  const accessToken = await getValidAccessToken(
    { uid, provider: 'google' },
    GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET || '',
  );
  if (!accessToken) {
    return res.status(401).json({ error: 'Google account not linked' });
  }

  try {
    const endTime = Date.now();
    const startTime = endTime - 7 * 24 * 60 * 60 * 1000; // Last 7 days

    const response = await fetch(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          aggregateBy: [
            { dataTypeName: 'com.google.heart_rate.bpm' },
            { dataTypeName: 'com.google.step_count.delta' },
          ],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: startTime,
          endTimeMillis: endTime,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Fit API error:', errorText);
      return res.status(response.status).json({ error: 'Failed to fetch Google Fit data' });
    }

    const data = await response.json();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error syncing with Google Fit:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Google Drive Integration
oauthGoogleApiRouter.get('/drive/auth/url', verifyAuth, (req, res) => {
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/api/drive/auth/callback`;

  const state = crypto.randomBytes(16).toString('hex');
  const sess = req.session as any;
  sess.driveOauthState = state;
  sess.driveOauthInitiator = {
    uid: (req as any).user.uid,
    provider: 'google-drive' as const,
  };

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state: state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

oauthGoogleApiRouter.get('/drive/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/api/drive/auth/callback`;

  const sess = req.session as any;
  if (!state || state !== sess.driveOauthState) {
    return res.status(403).send('Invalid state parameter (CSRF protection)');
  }
  const initiator = sess.driveOauthInitiator;
  if (!initiator?.uid || initiator.provider !== 'google-drive') {
    return res.status(403).send('OAuth initiator missing from session');
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID || '',
        client_secret: GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();
    if (!tokens.access_token) {
      console.error('Drive token exchange returned no access_token:', tokens);
      return res.status(500).send('Token exchange failed');
    }

    await saveTokens({ uid: initiator.uid, provider: 'google-drive' }, tokens);

    delete sess.driveOauthState;
    delete sess.driveOauthInitiator;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'DRIVE_AUTH_SUCCESS',
                linked: true
              }, '${appUrl}');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Google Drive vinculado exitosamente. Puedes cerrar esta ventana.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in Google Drive Auth Callback:', error);
    res.status(500).send('Error during authentication');
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Root-mounted /auth/* router — single endpoint at /auth/google/callback.
// Path is fixed by Google Cloud Console configuration; cannot be moved.
// ───────────────────────────────────────────────────────────────────────────
export const oauthGoogleAuthRouter = Router();

oauthGoogleAuthRouter.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/auth/google/callback`;

  const sess = req.session as any;
  if (!state || state !== sess.oauthState) {
    return res.status(403).send('Invalid state parameter (CSRF protection)');
  }
  const initiator = sess.oauthInitiator;
  if (!initiator?.uid || initiator.provider !== 'google') {
    return res.status(403).send('OAuth initiator missing from session');
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID || '',
        client_secret: GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();
    if (!tokens.access_token) {
      console.error('Google token exchange returned no access_token:', tokens);
      return res.status(500).send('Token exchange failed');
    }

    // Store server-side; never reaches the browser.
    await saveTokens({ uid: initiator.uid, provider: 'google' }, tokens);

    // Round 17 R1 — audit the link event. The endpoint is intentionally
    // unauthed (verifyAuth never ran), so we recover the actor uid from the
    // session oauth-state initiator that /api/auth/google/url stamped before
    // the redirect. Wrapped so an audit failure can't break the popup
    // closure flow that the SPA depends on.
    try {
      await auditServerEvent(req, 'oauth.link', 'oauth', { provider: 'google' }, {
        actorOverride: { uid: initiator.uid, email: null },
      });
    } catch {
      /* observability never breaks request path */
    }

    delete sess.oauthState;
    delete sess.oauthInitiator;

    // Tell the popup that linking succeeded — payload contains NO tokens.
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'GOOGLE_AUTH_SUCCESS',
                linked: true
              }, '${appUrl}');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Cuenta vinculada exitosamente. Puedes cerrar esta ventana.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in Google Auth Callback:', error);
    res.status(500).send('Error during authentication');
  }
});
