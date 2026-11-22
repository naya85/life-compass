// Guided flows: the Life Compass method without an AI. One question per screen, saved as you go,
// through the same actions the AI uses. All text is set with textContent.
(() => {
  const { api, toast, confetti, refresh, getState } = window.LC;
  const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)){ if (v == null || v === false) continue; if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); } for (const c of kids) if (c != null) n.append(c); return n; };
  const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const recipe = (anchor, tiny) => { const a = String(anchor || '').trim(); const lead = /^after\b/i.test(a) ? cap(a) : `After I ${a || '…'}`; return `${lead}, I will ${String(tiny || '').trim() || '…'}.`; };
  const need = (v, msg) => { if (v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)) throw new Error(msg); return typeof v === 'string' ? v.trim() : v; };
  // Secondary button: white, gradient border and label (one gradient primary per screen)
  const sec = (label, cls = '') => el('button', { type: 'button', class: ('btn2 ' + cls).trim() }, el('span', { text: label }));
  const doAction = async (name, body) => (await api('do/' + name, body)).data;
  let method = null;
  const getMethod = async () => method || (method = await api('method'));

  /* ---------- Inputs ---------- */
  function grow(t){ const fit = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }; t.addEventListener('input', fit); requestAnimationFrame(fit); return t; }
  const area = (value = '', placeholder = '') => grow(el('textarea', { class: 'g-text', rows: 3, placeholder }, document.createTextNode(value || '')));
  const line = (value = '', placeholder = '', type = 'text') => { const i = el('input', { class: 'g-line', type, placeholder, autocomplete: 'off' }); i.value = value || ''; return i; };
  function prefixed(prefix, value, placeholder){ const i = line(value, placeholder); return { node: el('label', { class: 'g-prefix' }, el('span', { text: prefix }), i), input: i }; }
  // A row of numbered buttons (energy 1–10, agreement 1–5)
  function scale(n, value, lo, hi){
    let v = value ?? null; const row = el('div', { class: 'g-scale', role: 'radiogroup' });
    for (let i = 1; i <= n; i++){ const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === i), text: String(i) }); b.addEventListener('click', () => { v = i; [...row.children].forEach((c, j) => c.setAttribute('aria-checked', String(j + 1 === i))); row.dispatchEvent(new Event('change')); }); row.append(b); }
    const wrap = el('div', { class: 'g-scale-wrap' }, row, lo ? el('div', { class: 'g-scale-ends' }, el('span', { text: lo }), el('span', { text: hi })) : null);
    return { node: wrap, get: () => v };
  }
  // Single or multi choice as cards
  function choice(options, { multi = false, value = multi ? [] : null, max = Infinity } = {}){
    let sel = multi ? [...value] : value; const box = el('div', { class: 'g-choices' + (options.some(o => o.sub) ? ' cards' : '') });
    const sync = () => [...box.children].forEach(b => b.setAttribute('aria-pressed', String(multi ? sel.includes(b.dataset.v) : sel === b.dataset.v)));
    for (const o of options){
      const b = el('button', { type: 'button', class: 'g-choice', 'data-v': o.value }, el('b', { text: o.label }), o.sub ? el('span', { text: o.sub }) : null);
      b.addEventListener('click', () => {
        if (multi){ if (sel.includes(o.value)) sel = sel.filter(x => x !== o.value); else if (sel.length < max) sel.push(o.value); else return toast(`Pick up to ${max}.`); }
        else sel = o.value;
        sync(); box.dispatchEvent(new Event('change'));
      });
      box.append(b);
    }
    sync();
    return { node: box, get: () => sel, add(o){ options.push(o); const b = el('button', { type: 'button', class: 'g-choice', 'data-v': o.value }, el('b', { text: o.label })); b.addEventListener('click', () => { if (sel.includes(o.value)) sel = sel.filter(x => x !== o.value); else if (sel.length < max) sel.push(o.value); sync(); }); box.append(b); if (sel.length < max) sel.push(o.value); sync(); } };
  }
  function sliders(names, values){
    const rows = names.map(n => {
      const r = el('input', { type: 'range', min: 1, max: 10, step: 1, 'aria-label': cap(n) }); r.value = values[n] ?? 5;
      const out = el('output', { text: r.value });
      const fill = () => { out.textContent = r.value; r.style.setProperty('--p', ((r.value - 1) / 9 * 100) + '%'); }; fill(); r.addEventListener('input', fill);
      return { n, r, node: el('label', { class: 'g-slider' }, el('span', { text: cap(n) }), r, out) };
    });
    return { node: el('div', { class: 'g-sliders' }, ...rows.map(x => x.node)), get: () => Object.fromEntries(rows.map(x => [x.n, Number(x.r.value)])) };
  }

  /* ---------- The sheet ---------- */
  let open = null;
  function runFlow(title, steps, ctx = {}, startAt = 0){
    if (open) open.close();
    const prevFocus = document.activeElement;
    const bar = el('i'), progress = el('div', { class: 'g-progress', 'aria-hidden': 'true' }, bar);
    const kicker = el('small', { class: 'g-kicker', text: title });
    const body = el('div', { class: 'g-body' });
    const back = sec('Back', 'g-back');
    const next = el('button', { type: 'button', class: 'btn g-next', text: 'Next' });
    const closeBtn = el('button', { type: 'button', class: 'g-close', 'aria-label': 'Close', text: '✕' });
    const sheet = el('div', { class: 'g-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'g-top' }, kicker, closeBtn), progress, body, el('div', { class: 'g-foot' }, back, next));
    const bg = el('div', { class: 'g-bg' }, sheet);
    document.body.append(bg); document.body.classList.add('g-open');
    let i = startAt, cur = null, busy = false;
    const visible = () => steps.filter(s => !s.skip || !s.skip(ctx));
    // Next stays disabled until the step's check passes (run on a copy so it can't change the flow's state)
    function ready(){ const s = visible()[i]; if (!s || s.final || !s.check || !cur || !cur.get) return true; try { s.check(cur.get(), { ...ctx }); return true; } catch { return false; } }
    const sync = () => { next.disabled = busy || !ready(); };
    const later = () => setTimeout(sync, 0);
    body.addEventListener('input', later); body.addEventListener('change', later); body.addEventListener('click', later);

    async function show(){
      const list = visible(); const s = list[i]; if (!s) return close();
      kicker.textContent = s.kicker || title; sheet.setAttribute('aria-label', kicker.textContent);
      body.textContent = ''; body.classList.remove('in'); void body.offsetWidth; body.classList.add('in');
      cur = await s.build(ctx);
      body.append(el('h2', { class: 'g-q', id: 'g-q', text: typeof s.q === 'function' ? s.q(ctx) : s.q }));
      if (s.hint) body.append(el('p', { class: 'g-hint', text: typeof s.hint === 'function' ? s.hint(ctx) : s.hint }));
      if (cur.node) body.append(cur.node);
      if (s.why) body.append(el('details', { class: 'g-why' }, el('summary', { text: 'Why this question?' }), el('p', { text: s.why })));
      const last = i === list.length - 1;
      bar.style.transform = `scaleX(${(i + (s.final ? 1 : 0)) / Math.max(1, list.length - 1)})`;
      progress.hidden = list.length < 2;
      back.hidden = i === 0 || s.final;
      next.textContent = s.nextLabel || (s.final ? 'Done' : last ? 'Save' : (s.optional ? 'Next' : 'Next'));
      next.classList.toggle('danger', !!s.danger);
      if (s.optional && !s.final) next.textContent = 'Next';
      sync();
      (body.querySelector('textarea,input:not([type=range]),button.g-choice,.g-scale button') || next).focus({ preventScroll: true });
    }
    async function go(){
      if (busy) return; const list = visible(); const s = list[i];
      if (s.final){ close(); if (s.then) s.then(ctx); return; }
      let v;
      try { v = cur.get ? cur.get() : undefined; if (s.check) v = s.check(v, ctx); } catch (e) { return toast(e.message); }
      busy = true; sync();
      try { if (s.save) await s.save(v, ctx); } catch (e) { busy = false; sync(); return toast(e.message); }
      busy = false;
      refresh();
      i = Math.min(i + 1, visible().length - 1);
      if (visible()[i] === s){ close(); if (s.then) s.then(ctx); return; }
      show();
    }
    function close(){ bg.remove(); document.body.classList.remove('g-open'); removeEventListener('keydown', onKey, true); open = null; refresh(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }
    function onKey(e){
      if (e.key === 'Escape'){ e.preventDefault(); close(); }
      else if (e.key === 'Enter' && (e.target.matches('input.g-line:not(.no-enter)') || ((e.metaKey || e.ctrlKey) && e.target.matches('textarea')))){ e.preventDefault(); go(); }
      else if (e.key === 'Tab'){ const f = [...sheet.querySelectorAll('button:not([hidden]):not([disabled]),input,textarea,summary')].filter(x => x.offsetParent); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } }
    }
    back.addEventListener('click', () => { if (i > 0){ i--; show(); } });
    next.addEventListener('click', go);
    closeBtn.addEventListener('click', close);
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    addEventListener('keydown', onKey, true);
    open = { close };
    show();
  }

  const text = (key, { optional = false, placeholder = '' } = {}) => ({
    build: ({ plan }) => { const t = area(plan.reflection?.[key], placeholder); return { node: t, get: () => t.value }; },
    check: v => optional ? v.trim() : need(v, 'Write a few words, or go back.'),
    save: v => doAction('save_reflection', { [key]: v }),
  });

  /* ---------- Phase 1: Reflect ---------- */
  async function reflect({ fromStart = false } = {}){
    const m = await getMethod(); const { plan } = getState();
    const Q = Object.fromEntries(m.questions.map(q => [q.key, q]));
    const ctx = { plan, picked: (plan.person.values || []).map(v => v.name) };
    const steps = [
      { key: 'name', q: 'First, what should we call you?',
        build: ({ plan }) => { const i = line(plan.person.name, 'Your name'); return { node: i, get: () => i.value }; },
        check: v => v.trim(), save: v => v ? doAction('save_reflection', { name: v }) : null },
      { key: 'proud', q: Q.proud.ask, why: Q.proud.why, ...text('proud', { placeholder: 'Big or small, any part of life' }) },
      { key: 'grateful', q: Q.grateful.ask, why: Q.grateful.why, ...text('grateful') },
      { key: 'hard', q: Q.hard.ask, why: Q.hard.why, ...text('hard') },
      { key: 'areas', q: 'How is each part of life going, from 1 to 10?', why: Q.areas.why,
        build: ({ plan }) => { const names = Object.keys(plan.baseline.areas || {}).length ? Object.keys(plan.baseline.areas) : m.areas; return sliders(names, plan.baseline.areas || {}); },
        save: v => doAction('save_baseline', { areas: v }) },
      { key: 'values', q: 'Which values do you want to guide this year?', hint: 'Pick 3 to 5 that feel most like you. Add your own if one is missing.', why: Q.values.why,
        build: c => {
          const opts = [...new Set([...m.values, ...c.picked])].map(v => ({ value: v, label: v }));
          const ch = choice(opts, { multi: true, value: c.picked, max: 5 });
          const own = line('', 'Add your own value'); own.classList.add('no-enter'); const add = sec('Add', 'small');
          const doAdd = () => { const v = cap(own.value.trim()); if (!v) return; if (!opts.some(o => o.value === v)) ch.add({ value: v, label: v }); own.value = ''; own.focus(); };
          add.addEventListener('click', doAdd); own.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); doAdd(); } });
          return { node: el('div', { class: 'g-stack' }, ch.node, el('div', { class: 'g-row' }, own, add)), get: ch.get };
        },
        check: (v, c) => { if (v.length < 1) throw new Error('Pick at least one value.'); c.picked = v; return v; } },
      { key: 'meanings', q: 'What does each one mean to you?', hint: 'One sentence each, in your own words.',
        build: ({ plan, picked }) => {
          const old = Object.fromEntries((plan.person.values || []).map(v => [v.name, v.meaning]));
          const rows = picked.map(n => ({ n, t: line(old[n] || '', `${n} means…`) }));
          return { node: el('div', { class: 'g-stack' }, ...rows.map(r => el('label', { class: 'g-field' }, el('span', { text: r.n }), r.t))), get: () => rows.map(r => ({ name: r.n, meaning: r.t.value.trim() })) };
        },
        save: v => doAction('save_values', { values: v }) },
      { key: 'vision', q: Q.vision.ask, why: Q.vision.why, hint: 'Where you wake up, what you do, who you see, how you feel.', ...text('vision') },
      { key: 'capacity', q: 'How much time and energy do you really have?', hint: 'Be honest: the plan will fit what you have, not the other way round.', why: Q.capacity.why,
        build: ({ plan }) => {
          const c = plan.person.capacity || {};
          const hrs = line(c.hoursPerWeek ?? '', 'e.g. 3', 'number'); hrs.min = 0; hrs.max = 80; hrs.inputMode = 'decimal';
          const en = scale(10, c.energy, 'Running on empty', 'Full of energy');
          return { node: el('div', { class: 'g-stack' }, el('label', { class: 'g-field' }, el('span', { text: 'Hours a week for your goals' }), hrs), el('div', { class: 'g-field' }, el('span', { text: 'Energy lately' }), en.node)),
            get: () => ({ hoursPerWeek: Number(hrs.value), energy: en.get(), raw: hrs.value }) };
        },
        check: v => { if (v.raw === '' || !(v.hoursPerWeek >= 0 && v.hoursPerWeek <= 80)) throw new Error('Add your hours a week (0 to 80).'); if (!v.energy) throw new Error('Pick your energy from 1 to 10.'); return { hoursPerWeek: v.hoursPerWeek, energy: v.energy }; },
        save: async v => { const d = await doAction('save_capacity', v); ctx.limit = d.habitLimit; } },
      { key: 'gentle', q: 'What needs gentleness this year?', why: Q.gentle.why, hint: 'Health, grief, big changes (optional)', optional: true, ...text('gentle', { optional: true }) },
      { key: 'decision', q: Q.decision.ask, why: Q.decision.why, optional: true,
        build: ({ plan }) => {
          const t = area(plan.reflection?.decision, 'e.g. Whether to change jobs');
          const d = line('', '', 'date');
          return { node: el('div', { class: 'g-stack' }, el('label', { class: 'g-field' }, el('span', { text: 'Decision (optional)' }), t), el('label', { class: 'g-field' }, el('span', { text: 'Decide by (optional)' }), d)), get: () => ({ q: t.value.trim(), date: d.value }) };
        },
        save: async ({ q, date }, { plan }) => {
          await doAction('save_reflection', { decision: q });
          if (q && date){ const keep = (plan.decisions || []).filter(x => x.question !== q).map(({ date, question, ifNot }) => ({ date, question, ...(ifNot ? { ifNot } : {}) })); await doAction('save_plan_extras', { decisions: [...keep, { date, question: q }] }); }
        },
        then: () => goal() },
    ];
    // Resume at the first unanswered question unless asked to start over
    let start = 0;
    if (!fromStart){
      const r = plan.reflection || {}, c = plan.person.capacity || {};
      const done = { name: !!plan.person.name, proud: !!r.proud, grateful: !!r.grateful, hard: !!r.hard, areas: Object.keys(plan.baseline.areas || {}).length > 0, values: (plan.person.values || []).length > 0, meanings: (plan.person.values || []).length > 0, vision: !!r.vision, capacity: c.energy != null && c.hoursPerWeek != null, gentle: r.gentle != null, decision: r.decision != null };
      start = steps.findIndex(s => !done[s.key]); if (start < 0) return goal();
    }
    runFlow('Reflect', steps, ctx, start);
  }

  /* ---------- Phase 2 + 3: a goal, its milestones, then a habit ---------- */
  async function goal(){
    const { plan } = getState();
    const active = plan.goals.filter(g => g.status !== 'dropped' && g.status !== 'done');
    if (active.length >= 3) return toast('You have 3 goals, the most the method allows. Finish or drop one first.');
    const ctx = { plan, g: {} };
    const steps = [
      { q: 'Which part of life is this goal for?',
        build: () => {
          const a = plan.baseline.areas || {}; const names = Object.keys(a).length ? Object.entries(a).sort((x, y) => x[1] - y[1]).map(([k, v]) => ({ value: k, label: cap(k), sub: `${v}/10 today` })) : ['health', 'career', 'money', 'relationships', 'home', 'hobbies and fun', 'meaning and growth'].map(k => ({ value: k, label: cap(k) }));
          const ch = choice(names); const own = line('', 'Or type another area');
          return { node: el('div', { class: 'g-stack' }, ch.node, own), get: () => own.value.trim().toLowerCase() || ch.get() };
        },
        check: v => need(v, 'Pick an area.'), save: v => { ctx.g.area = v; } },
      { q: 'Which value does it serve?', hint: 'Goals tied to what you care about last longer.',
        build: () => {
          const vals = (plan.person.values || []).map(v => ({ value: v.name, label: v.name, sub: v.meaning || null }));
          if (!vals.length){ const i = line('', 'e.g. Health, Freedom, Family'); return { node: i, get: () => i.value }; }
          const ch = choice(vals); return { node: ch.node, get: ch.get };
        },
        check: v => need(v, 'Pick a value.'), save: v => { ctx.g.value = v; } },
      { q: 'What exactly do you want, and by when?', hint: 'Make it specific and a bit of a stretch, but realistic. E.g. "Sleep 7 hours on 5 nights a week by March."',
        why: 'Specific, challenging goals lead to more progress than "do your best" (Locke and Latham).',
        build: () => { const t = area(ctx.g.statement, 'What, how much, by when'); return { node: t, get: () => t.value }; },
        check: v => need(v, 'Write your goal in a sentence.'), save: v => { ctx.g.statement = v; } },
      { q: 'If you get there, what\'s the best thing about it?', hint: 'Picture it for a moment. What changes for you?',
        why: 'WOOP: imagining the best outcome, then the obstacle, turns a wish into a plan (Oettingen).',
        build: () => { const t = area(ctx.g.outcome); return { node: t, get: () => t.value }; },
        check: v => need(v, 'Write a few words.'), save: v => { ctx.g.outcome = v; } },
      { q: 'What in you is most likely to get in the way?', hint: 'Something inside you, like a habit, feeling or excuse, rather than other people. E.g. "Scrolling in bed."',
        build: () => { const t = area(ctx.g.obstacle); return { node: t, get: () => t.value }; },
        check: v => need(v, 'Name the main obstacle.'), save: v => { ctx.g.obstacle = v; } },
      { q: 'What will you do when it happens?', hint: 'An if-then plan makes the response automatic.',
        why: 'If-then plans roughly double follow-through in studies (Gollwitzer).',
        build: () => {
          const a = prefixed('If', ctx.g.obstacle.replace(/\.$/, '').toLowerCase(), 'the obstacle shows up');
          const b = prefixed('then I will', '', 'e.g. put my phone on the hall shelf');
          return { node: el('div', { class: 'g-stack' }, a.node, b.node), get: () => ({ if: a.input.value.trim(), then: b.input.value.trim() }) };
        },
        check: v => { need(v.then, 'Write what you\'ll do.'); return v; }, save: v => { ctx.g.plan = `If ${v.if || ctx.g.obstacle}, then I will ${v.then}.`; } },
      { q: 'Who do you want to be here?', hint: 'Habits stick better when they match who you think you are.', optional: true,
        build: () => { const p = prefixed('I\'m someone who', '', 'protects my sleep'); return { node: p.node, get: () => p.input.value.trim() }; },
        save: async v => {
          const g = await doAction('save_goal', { area: ctx.g.area, value: ctx.g.value, statement: ctx.g.statement, identity: v ? `I'm someone who ${v.replace(/\.$/, '')}.` : '', woop: { wish: ctx.g.statement, outcome: ctx.g.outcome, obstacle: ctx.g.obstacle, plan: ctx.g.plan } });
          ctx.goalId = g.id;
        } },
      { q: 'Break it into milestones', hint: '4 to 8 small steps you can tick off, spread across the year. Put most in the first two quarters.',
        why: 'Near-term sub-goals keep motivation up on long goals.',
        build: () => {
          const list = el('div', { class: 'g-ms' });
          const row = (q = 1, t = '') => { const s = el('select', { 'aria-label': 'Quarter' }); for (let n = 1; n <= 4; n++){ const o = el('option', { value: n, text: 'Q' + n }); if (n === q) o.selected = true; s.append(o); } const i = line(t, 'A tickable step'); const x = el('button', { type: 'button', class: 'g-x', 'aria-label': 'Remove', text: '✕' }); const r = el('div', { class: 'g-ms-row' }, s, i, x); x.addEventListener('click', () => r.remove()); list.append(r); return i; };
          [1, 1, 2, 3].forEach(q => row(q));
          const add = sec('+ Add a milestone', 'small'); add.addEventListener('click', () => { if (list.children.length >= 10) return toast('10 is plenty.'); row(Math.min(4, list.children.length ? 2 : 1)).focus(); });
          return { node: el('div', { class: 'g-stack' }, list, add), get: () => [...list.children].map(r => ({ quarter: Number(r.querySelector('select').value), text: r.querySelector('input').value.trim() })).filter(m => m.text) };
        },
        check: v => need(v, 'Add at least one milestone.'), save: v => doAction('save_milestones', { goalId: ctx.goalId, milestones: v }) },
      ...habitSteps(ctx),
    ];
    runFlow('New goal', steps, ctx);
  }

  function habitSteps(ctx){ return habitStepList(ctx).map(st => ({ kicker: 'New habit', ...st })); }
  function habitStepList(ctx){
    const BARRIERS = [
      { value: 'capability', label: 'I\'m not sure how, or it feels hard', sub: 'Fix: learn one small piece, or make the step even smaller.' },
      { value: 'opportunity', label: 'No time, place or tools', sub: 'Fix: set up the place and tools in advance, or move the cue.' },
      { value: 'motivation', label: 'I won\'t feel like it', sub: 'Fix: pair it with something you enjoy, or do it with someone.' },
    ];
    const h = ctx.h = ctx.h || {};
    // Decide once, at the start, whether to ask for the low-energy rule (saving it mustn't shift the steps)
    const hadRule = !!getState().plan.lowEnergyRule;
    return [
      { q: 'Which goal is this habit for?', skip: c => !!c.goalId,
        build: () => { const gs = getState().plan.goals.filter(g => g.status === 'active').map(g => ({ value: g.id, label: g.statement, sub: cap(g.area) })); const ch = choice(gs, { value: gs.length === 1 ? gs[0].value : null }); return { node: ch.node, get: ch.get }; },
        check: v => need(v, 'Pick a goal.'), save: v => { ctx.pickedGoal = v; } },
      { q: 'What\'s one small thing that would move it forward?', hint: 'Something you can do regularly. E.g. "Phone out of the bedroom", "Stretch", "Write 100 words".',
        why: 'Pick behaviours with high impact that are also easy: those are the ones that become habits.',
        build: () => { const i = line(h.behaviour, 'A short name for the habit'); return { node: i, get: () => i.value }; },
        check: v => need(v, 'Name the habit.'), save: v => { h.behaviour = v; } },
      { q: 'When will you do it?', hint: 'Tie it to something you already do every day. E.g. "brush my teeth", "pour my morning coffee".',
        why: 'An existing routine works as a cue, so you don\'t have to remember (habit stacking).',
        build: () => { const p = prefixed('After I', h.anchor, 'brush my teeth'); return { node: p.node, get: () => p.input.value }; },
        check: v => need(v, 'Pick something you already do.'), save: v => { h.anchor = v.replace(/^after (i )?/i, ''); } },
      { q: 'What\'s the tiny version?', hint: 'Under two minutes, so you\'d still do it on a bad day. Start with a verb.',
        why: 'Starting tiny makes the habit automatic first; you can grow it later (Fogg).',
        build: () => {
          const p = prefixed('I will', h.tiny, 'put my phone on the hall shelf');
          const prev = el('p', { class: 'g-recipe', text: recipe(h.anchor, h.tiny) });
          p.input.addEventListener('input', () => { prev.textContent = recipe(h.anchor, p.input.value); });
          return { node: el('div', { class: 'g-stack' }, p.node, prev), get: () => p.input.value };
        },
        check: v => need(v, 'Write the tiny version.'), save: v => { h.tiny = v.replace(/^i will /i, '').replace(/\.$/, ''); } },
      { q: 'How often?',
        build: () => { const ch = choice(['daily', 'weekly', 'fortnightly', 'monthly'].map(v => ({ value: v, label: cap(v) })), { value: h.rhythm || 'daily' }); return { node: ch.node, get: ch.get }; },
        check: v => need(v, 'Pick how often.'), save: v => { h.rhythm = v; } },
      { q: 'What\'s most likely to stop it?', hint: 'Your answer picks the fix.',
        why: 'COM-B: behaviour needs capability, opportunity and motivation. Fix the one that\'s missing.',
        build: () => {
          const ch = choice(BARRIERS, { value: h.barrier || null });
          const fix = area(h.fix, 'Your fix, in a sentence'); fix.hidden = !h.barrier;
          ch.node.addEventListener('change', () => { fix.hidden = false; fix.placeholder = BARRIERS.find(b => b.value === ch.get()).sub; fix.focus(); });
          return { node: el('div', { class: 'g-stack' }, ch.node, fix), get: () => ({ barrier: ch.get(), fix: fix.value.trim() }) };
        },
        check: v => { need(v.barrier, 'Pick what\'s most likely to stop it.'); return v; }, save: v => { h.barrier = v.barrier; h.fix = v.fix; } },
      { q: 'Plan for the hard day', hint: 'Optional. What will you do when that obstacle shows up?', optional: true,
        build: () => { const a = prefixed('If', '', 'I get home late'); const b = prefixed('then I will', '', 'do the tiny version'); return { node: el('div', { class: 'g-stack' }, a.node, b.node), get: () => ({ if: a.input.value.trim(), then: b.input.value.trim() }) }; },
        save: v => { h.ifThen = v.if && v.then ? [v] : []; } },
      { q: 'One change to your space that makes it easier', hint: 'Optional. E.g. "Move the charger to the hall", "Leave my shoes by the door".', optional: true,
        build: () => { const i = line(h.environment, 'Make it obvious and easy'); return { node: i, get: () => i.value.trim() }; },
        save: async v => {
          h.environment = v;
          const goalId = ctx.goalId || ctx.pickedGoal;
          const out = await doAction('save_habit', { goalId, behaviour: h.behaviour, anchor: h.anchor, tiny: h.tiny, rhythm: h.rhythm, barrier: h.barrier, ...(h.fix ? { fix: h.fix } : {}), ...(h.ifThen?.length ? { ifThen: h.ifThen } : {}), ...(v ? { environment: v } : {}) });
          ctx.saved = out;
        } },
      { q: 'When energy runs low for two weeks, what\'s your minimum?', hint: 'Decide now, while you have energy. E.g. "Only the tiny versions, and an early night."',
        skip: () => hadRule, optional: true,
        build: () => { const t = area('', 'My low-energy rule'); return { node: t, get: () => t.value.trim() }; },
        save: v => v ? doAction('save_plan_extras', { lowEnergyRule: v }) : null },
      { final: true, q: 'Your new habit', nextLabel: 'Done',
        hint: 'Tap it on your Compass each time you do it. The tiny version counts.',
        build: () => {
          const s = ctx.saved; if (!s) return { node: null };
          return { node: el('div', { class: 'g-stack' }, el('p', { class: 'g-recipe big', text: s.recipe }),
            s.overCapacity ? el('p', { class: 'g-warn', text: `That's more habits than your energy allows right now (about ${getState().habitLimit}). Consider pausing one, or keeping only the tiny versions.` }) : null) };
        },
        then: () => { const t = document.querySelector('.tile:last-child'); if (t) confetti(t); } },
    ];
  }
  function habit(){
    const { plan } = getState();
    if (!plan.goals.some(g => g.status === 'active')) return goal();
    const ctx = { plan };
    runFlow('New habit', habitSteps(ctx), ctx);
  }

  /* ---------- Phase 5: Reviews ---------- */
  function weekly(){
    const ctx = {};
    runFlow('Weekly review', [
      { q: 'How was your energy this week?', build: () => { const s = scale(10, null, 'Running on empty', 'Full of energy'); return s; }, check: v => need(v, 'Pick a number from 1 to 10.'), save: v => { ctx.energy = v; } },
      { q: 'What helped, or got in the way?', hint: 'One line is plenty.', optional: true, build: () => { const t = area(); return { node: t, get: () => t.value.trim() }; }, save: v => { ctx.note = v; } },
      { q: 'One good thing this week, and why it happened', hint: 'Optional. Noticing why good things happen helps you repeat them.', optional: true,
        build: () => { const t = area(); return { node: t, get: () => t.value.trim() }; },
        save: async v => { ctx.out = await doAction('weekly_review', { energy: ctx.energy, note: ctx.note || '', goodThing: v || '' }); } },
      { final: true, q: 'Week done', build: () => {
          const o = ctx.out || {}; const { plan } = getState();
          return { node: el('div', { class: 'g-stack' },
            (o.logged || []).length ? el('ul', { class: 'g-summary' }, ...o.logged.map(l => el('li', {}, el('b', { text: l.habit }), el('span', { text: `${l.times} time${l.times === 1 ? '' : 's'} this week` })))) : null,
            o.lowEnergy ? el('p', { class: 'g-warn', text: `Energy has been low two weeks running. Time for your low-energy rule${plan.lowEnergyRule ? `: "${plan.lowEnergyRule}"` : ': keep only the tiny versions and rest'}.` }) : null) };
        } },
    ]);
  }
  async function monthly(){
    const m = await getMethod(); const { habits } = getState();
    if (!habits.length) return toast('No active habits to check yet.');
    const ctx = { results: [] };
    const steps = habits.map(h => ({
      q: h.behaviour, hint: 'How true is each of these, from 1 (not at all) to 5 (completely)?',
      why: 'The Self-Report Behavioural Automaticity Index: at 4 or more, a habit runs on its own.',
      build: () => { const ss = m.srbai.map(t => ({ t, s: scale(5, null) })); return { node: el('div', { class: 'g-stack' }, ...ss.map(x => el('div', { class: 'g-field' }, el('span', { text: x.t }), x.s.node))), get: () => ss.map(x => x.s.get()) }; },
      check: v => { if (v.some(x => !x)) throw new Error('Rate all four.'); return v; },
      save: async v => { const r = await doAction('monthly_check', { habitId: h.id, ratings: v }); ctx.results.push({ h, r }); },
    }));
    steps.push({ final: true, q: 'Habit check done', build: () => ({ node: el('ul', { class: 'g-summary' }, ...ctx.results.map(({ h, r }) => {
      const li = el('li', {}, el('b', { text: h.behaviour }), el('span', { text: r.graduate ? `${r.avg} out of 5: it's automatic` : `${r.avg} out of 5: keep going` }));
      if (r.graduate){ const b = sec('Graduate it', 'small'); b.addEventListener('click', async () => { await doAction('save_habit', { goalId: h.goalId, id: h.id, status: 'graduated' }); b.replaceWith(el('span', { class: 'g-ok', text: 'Graduated' })); confetti(li); refresh(); }); li.append(b); }
      return li; })) }) });
    runFlow('Habit check', steps, ctx);
  }
  function quarterly(){
    const { plan } = getState(); const ctx = {};
    runFlow('Quarterly review', [
      { q: 'How is each part of life going now?', hint: 'Rate them again, from 1 to 10.', build: () => sliders(Object.keys(plan.baseline.areas || {}).length ? Object.keys(plan.baseline.areas) : ['health', 'career', 'money', 'relationships', 'home', 'hobbies and fun', 'meaning and growth'], plan.baseline.areas || {}), save: v => { ctx.areas = v; } },
      { q: 'Anything to note about this quarter?', hint: 'Optional. You could write a short thank-you to someone who helped, sent or not.', optional: true,
        build: () => { const t = area(); return { node: t, get: () => t.value.trim() }; },
        save: async v => { ctx.out = await doAction('quarterly_review', { areas: ctx.areas, note: v || '' }); } },
      { final: true, q: 'What changed', hint: 'Look at your goals: keep, change or drop any of them, and plan next quarter\'s milestones.', build: () => ({ node: el('ul', { class: 'g-summary' }, ...Object.entries(ctx.out?.change || {}).map(([k, d]) => el('li', {}, el('b', { text: cap(k) }), el('span', { class: d > 0 ? 'up' : d < 0 ? 'down' : '', text: d == null ? 'new' : d > 0 ? `+${d}` : d === 0 ? 'same' : String(d) })))) }) },
    ]);
  }
  function lapse(item){
    const { plan } = getState(); const h = plan.goals.flatMap(g => (g.habits || []).map(x => ({ ...x, goalId: g.id }))).find(x => x.id === item.habitId); if (!h) return;
    runFlow('Restart a habit', [
      { q: `${h.behaviour} slipped. That's normal.`, hint: 'New habits take about 66 days on average, and missed days are part of it. What got in the way?',
        build: () => { const t = area('', 'One line'); return { node: t, get: () => t.value.trim() }; }, optional: true, save: v => { h._why = v; } },
      { q: 'Make it easier', hint: 'Shrink it, or move it to a better moment.',
        build: () => { const a = prefixed('After I', h.anchor, ''); const b = prefixed('I will', h.tiny, ''); return { node: el('div', { class: 'g-stack' }, a.node, b.node), get: () => ({ anchor: a.input.value.trim(), tiny: b.input.value.trim() }) }; },
        check: v => { need(v.anchor, 'Keep a cue.'); need(v.tiny, 'Keep a tiny version.'); return v; },
        save: v => doAction('save_habit', { goalId: h.goalId, id: h.id, anchor: v.anchor.replace(/^after (i )?/i, ''), tiny: v.tiny.replace(/^i will /i, '') }) },
      { final: true, q: 'Fresh start', hint: 'Begin again at the next Monday or the 1st of the month. Never miss twice.', build: () => ({ node: null }) },
    ]);
  }

  /* ---------- Edit and delete, available at all times ---------- */
  function quarterPicker(q){ const s = el('select', { class: 'g-q-pick', 'aria-label': 'Quarter' }); for (let n = 1; n <= 4; n++){ const o = el('option', { value: n, text: 'Q' + n }); if (n === q) o.selected = true; s.append(o); } return s; }
  function editHabit(h){
    runFlow('Habit', [{
      q: 'Edit habit', nextLabel: 'Save',
      build: () => {
        const name = line(h.behaviour, 'A short name for the habit');
        const a = prefixed('After I', String(h.anchor || '').replace(/^after (i )?/i, ''), 'brush my teeth');
        const t = prefixed('I will', h.tiny, 'put my phone on the hall shelf');
        const prev = el('p', { class: 'g-recipe', text: recipe(a.input.value, t.input.value) });
        const upd = () => { prev.textContent = recipe(a.input.value, t.input.value); }; a.input.addEventListener('input', upd); t.input.addEventListener('input', upd);
        const rh = choice(['daily', 'weekly', 'fortnightly', 'monthly'].map(v => ({ value: v, label: cap(v) })), { value: h.rhythm });
        return { node: el('div', { class: 'g-stack' }, el('label', { class: 'g-field' }, el('span', { text: 'Habit' }), name), a.node, t.node, prev, el('div', { class: 'g-field' }, el('span', { text: 'How often' }), rh.node)),
          get: () => ({ behaviour: name.value.trim(), anchor: a.input.value.trim().replace(/^after (i )?/i, ''), tiny: t.input.value.trim().replace(/^i will /i, '').replace(/\.$/, ''), rhythm: rh.get() }) };
      },
      check: v => { need(v.behaviour, 'Name the habit.'); need(v.anchor, 'Keep a cue.'); need(v.tiny, 'Keep a tiny version.'); return v; },
      save: v => doAction('save_habit', { goalId: h.goalId, id: h.id, ...v }),
    }]);
  }
  function editMilestone(m){
    runFlow('Step', [{
      q: 'Edit step', nextLabel: 'Save',
      build: () => { const t = line(m.text, 'A tickable step'); const qp = quarterPicker(m.quarter); return { node: el('div', { class: 'g-ms-row two' }, qp, t), get: () => ({ text: t.value.trim(), quarter: Number(qp.value) }) }; },
      check: v => { need(v.text, 'Write the step.'); return v; },
      save: v => doAction('edit_milestone', { milestoneId: m.id, ...v }),
    }]);
  }
  function addMilestone(g){
    runFlow('Step', [{
      q: 'Add a step', hint: g.statement, nextLabel: 'Add',
      build: () => { const t = line('', 'A tickable step'); const qp = quarterPicker(1); return { node: el('div', { class: 'g-ms-row two' }, qp, t), get: () => ({ text: t.value.trim(), quarter: Number(qp.value) }) }; },
      check: v => { need(v.text, 'Write the step.'); return v; },
      save: v => doAction('add_milestone', { goalId: g.id, ...v }),
    }]);
  }
  // Deleting asks once; habits are set aside (their history stays), steps are removed
  function confirmDelete(kind, item){
    const isHabit = kind === 'habit';
    runFlow(isHabit ? 'Habit' : 'Step', [{
      q: isHabit ? `Delete "${item.behaviour}"?` : `Delete "${item.text}"?`,
      hint: isHabit ? 'It leaves your Compass. Past check-ins stay in your history.' : 'This step will be removed from its goal.',
      nextLabel: 'Delete', danger: true,
      build: () => ({ node: null }),
      save: () => isHabit ? doAction('save_habit', { goalId: item.goalId, id: item.id, status: 'dropped' }) : doAction('delete_milestone', { milestoneId: item.id }),
    }]);
  }

  window.LCGuide = { reflect, goal, habit, weekly, monthly, quarterly, lapse, editHabit, editMilestone, addMilestone, confirmDelete };
})();
