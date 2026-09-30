'use strict';

const MONTHS = Object.fromEntries(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((name, index) => [name, index + 1]));
const DAYS = Object.fromEntries(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((name, index) => [name, index]));

function fieldValue(value, index) {
  if (/^\d+$/.test(value)) return Number(value);
  const upper = value.toUpperCase();
  if (index === 3 && Object.hasOwn(MONTHS, upper)) return MONTHS[upper];
  if (index === 4 && Object.hasOwn(DAYS, upper)) return DAYS[upper];
  return NaN;
}

function isValidField(field, min, max, index) {
  return field.split(',').every(part => {
    if (!part) return false;
    const segments = part.split('/');
    if (segments.length > 2) return false;
    const step = segments.length === 2 ? Number(segments[1]) : null;
    if (step !== null && (!Number.isInteger(step) || step < 1)) return false;

    const base = segments[0];
    if (base === '*') return true;
    const range = base.split('-');
    if (range.length === 1) {
      const value = fieldValue(range[0], index);
      return Number.isInteger(value) && value >= min && value <= max;
    }
    if (range.length !== 2) return false;
    const start = fieldValue(range[0], index);
    const end = fieldValue(range[1], index);
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end;
  });
}

function isValidCronExpression(expression) {
  if (typeof expression !== 'string') return false;
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.every((field, index) => isValidField(field, ...bounds[index], index));
}

module.exports = { isValidCronExpression };
