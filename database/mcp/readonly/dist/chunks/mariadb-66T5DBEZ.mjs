#!/usr/bin/env node
// database-readonly MCP server, bundled by build.mjs — do not edit; edit the sources and run npm run build.
// sources: 379690eca612ddd0
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
import {
  checkQuery,
  createMysql
} from "./chunk-UVJEI5Q2.mjs";
import "./chunk-K2E2BWSH.mjs";
import "./chunk-M46VLRPB.mjs";

// vendors/mariadb.mjs
var mariadb_default = (cfg) => createMysql(cfg, "mariadb");
export {
  checkQuery,
  mariadb_default as default
};
