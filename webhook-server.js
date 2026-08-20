/**
 * webhook-server.js
 *
 * Standalone entrypoint for the GitHub webhook server.
 * Run with:  npm run webhook
 *
 * The server is also started inline inside sanwan.js when
 * GITHUB_WEBHOOK_SECRET or GITHUB_WEBHOOK_PORT is set, so you only need
 * this file if you want to run the webhook listener as a separate process.
 */

'use strict';

require('dotenv').config();

const logger  = require('./utils/logger');
const storage = require('./utils/storage');
const { createWebhook } = require('./utils/github-webhook');

const webhook = createWebhook();

// ── Push ──────────────────────────────────────────────────────────────────────
webhook.onPush(({ branch, commits, pusher, repo }) => {
  logger.info(`[webhook] push → ${repo}@${branch} by ${pusher.name} (${commits.length} commit(s))`);
  // TODO: wire redeploy logic here, e.g. spawn('git pull && npm restart')
});

// ── Pull request ──────────────────────────────────────────────────────────────
webhook.onPullRequest(({ action, number, title, repo }) => {
  logger.info(`[webhook] PR #${number} ${action}: "${title}" on ${repo}`);
});

// ── Workflow run ──────────────────────────────────────────────────────────────
webhook.onWorkflowRun(({ workflow, conclusion, repo }) => {
  if (!conclusion) return;
  logger.info(`[webhook] workflow "${workflow}" → ${conclusion} on ${repo}`);
});

// ── Release ───────────────────────────────────────────────────────────────────
webhook.onRelease(({ action, tag, repo }) => {
  if (action !== 'published') return;
  logger.info(`[webhook] release ${tag} published on ${repo}`);
});

// ── Catch-all for debugging ───────────────────────────────────────────────────
webhook.on('*', ({ event, delivery }) => {
  logger.info(`[webhook] event="${event}" delivery=${delivery}`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
webhook.start().catch(err => {
  logger.error('Webhook server failed to start', { error: err.message });
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  console.log('\n🛑 Stopping webhook server…');
  await webhook.stop();
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
