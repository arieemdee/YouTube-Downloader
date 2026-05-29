const fs = require('fs');
const path = require('path');

const { BASE_DIR } = require('./paths');

const historyPath = path.join(BASE_DIR, 'config', 'history.json');

function ensureHistoryFile() {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  if (!fs.existsSync(historyPath)) {
    fs.writeFileSync(historyPath, '[]', 'utf8');
  }
}

function loadHistory() {
  ensureHistoryFile();
  try {
    return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch (error) {
    return [];
  }
}

function saveHistory(entries) {
  ensureHistoryFile();
  fs.writeFileSync(historyPath, JSON.stringify(entries, null, 2), 'utf8');
}

function addHistoryRecord(record) {
  const entries = loadHistory();
  const nextEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'success',
    createdAt: new Date().toISOString(),
    ...record
  };

  const updated = [nextEntry, ...entries].slice(0, 10);
  saveHistory(updated);
  return updated;
}

function getHistory() {
  return loadHistory();
}

module.exports = {
  addHistoryRecord,
  getHistory,
  loadHistory,
  saveHistory
};
