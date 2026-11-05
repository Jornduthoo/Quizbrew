// The start script built into Quizbrew.exe (a Node single executable application).
// It only loads the real app from the app\ folder next to the exe, so an update never needs a new exe.
const path = require('path');
const { createRequire } = require('module');

const launcher = path.join(path.dirname(process.execPath), 'app', 'desktop', 'launcher.js');
createRequire(launcher)(launcher).main();
