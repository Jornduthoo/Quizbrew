// Small settings file next to the app (data/settings.json). The installed Windows app keeps it in
// %LOCALAPPDATA%\Quizbrew instead (QUIZBREW_DATA), because Program Files and the Store package are read-only.
const fs = require('fs');
const path = require('path');

function create(dir = process.env.QUIZBREW_DATA || path.join(__dirname, '..', 'data')) {
  const file = path.join(dir, 'settings.json');
  let values = {};
  try { values = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first start */ }
  return {
    get: key => values[key],
    set(key, value) {
      values[key] = value;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(values, null, 2));
      } catch (err) {
        console.error('Could not save settings:', err.message);
      }
    },
  };
}

module.exports = { create };
