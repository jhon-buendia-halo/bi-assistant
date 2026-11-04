/* eslint-disable */
// Starts a throwaway embedded PostgreSQL, creates `smokedb`, loads seed.sql and
// stays up until SIGTERM/SIGINT, then stops the server. Run from a directory
// where `embedded-postgres` and `pg` are installed (run.sh does this).
//   node start-postgres.cjs <dataDir> <port> <seed.sql>
const fs = require('fs');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');

const [dataDir, portArg, seedPath] = process.argv.slice(2);
const port = Number(portArg);
if (!dataDir || !port || !seedPath) {
  console.error('usage: node start-postgres.cjs <dataDir> <port> <seed.sql>');
  process.exit(2);
}

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: false,
  onLog: () => undefined,
});

let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  try {
    await pg.stop();
  } catch (err) {
    console.error('stop failed:', err && err.message);
  }
  process.exit(code);
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

(async () => {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('smokedb');
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'postgres',
    database: 'smokedb',
  });
  await client.connect();
  await client.query(fs.readFileSync(seedPath, 'utf8'));
  await client.end();
  console.log(`POSTGRES READY on 127.0.0.1:${port}/smokedb`);
})().catch((err) => {
  console.error('postgres setup failed:', err && err.message);
  stop(1);
});
