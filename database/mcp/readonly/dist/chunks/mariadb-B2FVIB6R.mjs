#!/usr/bin/env node
// database-readonly MCP server, bundled by build.mjs — do not edit; edit the sources and run npm run build.
// sources: 2828b65317574d22
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
import {
  checkQuery,
  createMysql
} from "./chunk-52OQXT5E.mjs";
import "./chunk-7A5PE64W.mjs";
import "./chunk-WTCPNGGB.mjs";

// vendors/mariadb.mjs
var mariadb_default = (cfg) => createMysql(cfg, "mariadb");
export {
  checkQuery,
  mariadb_default as default
};
