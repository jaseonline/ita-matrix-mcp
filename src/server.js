#!/usr/bin/env node
/**
 * stdio entrypoint — for local use by Claude Code / Claude Desktop's
 * claude_desktop_config.json. The HTTP entrypoint is http-server.js.
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createNodeServer } from "./node-runtime.js";

const server = createNodeServer();
await server.connect(new StdioServerTransport());
// stdout is the MCP channel — anything informational must go to stderr.
process.stderr.write("ita-matrix MCP server ready (stdio)\n");
