// Local plan storage: one JSON file on the person's own computer. Nothing leaves the machine.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { METHOD_VERSION } from './method.js';

export const DATA_DIR = process.env.LIFE_COMPASS_DIR || path.join(os.homedir(), '.life-compass');
export const PLAN_FILE = path.join(DATA_DIR, 'plan.json');

// The plan can hold health and relationship details: keep the folder and files readable only by their owner.
export async function ensurePrivateDir(){
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(DATA_DIR, 0o700);
}

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

let writing = Promise.resolve();

// Always read fresh from disk: the MCP server and the dashboard may both change the plan.
export async function load(){
  try {
    const raw = await fs.readFile(PLAN_FILE, 'utf8');
    return { ...emptyPlan(), ...JSON.parse(raw) };
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Could not read ${PLAN_FILE}: ${e.message}`);
    return emptyPlan();
  }
}

// Atomic write: temp file then rename, plus a one-step backup, so a crash can't corrupt the plan.
export async function save(plan){
  plan.updatedAt = new Date().toISOString();
  const body = JSON.stringify(plan, null, 2);
  writing = writing.catch(() => {}).then(async () => {   // one failed write must not block all later ones
    await ensurePrivateDir();
    try { await fs.copyFile(PLAN_FILE, PLAN_FILE + '.bak'); await fs.chmod(PLAN_FILE + '.bak', 0o600); } catch {}
    const tmp = PLAN_FILE + '.tmp';
    await fs.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, PLAN_FILE);
    await fs.chmod(PLAN_FILE, 0o600);
  });
  await writing;
  return plan;
}

// Read-modify-write, one at a time within this process
let queue = Promise.resolve();
export function update(fn){
  const run = queue.catch(() => {}).then(async () => {
    const plan = await load();
    const out = await fn(plan);
    if (!(out && out.isError)) await save(plan);
    return out;
  });
  queue = run;
  return run;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const slugId = (prefix, list) => {
  let n = list.length + 1;
  while (list.some(x => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};
