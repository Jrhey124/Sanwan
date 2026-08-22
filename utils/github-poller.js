/**
 * utils/github-poller.js
 *
 * GitHub integration via scheduled API polling (no public URL required).
 *
 * ── Modes ────────────────────────────────────────────────────────────────────
 *
 *   polling      Public repos only.  Uses unauthenticated GitHub REST API.
 *                Rate limit: 60 requests/hour.
 *
 *   polling_pat  Public and private repos.  Uses a Personal Access Token set
 *                in GITHUB_PAT.  Rate limit: 5 000 requests/hour.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *  1. startPolling(opts) begins a setInterval loop at the configured interval.
 *  2. On each tick it fetches /repos/:owner/:repo/commits and
 *     /repos/:owner/:repo/issues?state=open from the GitHub REST API.
 *  3. New items (not seen in the previous tick) are emitted as events on the
 *     returned EventEmitter so the bot can react to them.
 *
 * ── Emitted events ───────────────────────────────────────────────────────────
 *
 *   "commits"  → { repo, commits: CommitSummary[] }
 *   "issues"   → { repo, issues: IssueSummary[]  }
 *   "error"    → Error
 *
 * ── Env vars used ────────────────────────────────────────────────────────────
 *
 *   GITHUB_MODE          polling | polling_pat | webhook
 *   GITHUB_REPO          owner/repo  e.g. "octocat/Hello-World"
 *   GITHUB_PAT           Personal Access Token  (polling_pat only)
 *   GITHUB_POLL_INTERVAL Polling interval in milliseconds (default 60000)
 *
 * ── Exported API ─────────────────────────────────────────────────────────────
 *
 *   startPolling(opts?)  → EventEmitter   (start the poll loop)
 *   stopPolling()        → void           (clear the interval)
 */

'use strict';

const https        = require('https');
const EventEmitter = require('events');
const logger       = require('./logger');

// ─── Module-level state ───────────────────────────────────────────────────────

let _timer   = null;
const _emitter = new EventEmitter();

// Seen-set keepers so we only emit genuinely new items each tick
let _seenCommits = new Set();
let _seenIssues  = new Set();

// ─── HTTP helper ──────────────────────────────────────────────────────────────

/**
 * Minimal HTTPS GET for the GitHub REST API.
 * Returns parsed JSON or throws on non-2xx status.
 *
 * @param {string}      urlPath  e.g. "/repos/octocat/Hello-World/commits"
 * @param {string|null} pat      Personal Access Token, or null for public
 * @returns {Promise<any>}
 */
function _githubGet(urlPath, pat = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent':  'Sanwan-Bot/1.0',
      'Accept':      'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    if (pat) {
      headers['Authorization'] = `Bearer ${pat}`;
    }

    const options = {
      hostname: 'api.github.com',
      path:     urlPath,
      method:   'GET',
      headers
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        if (res.statusCode === 304) {
          // Not Modified — etag match, nothing new
          resolve(null);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(
            `GitHub API ${res.statusCode} for ${urlPath}: ${body.slice(0, 200)}`
          ));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`GitHub API returned non-JSON for ${urlPath}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ─── Per-tick fetchers ────────────────────────────────────────────────────────

/**
 * Fetch the latest commits and emit only new ones.
 *
 * @param {string}      repo   "owner/repo"
 * @param {string|null} pat
 */
async function _pollCommits(repo, pat) {
  try {
    const data = await _githubGet(`/repos/${repo}/commits?per_page=10`, pat);
    if (!data) return; // 304 Not Modified

    const newCommits = data
      .filter(c => !_seenCommits.has(c.sha))
      .map(c => ({
        sha:     c.sha,
        short:   c.sha.slice(0, 7),
        message: c.commit?.message?.split('\n')[0] ?? '',
        author:  c.commit?.author?.name ?? c.author?.login ?? 'unknown',
        url:     c.html_url
      }));

    // Mark all fetched SHAs as seen
    data.forEach(c => _seenCommits.add(c.sha));

    if (newCommits.length > 0 && _seenCommits.size > newCommits.length) {
      // Only emit after the first full seed tick so we don't flood on startup
      _emitter.emit('commits', { repo, commits: newCommits });
      logger.info(`[poller] ${newCommits.length} new commit(s) on ${repo}`);
    }

  } catch (err) {
    logger.warn(`[poller] commits fetch failed for ${repo}`, { error: err.message });
    _emitter.emit('error', err);
  }
}

/**
 * Fetch open issues and emit only newly opened ones.
 *
 * @param {string}      repo
 * @param {string|null} pat
 */
async function _pollIssues(repo, pat) {
  try {
    const data = await _githubGet(`/repos/${repo}/issues?state=open&per_page=20`, pat);
    if (!data) return;

    const newIssues = data
      .filter(i => !i.pull_request)             // skip PRs that appear in issues
      .filter(i => !_seenIssues.has(i.number))
      .map(i => ({
        number: i.number,
        title:  i.title,
        author: i.user?.login ?? 'unknown',
        url:    i.html_url,
        labels: (i.labels ?? []).map(l => l.name)
      }));

    data
      .filter(i => !i.pull_request)
      .forEach(i => _seenIssues.add(i.number));

    if (newIssues.length > 0 && _seenIssues.size > newIssues.length) {
      _emitter.emit('issues', { repo, issues: newIssues });
      logger.info(`[poller] ${newIssues.length} new issue(s) on ${repo}`);
    }

  } catch (err) {
    logger.warn(`[poller] issues fetch failed for ${repo}`, { error: err.message });
    _emitter.emit('error', err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the polling loop.
 *
 * @param {{
 *   repo?:     string,   override GITHUB_REPO env var
 *   pat?:      string,   override GITHUB_PAT env var
 *   interval?: number    override GITHUB_POLL_INTERVAL env var (ms)
 * }} opts
 *
 * @returns {EventEmitter}  Emits "commits", "issues", "error"
 */
function startPolling(opts = {}) {
  const mode     = process.env.GITHUB_MODE || 'polling';
  const repo     = opts.repo     || process.env.GITHUB_REPO || '';
  const pat      = opts.pat      || (mode === 'polling_pat' ? process.env.GITHUB_PAT : null) || null;
  const interval = opts.interval || Number(process.env.GITHUB_POLL_INTERVAL || 60_000);

  if (!repo) {
    logger.warn('[poller] GITHUB_REPO not set — polling disabled.');
    return _emitter;
  }

  if (mode === 'polling_pat' && !pat) {
    logger.warn('[poller] GITHUB_MODE=polling_pat but GITHUB_PAT is not set — falling back to unauthenticated polling.');
  }

  logger.info(`[poller] Starting GitHub polling`, {
    repo, mode,
    interval: `${interval / 1000}s`,
    authenticated: !!pat
  });

  // Seed the seen-sets on first tick without emitting, then emit on changes
  const tick = async () => {
    await _pollCommits(repo, pat);
    await _pollIssues(repo, pat);
  };

  tick(); // immediate first tick (seeds the seen-sets)

  _timer = setInterval(tick, interval);

  return _emitter;
}

/**
 * Stop the polling loop.
 */
function stopPolling() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('[poller] GitHub polling stopped.');
  }
}

module.exports = { startPolling, stopPolling, emitter: _emitter };
