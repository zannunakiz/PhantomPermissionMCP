const s = require('../coverage/coverage-summary.json');
const norm = (k) => k.replace(/\\/g, '/');
const d = Object.entries(s).filter(([k]) => norm(k).includes('src/domain/'));
const agg = (m) => {
  let t = 0,
    c = 0;
  for (const [, v] of d) {
    t += v[m].total;
    c += v[m].covered;
  }
  return t ? (100 * c) / t : 100;
};
const gates = { statements: 90, branches: 75, functions: 78, lines: 90 };
let failed = false;
for (const [m, min] of Object.entries(gates)) {
  const pct = agg(m);
  const ok = pct >= min ? 'PASS' : 'FAIL';
  if (pct < min) failed = true;
  console.log(`domain ${m}: ${pct.toFixed(2)}% (gate ${min}%) ${ok}`);
}
console.log(
  `global: stmts ${s.total.statements.pct}% branches ${s.total.branches.pct}% funcs ${s.total.functions.pct}% lines ${s.total.lines.pct}%`,
);
if (failed) {
  console.error('Domain coverage gate FAILED');
  process.exit(1);
}
console.log('Domain coverage gate PASSED');
