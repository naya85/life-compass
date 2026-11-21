// Pure coaching logic: where someone is in the method, what's due, and the capacity and habit-strength rules.
import { PHASES } from './method.js';
import { today, daysBetween } from './store.js';

const RHYTHM_DAYS = { daily: 1, weekly: 7, fortnightly: 14, monthly: 31 };

export function allHabits(plan){ return plan.goals.flatMap(g => (g.habits || []).map(h => ({ ...h, goalId: g.id }))); }
export function activeHabits(plan){ return allHabits(plan).filter(h => h.status === 'active'); }

// How many active habits capacity allows: low energy or few hours means fewer.
export function habitLimit(plan){
  const { energy, hoursPerWeek } = plan.person.capacity || {};
  let limit = 5;
  if (energy != null) limit = energy <= 4 ? 2 : energy <= 6 ? 3 : 5;
  if (hoursPerWeek != null && hoursPerWeek < 2) limit = Math.min(limit, 2);
  return limit;
}

export function reflectionGaps(plan){
  const r = plan.reflection || {}, c = plan.person.capacity || {};
  const answered = {
    proud: !!r.proud, grateful: !!r.grateful, hard: !!r.hard, vision: !!r.vision, gentle: r.gentle != null, decision: r.decision != null,
    areas: Object.keys(plan.baseline.areas || {}).length > 0,
    values: (plan.person.values || []).length > 0,
    capacity: c.energy != null && c.hoursPerWeek != null,
  };
  return PHASES.reflect.questions.filter(q => !answered[q.key]);
}

export function currentPhase(plan){
  if (reflectionGaps(plan).length) return 'reflect';
  if (!plan.goals.length) return 'choose';
  if (plan.goals.some(g => !(g.milestones || []).length || !(g.habits || []).length)) return 'plan';
  return 'act';
}

// The most recent entry by date (logs can be added for past days, so array order isn't date order)
function lastOf(list, pred){ let best = null; for (const x of list) if (pred(x) && (!best || x.date >= best.date)) best = x; return best; }

export function dueItems(plan, on = today()){
  const due = [];
  const habits = activeHabits(plan);
  if (habits.length){
    const w = lastOf(plan.reviews, r => r.type === 'weekly');
    if (!w || daysBetween(w.date, on) >= 7) due.push({ type: 'weekly review', why: w ? `last one was ${daysBetween(w.date, on)} days ago` : 'none done yet' });
    for (const h of habits){
      const started = h.createdAt || on;
      const checks = h.automaticity || [];
      const last = checks.length ? checks.reduce((m, c) => c.date > m ? c.date : m, checks[0].date) : null;
      if (daysBetween(started, on) >= 28 && (!last || daysBetween(last, on) >= 30)) due.push({ type: 'monthly habit-strength check', habitId: h.id, habit: h.behaviour });
      // Lapse: missed for two of its periods
      const period = RHYTHM_DAYS[h.rhythm] || 7;
      const lastLog = lastOf(plan.log, l => l.habitId === h.id);
      const since = lastLog ? daysBetween(lastLog.date, on) : daysBetween(started, on);
      if (since > 2 * period) due.push({ type: 'lapse replan', habitId: h.id, habit: h.behaviour, why: `not logged for ${since} days (${h.rhythm})` });
    }
  }
  const q = lastOf(plan.reviews, r => r.type === 'quarterly');
  const qFrom = q ? q.date : plan.baseline.at;
  if (qFrom && daysBetween(qFrom, on) >= 90) due.push({ type: 'quarterly review', why: `${daysBetween(qFrom, on)} days since the last baseline` });
  for (const d of plan.decisions || []){
    if (d.decided) continue;
    const n = daysBetween(on, d.date);
    if (n <= 14) due.push({ type: 'decision', date: d.date, question: d.question, why: n < 0 ? `${-n} days overdue` : `in ${n} days` });
  }
  return due;
}

export function status(plan){
  const phase = currentPhase(plan);
  const out = { phase, phaseTitle: PHASES[phase].title, goal: PHASES[phase].goal };
  if (phase === 'reflect'){
    const gaps = reflectionGaps(plan);
    out.nextQuestion = gaps[0];
    out.remaining = gaps.length;
  }
  if (phase === 'act' || plan.goals.length){
    out.activeHabits = activeHabits(plan).length;
    out.habitLimit = habitLimit(plan);
    out.due = dueItems(plan);
    const done = plan.goals.flatMap(g => g.milestones || []);
    out.milestones = { done: done.filter(m => m.done).length, total: done.length };
  }
  return out;
}

// SRBAI: four 1–5 ratings. Average 4 or more means the habit is automatic enough to graduate.
export function srbaiResult(ratings){
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return { avg: Math.round(avg * 10) / 10, graduate: avg >= 4 };
}

// Low energy two weekly reviews running → suggest the low-energy rule
export function lowEnergyStreak(plan){
  const w = plan.reviews.filter(r => r.type === 'weekly').sort((a, b) => a.date < b.date ? -1 : 1).slice(-2);
  return w.length === 2 && w.every(r => (r.energy ?? 10) < 5);
}

export function weekStreak(plan, habitId, on = today()){
  // Consecutive weeks (Mon–Sun) with at least one log, counting back from this week
  const monday = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const weeks = new Set(plan.log.filter(l => l.habitId === habitId).map(l => monday(l.date)));
  let n = 0, cur = monday(on);
  while (weeks.has(cur)){ n++; const x = new Date(cur + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 7); cur = x.toISOString().slice(0, 10); }
  return n;
}
