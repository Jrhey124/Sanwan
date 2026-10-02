/**
 * utils/notifier.js
 *
 * Singleton notification hub for Sanwan.
 *
 * Three dedicated channels — each serves a distinct purpose:
 *
 *   taskChannel    Task lifecycle events: created, delegated, status changes,
 *                  deadline reminders sent by the daemon.
 *
 *   errorChannel   Server-side errors only: uncaught exceptions, failed
 *                  Discord operations, crypto failures, storage failures.
 *                  This is the channel logger.notifyDiscord() already posts to.
 *
 *   githubChannel  GitHub events only: push, PR, workflow run, release.
 *                  Falls back to errorChannel if not set.
 *
 * Usage
 * ─────
 *   // In sanwan.js after `client.once('ready', ...)`:
 *   notifier.init(client, { errorChannelId, taskChannelId, githubChannelId });
 *
 *   // Anywhere else:
 *   const notifier = require('./utils/notifier');
 *   await notifier.taskNotify(embed);
 *   await notifier.errorNotify(embed);
 *   await notifier.githubNotify(message);
 *
 * All send methods are best-effort and never throw.
 */

'use strict';

const logger = require('./logger');

// ─── Singleton state ──────────────────────────────────────────────────────────

let _client         = null;
let _errorChannelId = null;
let _taskChannelId  = null;
let _githubChannelId = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Wire the Discord client and channel IDs.
 * Called once from sanwan.js on the 'ready' event.
 *
 * @param {import('discord.js').Client} client
 * @param {{ errorChannelId?: string, taskChannelId?: string, githubChannelId?: string }} channels
 */
function init(client, { errorChannelId = null, taskChannelId = null, githubChannelId = null } = {}) {
  _client          = client;
  _errorChannelId  = errorChannelId;
  _taskChannelId   = taskChannelId;
  _githubChannelId = githubChannelId;

  logger.info(`Notifier ready — error:${errorChannelId ?? 'none'} task:${taskChannelId ?? 'none'} github:${githubChannelId ?? 'none'}`);
}

// ─── Internal send ────────────────────────────────────────────────────────────

/**
 * Post a payload to a Discord channel.
 * Payload can be a string or a discord.js message options object { embeds, content, … }.
 * Returns true on success, false on any failure.
 *
 * @param {string|null} channelId
 * @param {string|object} payload
 * @returns {Promise<boolean>}
 */
async function _post(channelId, payload) {
  if (!channelId || !_client) return false;
  try {
    const ch = await _client.channels.fetch(channelId);
    if (!ch) return false;
    await ch.send(payload);
    return true;
  } catch (err) {
    // Don't use logger.error here — that would cause a recursive loop
    // if the error channel itself is unreachable.
    console.error(`[notifier] failed to post to ${channelId}: ${err.message}`);
    return false;
  }
}

// ─── Public send methods ──────────────────────────────────────────────────────

/**
 * Post a task lifecycle notification to the task channel.
 *
 * @param {string|object} payload  Plain string or { embeds } object
 * @returns {Promise<boolean>}
 */
async function taskNotify(payload) {
  if (!_taskChannelId) return false;
  return _post(_taskChannelId, payload);
}

/**
 * Post an error notification to the error channel.
 * (logger.notifyDiscord already calls this indirectly — this method exists
 * for callers that want to post a custom embed rather than a plain string.)
 *
 * @param {string|object} payload
 * @returns {Promise<boolean>}
 */
async function errorNotify(payload) {
  if (!_errorChannelId) return false;
  return _post(_errorChannelId, payload);
}

/**
 * Post a GitHub event notification to the github channel.
 * Falls back to the error channel if no dedicated github channel is set.
 *
 * @param {string|object} payload
 * @returns {Promise<boolean>}
 */
async function githubNotify(payload) {
  const target = _githubChannelId ?? _errorChannelId;
  if (!target) return false;
  return _post(target, payload);
}

// ─── Embed builders ───────────────────────────────────────────────────────────
// Centralised embed shapes so every caller produces consistent messages.

/**
 * Build a task lifecycle embed.
 *
 * @param {{
 *   action:     string,   e.g. 'Created', 'Delegated', 'Status changed'
 *   tid:        string,
 *   title:      string,
 *   assignees?: string[],
 *   deadline?:  string,   formatted display string
 *   status?:    string,
 *   priority?:  string,
 *   by:         string,   interaction.user.tag
 * }} opts
 * @returns {object}  discord.js embed object
 */
function buildTaskEmbed({ action, tid, title, assignees, deadline, status, priority, by }) {
  const STATUS_EMOJI   = { open: '⚪', ongoing: '🔵', completed: '✅', closed: '🔒' };
  const PRIORITY_EMOJI = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };

  const COLOR = {
    Created:        0x57f287,  // green
    Delegated:      0x5865f2,  // blurple
    'Status changed': 0xfee75c, // yellow
    Completed:      0x57f287,
    Closed:         0x99aab5,
    Deleted:        0xed4245,  // red
  };

  const fields = [
    { name: 'ID',    value: `\`${tid}\``, inline: true },
    { name: 'Title', value: title,        inline: true }
  ];

  if (status)            fields.push({ name: 'Status',   value: `${STATUS_EMOJI[status]   ?? ''} ${status}`,   inline: true });
  if (priority)          fields.push({ name: 'Priority', value: `${PRIORITY_EMOJI[priority] ?? ''} ${priority}`, inline: true });
  if (assignees?.length) fields.push({ name: 'Assignees', value: assignees.join(', '),    inline: true });
  if (deadline)          fields.push({ name: 'Deadline',  value: deadline,                inline: true });

  return {
    embeds: [{
      color:       COLOR[action] ?? 0x5865f2,
      title:       `📋 Task ${action}`,
      fields,
      footer:      { text: `By ${by}` },
      timestamp:   new Date().toISOString()
    }]
  };
}

/**
 * Build a task deadline reminder embed (used by daemon.js).
 *
 * @param {{ tid: string, title: string, assignees: string[], deadline: string }} task
 * @returns {object}
 */
function buildReminderEmbed(task) {
  return {
    embeds: [{
      color:       0xffaa00,
      title:       '⏰ Task Reminder',
      description: `Task **${task.tid}** is due soon!`,
      fields: [
        { name: 'Title',     value: task.title,                          inline: false },
        { name: 'Assignees', value: (task.assignees ?? []).join(', ') || 'Unassigned', inline: true },
        { name: 'Deadline',  value: task.deadline ?? 'No deadline',     inline: true  }
      ],
      timestamp: new Date().toISOString()
    }]
  };
}

// ─── State accessors (used by debug.js) ──────────────────────────────────────

function getChannels() {
  return {
    errorChannelId:  _errorChannelId,
    taskChannelId:   _taskChannelId,
    githubChannelId: _githubChannelId
  };
}

function isReady() {
  return !!_client;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  init,
  taskNotify,
  errorNotify,
  githubNotify,
  buildTaskEmbed,
  buildReminderEmbed,
  getChannels,
  isReady
};
