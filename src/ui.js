#!/usr/bin/env node
// Opens the Life Compass dashboard in your browser: npm run ui
import { exec } from 'node:child_process';
import { startWeb } from './web.js';
import { PLAN_FILE } from './store.js';

const { url } = await startWeb();
console.log(`Life Compass dashboard: ${url}`);
console.log(`Reading ${PLAN_FILE}. Press Ctrl+C to stop.`);
if (!process.argv.includes('--no-open')){
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}
