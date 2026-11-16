// MariaDB: the MySQL vendor (same driver, statement check and read-only session), with MariaDB's
// statement timeout variable.
import { createMysql } from './mysql.mjs';

export { checkQuery } from './mysql.mjs';
export default (cfg) => createMysql(cfg, 'mariadb');
