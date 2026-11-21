#!/usr/bin/env node
// Life Compass MCP server: runs the method inside whichever AI app the person uses.
// The AI asks the questions; this server holds the method and saves the plan to a local file.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { METHOD_VERSION, PHASES, RULES, VALUES_CARDS, CARD_SORT, DEFAULT_AREAS, methodText } from './method.js';
import { load, update, today, slugId, PLAN_FILE, DATA_DIR, ensurePrivateDir } from './store.js';
import { status, activeHabits, allHabits, habitLimit, srbaiResult, lowEnergyStreak, weekStreak } from './coach.js';

const INSTRUCTIONS = `Life Compass is an evidence-based reflection, goal and habit coach. Start every session with get_status: it says which phase the person is in, the next question, and any reviews or lapses that are due. Follow the method (get_method, or the life_compass prompt) one question at a time, save answers with the tools as you go, and never assign goals: offer options and let the person choose. Plans are stored only on this computer, at ${PLAN_FILE}.`;

const server = new McpServer({ name: 'life-compass', version: METHOD_VERSION }, { instructions: INSTRUCTIONS });

const reply = (data, note) => ({ content: [{ type: 'text', text: (note ? note + '\n\n' : '') + JSON.stringify(data, null, 2) }] });
const fail = msg => ({ content: [{ type: 'text', text: msg }], isError: true });
const findGoal = (plan, id) => plan.goals.find(g => g.id === id);
const findHabit = (plan, id) => { for (const g of plan.goals){ const h = (g.habits || []).find(x => x.id === id); if (h) return { goal: g, habit: h }; } return null; };
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(d => { const t = new Date(d + 'T00:00:00Z'); return !isNaN(t) && t.toISOString().slice(0, 10) === d; }, 'Not a real date');
// Text is not length-capped (by choice); only the number of life areas is limited
const text = () => z.string();
const shortText = () => z.string();
const areaRatings = z.record(shortText(), z.number().int().min(1).max(10)).refine(o => Object.keys(o).length >= 1 && Object.keys(o).length <= 12, 'Rate between 1 and 12 areas');

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

/* ---------- Phase 1: Reflect ---------- */

server.registerTool('save_reflection', {
  title: 'Save reflection answers',
  description: 'Save answers to Phase 1 questions as the person gives them. Only include the fields answered; others are kept. Use the person\'s own words, lightly tidied.',
  inputSchema: {
    proud: text().optional(), grateful: text().optional(), hard: text().optional(),
    vision: text().optional(), gentle: text().optional().describe('What needs gentleness this year; empty string if nothing'),
    decision: text().optional().describe('A decision they are waiting on; empty string if none'),
    name: text().optional(),
  },
}, async (a) => update(plan => {
  const { name, ...r } = a;
  if (name != null) plan.person.name = name;
  plan.reflection = { ...plan.reflection, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) };
  return reply(status(plan), 'Saved.');
}));

server.registerTool('save_baseline', {
  title: 'Save life-area ratings',
  description: `Save 1–10 ratings for each life area. Defaults: ${DEFAULT_AREAS.join(', ')}; people may rename, add or remove areas. Also used at quarterly reviews.`,
  inputSchema: { areas: areaRatings },
}, async ({ areas }) => update(plan => {
  plan.baseline = { areas, at: today() };
  return reply(status(plan), 'Baseline saved.');
}));

server.registerTool('save_capacity', {
  title: 'Save time and energy',
  description: 'Save realistic hours per week for the plan and current energy from 1 to 10. This caps how many habits can be active at once.',
  inputSchema: { hoursPerWeek: z.number().min(0).max(80), energy: z.number().int().min(1).max(10) },
}, async (c) => update(plan => {
  plan.person.capacity = c;
  return reply({ habitLimit: habitLimit(plan), ...status(plan) }, `Saved. With this capacity, keep to ${habitLimit(plan)} active habits at most.`);
}));

server.registerTool('values_card_sort', {
  title: 'Values card sort',
  description: 'For people unsure of their values. Returns the value cards and the steps of the sort (after the Personal Values Card Sort, Miller et al. 2001). Walk them through it, then call save_values.',
  inputSchema: {},
}, async () => reply({ steps: CARD_SORT, values: VALUES_CARDS }));

server.registerTool('save_values', {
  title: 'Save values',
  description: 'Save the person\'s 3 to 5 guiding values, each with what it means to them in their own words. Replaces the current list.',
  inputSchema: { values: z.array(z.object({ name: text(), meaning: text() })).min(1).max(5) },
}, async ({ values }) => update(plan => {
  plan.person.values = values;
  return reply(status(plan), 'Values saved.');
}));

/* ---------- Phase 2: Choose ---------- */

server.registerTool('save_goal', {
  title: 'Save a goal',
  description: 'Create or update one goal (max 3 active). Only after the person chose it. Include the value it serves, a specific statement (what, how much, by when), an identity statement and the WOOP answers.',
  inputSchema: {
    id: text().optional().describe('Pass to update an existing goal'),
    area: text(), value: text(), statement: text(),
    identity: text().optional(),
    woop: z.object({ wish: text(), outcome: text(), obstacle: text(), plan: text() }).partial().optional(),
    status: z.enum(['active', 'done', 'dropped']).optional(),
  },
}, async (a) => update(plan => {
  if (a.id){
    const g = findGoal(plan, a.id); if (!g) return fail(`No goal ${a.id}.`);
    Object.assign(g, Object.fromEntries(Object.entries(a).filter(([k, v]) => v !== undefined && k !== 'id')));
    return reply(g, 'Goal updated.');
  }
  const active = plan.goals.filter(g => g.status !== 'dropped' && g.status !== 'done');
  if (active.length >= 3) return fail('There are already 3 active goals. The method caps goals at 3: ask which one to drop or finish first.');
  const g = { id: slugId('g', plan.goals), area: a.area, value: a.value, statement: a.statement, identity: a.identity || '', woop: a.woop || {}, status: 'active', createdAt: today(), milestones: [], habits: [] };
  plan.goals.push(g);
  return reply(g, `Goal saved as ${g.id}.`);
}));

/* ---------- Phase 3: Plan ---------- */

server.registerTool('save_milestones', {
  title: 'Save milestones',
  description: 'Set a goal\'s milestones: 4 to 8 concrete, tickable actions spread across quarters 1–4, most in the first two. Replaces the list; ticks are kept for milestones with the same text.',
  inputSchema: { goalId: text(), milestones: z.array(z.object({ quarter: z.number().int().min(1).max(4), text: text() })).min(1).max(10) },
}, async ({ goalId, milestones }) => update(plan => {
  const g = findGoal(plan, goalId); if (!g) return fail(`No goal ${goalId}.`);
  const old = g.milestones || [];
  g.milestones = milestones.map((m, i) => ({ id: `${g.id}m${i + 1}`, quarter: m.quarter, text: m.text, done: !!old.find(o => o.text === m.text)?.done }));
  return reply(g.milestones, 'Milestones saved.');
}));

server.registerTool('save_habit', {
  title: 'Save a habit',
  description: 'Create or update a tiny habit for a goal: a recipe ("After I [anchor], I will [tiny]"), its rhythm, the COM-B barrier and fix, if-then plans for obstacles and one environment change. Also use it to shrink, pause, graduate or drop a habit (status). Warns when active habits exceed what capacity allows.',
  inputSchema: {
    goalId: text(), id: text().optional().describe('Pass to update an existing habit'),
    behaviour: text().optional(),
    anchor: text().optional().describe('The existing routine it follows, e.g. "After I make my morning coffee"'),
    tiny: text().optional().describe('What they will do, starting with a verb, small enough to take under two minutes, e.g. "do one hip stretch"'),
    full: text().optional(),
    rhythm: z.enum(['daily', 'weekly', 'fortnightly', 'monthly']).optional(),
    barrier: z.enum(['capability', 'opportunity', 'motivation']).optional(), fix: text().optional(),
    ifThen: z.array(z.object({ if: text(), then: text() })).optional(),
    environment: text().optional(),
    status: z.enum(['active', 'paused', 'graduated', 'dropped']).optional(),
  },
}, async (a) => update(plan => {
  const g = findGoal(plan, a.goalId); if (!g) return fail(`No goal ${a.goalId}.`);
  g.habits = g.habits || [];
  let h;
  if (a.id){
    h = g.habits.find(x => x.id === a.id); if (!h) return fail(`No habit ${a.id} under ${a.goalId}.`);
  } else {
    if (!a.behaviour || !a.anchor || !a.tiny || !a.rhythm) return fail('A new habit needs behaviour, anchor, tiny and rhythm.');
    h = { id: `${g.id}h${g.habits.length + 1}`, status: 'active', createdAt: today(), automaticity: [] };
    g.habits.push(h);
  }
  for (const k of ['behaviour', 'anchor', 'tiny', 'full', 'rhythm', 'barrier', 'fix', 'ifThen', 'environment', 'status']) if (a[k] !== undefined) h[k] = a[k];
  const n = activeHabits(plan).length, limit = habitLimit(plan);
  const warn = n > limit ? `Heads up: ${n} active habits, but capacity allows about ${limit}. Suggest pausing one or keeping only the tiny versions.` : '';
  return reply({ ...h, recipe: `${/^after\b/i.test(String(h.anchor).trim()) ? String(h.anchor).trim().replace(/^a/, 'A') : 'After I ' + h.anchor}, I will ${h.tiny}.` }, ['Habit saved.', warn].filter(Boolean).join(' '));
}));

server.registerTool('save_plan_extras', {
  title: 'Save decisions and low-energy rule',
  description: 'Save dated decision points (question + what to do if the answer is no) and the one-sentence low-energy rule for a bad fortnight.',
  inputSchema: {
    decisions: z.array(z.object({ date: dateStr, question: text(), ifNot: text().optional() })).optional(),
    lowEnergyRule: text().optional(),
  },
}, async ({ decisions, lowEnergyRule }) => update(plan => {
  if (decisions) plan.decisions = decisions.map(d => ({ ...d, decided: false }));
  if (lowEnergyRule != null) plan.lowEnergyRule = lowEnergyRule;
  return reply({ decisions: plan.decisions, lowEnergyRule: plan.lowEnergyRule }, 'Saved.');
}));

/* ---------- Phase 4: Act ---------- */

server.registerTool('log_habit', {
  title: 'Log a habit',
  description: 'Record that a habit happened (the tiny version counts). Returns the weekly streak so you can celebrate in one warm line. Never shame a gap.',
  inputSchema: { habitId: text(), version: z.enum(['tiny', 'full']).optional(), date: dateStr.optional() },
}, async ({ habitId, version, date }) => update(plan => {
  const f = findHabit(plan, habitId); if (!f) return fail(`No habit ${habitId}.`);
  plan.log.push({ date: date || today(), habitId, version: version || 'full' });
  return reply({ habit: f.habit.behaviour, weekStreak: weekStreak(plan, habitId) }, 'Logged. Celebrate it briefly.');
}));

server.registerTool('tick_milestone', {
  title: 'Tick a milestone',
  description: 'Mark a milestone done (or undone).',
  inputSchema: { milestoneId: text(), done: z.boolean().default(true) },
}, async ({ milestoneId, done }) => update(plan => {
  for (const g of plan.goals){ const m = (g.milestones || []).find(x => x.id === milestoneId); if (m){ m.done = done; return reply(status(plan).milestones, done ? 'Milestone done.' : 'Unticked.'); } }
  return fail(`No milestone ${milestoneId}.`);
}));

server.registerTool('add_win', {
  title: 'Log a win',
  description: 'Note something the person did and what changed because of it. Wins feed reviews, confidence and, for career goals, promotion cases.',
  inputSchema: { text: text(), tag: text().optional() },
}, async ({ text, tag }) => update(plan => {
  plan.wins.push({ date: today(), text, tag: tag || '' });
  return reply({ wins: plan.wins.length }, 'Win logged.');
}));

/* ---------- Phase 5: Review ---------- */

server.registerTool('weekly_review', {
  title: 'Weekly review',
  description: '5-minute weekly check-in: energy 1–10, a line on what helped or got in the way, and optionally one good thing this week and why it happened. Returns habits logged this week and a low-energy flag.',
  inputSchema: { energy: z.number().int().min(1).max(10), note: text().optional(), goodThing: text().optional() },
}, async ({ energy, note, goodThing }) => update(plan => {
  plan.reviews.push({ date: today(), type: 'weekly', energy, note: note || '', goodThing: goodThing || '' });
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const logged = activeHabits(plan).map(h => ({ habit: h.behaviour, times: plan.log.filter(l => l.habitId === h.id && l.date > weekAgo).length }));
  const low = lowEnergyStreak(plan);
  return reply({ logged, lowEnergy: low, lowEnergyRule: low ? plan.lowEnergyRule : undefined }, low ? 'Saved. Energy has been low two weeks running: suggest switching to the low-energy rule.' : 'Saved.');
}));

server.registerTool('monthly_check', {
  title: 'Monthly habit-strength check',
  description: 'Record the 4 SRBAI ratings (1–5) for one habit: "I do it automatically", "without having to consciously remember", "without thinking", "before I realise I\'m doing it". An average of 4 or more means it can graduate.',
  inputSchema: { habitId: text(), ratings: z.array(z.number().int().min(1).max(5)).length(4) },
}, async ({ habitId, ratings }) => update(plan => {
  const f = findHabit(plan, habitId); if (!f) return fail(`No habit ${habitId}.`);
  const r = srbaiResult(ratings);
  f.habit.automaticity = [...(f.habit.automaticity || []), { date: today(), srbai: r.avg }];
  return reply(r, r.graduate ? 'Automatic enough to graduate. Ask whether to mark it graduated and grow the next habit.' : 'Not automatic yet. Keep it, or shrink it if it feels hard.');
}));

server.registerTool('quarterly_review', {
  title: 'Quarterly review',
  description: '30-minute reset: new life-area ratings, which goals stay, and an optional note (e.g. a gratitude letter written). Returns the change in each area since the last baseline.',
  inputSchema: { areas: areaRatings, note: text().optional() },
}, async ({ areas, note }) => update(plan => {
  const before = plan.baseline.areas || {};
  const change = Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, before[k] != null ? v - before[k] : null]));
  plan.reviews.push({ date: today(), type: 'quarterly', areas, note: note || '' });
  plan.baseline = { areas, at: today() };
  return reply({ change, milestones: status(plan).milestones }, 'Saved. Re-plan the next quarter with save_milestones and save_habit.');
}));

server.registerTool('record_decision', {
  title: 'Record a decision',
  description: 'Close a dated decision point with what was decided.',
  inputSchema: { date: dateStr, outcome: text() },
}, async ({ date, outcome }) => update(plan => {
  const d = plan.decisions.find(x => x.date === date); if (!d) return fail(`No decision on ${date}.`);
  d.decided = true; d.outcome = outcome;
  return reply(d, 'Decision recorded.');
}));

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
