// Generates manifest.json for the Claude Desktop extension (.mcpb) from the running server's tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const client = new Client({ name: 'manifest', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/index.js'], env: { ...process.env, LIFE_COMPASS_DIR: mkdtempSync(path.join(tmpdir(), 'lc-m-')) } }));
const tools = (await client.listTools()).tools.map(t => ({ name: t.name, description: t.description.split('. ')[0].replace(/\.$/, '') + '.' }));
const prompts = (await client.listPrompts()).prompts.map(p => ({ name: p.name, description: p.description, text: 'Coach me through the Life Compass.' }));
await client.close();
const manifest = {
  manifest_version: '0.3',
  name: 'life-compass',
  display_name: 'Life Compass',
  version: pkg.version,
  description: 'An evidence-based reflection, goal and habit coach. Your plan stays on your computer.',
  long_description: 'Life Compass guides you from reflection to 1 to 3 goals to tiny daily habits, then keeps you going with short weekly, monthly and quarterly reviews. It is grounded in behavioural science: values work, goal setting, WOOP, implementation intentions, tiny habits, COM-B and habit-strength tracking. Say "Start my Life Compass" to begin, and "open my dashboard" to see your plan. Everything is saved in a file on your own computer.',
  author: { name: 'Life Compass contributors', url: 'https://github.com/naya85/life-compass' },
  repository: { type: 'git', url: 'https://github.com/naya85/life-compass.git' },
  homepage: 'https://github.com/naya85/life-compass',
  icon: 'icon.png',
  support: 'https://github.com/naya85/life-compass/issues',
  license: 'MIT',
  keywords: ['habits', 'goals', 'reflection', 'coaching', 'behavioural science', 'wellbeing'],
  server: {
    type: 'node',
    entry_point: 'src/index.js',
    mcp_config: { command: 'node', args: ['${__dirname}/src/index.js'], env: { LIFE_COMPASS_DIR: '${user_config.data_dir}' } },
  },
  tools, prompts,
  user_config: {
    data_dir: { type: 'directory', title: 'Where to keep your plan', description: 'A folder on your computer for your plan file. Nothing is ever sent anywhere else.', required: false, default: '${HOME}/.life-compass' },
  },
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
};
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json written: ${tools.length} tools, ${prompts.length} prompt`);
