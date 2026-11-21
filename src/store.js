// Local plan storage: one JSON file on the person's own computer. Nothing leaves the machine.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { METHOD_VERSION } from './method.js';

export const DATA_DIR = process.env.LIFE_COMPASS_DIR || path.join(os.homedir(), '.life-compass');
export const PLAN_FILE = path.join(DATA_DIR, 'plan.json');

export function emptyPlan(){
  const now = new Date().toISOString();
  return {
    version: METHOD_VERSION,
    createdAt: now,
    updatedAt: now,
    person: { name: '', values: [], capacity: { hoursPerWeek: null, energy: null } },
    reflection: {},                 // proud, grateful, hard, vision, gentle, decision
    baseline: { areas: {}, at: null },
    goals: [],                      // see addGoal
    decisions: [],                  // { date, question, ifNot }
    lowEnergyRule: '',
    log: [],                        // { date, habitId, version }
    wins: [],                       // { date, text, tag }
    reviews: [],                    // { date, type, ... }
  };
}

let cache = null;
let writing = Promise.resolve();

export async function load(){
  if (cache) return cache;
  try {
    const raw = await fs.readFile(PLAN_FILE, 'utf8');
    cache = { ...emptyPlan(), ...JSON.parse(raw) };
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Could not read ${PLAN_FILE}: ${e.message}`);
    cache = emptyPlan();
  }
  return cache;
}

// Atomic write: temp file then rename, plus a one-step backup, so a crash can't corrupt the plan.
export async function save(plan){
  plan.updatedAt = new Date().toISOString();
  cache = plan;
  const body = JSON.stringify(plan, null, 2);
  writing = writing.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try { await fs.copyFile(PLAN_FILE, PLAN_FILE + '.bak'); } catch {}
    const tmp = PLAN_FILE + '.tmp';
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, PLAN_FILE);
  });
  await writing;
  return plan;
}

export async function update(fn){
  const plan = await load();
  const out = await fn(plan);
  await save(plan);
  return out;
}

// Only for tests
export function _reset(){ cache = null; }

export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const slugId = (prefix, list) => {
  let n = list.length + 1;
  while (list.some(x => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};
