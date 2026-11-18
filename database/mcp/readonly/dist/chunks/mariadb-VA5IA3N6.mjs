#!/usr/bin/env node
// database-readonly MCP server, bundled by build.mjs — do not edit; edit the sources and run npm run build.
// sources: 0f598961112e8f4a
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
import {
  checkQuery,
  createMysql
} from "./chunk-FWFBHFUF.mjs";
import "./chunk-25G6II45.mjs";
import "./chunk-HUUJICVI.mjs";

// vendors/mariadb.mjs
var mariadb_default = (cfg) => createMysql(cfg, "mariadb");
export {
  checkQuery,
  mariadb_default as default
};
