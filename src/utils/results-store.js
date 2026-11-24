'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;

/**
 * One JSON file per run (schema v1), grouped by month:
 *   <resultsDir>/2026-11/2026-11-24T00-30-12Z.json
 * File names sort in time order, and a month folder stays small (about 120 files).
 */
function runFilePath(resultsDir, timestamp) {
  const safe = timestamp.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return path.join(resultsDir, timestamp.slice(0, 7), `${safe}.json`);
}

function writeRun(resultsDir, run) {
  const file = runFilePath(resultsDir, run.timestamp);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(run, null, 2) + '\n');
  return file;
}

/** Every run in the results directory, oldest first. Unreadable files are skipped and reported. */
function readRuns(resultsDir) {
  if (!fs.existsSync(resultsDir)) return { runs: [], skipped: [] };
  const runs = [];
  const skipped = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) {
        try {
          const run = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (run.schemaVersion === SCHEMA_VERSION && Array.isArray(run.results)) runs.push(run);
          else skipped.push(full);
        } catch {
          skipped.push(full);
        }
      }
    }
  };
  walk(resultsDir);
  runs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { runs, skipped };
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

module.exports = { SCHEMA_VERSION, writeRun, readRuns, readJson, writeJson, runFilePath };
