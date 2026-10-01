/**
 * utils/queue.js
 *
 * Lightweight per-user command queue for Sanwan.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 *
 *  1. Receives a Discord interaction via enqueue().
 *  2. Runs Gate A (owner registry: isCommandAllowed).
 *  3. Runs Gate B (role permissions: checkPermission).
 *  4. If both pass → places the job in that user's queue and executes it.
 *     Each user has an independent FIFO queue so one slow command never
 *     blocks a different user.
 *  5. Logs every gate decision and execution result for traceability.
 *
 * ── Exported API ─────────────────────────────────────────────────────────────
 *
 *   enqueue(interaction, commandFn)  → Promise<void>
 *     interaction  — Discord ChatInputCommandInteraction
 *     commandFn    — async (interaction) => void   (the command's run())
 *
 *   stats()  → { queued: number, running: number, users: string[] }
 *
 * ── Queue behaviour ───────────────────────────────────────────────────────────
 *
 *  - One active job per user at a time.
 *  - Pending jobs are buffered in an in-memory array; there is no size cap
 *    because Discord's 3-second reply deadline means queues will drain fast.
 *  - If a user already has a job running, the new job is queued but the user
 *    gets an ephemeral "queued" acknowledgement so they know it was accepted.
 */

'use strict';

const logger      = require('./logger');
const registry    = require('./registry');
const permissions = require('./permissions');

// ─── Per-user queue map ───────────────────────────────────────────────────────

// userId → { running: boolean, jobs: Array<() => Promise<void>> }
const _queues = new Map();

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Get or create a queue bucket for a user. */
function _bucket(userId) {
  if (!_queues.has(userId)) {
    _queues.set(userId, { running: false, jobs: [] });
  }
  return _queues.get(userId);
}

/**
 * Drain the queue for a user one job at a time.
 * Sets running=false and deletes the bucket when the queue is empty.
 */
async function _drain(userId) {
  const bucket = _queues.get(userId);
  if (!bucket) return;

  while (bucket.jobs.length > 0) {
    const job = bucket.jobs.shift();
    try {
      await job();
    } catch (err) {
      // Job-level errors are already handled inside the job closure;
      // we log here as a safety net so a thrown error never stops the drain.
      logger.error('queue: unhandled error in job', { userId, error: err.message });
    }
  }

  bucket.running = false;
  _queues.delete(userId); // clean up when idle
}

// ─── Gate checks ──────────────────────────────────────────────────────────────

/**
 * Gate A — owner registry check.
 * Returns { allowed: boolean, reason: string }.
 */
function _gateA(commandName) {
  const allowed = registry.isCommandAllowed(commandName);
  return {
    allowed,
    reason: allowed
      ? 'enabled in registry'
      : `/${commandName} is not enabled on this device`
  };
}

/**
 * Gate B — Discord role check.
 * Returns { allowed: boolean, reason: string }.
 */
function _gateB(commandName, memberRoleIds) {
  return permissions.checkPermission(commandName, memberRoleIds);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue a command for execution.
 *
 * Runs permission gates synchronously before queuing.
 * If denied at either gate, replies immediately with ❌ and reason.
 * If allowed, places the job in the user's queue and starts draining.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {(interaction: any) => Promise<void>} commandFn
 */
async function enqueue(interaction, commandFn) {
  const commandName   = interaction.commandName;
  const userId        = interaction.user.id;
  const userTag       = interaction.user.tag;
  const memberRoleIds = interaction.member
    ? [...interaction.member.roles.cache.keys()]
    : [];

  // ── Gate A ────────────────────────────────────────────────────────────────
  let gateA;
  try {
    gateA = _gateA(commandName);
  } catch (error) {
    logger.error('queue: command registry check failed; command blocked', { command: commandName, error: error.message });
    await interaction.reply({
      content: '❌ Security settings could not be read. This command was blocked.',
      ephemeral: true
    }).catch(() => {});
    return;
  }
  if (!gateA.allowed) {
    logger.warn(`queue: Gate A denied /${commandName}`, { user: userTag, reason: gateA.reason });
    await interaction.reply({
      content: `❌ \`/${commandName}\` is not enabled on this device.\n> ${gateA.reason}`,
      ephemeral: true
    }).catch(() => {});
    return;
  }

  // ── Gate B ────────────────────────────────────────────────────────────────
  let gateB;
  try {
    gateB = _gateB(commandName, memberRoleIds);
  } catch (error) {
    logger.error('queue: role permission check failed; command blocked', { command: commandName, error: error.message });
    await interaction.reply({
      content: '❌ Security settings could not be read. This command was blocked.',
      ephemeral: true
    }).catch(() => {});
    return;
  }
  if (!gateB.allowed) {
    logger.warn(`queue: Gate B denied /${commandName}`, { user: userTag, reason: gateB.reason });
    await interaction.reply({
      content: `🔒 You don't have permission to run \`/${commandName}\`.\n> ${gateB.reason}`,
      ephemeral: true
    }).catch(() => {});
    return;
  }

  // ── Enqueue ───────────────────────────────────────────────────────────────
  const bucket  = _bucket(userId);
  const queued  = bucket.running; // true = another job is already in progress

  // A queued interaction must be acknowledged immediately. Once acknowledged,
  // command handlers must edit that response instead of calling reply again.
  // Preserve Discord.js' method binding while transparently handling both paths.
  const originalReply = interaction.reply.bind(interaction);
  if (queued) {
    interaction.reply = async payload => {
      if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
      return originalReply(payload);
    };
  }

  logger.info(`queue: ✅ /${commandName} enqueued`, {
    user:    userTag,
    queued:  queued,
    backlog: bucket.jobs.length
  });

  // If a job is already running for this user, acknowledge the queue position
  if (queued) {
    void originalReply({
      content: `⏳ \`/${commandName}\` is queued (position ${bucket.jobs.length + 1}) — it will run shortly.`,
      ephemeral: true
    }).catch(() => {});
  }

  // Build the job closure
  const job = async () => {
    const start = Date.now();
    logger.info(`queue: ▶ executing /${commandName}`, { user: userTag });
    try {
      await commandFn(interaction);
      const ms = Date.now() - start;
      logger.command(commandName, userTag, true, { ms });
    } catch (err) {
      const ms = Date.now() - start;
      logger.error(`queue: /${commandName} threw an error`, {
        user:  userTag,
        error: err.message,
        ms
      });

      // Attempt to surface the error to the user
      const msg = {
        content:   `❌ Something went wrong running \`/${commandName}\`.`,
        ephemeral: true
      };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg);
        } else {
          await interaction.reply(msg);
        }
      } catch { /* reply already sent or timed out — nothing more we can do */ }
    }
    logger.info(`queue: ✓ finished /${commandName}`, { user: userTag });
  };

  bucket.jobs.push(job);

  // Start the drain loop only if nothing is running for this user
  if (!bucket.running) {
    bucket.running = true;
    _drain(userId); // intentionally not awaited — runs in background
  }
}

/**
 * Return a snapshot of the current queue state (for diagnostics).
 *
 * @returns {{ queued: number, running: number, users: string[] }}
 */
function stats() {
  let queued  = 0;
  let running = 0;
  const users = [];

  _queues.forEach((bucket, userId) => {
    users.push(userId);
    queued  += bucket.jobs.length;
    if (bucket.running) running++;
  });

  return { queued, running, users };
}

module.exports = { enqueue, stats };
