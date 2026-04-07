'use strict';

/**
 * AI Maze Logger — Simple, colored logging with timestamp.
 * In a real production environment, you would use Winston or Pino.
 */

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgBlue: "\x1b[34m",
  fgCyan: "\x1b[36m",
  fgRed: "\x1b[31m",
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const Logger = {
  info: (tag, msg, ...args) => {
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.fgCyan}[${tag}]${colors.reset} ${msg}`, ...args);
  },
  warn: (tag, msg, ...args) => {
    console.warn(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.fgYellow}[${tag}] WARN:${colors.reset} ${msg}`, ...args);
  },
  error: (tag, msg, ...args) => {
    console.error(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.fgRed}[${tag}] ERROR:${colors.reset} ${msg}`, ...args);
  },
  success: (tag, msg, ...args) => {
    console.log(`${colors.dim}[${timestamp()}]${colors.reset} ${colors.fgGreen}[${tag}] SUCCESS:${colors.reset} ${msg}`, ...args);
  },
  debug: (tag, msg, ...args) => {
    if (process.env.DEBUG) {
      console.log(`${colors.dim}[${timestamp()}] [${tag}] DEBUG: ${msg}${colors.reset}`, ...args);
    }
  }
};

module.exports = Logger;
