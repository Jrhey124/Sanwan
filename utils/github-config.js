'use strict';

function resolveGitHubMode(choice, currentMode = 'none') {
  if (choice === '1') return 'polling';
  if (choice === '2') return 'webhook';
  return currentMode && currentMode !== 'none' ? currentMode : 'polling';
}

module.exports = { resolveGitHubMode };
