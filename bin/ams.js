#!/usr/bin/env node

const path = require('path');
const { startServer } = require('../server/index');

const args = process.argv.slice(2);

// Parse port from --port=XXXX argument
const portArg = args.find(a => a.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1], 10) : 6789;

// The project directory is the current working directory
const projectDir = process.cwd();

startServer(projectDir, port);
