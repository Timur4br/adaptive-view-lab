/* Numerical browser model. No DOM, network, or dependency on the renderer.
 * Conditional known-pose WLS, matching research/run_experiments.py.
 * Ground truth is passed only to observation generation and outcome scoring.
 */
(function (root) {
  'use strict';
  const F = 1600, CX = 640, CY = 480, SIGMA = 0.7, RIDGE = 1e-10;
  const STRATEGIES = ['object_only', 'periodic_3', 'alternating', 'random', 'frozen_plan', 'adaptive', 'wide_only'];
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const minus = (a, b) => a.map((x, i) => x - b[i]);
  const norm = a => Math.sqrt(dot(a, a));
  const copy = x => JSON.parse(JSON.stringify(x));
  const zeros = () => Array(9).fill(0);
  function inverse(A, ridge = RIDGE) {
    const a = Math.sqrt(A[0] + ridge), b = A[3] / a, c = A[6] / a;
    const d = Math.sqrt(A[4] + ridge - b * b), e = (A[7] - c * b) / d;
    const f = Math.sqrt(A[8] + ridge - c * c - e * e);
    if (![a, d, f].every(x => Number.isFinite(x) && x > 0)) throw new Error('Недостаточно геометрической информации для восстановления точек.');
    const out = zeros();
    for (let k = 0; k < 3; k++) {
      const y0 = (k === 0 ? 1 : 0) / a;
      const y1 = ((k === 1 ? 1 : 0) - b * y0) / d;
      const y2 = ((k === 2 ? 1 : 0) - c * y0 - e * y1) / f;
      const x2 = y2 / f, x1 = (y1 - e * x2) / d, x0 = (y0 - b * x1 - c * x2) / a;
      out[k] = x0; out[3 + k] = x1; out[6 + k] = x2;
    }
    return out;
  }
  const mul = (A, v) => [0, 1, 2].map(i => A.slice(i * 3, i * 3 + 3).reduce((s, x, j) => s + x * v[j], 0));
  function addOuter(H, a, weight = 1) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H[i * 3 + j] += a[i] * a[j] * weight;
  }
  function project(points, view) {
    const coords = [], jac = [], visible = [];
    for (const p of points) {
      const v = minus(p, view.center), pc = view.rotation.map(row => dot(row, v));
      const z = pc[2], uv = [F * pc[0] / z + CX, F * pc[1] / z + CY];
      const J = [0, 1].map(k => [0, 1, 2].map(j => F / z * (view.rotation[k][j] - pc[k] / z * view.rotation[2][j])));
      coords.push(uv); jac.push(J);
      visible.push(z > 50 && uv[0] > 16 && uv[0] < 1264 && uv[1] > 16 && uv[1] < 944);
    }
    for (const j of [0, 2]) { const both = visible[j] && visible[j + 1]; visible[j] = both; visible[j + 1] = both; }
    return { coords, jac, visible };
  }
  function fit(bank, selected) {
    const H = Array.from({ length: 4 }, zeros), rhs = Array.from({ length: 4 }, () => [0, 0, 0]);
    bank.views.forEach((view, v) => {
      if (!selected[v]) return;
      for (let p = 0; p < 4; p++) if (bank.visible[v][p]) {
        for (let k = 0; k < 2; k++) {
          const x = (bank.pixels[v][p][k] - (k === 0 ? CX : CY)) / F;
          const a = view.rotation[2].map((r, j) => x * r - view.rotation[k][j]);
          addOuter(H[p], a); const b = dot(a, view.center);
          a.forEach((x, j) => { rhs[p][j] += x * b; });
        }
      }
    });
    const points = H.map((h, i) => mul(inverse(h, 1e-14), rhs[i]));
    let information;
    for (let it = 0; it < 5; it++) {
      information = Array.from({ length: 4 }, zeros);
      const grad = Array.from({ length: 4 }, () => [0, 0, 0]);
      bank.views.forEach((view, v) => {
        if (!selected[v]) return;
        const projected = project(points, view);
        for (let p = 0; p < 4; p++) if (bank.visible[v][p]) {
          for (let k = 0; k < 2; k++) {
            const j = projected.jac[p][k], residual = bank.pixels[v][p][k] - projected.coords[p][k];
            addOuter(information[p], j, 1 / SIGMA ** 2);
            j.forEach((x, i) => { grad[p][i] += x * residual / SIGMA ** 2; });
          }
        }
      });
      if (it < 4) information.forEach((h, p) => {
        const delta = mul(inverse(h), grad[p]); delta.forEach((x, j) => { points[p][j] += x; });
      });
    }
    return { points, information, covariance: information.map(h => inverse(h)) };
  }
  function measure(state, referenceObserved, uL) {
    const od = minus(state.points[1], state.points[0]), rd = minus(state.points[3], state.points[2]);
    const d = norm(od), ell = norm(rd), q = referenceObserved * d / ell;
    const og = od.map(x => referenceObserved / ell * x / d);
    const rg = rd.map(x => -referenceObserved * d / ell ** 2 * x / ell);
    const gradient = [og.map(x => -x), og, rg.map(x => -x), rg];
    const pointVariances = gradient.map((g, p) => dot(g, mul(state.covariance[p], g)));
    const floor = (d / ell * uL) ** 2;
    const components = [pointVariances[0] + pointVariances[1], pointVariances[2] + pointVariances[3], floor];
    const variance = components.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(q) || !(variance > 0)) throw new Error('Не удалось получить конечную оценку длины и неопределённости.');
    return { q, u: Math.sqrt(variance), variance, gradient, floor, components, d, ell };
  }
  function predictions(bank, state, measured, selected) {
    const out = [];
    bank.views.forEach((view, index) => {
      if (selected[index] || index < 6) return;
      const proj = project(state.points, view), additions = Array.from({ length: 4 }, zeros);
      const covs = additions.map((h, p) => {
        if (proj.visible[p]) proj.jac[p].forEach(j => addOuter(h, j, 1 / SIGMA ** 2));
        return inverse(h.map((x, i) => x + state.information[p][i]));
      });
      const variance = measured.floor + measured.gradient.reduce((v, g, p) => v + dot(g, mul(covs[p], g)), 0);
      out.push({ index, family: view.family, variance, gain: measured.variance - variance, additions });
    });
    return out;
  }
  function allowedFamily(strategy, step) {
    if (strategy === 'object_only') return 0;
    if (strategy === 'wide_only') return 2;
    if (strategy === 'periodic_3') return (step + 1) % 3 === 0 ? 1 : 0;
    if (strategy === 'alternating') return step % 2;
    return null;
  }
  function prepare(bank, budget = 8) {
    const selected = bank.views.map((_, i) => i < 6), state = fit(bank, selected);
    const measured = measure(state, bank.referenceObserved, bank.config.uL);
    const planning = copy(state), used = selected.slice(), plan = [];
    const additions = predictions(bank, state, measured, selected);
    for (let step = 0; step < budget; step++) {
      let best = null;
      for (const candidate of additions) if (!used[candidate.index]) {
        const variance = measured.floor + measured.gradient.reduce((v, g, p) =>
          v + dot(g, mul(inverse(planning.information[p].map((x, i) => x + candidate.additions[p][i])), g)), 0);
        if (best === null || variance < best.variance) best = { ...candidate, variance };
      }
      plan.push(best.index); used[best.index] = true;
      planning.information = planning.information.map((h, p) => h.map((x, i) => x + best.additions[p][i]));
    }
    return { state, measured, selected, plan };
  }
  function run(bank, strategy = 'adaptive', prepared = null, budget = 8, truth = null) {
    if (!STRATEGIES.includes(strategy)) throw new Error('Неизвестная стратегия');
    const initial = prepared || prepare(bank, budget), history = [];
    let selected = initial.selected.slice(), state = copy(initial.state), measured = copy(initial.measured), action = -1;
    for (let step = 0; step <= budget; step++) {
      const family = allowedFamily(strategy, step);
      const candidates = step < budget ? predictions(bank, state, measured, selected).filter(c => family === null || c.family === family) : [];
      candidates.sort((a, b) => a.variance - b.variance || a.index - b.index);
      let next = candidates.length ? candidates[0].index : null;
      if (step < budget && strategy === 'random') next = bank.randomOrder.find(i => !selected[i]);
      if (step < budget && strategy === 'frozen_plan') next = initial.plan[step];
      history.push({ step, action, selected: selected.slice(), state: copy(state), ...copy(measured), next,
        candidates: candidates.map(({ additions, ...rest }) => rest), error: truth === null ? null : measured.q - truth });
      if (step < budget) {
        action = next;
        if (!Number.isInteger(action) || selected[action]) throw new Error('Недопустимое повторное действие');
        selected[action] = true; state = fit(bank, selected); measured = measure(state, bank.referenceObserved, bank.config.uL);
      }
    }
    return history;
  }
  function runAll(bank, truth = null) {
    const prepared = prepare(bank); return Object.fromEntries(STRATEGIES.map(s => [s, run(bank, s, prepared, 8, truth)]));
  }
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function generate(template, truthPoints, referenceLength, seed) {
    const bank = copy(template), random = seededRandom(seed);
    const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
    bank.pixels = []; bank.visible = [];
    for (const view of bank.views) {
      const p = project(truthPoints, view);
      bank.pixels.push(p.coords.map(uv => uv.map(x => x + gaussian() * bank.config.actual_noise)));
      bank.visible.push(p.visible);
    }
    bank.referenceObserved = referenceLength + gaussian() * bank.config.uL;
    bank.randomOrder = bank.views.map((_, i) => i).filter(i => i >= 6).map(index => ({ index, rank: random() })).sort((a, b) => a.rank - b.rank).map(x => x.index);
    bank.browserSeed = seed >>> 0; return bank;
  }
  const api = { STRATEGIES, inverse, project, fit, measure, predictions, prepare, run, runAll, generate };
  root.NBVModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'undefined' ? window : globalThis);
