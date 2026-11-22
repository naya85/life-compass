// Every change to the plan, in one place. The MCP server registers these as tools and the
// dashboard calls them directly, so the AI and the web app save plans exactly the same way.
// Each action: input (zod shape), run(plan, args) → { data, note } or { error }.
import { z } from 'zod';
import { DEFAULT_AREAS } from './method.js';
import { today, slugId } from './store.js';
import { status, activeHabits, habitLimit, srbaiResult, lowEnergyStreak, weekStreak } from './coach.js';

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(d => { const t = new Date(d + 'T00:00:00Z'); return !isNaN(t) && t.toISOString().slice(0, 10) === d; }, 'Not a real date');
// Text is not length-capped (by choice); only the number of life areas is limited
const text = () => z.string();
const areaRatings = z.record(z.string(), z.number().int().min(1).max(10)).refine(o => Object.keys(o).length >= 1 && Object.keys(o).length <= 12, 'Rate between 1 and 12 areas');

const findGoal = (plan, id) => plan.goals.find(g => g.id === id);
const findHabit = (plan, id) => { for (const g of plan.goals){ const h = (g.habits || []).find(x => x.id === id); if (h) return { goal: g, habit: h }; } return null; };
export const recipeOf = h => { const a = String(h.anchor || '').trim(); return `${/^after\b/i.test(a) ? a.charAt(0).toUpperCase() + a.slice(1) : 'After I ' + a}, I will ${h.tiny}.`; };
const ok = (data, note) => ({ data, note });
const err = error => ({ error });

export const ACTIONS = {
  /* ---------- Phase 1: Reflect ---------- */
  save_reflection: {
    title: 'Save reflection answers',
    description: 'Save answers to Phase 1 questions as the person gives them. Only include the fields answered; others are kept. Use the person\'s own words, lightly tidied.',
    input: {
      proud: text().optional(), grateful: text().optional(), hard: text().optional(),
      vision: text().optional(), gentle: text().optional().describe('What needs gentleness this year; empty string if nothing'),
      decision: text().optional().describe('A decision they are waiting on; empty string if none'),
      name: text().optional(),
    },
    run(plan, a){
      const { name, ...r } = a;
      if (name != null) plan.person.name = name;
      plan.reflection = { ...plan.reflection, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) };
      return ok(status(plan), 'Saved.');
    },
  },
  save_baseline: {
    title: 'Save life-area ratings',
    description: `Save 1–10 ratings for each life area. Defaults: ${DEFAULT_AREAS.join(', ')}; people may rename, add or remove areas. Also used at quarterly reviews.`,
    input: { areas: areaRatings },
    run(plan, { areas }){ plan.baseline = { areas, at: today() }; return ok(status(plan), 'Baseline saved.'); },
  },
  save_capacity: {
    title: 'Save time and energy',
    description: 'Save realistic hours per week for the plan and current energy from 1 to 10. This caps how many habits can be active at once.',
    input: { hoursPerWeek: z.number().min(0).max(80), energy: z.number().int().min(1).max(10) },
    run(plan, c){ plan.person.capacity = c; return ok({ habitLimit: habitLimit(plan), ...status(plan) }, `Saved. With this capacity, keep to ${habitLimit(plan)} active habits at most.`); },
  },
  save_values: {
    title: 'Save values',
    description: 'Save the person\'s 3 to 5 guiding values, each with what it means to them in their own words. Replaces the current list.',
    input: { values: z.array(z.object({ name: text(), meaning: text() })).min(1).max(5) },
    run(plan, { values }){ plan.person.values = values; return ok(status(plan), 'Values saved.'); },
  },

  /* ---------- Phase 2: Choose ---------- */
  save_goal: {
    title: 'Save a goal',
    description: 'Create or update one goal (max 3 active). Only after the person chose it. Include the value it serves, a specific statement (what, how much, by when), an identity statement and the WOOP answers.',
    input: {
      id: text().optional().describe('Pass to update an existing goal'),
      area: text(), value: text(), statement: text(),
      identity: text().optional(),
      woop: z.object({ wish: text(), outcome: text(), obstacle: text(), plan: text() }).partial().optional(),
      status: z.enum(['active', 'done', 'dropped']).optional(),
    },
    run(plan, a){
      if (a.id){
        const g = findGoal(plan, a.id); if (!g) return err(`No goal ${a.id}.`);
        Object.assign(g, Object.fromEntries(Object.entries(a).filter(([k, v]) => v !== undefined && k !== 'id')));
        return ok(g, 'Goal updated.');
      }
      const active = plan.goals.filter(g => g.status !== 'dropped' && g.status !== 'done');
      if (active.length >= 3) return err('There are already 3 active goals. The method caps goals at 3: ask which one to drop or finish first.');
      const g = { id: slugId('g', plan.goals), area: a.area, value: a.value, statement: a.statement, identity: a.identity || '', woop: a.woop || {}, status: 'active', createdAt: today(), milestones: [], habits: [] };
      plan.goals.push(g);
      return ok(g, `Goal saved as ${g.id}.`);
    },
  },

  /* ---------- Phase 3: Plan ---------- */
  save_milestones: {
    title: 'Save milestones',
    description: 'Set a goal\'s milestones: 4 to 8 concrete, tickable actions spread across quarters 1–4, most in the first two. Replaces the list; ticks are kept for milestones with the same text.',
    input: { goalId: text(), milestones: z.array(z.object({ quarter: z.number().int().min(1).max(4), text: text() })).min(1).max(10) },
    run(plan, { goalId, milestones }){
      const g = findGoal(plan, goalId); if (!g) return err(`No goal ${goalId}.`);
      const old = g.milestones || [];
      g.milestones = milestones.map((m, i) => ({ id: `${g.id}m${i + 1}`, quarter: m.quarter, text: m.text, done: !!old.find(o => o.text === m.text)?.done }));
      return ok(g.milestones, 'Milestones saved.');
    },
  },
  add_milestone: {
    title: 'Add a milestone',
    description: 'Add one milestone to a goal, keeping the others and their ticks.',
    input: { goalId: text(), quarter: z.number().int().min(1).max(4), text: text() },
    run(plan, { goalId, quarter, text }){
      const g = findGoal(plan, goalId); if (!g) return err(`No goal ${goalId}.`);
      if (!text.trim()) return err('A milestone needs some text.');
      g.milestones = g.milestones || [];
      const n = Math.max(0, ...g.milestones.map(m => Number(String(m.id).split('m').pop()) || 0)) + 1;
      const m = { id: `${g.id}m${n}`, quarter, text: text.trim(), done: false };
      g.milestones.push(m);
      return ok(m, 'Milestone added.');
    },
  },
  edit_milestone: {
    title: 'Edit a milestone',
    description: 'Change one milestone\'s text or quarter. Its tick is kept.',
    input: { milestoneId: text(), text: text().optional(), quarter: z.number().int().min(1).max(4).optional() },
    run(plan, { milestoneId, text, quarter }){
      for (const g of plan.goals){ const m = (g.milestones || []).find(x => x.id === milestoneId); if (m){
        if (text !== undefined){ if (!text.trim()) return err('A milestone needs some text.'); m.text = text.trim(); }
        if (quarter !== undefined) m.quarter = quarter;
        return ok(m, 'Milestone updated.');
      } }
      return err(`No milestone ${milestoneId}.`);
    },
  },
  delete_milestone: {
    title: 'Delete a milestone',
    description: 'Remove one milestone from its goal. Only after the person asks.',
    input: { milestoneId: text() },
    run(plan, { milestoneId }){
      for (const g of plan.goals){ const i = (g.milestones || []).findIndex(x => x.id === milestoneId); if (i >= 0){ g.milestones.splice(i, 1); return ok({ goalId: g.id }, 'Milestone deleted.'); } }
      return err(`No milestone ${milestoneId}.`);
    },
  },
  save_habit: {
    title: 'Save a habit',
    description: 'Create or update a tiny habit for a goal: a recipe ("After I [anchor], I will [tiny]"), its rhythm, the COM-B barrier and fix, if-then plans for obstacles and one environment change. Also use it to shrink, pause, graduate or drop a habit (status). Warns when active habits exceed what capacity allows.',
    input: {
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
    run(plan, a){
      const g = findGoal(plan, a.goalId); if (!g) return err(`No goal ${a.goalId}.`);
      g.habits = g.habits || [];
      let h;
      if (a.id){
        h = g.habits.find(x => x.id === a.id); if (!h) return err(`No habit ${a.id} under ${a.goalId}.`);
      } else {
        if (!a.behaviour || !a.anchor || !a.tiny || !a.rhythm) return err('A new habit needs behaviour, anchor, tiny and rhythm.');
        h = { id: `${g.id}h${g.habits.length + 1}`, status: 'active', createdAt: today(), automaticity: [] };
        g.habits.push(h);
      }
      for (const k of ['behaviour', 'anchor', 'tiny', 'full', 'rhythm', 'barrier', 'fix', 'ifThen', 'environment', 'status']) if (a[k] !== undefined) h[k] = a[k];
      const n = activeHabits(plan).length, limit = habitLimit(plan);
      const warn = n > limit ? `Heads up: ${n} active habits, but capacity allows about ${limit}. Suggest pausing one or keeping only the tiny versions.` : '';
      return ok({ ...h, recipe: recipeOf(h), overCapacity: n > limit }, ['Habit saved.', warn].filter(Boolean).join(' '));
    },
  },
  save_plan_extras: {
    title: 'Save decisions and low-energy rule',
    description: 'Save dated decision points (question + what to do if the answer is no) and the one-sentence low-energy rule for a bad fortnight.',
    input: {
      decisions: z.array(z.object({ date: dateStr, question: text(), ifNot: text().optional() })).optional(),
      lowEnergyRule: text().optional(),
    },
    run(plan, { decisions, lowEnergyRule }){
      if (decisions) plan.decisions = decisions.map(d => ({ ...d, decided: false }));
      if (lowEnergyRule != null) plan.lowEnergyRule = lowEnergyRule;
      return ok({ decisions: plan.decisions, lowEnergyRule: plan.lowEnergyRule }, 'Saved.');
    },
  },

  /* ---------- Phase 4: Act ---------- */
  log_habit: {
    title: 'Log a habit',
    description: 'Record that a habit happened (the tiny version counts). Returns the weekly streak so you can celebrate in one warm line. Never shame a gap.',
    input: { habitId: text(), version: z.enum(['tiny', 'full']).optional(), date: dateStr.optional() },
    run(plan, { habitId, version, date }){
      const f = findHabit(plan, habitId); if (!f) return err(`No habit ${habitId}.`);
      plan.log.push({ date: date || today(), habitId, version: version || 'full' });
      return ok({ habit: f.habit.behaviour, weekStreak: weekStreak(plan, habitId) }, 'Logged. Celebrate it briefly.');
    },
  },
  tick_milestone: {
    title: 'Tick a milestone',
    description: 'Mark a milestone done (or undone).',
    input: { milestoneId: text(), done: z.boolean().default(true) },
    run(plan, { milestoneId, done }){
      for (const g of plan.goals){ const m = (g.milestones || []).find(x => x.id === milestoneId); if (m){ m.done = done; return ok(status(plan).milestones, done ? 'Milestone done.' : 'Unticked.'); } }
      return err(`No milestone ${milestoneId}.`);
    },
  },
  add_win: {
    title: 'Log a win',
    description: 'Note something the person did and what changed because of it. Wins feed reviews, confidence and, for career goals, promotion cases.',
    input: { text: text(), tag: text().optional() },
    run(plan, { text, tag }){
      if (!text.trim()) return err('A win needs some text.');
      plan.wins.push({ date: today(), text, tag: tag || '' });
      return ok({ wins: plan.wins.length }, 'Win logged.');
    },
  },

  /* ---------- Phase 5: Review ---------- */
  weekly_review: {
    title: 'Weekly review',
    description: '5-minute weekly check-in: energy 1–10, a line on what helped or got in the way, and optionally one good thing this week and why it happened. Returns habits logged this week and a low-energy flag.',
    input: { energy: z.number().int().min(1).max(10), note: text().optional(), goodThing: text().optional() },
    run(plan, { energy, note, goodThing }){
      plan.reviews.push({ date: today(), type: 'weekly', energy, note: note || '', goodThing: goodThing || '' });
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const logged = activeHabits(plan).map(h => ({ habit: h.behaviour, times: plan.log.filter(l => l.habitId === h.id && l.date > weekAgo).length }));
      const low = lowEnergyStreak(plan);
      return ok({ logged, lowEnergy: low, lowEnergyRule: low ? plan.lowEnergyRule : undefined }, low ? 'Saved. Energy has been low two weeks running: suggest switching to the low-energy rule.' : 'Saved.');
    },
  },
  monthly_check: {
    title: 'Monthly habit-strength check',
    description: 'Record the 4 SRBAI ratings (1–5) for one habit: "I do it automatically", "without having to consciously remember", "without thinking", "before I realise I\'m doing it". An average of 4 or more means it can graduate.',
    input: { habitId: text(), ratings: z.array(z.number().int().min(1).max(5)).length(4) },
    run(plan, { habitId, ratings }){
      const f = findHabit(plan, habitId); if (!f) return err(`No habit ${habitId}.`);
      const r = srbaiResult(ratings);
      f.habit.automaticity = [...(f.habit.automaticity || []), { date: today(), srbai: r.avg }];
      return ok(r, r.graduate ? 'Automatic enough to graduate. Ask whether to mark it graduated and grow the next habit.' : 'Not automatic yet. Keep it, or shrink it if it feels hard.');
    },
  },
  quarterly_review: {
    title: 'Quarterly review',
    description: '30-minute reset: new life-area ratings, which goals stay, and an optional note (e.g. a gratitude letter written). Returns the change in each area since the last baseline.',
    input: { areas: areaRatings, note: text().optional() },
    run(plan, { areas, note }){
      const before = plan.baseline.areas || {};
      const change = Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, before[k] != null ? v - before[k] : null]));
      plan.reviews.push({ date: today(), type: 'quarterly', areas, note: note || '' });
      plan.baseline = { areas, at: today() };
      return ok({ change, milestones: status(plan).milestones }, 'Saved. Re-plan the next quarter with save_milestones and save_habit.');
    },
  },
  record_decision: {
    title: 'Record a decision',
    description: 'Close a dated decision point with what was decided.',
    input: { date: dateStr, outcome: text() },
    run(plan, { date, outcome }){
      const d = plan.decisions.find(x => x.date === date); if (!d) return err(`No decision on ${date}.`);
      d.decided = true; d.outcome = outcome;
      return ok(d, 'Decision recorded.');
    },
  },
};

// Validate and run one action against a plan. Returns { data, note } or { error }.
export function runAction(plan, name, args){
  const a = ACTIONS[name]; if (!a) return err(`Unknown action ${name}.`);
  const parsed = z.object(a.input).strict().safeParse(args ?? {});
  if (!parsed.success) return err(parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return a.run(plan, parsed.data);
}
