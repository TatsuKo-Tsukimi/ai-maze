'use strict';

const log = require('./utils/logger');

// gameId → { trials: [], cards: [] }
const _queues = new Map();

const MAX_TRIALS = 3;
const MAX_CARDS = 5;
const STALE_THRESHOLD = 3;

function _ensureQueue(gameId) {
  if (!_queues.has(gameId)) {
    _queues.set(gameId, { trials: [], cards: [] });
  }
  return _queues.get(gameId);
}

function _bucketFor(type) {
  return type === 'trial' ? 'trials' : 'cards';
}

function _maxFor(type) {
  return type === 'trial' ? MAX_TRIALS : MAX_CARDS;
}

/**
 * Get one ammo item from the queue. Returns null if empty.
 * @param {string} gameId
 * @param {'trial'|'card'} type
 * @returns {object|null}
 */
function getAmmo(gameId, type) {
  if (!gameId || (type !== 'trial' && type !== 'card')) return null;
  const queue = _queues.get(gameId);
  if (!queue) return null;
  const bucket = queue[_bucketFor(type)];
  return bucket.length > 0 ? bucket.shift() : null;
}

/**
 * Add an ammo item to the queue (respects max limits).
 * @param {string} gameId
 * @param {'trial'|'card'} type
 * @param {object} item - Must include preparedAtStep
 */
function addAmmo(gameId, type, item) {
  if (!gameId || !item || (type !== 'trial' && type !== 'card')) return;
  const queue = _ensureQueue(gameId);
  const bucket = queue[_bucketFor(type)];
  bucket.push(item);

  const max = _maxFor(type);
  while (bucket.length > max) {
    bucket.shift();
  }

  log.info('ammo-queue', `${type} ammo queued for ${gameId} (${queue.trials.length} trials, ${queue.cards.length} cards)`);
}

/**
 * Check if an ammo item is stale (prepared too many steps ago).
 * @param {object} item - Must have preparedAtStep
 * @param {number} currentStep
 * @returns {boolean}
 */
function isStale(item, currentStep) {
  if (!item || typeof item.preparedAtStep !== 'number') return true;
  return (Number(currentStep) || 0) - item.preparedAtStep > STALE_THRESHOLD;
}

/**
 * Get queue status for a game (for logging/debugging).
 * @param {string} gameId
 * @returns {{trials: number, cards: number}}
 */
function status(gameId) {
  const queue = _queues.get(gameId);
  if (!queue) return { trials: 0, cards: 0 };
  return {
    trials: queue.trials.length,
    cards: queue.cards.length,
  };
}

/**
 * Cleanup queue when game ends.
 * @param {string} gameId
 */
function cleanup(gameId) {
  if (!gameId) return;
  _queues.delete(gameId);
  log.info('ammo-queue', `cleaned up ammo queue for ${gameId}`);
}

module.exports = {
  getAmmo,
  addAmmo,
  isStale,
  status,
  cleanup,
  MAX_TRIALS,
  MAX_CARDS,
};
