#!/usr/bin/env node
// interrupted run: wrong import name, nothing printed yet
import { greet } from "../../fmt/src/index.mjs";

const name = process.argv.slice(2).join(" ");
