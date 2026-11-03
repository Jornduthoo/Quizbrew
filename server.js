// Start Quizbrew: node server.js (or npm start). PORT=4000 node server.js picks another port.
const { createServer } = require('./src/app');
const { lanAddresses } = require('./src/network');

const port = Number(process.env.PORT) || 3000;
const qb = createServer({ port });

qb.server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\n  Port ${port} is already in use. Is Quizbrew already running?\n  Try another port: PORT=${port + 1} npm start\n`);
  else console.error(err);
  process.exit(1);
});

process.on('uncaughtException', err => console.error('Unexpected error:', err));
process.on('unhandledRejection', err => console.error('Unexpected error:', err));

qb.listen().then(p => {
  const lan = lanAddresses()[0];
  console.log('\n  Quizbrew is running.\n');
  console.log(`  Quizmaster:  http://localhost:${p}/host`);
  console.log(`  Big screen:  http://localhost:${p}/screen`);
  if (lan) console.log(`  Players:     http://${lan}:${p}/play`);
  else console.log('  No network found. Connect this laptop to wifi or a hotspot so phones can join.');
  console.log('');
});
