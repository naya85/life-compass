// End-to-end test: talks to the server over stdio like an AI app would, with a throwaway plan folder.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(path.join(tmpdir(), 'life-compass-test-'));
const transport = new StdioClientTransport({ command: process.execPath, args: ['src/index.js'], env: { ...process.env, LIFE_COMPASS_DIR: dir } });
const client = new Client({ name: 'smoke-test', version: '0.0.0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  if (r.isError) return { error: text };
  const json = text.slice(text.indexOf('{') >= 0 && (text.indexOf('[') < 0 || text.indexOf('{') < text.indexOf('[')) ? text.indexOf('{') : text.indexOf('['));
  return { note: text, data: JSON.parse(json) };
};
let step = 0; const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

const tools = (await client.listTools()).tools.map(t => t.name);
assert.ok(tools.includes('get_status') && tools.length >= 18); ok(`${tools.length} tools listed`);
const prompts = (await client.listPrompts()).prompts.map(p => p.name);
assert.deepEqual(prompts, ['life_compass']); ok('life_compass prompt listed');
const p = await client.getPrompt({ name: 'life_compass' });
assert.ok(p.messages[0].content.text.includes('Phase 3: Plan')); ok('prompt carries the method');

let s = await call('get_status');
assert.equal(s.data.phase, 'reflect'); assert.equal(s.data.nextQuestion.key, 'proud'); ok('new user starts at Reflect, question 1');

await call('save_reflection', { name: 'Test', proud: 'Shipped the redesign', grateful: 'My sister', hard: 'Sleep', vision: 'Calm mornings', gentle: '', decision: 'Stay or move jobs' });
await call('save_baseline', { areas: { health: 5, career: 6, money: 6, relationships: 7, home: 6, 'hobbies and fun': 4, 'meaning and growth': 6 } });
const cards = await call('values_card_sort'); assert.ok(cards.data.values.length >= 30); ok('values card sort has 30+ values');
await call('save_values', { values: [{ name: 'Growth', meaning: 'Learning what I am not good at yet' }, { name: 'Calm', meaning: 'Unhurried days' }] });
s = await call('save_capacity', { hoursPerWeek: 3, energy: 4 });
assert.equal(s.data.habitLimit, 2); assert.equal(s.data.phase, 'choose'); ok('capacity saved, limit 2 habits, moves to Choose');

const g = await call('save_goal', { area: 'health', value: 'Calm', statement: 'Sleep 7 hours on 5 nights a week by March', identity: 'I protect my sleep', woop: { wish: 'Sleep well', outcome: 'Calm mornings', obstacle: 'Phone in bed', plan: 'If I reach for my phone, then I put it in the hall' } });
assert.equal(g.data.id, 'g1'); ok('goal g1 saved');
await call('save_goal', { area: 'career', value: 'Growth', statement: 'Lead role by November' });
await call('save_goal', { area: 'fun', value: 'Growth', statement: 'Learn bouldering' });
const fourth = await call('save_goal', { area: 'money', value: 'Calm', statement: 'Save 6 months' });
assert.ok(fourth.error && fourth.error.includes('3 active goals')); ok('4th goal refused (cap of 3)');

s = await call('get_status'); assert.equal(s.data.phase, 'plan'); ok('moves to Plan');
await call('save_milestones', { goalId: 'g1', milestones: [{ quarter: 1, text: 'Charge phone in the hall' }, { quarter: 1, text: 'Fixed wake time' }, { quarter: 2, text: 'Review with GP' }, { quarter: 3, text: 'Six weeks of 7-hour nights' }] });
const h = await call('save_habit', { goalId: 'g1', behaviour: 'Phone out of the bedroom', anchor: 'After I brush my teeth', tiny: 'put my phone on the hall shelf', rhythm: 'daily', barrier: 'opportunity', fix: 'Charger in the hall', ifThen: [{ if: 'I want my alarm', then: 'I use the old alarm clock' }], environment: 'Charger moved to the hall' });
assert.equal(h.data.recipe, 'After I brush my teeth, I will put my phone on the hall shelf.'); ok('habit saved with a proper recipe');
await call('save_habit', { goalId: 'g2', behaviour: 'Outreach', anchor: 'After lunch on Monday', tiny: 'open the target list', rhythm: 'weekly' });
const third = await call('save_habit', { goalId: 'g3', behaviour: 'Stretch', anchor: 'After I wake up', tiny: 'one stretch', rhythm: 'daily' });
assert.ok(third.note.includes('capacity allows about 2')); ok('capacity warning on the 3rd habit');

const log = await call('log_habit', { habitId: 'g1h1', version: 'tiny' });
assert.equal(log.data.weekStreak, 1); ok('habit logged, streak 1');
const ms = await call('tick_milestone', { milestoneId: 'g1m1' });
assert.equal(ms.data.done, 1); ok('milestone ticked');
await call('add_win', { text: 'Slept 7 hours three nights running', tag: 'health' });
await call('save_plan_extras', { decisions: [{ date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), question: 'Stay or move?', ifNot: 'Start applying' }], lowEnergyRule: 'Only the tiny versions, and rest.' });
s = await call('get_status');
assert.ok(s.data.due.some(d => d.type === 'decision')); assert.ok(s.data.due.some(d => d.type === 'weekly review')); ok('decision and weekly review show as due');

await call('weekly_review', { energy: 3, note: 'Tired', goodThing: 'Dinner with friends' });
const wr = await call('weekly_review', { energy: 4, note: 'Still tired' });
assert.equal(wr.data.lowEnergy, true); ok('two low-energy weeks trigger the low-energy rule');
const mc = await call('monthly_check', { habitId: 'g1h1', ratings: [5, 4, 4, 5] });
assert.equal(mc.data.graduate, true); ok('SRBAI 4.5 suggests graduating');
const qr = await call('quarterly_review', { areas: { health: 7, career: 6 }, note: 'Wrote a gratitude letter' });
assert.equal(qr.data.change.health, 2); ok('quarterly review shows +2 in health');

const rem = await call('export_reminders', { weekday: 'SU', time: '18:00' });
assert.ok(existsSync(rem.data.file) && readFileSync(rem.data.file, 'utf8').includes('RRULE:FREQ=WEEKLY;BYDAY=SU')); ok('calendar reminders written');

const plan = JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf8'));
assert.equal(plan.goals.length, 3); assert.equal(plan.log.length, 1); assert.equal(plan.person.values[0].name, 'Growth'); ok(`plan saved locally (${path.join(dir, 'plan.json')})`);

await client.close();
console.log(`\nAll ${step} checks passed.`);
