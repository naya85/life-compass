#!/usr/bin/env node
// Life Compass MCP server: runs the method inside whichever AI app the person uses.
// The AI asks the questions; this server holds the method and saves the plan to a local file.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { METHOD_VERSION, PHASES, RULES, VALUES_CARDS, CARD_SORT, methodText } from './method.js';
import { load, update, today, PLAN_FILE, DATA_DIR, ensurePrivateDir } from './store.js';
import { ACTIONS } from './actions.js';
import { status, lowEnergyStreak } from './coach.js';

const INSTRUCTIONS = `Life Compass is an evidence-based reflection, goal and habit coach. Start every session with get_status: it says which phase the person is in, the next question, and any reviews or lapses that are due. Follow the method (get_method, or the life_compass prompt) one question at a time, save answers with the tools as you go, and never assign goals: offer options and let the person choose. Plans are stored only on this computer, at ${PLAN_FILE}.`;

const server = new McpServer({ name: 'life-compass', version: METHOD_VERSION }, { instructions: INSTRUCTIONS });

const reply = (data, note) => ({ content: [{ type: 'text', text: (note ? note + '\n\n' : '') + JSON.stringify(data, null, 2) }] });
const fail = msg => ({ content: [{ type: 'text', text: msg }], isError: true });

/* ---------- Orientation ---------- */

server.registerTool('get_status', {
  title: 'Where am I?',
  description: 'Call first in every session. Returns the current phase, the next reflection question, and anything due today: weekly review, monthly habit-strength checks, quarterly review, upcoming decisions and lapsed habits.',
  inputSchema: {},
}, async () => {
  const plan = await load();
  const s = status(plan);
  if (plan.goals.length && lowEnergyStreak(plan)) s.lowEnergy = `Energy was below 5 two weeks running. Suggest the low-energy rule: "${plan.lowEnergyRule || 'drop to the tiny version of each habit and rest'}".`;
  return reply(s);
});

server.registerTool('get_method', {
  title: 'Read the method',
  description: 'Returns the Life Compass method: rules and, for each phase, the questions or steps in order with the reason for each. Pass a phase to get just that part.',
  inputSchema: { phase: z.enum(['reflect', 'choose', 'plan', 'act', 'review']).optional() },
}, async ({ phase }) => phase ? reply({ rules: RULES, ...PHASES[phase] }) : ({ content: [{ type: 'text', text: methodText() }] }));

/* ---------- Phases 1–5: every plan change lives in actions.js, shared with the dashboard ---------- */

server.registerTool('values_card_sort', {
  title: 'Values card sort',
  description: 'For people unsure of their values. Returns the value cards and the steps of the sort (after the Personal Values Card Sort, Miller et al. 2001). Walk them through it, then call save_values.',
  inputSchema: {},
}, async () => reply({ steps: CARD_SORT, values: VALUES_CARDS }));

for (const [name, a] of Object.entries(ACTIONS)){
  server.registerTool(name, { title: a.title, description: a.description, inputSchema: a.input },
    async (args) => update(plan => { const r = a.run(plan, args); return r.error ? fail(r.error) : reply(r.data, r.note); }));
}

/* ---------- Plan and reminders ---------- */

server.registerTool('get_plan', {
  title: 'Get the whole plan',
  description: 'Returns the full plan JSON (values, goals, milestones, habits, decisions, log, wins and reviews).',
  inputSchema: {},
}, async () => reply(await load()));

server.registerTool('export_reminders', {
  title: 'Export calendar reminders',
  description: 'Writes a calendar file (.ics) with the weekly review, the monthly habit-strength check and the quarterly review, so reminders work without any server. Returns the file path to import into a calendar app.',
  inputSchema: { weekday: z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']).default('SU'), time: z.string().regex(/^\d{2}:\d{2}$/).default('18:00') },
}, async ({ weekday, time }) => {
  const [hh, mm] = time.split(':');
  const start = today().replace(/-/g, '') + `T${hh}${mm}00`;
  const ev = (uid, title, rule, minutes, desc) => [
    'BEGIN:VEVENT', `UID:${uid}@life-compass`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${start}`, `DURATION:PT${minutes}M`, `RRULE:${rule}`, `SUMMARY:${title}`, `DESCRIPTION:${desc}`, 'END:VEVENT'].join('\r\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life Compass//EN',
    ev('weekly', 'Life Compass: weekly review (5 min)', `FREQ=WEEKLY;BYDAY=${weekday}`, 5, 'Open your AI and say: weekly review.'),
    ev('monthly', 'Life Compass: habit-strength check (10 min)', `FREQ=MONTHLY;BYDAY=1${weekday}`, 10, 'Open your AI and say: monthly check.'),
    ev('quarterly', 'Life Compass: quarterly review (30 min)', `FREQ=MONTHLY;INTERVAL=3;BYDAY=1${weekday}`, 30, 'Open your AI and say: quarterly review.'),
    'END:VCALENDAR'].join('\r\n');
  await ensurePrivateDir();
  const file = path.join(DATA_DIR, 'life-compass-reminders.ics');
  await fs.writeFile(file, ics, { encoding: 'utf8', mode: 0o600 });
  return reply({ file }, 'Calendar file written. Open it to add the reminders to your calendar.');
});

server.registerTool('open_dashboard', {
  title: 'Open the dashboard',
  description: 'Starts the visual Life Compass dashboard on this computer (rings, mountain, habits, goals, wins) and returns a private link to open in a browser. It reads the same local plan file and stays up while this app is open.',
  inputSchema: {},
}, async () => {
  const { startWeb } = await import('./web.js');
  const { url } = await startWeb();
  return reply({ url }, 'Dashboard is running. Share this private link with the person so they can open it in their browser; it only works on this computer.');
});

/* ---------- Prompt and resources ---------- */

server.registerPrompt('life_compass', {
  title: 'Start Life Compass',
  description: 'Coach me through the Life Compass: reflect, choose goals, plan tiny habits, and review.',
}, async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: `${methodText()}\n\n---\n\nPlease be my Life Compass coach. Start with get_status, then pick up wherever I am. One question at a time.` } }],
}));

server.registerResource('method', 'life-compass://method', { title: 'Life Compass method', mimeType: 'text/markdown' },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: methodText() }] }));

server.registerResource('plan', 'life-compass://plan', { title: 'My plan', mimeType: 'application/json' },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await load(), null, 2) }] }));

await server.connect(new StdioServerTransport());
