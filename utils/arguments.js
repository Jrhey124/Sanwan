'use strict';

/** Split a simple command argument template while preserving quoted groups. */
function tokenizeArguments(input) {
  const tokens = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(input)) !== null) {
    tokens.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'\\])/g, '$1'));
  }
  return tokens;
}

module.exports = { tokenizeArguments };
