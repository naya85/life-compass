// Life Compass dashboard. Reads the local plan through the dashboard server; all text is set with textContent.
(() => {
  const key = new URLSearchParams(location.hash.slice(1)).get('key') || sessionStorage.getItem('lc-key') || '';
  if (key){ try { sessionStorage.setItem('lc-key', key); } catch {} history.replaceState(null, '', location.pathname); }
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)){ if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } for (const c of kids) if (c != null) n.append(c); return n; };
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // "After I brush my teeth" or "After lunch on Mondays" both read naturally
  const recipe = h => { const a = String(h.anchor || '').trim(); const lead = /^after\b/i.test(a) ? a.charAt(0).toUpperCase() + a.slice(1) : `After I ${a}`; return `${lead}, I will ${h.tiny}.`; };
  const COLORS = ['#8E5CF7', '#E5489B', '#0BA5B4'];
  const COLORS_DARK = ['#5E3BC2', '#B42F78', '#07818D'];

  async function api(path, body){
    const r = await fetch('/api/' + path, { method: body ? 'POST' : 'GET', headers: { 'x-life-compass-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(r.status === 401 ? 'This page needs its private link. Open it again from your AI or with npm run ui.' : 'Something went wrong.');
    return r.json();
  }
  function toast(msg){ const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 2600); }

  /* ---------- Mountain: 6 stages, front layer masked to the near ground and big peak ---------- */
  const BAND = '0,0.665 1,0.665 1,1 0,1';
  const PEAKS = [null, '0.58,0.62 0.64,0.47 0.69,0.37 0.75,0.47 0.83,0.56 0.86,0.62', '0.52,0.63 0.62,0.34 0.70,0.16 0.78,0.33 0.90,0.50 0.94,0.63',
    '0.50,0.63 0.61,0.31 0.70,0.12 0.79,0.30 0.91,0.47 0.95,0.63', '0.50,0.63 0.61,0.31 0.70,0.12 0.79,0.30 0.91,0.47 0.95,0.63', '0.50,0.63 0.61,0.31 0.70,0.12 0.79,0.30 0.91,0.47 0.95,0.63'];
  const mask = i => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><filter id='b' x='-.1' y='-.1' width='1.2' height='1.2'><feGaussianBlur stdDeviation='.006'/></filter><g filter='url(#b)'><polygon points='${BAND}'/>${PEAKS[i] ? `<polygon points='${PEAKS[i]}'/>` : ''}</g></svg>`)}")`;
  for (let i = 0; i < 6; i++){
    $('mtnBack').append(el('img', { src: `assets/mountain/s${i + 1}.png`, alt: '' }));
    const f = el('img', { src: `assets/mountain/s${i + 1}.png`, alt: '' });
    f.style.webkitMaskImage = f.style.maskImage = mask(i);
    $('mtnFront').append(f);
  }
  const setMountain = pct => { const idx = Math.min(5, Math.floor(pct / (100 / 6))); for (const m of [$('mtnBack'), $('mtnFront')]) [...m.children].forEach((img, i) => img.classList.toggle('on', i === idx)); };

  /* ---------- Rings: one per goal ---------- */
  let hovering = null;
  function renderRings(plan, pctAll){
    const host = $('rings'); host.textContent = '';
    const goals = plan.goals.filter(g => g.status !== 'dropped').slice(0, 3);
    const W = 14, gap = 5;
    host.append(svg('path', { id: 'arc', d: 'M 100 100 m -110 0 a 110 110 0 1 1 220 0 a 110 110 0 1 1 -220 0', fill: 'none' }));
    const values = (plan.person.values || []).slice(0, 4).map(v => v.name);
    values.forEach((name, i, a) => { const t = svg('text', { class: 'ring-label', 'text-anchor': 'middle' }); const tp = svg('textPath', { href: '#arc', startOffset: (a.length === 1 ? 25 : 7 + i * (36 / (a.length - 1))) + '%' }); tp.textContent = name; t.append(tp); host.append(t); });
    goals.forEach((g, i) => {
      const r = 100 - W / 2 - 4 - i * (W + gap), C = 2 * Math.PI * r;
      const ms = g.milestones || [], f = ms.length ? ms.filter(m => m.done).length / ms.length : 0;
      const grad = svg('linearGradient', { id: 'g' + i, x1: 0, y1: 0, x2: 1, y2: 1 });
      grad.append(svg('stop', { offset: 0, 'stop-color': COLORS[i] + '99' }), svg('stop', { offset: 1, 'stop-color': COLORS_DARK[i] }));
      host.append(grad);
      host.append(svg('circle', { cx: 100, cy: 100, r, fill: 'none', stroke: 'rgb(250 248 253 / .92)', 'stroke-width': W + 1 }));
      const trk = svg('circle', { cx: 100, cy: 100, r, fill: 'none', stroke: COLORS[i], 'stroke-opacity': .18, 'stroke-width': W, 'data-goal': g.id, 'pointer-events': 'stroke' });
      const prog = svg('circle', { class: 'prog', cx: 100, cy: 100, r, fill: 'none', stroke: `url(#g${i})`, 'stroke-width': W, 'stroke-linecap': 'round', 'stroke-dasharray': C, 'stroke-dashoffset': C * (1 - f), transform: 'rotate(-90 100 100)', 'data-goal': g.id, 'pointer-events': 'stroke' });
      host.append(trk, prog);
    });
    // Hover a ring: show that goal in the centre
    host.onpointerover = e => { const t = e.target.closest('[data-goal]'); if (!t) return; const g = plan.goals.find(x => x.id === t.dataset.goal); const ms = g.milestones || [];
      hovering = g.id; host.classList.add('focus'); host.querySelectorAll('[data-goal]').forEach(c => c.classList.toggle('hot', c.dataset.goal === g.id));
      $('pct').textContent = (ms.length ? Math.round(100 * ms.filter(m => m.done).length / ms.length) : 0) + '%'; $('cap').textContent = g.statement; };
    host.onpointerleave = () => { hovering = null; host.classList.remove('focus'); host.querySelectorAll('.hot').forEach(c => c.classList.remove('hot')); $('pct').textContent = pctAll + '%'; $('cap').textContent = 'of milestones done'; };
  }

  /* ---------- Confetti in the gradient's colours ---------- */
  const CONFETTI = ['#8E5CF7', '#A458E8', '#BE50CB', '#E5489B', '#C9B4FF', '#F6A9CF', '#FFD25A', '#3CCFB4'];
  function confetti(from){
    if (reduce()) return;
    const cv = el('canvas', { class: 'confetti' }); document.body.append(cv);
    const ctx = cv.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    const r = from.getBoundingClientRect(), ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    const parts = Array.from({ length: 110 }, (_, i) => { const a = -Math.PI / 2 + (Math.random() * 2 - 1) * 1.4, sp = 350 + Math.random() * 550; return { x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: (Math.random() - .5) * 12, w: i % 5 ? 6 + Math.random() * 5 : 3, h: i % 5 ? 4 + Math.random() * 3 : 12 + Math.random() * 8, c: CONFETTI[i % CONFETTI.length], wob: Math.random() * 6, life: 1900 + Math.random() * 800 }; });
    const t0 = performance.now(); let last = t0;
    (function frame(t){ const dt = Math.min(.033, (t - last) / 1000); last = t; const e = t - t0; ctx.clearRect(0, 0, W, H); let alive = false;
      for (const p of parts){ if (e > p.life) continue; alive = true; p.vy += 900 * dt; p.vx *= Math.pow(.12, dt); p.vy *= Math.pow(.35, dt); p.wob += 9 * dt; p.x += (p.vx + Math.sin(p.wob) * 40) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        ctx.save(); ctx.globalAlpha = Math.min(1, (p.life - e) / 400); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.wob)); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); }
      if (alive) requestAnimationFrame(frame); else cv.remove(); })(t0);
  }

  /* ---------- Render ---------- */
  const DUE_LABEL = { 'weekly review': 'Weekly review', 'monthly habit-strength check': 'Habit check', 'quarterly review': 'Quarterly review', 'decision': 'Decision', 'lapse replan': 'Restart a habit' };
  function render({ plan, status, habits, today }){
    const name = plan.person.name;
    $('avatar').textContent = (name || 'You').slice(0, 1).toUpperCase();
    $('hello').textContent = name ? `Hi, ${name}!` : 'Your Life Compass';
    $('sub').textContent = new Date(today + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + (plan.goals.length ? ` · ${plan.goals.filter(g => g.status !== 'dropped').length} goals` : '');
    const hasPlan = plan.goals.length > 0;
    $('empty').hidden = hasPlan; $('grid').hidden = !hasPlan;
    // Chips: phase + anything due
    const chips = $('chips'); chips.textContent = '';
    if (status.phase !== 'act') chips.append(el('span', { class: 'chip', text: status.phaseTitle }));
    for (const d of (status.due || []).slice(0, 2)) chips.append(el('span', { class: 'chip hot', text: DUE_LABEL[d.type] || d.type }));
    if (!hasPlan) return;

    const all = plan.goals.flatMap(g => g.milestones || []), done = all.filter(m => m.done).length;
    const pct = all.length ? Math.round(100 * done / all.length) : 0;
    if (!hovering){ $('pct').textContent = pct + '%'; $('cap').textContent = 'of milestones done'; }
    renderRings(plan, pct); setMountain(pct);

    // Next step: first open milestone in the earliest quarter
    const nextM = plan.goals.flatMap(g => (g.milestones || []).map(m => ({ ...m, goal: g }))).filter(m => !m.done).sort((a, b) => a.quarter - b.quarter)[0];
    const next = $('next'); next.textContent = '';
    if (nextM) next.append(el('small', { text: 'Next step' }), el('p', { text: nextM.text }));

    // Habits
    const tiles = $('tiles'); tiles.textContent = '';
    $('weekMeta').textContent = habits.length ? `${habits.filter(h => h.loggedToday).length} of ${habits.length} today` : '';
    if (!habits.length) tiles.append(el('p', { class: 'empty-line', text: 'No habits yet. Plan them with your AI.' }));
    for (const h of habits){
      const t = el('button', { class: 'tile' + (h.loggedToday ? ' done' : ''), type: 'button', 'aria-pressed': String(h.loggedToday) },
        el('b', { text: h.behaviour }), el('span', { text: recipe(h) }),
        el('span', { class: 't-foot' }, el('span', { text: `${h.rhythm} · ${h.weekStreak} week${h.weekStreak === 1 ? '' : 's'}` }), el('span', { class: 'check', text: h.loggedToday ? '✓' : '' })));
      t.addEventListener('click', async () => {
        if (h.loggedToday) return toast('Already logged today. Nice.');
        try { await api('log', { habitId: h.id, version: 'full' }); confetti(t); refresh(); } catch (e) { toast(e.message); }
      });
      tiles.append(t);
    }

    // Due
    const due = $('due'); due.textContent = '';
    const items = [...(status.due || [])];
    for (const d of plan.decisions || []) if (!d.decided && !items.some(x => x.type === 'decision' && x.date === d.date)) items.push({ type: 'decision', why: new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), question: d.question });
    if (!items.length) due.append(el('li', {}, el('b', { text: 'All clear' }), el('span', { text: 'Nothing due right now' })));
    for (const d of items.slice(0, 6)) due.append(el('li', {}, el('b', { text: d.type === 'decision' ? d.question : (DUE_LABEL[d.type] || d.type) + (d.habit ? `: ${d.habit}` : '') }), el('span', { text: d.why || '' })));

    // Goals
    const goals = $('goals'); goals.textContent = '';
    $('goalsMeta').textContent = `${done} of ${all.length} milestones`;
    plan.goals.filter(g => g.status !== 'dropped').forEach((g, i) => {
      const ms = g.milestones || [], gd = ms.filter(m => m.done).length;
      const bar = el('div', { class: 'bar' }, el('i')); bar.firstChild.style.transform = `scaleX(${ms.length ? gd / ms.length : 0})`;
      const dot = el('span', { class: 'goal-dot' }); dot.style.background = COLORS[i % 3];
      const list = el('ul', { class: 'ms' });
      for (const m of [...ms].sort((a, b) => a.quarter - b.quarter)){
        const cb = el('input', { type: 'checkbox', 'aria-label': m.text }); cb.checked = m.done;
        cb.addEventListener('change', async () => { try { await api('milestone', { milestoneId: m.id, done: cb.checked }); if (cb.checked) confetti(cb); refresh(); } catch (e) { toast(e.message); cb.checked = !cb.checked; } });
        list.append(el('li', {}, el('label', {}, cb, el('span', { class: m.done ? 'done-t' : '' }, el('em', { text: 'Q' + m.quarter }), document.createTextNode(m.text)))));
      }
      goals.append(el('div', { class: 'goal' }, el('div', { class: 'goal-top' }, dot, el('span', { class: 'goal-area', text: `${g.area.charAt(0).toUpperCase() + g.area.slice(1)} · ${g.value}` })),
        el('h3', { text: g.statement }), g.identity ? el('p', { class: 'identity', text: `"${g.identity}"` }) : null, bar, list));
    });

    // Wins
    const wins = $('wins'); wins.textContent = '';
    $('winsMeta').textContent = plan.wins.length ? `${plan.wins.length} logged` : '';
    for (const w of [...plan.wins].reverse().slice(0, 8)) wins.append(el('li', {}, el('span', { text: w.text }), el('small', { text: new Date(w.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) })));
  }

  $('winForm').addEventListener('submit', async e => {
    e.preventDefault(); const input = $('winText'), text = input.value.trim(); if (!text) return;
    try { await api('win', { text }); input.value = ''; confetti(e.submitter || input); refresh(); } catch (err) { toast(err.message); }
  });

  // Live: re-read every few seconds so changes made through the AI show up
  let lastStamp = '';
  async function refresh(){
    try { const s = await api('state'); const stamp = s.plan.updatedAt + s.today; if (stamp !== lastStamp){ lastStamp = stamp; render(s); } }
    catch (e) { $('empty').hidden = false; $('empty').querySelector('p').textContent = e.message; }
  }
  refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 4000);
})();
