#!/usr/bin/env node
// Seeds the throwaway database live/docker.mjs started: waits until it accepts connections, then
// creates orders (with personal-data columns) and two rows; on mysql/mariadb also a table named address
// and a view whose column is named by its expression (UPPER(recv_hp)), as a decrypting view is. Writes, so it uses the drivers directly,
// never the read-only server. Env: DBRO_LIVE_VENDOR, DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME.
const { DBRO_LIVE_VENDOR: vendor, DB_HOST: host, DB_PORT: port, DB_USER: user, DB_PASS: password, DB_NAME: database } = process.env;

const TABLE = {
  mysql: 'CREATE TABLE orders (id INT PRIMARY KEY, order_nm VARCHAR(20), recv_hp VARCHAR(20), shop_cd VARCHAR(10), reg_date DATETIME)',
  postgres: 'CREATE TABLE orders (id INT PRIMARY KEY, order_nm VARCHAR(20), recv_hp VARCHAR(20), shop_cd VARCHAR(10), reg_date TIMESTAMP)',
  oracle: 'CREATE TABLE orders (id NUMBER(10) PRIMARY KEY, order_nm VARCHAR2(20), recv_hp VARCHAR2(20), shop_cd VARCHAR2(10), reg_date DATE)',
};
const ROWS = [
  [1, 'Kim', '010-0000-0001', 'A', '2026-01-01 10:00:00'],
  [2, 'Lee', '010-0000-0002', 'B', '2026-01-02 10:00:00'],
];

async function connect() {
  if (vendor === 'mysql' || vendor === 'mariadb') {
    const mysql = (await import('mysql2/promise')).default;
    const c = await mysql.createConnection({ host, port: Number(port), user, password, database });
    return {
      run: (sql, v) => c.query(sql, v),
      table: TABLE.mysql,
      insert: 'INSERT INTO orders VALUES (?, ?, ?, ?, ?)',
      extra: ['CREATE TABLE address (id INT PRIMARY KEY, shop_cd VARCHAR(10))', 'CREATE VIEW v_orders AS SELECT id, UPPER(recv_hp) FROM orders'],
      end: () => c.end(),
    };
  }
  if (vendor === 'postgres') {
    const pg = (await import('pg')).default;
    const c = new pg.Client({ host, port: Number(port), user, password, database });
    await c.connect();
    return { run: (sql, v) => c.query(sql, v), table: TABLE.postgres, insert: 'INSERT INTO orders VALUES ($1, $2, $3, $4, $5)', end: () => c.end() };
  }
  if (vendor === 'oracle') {
    const oracledb = (await import('oracledb')).default;
    const c = await oracledb.getConnection({ user, password, connectString: `${host}:${port}/${database}` });
    return {
      run: (sql, v = []) => c.execute(sql, v, { autoCommit: true }),
      table: TABLE.oracle,
      insert: "INSERT INTO orders VALUES (:1, :2, :3, :4, TO_DATE(:5, 'YYYY-MM-DD HH24:MI:SS'))",
      end: () => c.close(),
    };
  }
  throw new Error(`unknown vendor ${vendor}`);
}

const deadline = Date.now() + Number(process.env.DBRO_SEED_WAIT_MS || 300_000);
let db;
for (;;) {
  try {
    db = await connect();
    break;
  } catch (e) {
    if (Date.now() > deadline) throw new Error(`${vendor} not ready: ${e.code ?? ''} ${e.message}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
await db.run(db.table);
for (const r of ROWS) await db.run(db.insert, r);
for (const s of db.extra ?? []) await db.run(s);
await db.end();
process.stderr.write(`seeded ${vendor}: orders (2 rows)\n`);
