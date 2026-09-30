/**
 * utils/github-webhook.js
 *
 * Lightweight Express HTTP server that receives GitHub webhook payloads
 * and emits them as EventEmitter events so the rest of the bot can react.
 *
 * ── How it works ────────────────────────────────────────────────────────────
 *
 *  1. GitHub → POST /webhook  (X-Hub-Signature-256 verified)
 *  2. GitHubWebhook emits event named after X-GitHub-Event, e.g. "push"
 *  3. Listeners added with  webhook.on('push', handler)  react to the payload
 *  4. The bot (sanwan.js) registers listeners that call Discord channels
 *
 * ── Setup ───────────────────────────────────────────────────────────────────
 *
 *  .env keys used:
 *    GITHUB_WEBHOOK_SECRET   – secret you enter in GitHub repo settings
 *    GITHUB_WEBHOOK_PORT     – port to listen on (default: 3000)
 *    GITHUB_WEBHOOK_PATH     – URL path (default: /webhook)
 *
 * ── Supported GitHub events ─────────────────────────────────────────────────
 *
 *  "push"            – commit pushed to any branch
 *  "pull_request"    – PR opened/closed/merged
 *  "issues"          – issue opened/closed/commented
 *  "workflow_run"    – GitHub Actions workflow completed
 *  "release"         – release published
 *  "*"               – catch-all for any event
 */

'use strict';

const http         = require('http');
const crypto       = require('crypto');
const EventEmitter = require('events');
const logger       = require('./logger');

class GitHubWebhook extends EventEmitter {
  /**
   * @param {{
   *   secret?: string,   HMAC secret (from GITHUB_WEBHOOK_SECRET or opts)
   *   port?: number,
   *   path?: string
   * }} opts
   */
  constructor(opts = {}) {
    super();

    this.secret = opts.secret || process.env.GITHUB_WEBHOOK_SECRET || '';
    this.port   = Number(opts.port  || process.env.GITHUB_WEBHOOK_PORT || 3000);
    this.path   = opts.path  || process.env.GITHUB_WEBHOOK_PATH  || '/webhook';
    this.maxBodyBytes = opts.maxBodyBytes || 25 * 1024 * 1024;

    this._server = null;
  }

  // ─── Server lifecycle ────────────────────────────────────────────────────

  /** Start the HTTP server. Returns a Promise that resolves when listening. */
  start() {
    return new Promise((resolve, reject) => {
      if (!this.secret) {
        reject(new Error('GITHUB_WEBHOOK_SECRET is required to start the webhook server.'));
        return;
      }
      this._server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      this._server.once('error', reject);

      this._server.listen(this.port, () => {
        logger.info('GitHub webhook server started', {
          port: this.port,
          path: this.path
        });
        console.log(`🪝 GitHub webhook listening on http://localhost:${this.port}${this.path}`);
        resolve();
      });
    });
  }

  /** Stop the server gracefully. */
  stop() {
    return new Promise(resolve => {
      if (!this._server) return resolve();
      this._server.close(() => {
        logger.info('GitHub webhook server stopped');
        resolve();
      });
    });
  }

  // ─── Request handler ─────────────────────────────────────────────────────

  _handleRequest(req, res) {
    // Only accept POST on the configured path
    if (req.method !== 'POST' || req.url !== this.path) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (!this.secret) {
      res.writeHead(503);
      res.end('Webhook signature verification is not configured');
      return;
    }

    // Collect body
    const chunks = [];
    let bodyBytes = 0;
    let bodyRejected = false;
    req.on('data', chunk => {
      if (bodyRejected) return;
      bodyBytes += chunk.length;
      if (bodyBytes > this.maxBodyBytes) {
        bodyRejected = true;
        res.writeHead(413);
        res.end('Payload too large');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (bodyRejected) return;
      const body = Buffer.concat(chunks);

      // ── Signature verification ──────────────────────────────────────────
      if (this.secret) {
        const sigHeader = req.headers['x-hub-signature-256'] || '';
        const expected  = 'sha256=' + crypto
          .createHmac('sha256', this.secret)
          .update(body)
          .digest('hex');

        // Constant-time comparison to resist timing attacks
        const sigBuffer = Buffer.from(sigHeader);
        const expBuffer = Buffer.from(expected);

        const signaturesMatch =
          sigBuffer.length === expBuffer.length &&
          crypto.timingSafeEqual(sigBuffer, expBuffer);

        if (!signaturesMatch) {
          logger.warn('GitHub webhook: signature mismatch — request rejected', {
            received: sigHeader.substring(0, 20) + '...'
          });
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }
      }

      // ── Parse payload ───────────────────────────────────────────────────
      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch (err) {
        logger.warn('GitHub webhook: invalid JSON payload', { error: err.message });
        res.writeHead(400);
        res.end('Bad request');
        return;
      }

      const event = req.headers['x-github-event'] || 'unknown';
      const delivery = req.headers['x-github-delivery'] || 'n/a';

      logger.info(`GitHub event received: ${event}`, { delivery });

      // ── Acknowledge immediately ─────────────────────────────────────────
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, event }));

      // ── Emit named event + wildcard ─────────────────────────────────────
      const enriched = { event, delivery, payload, receivedAt: new Date().toISOString() };

      this.emit(event, enriched);   // e.g. "push", "pull_request"
      this.emit('*', enriched);     // catch-all
    });

    req.on('error', err => {
      if (res.writableEnded) return;
      logger.error('GitHub webhook request error', { error: err.message });
      res.writeHead(500);
      res.end('Internal server error');
    });
  }

  // ─── Pre-built action wrappers ─────────────────────────────────────────────

  /**
   * Register a handler for push events.
   * Calls handler({ branch, commits, pusher, repo, delivery }).
   */
  onPush(handler) {
    this.on('push', ({ payload, delivery }) => {
      const branch = (payload.ref || '').replace('refs/heads/', '');
      handler({
        branch,
        commits:  payload.commits   || [],
        pusher:   payload.pusher    || {},
        repo:     payload.repository?.full_name || 'unknown',
        delivery
      });
    });
  }

  /**
   * Register a handler for pull_request events.
   * Calls handler({ action, number, title, url, author, repo, delivery }).
   */
  onPullRequest(handler) {
    this.on('pull_request', ({ payload, delivery }) => {
      const pr = payload.pull_request || {};
      handler({
        action:   payload.action,
        number:   pr.number,
        title:    pr.title,
        url:      pr.html_url,
        author:   pr.user?.login,
        repo:     payload.repository?.full_name || 'unknown',
        delivery
      });
    });
  }

  /**
   * Register a handler for workflow_run events.
   * Calls handler({ workflow, conclusion, branch, url, repo, delivery }).
   */
  onWorkflowRun(handler) {
    this.on('workflow_run', ({ payload, delivery }) => {
      const run = payload.workflow_run || {};
      handler({
        workflow:   run.name,
        conclusion: run.conclusion,   // success | failure | cancelled | …
        branch:     run.head_branch,
        url:        run.html_url,
        repo:       payload.repository?.full_name || 'unknown',
        delivery
      });
    });
  }

  /**
   * Register a handler for release events.
   * Calls handler({ action, tag, name, url, repo, delivery }).
   */
  onRelease(handler) {
    this.on('release', ({ payload, delivery }) => {
      const rel = payload.release || {};
      handler({
        action:   payload.action,
        tag:      rel.tag_name,
        name:     rel.name,
        url:      rel.html_url,
        repo:     payload.repository?.full_name || 'unknown',
        delivery
      });
    });
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

/** Return a pre-configured instance (not yet started). */
function createWebhook(opts = {}) {
  return new GitHubWebhook(opts);
}

module.exports = { GitHubWebhook, createWebhook };
