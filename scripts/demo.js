// Writes a sample plan for a made-up person into LIFE_COMPASS_DIR, for demos and screenshots.
import { save, emptyPlan } from '../src/store.js';
const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const p = emptyPlan();
p.person = { name: 'Sam', values: [{ name: 'Growth', meaning: 'Learning what I am not good at yet' }, { name: 'Calm', meaning: 'Unhurried mornings' }, { name: 'Adventure', meaning: 'Trying new things' }, { name: 'Freedom', meaning: 'Choices of my own' }], capacity: { hoursPerWeek: 4, energy: 6 } };
p.reflection = { proud: 'Led my first workshop', grateful: 'My sister, for the calls', hard: 'Sleep', vision: 'Calm mornings and a job I love', gentle: '', decision: 'Stay or move jobs' };
p.baseline = { areas: { health: 5, career: 6, money: 6, relationships: 7, home: 6, 'hobbies and fun': 4, 'meaning and growth': 6 }, at: d(-40) };
p.goals = [
  { id: 'g1', area: 'health', value: 'Calm', statement: 'Sleep 7 hours on 5 nights a week by March', identity: 'I protect my sleep', status: 'active', createdAt: d(-40),
    milestones: [{ id: 'g1m1', quarter: 1, text: 'Charge my phone in the hall', done: true }, { id: 'g1m2', quarter: 1, text: 'Fixed wake-up time, weekends too', done: true }, { id: 'g1m3', quarter: 2, text: 'Check in with my GP', done: false }, { id: 'g1m4', quarter: 3, text: 'Six weeks of 7-hour nights', done: false }],
    habits: [{ id: 'g1h1', behaviour: 'Phone out of the bedroom', anchor: 'After I brush my teeth', tiny: 'put my phone on the hall shelf', rhythm: 'daily', status: 'active', createdAt: d(-40), automaticity: [] }] },
  { id: 'g2', area: 'career', value: 'Growth', statement: 'A lead role, or a clear date for one, by November', identity: 'I back my work with evidence', status: 'active', createdAt: d(-40),
    milestones: [{ id: 'g2m1', quarter: 1, text: 'Ask my manager for written criteria', done: true }, { id: 'g2m2', quarter: 1, text: 'Write 10 STAR stories', done: false }, { id: 'g2m3', quarter: 2, text: 'Three mock interviews', done: false }, { id: 'g2m4', quarter: 3, text: 'Final round with two companies', done: false }],
    habits: [{ id: 'g2h1', behaviour: 'One outreach message', anchor: 'After lunch on Mondays', tiny: 'open my target list', rhythm: 'weekly', status: 'active', createdAt: d(-30), automaticity: [] }] },
  { id: 'g3', area: 'hobbies and fun', value: 'Adventure', statement: 'Climb a 6a route by the summer', identity: 'I try things before I feel ready', status: 'active', createdAt: d(-20),
    milestones: [{ id: 'g3m1', quarter: 1, text: 'Book a beginners class', done: true }, { id: 'g3m2', quarter: 2, text: 'Climb twice a month', done: false }, { id: 'g3m3', quarter: 3, text: 'Lead a 6a', done: false }],
    habits: [{ id: 'g3h1', behaviour: 'Stretch for climbing', anchor: 'After I make my morning coffee', tiny: 'do one hip stretch', rhythm: 'daily', status: 'active', createdAt: d(-20), automaticity: [] }] },
];
p.decisions = [{ date: d(9), question: 'Stay or move jobs?', ifNot: 'Start applying', decided: false }];
p.lowEnergyRule = 'Only the tiny versions, and rest.';
p.log = [{ date: d(-1), habitId: 'g1h1', version: 'full' }, { date: d(0), habitId: 'g1h1', version: 'tiny' }, { date: d(-6), habitId: 'g2h1', version: 'full' }, { date: d(-2), habitId: 'g3h1', version: 'full' }];
p.wins = [{ date: d(-12), text: 'Ran the team workshop; PM and engineering agreed on one scope', tag: 'career' }, { date: d(-3), text: 'Slept 7 hours three nights running', tag: 'health' }];
p.reviews = [{ date: d(-8), type: 'weekly', energy: 6, note: 'Good week', goodThing: 'Dinner with friends' }];
await save(p);
console.log('Demo plan written.');
