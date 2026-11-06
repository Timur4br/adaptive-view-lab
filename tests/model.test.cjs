'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Model = require('../assets/model.js');
const { cases, golden } = require('./fixtures/reference-cases.json');
const truthPoints = [[-65,-20,-15],[65,25,45],[305,65,-20],[405,85,30]];
const length = (a,b) => Math.hypot(...a.map((x,i)=>x-b[i]));
const truth = length(truthPoints[0],truthPoints[1]);
const reference = length(truthPoints[2],truthPoints[3]);
const close = (a,b,epsilon=1e-6) => assert.ok(Math.abs(a-b)<epsilon,`${a} differs from ${b}`);
for (const [name, bank] of Object.entries(cases)) {
  test(`Python parity: ${name}, all seven strategies and nine states`, () => {
    const results=Model.runAll(bank,truth);
    for(const strategy of Model.STRATEGIES) for(let k=0;k<9;k++) {
      const actual=results[strategy][k], expected=golden[name][strategy][k];
      assert.equal(actual.action,expected.action,`${name}/${strategy}/${k} action`);
      close(actual.q,expected.q);close(actual.u,expected.u);
      assert.equal(actual.selected.filter(Boolean).length,6+k);
    }
  });
}
test('Noiseless reconstruction recovers the known object length',()=>{
 const bank=structuredClone(cases.balanced);
 bank.pixels=bank.views.map(v=>Model.project(truthPoints,v).coords);
 bank.visible=bank.views.map(v=>Model.project(truthPoints,v).visible);
 bank.referenceObserved=reference;
 for(const state of Model.run(bank,'adaptive',null,8,truth))close(state.q,truth,1e-7);
});
test('Projection Jacobian agrees with finite differences',()=>{
 const view=cases.balanced.views[11],h=1e-5,p=Model.project(truthPoints,view);
 for(let k=0;k<3;k++){
   const plus=structuredClone(truthPoints),minus=structuredClone(truthPoints);
   plus[0][k]+=h;minus[0][k]-=h;
   const a=Model.project(plus,view),b=Model.project(minus,view);
   for(let row=0;row<2;row++)close((a.coords[0][row]-b.coords[0][row])/(2*h),p.jac[0][row][k],1e-5);
 }
});
test('Scoring truth never changes reconstruction or action selection',()=>{
 const a=Model.run(cases.reference_weak,'adaptive',null,8,0);
 const b=Model.run(cases.reference_weak,'adaptive',null,8,1000);
 for(let k=0;k<9;k++){assert.equal(a[k].action,b[k].action);assert.equal(a[k].q,b[k].q);assert.equal(a[k].u,b[k].u);}
});
test('Unobserved future pixels cannot affect the first decision',()=>{
 const bank=structuredClone(cases.reference_weak),changed=structuredClone(bank);
 for(let v=6;v<changed.pixels.length;v++)for(const p of changed.pixels[v]){p[0]+=300;p[1]-=200;}
 const a=Model.prepare(bank),b=Model.prepare(changed);
 assert.deepEqual(a.state,b.state);assert.deepEqual(a.plan,b.plan);
 const scoresA=Model.predictions(bank,a.state,a.measured,a.selected);
 const scoresB=Model.predictions(changed,b.state,b.measured,b.selected);
 assert.deepEqual(scoresA,scoresB);
});
test('Seeded browser sessions are repeatable and inputs stay immutable',()=>{
 const bank=Model.generate(cases.reference_weak,truthPoints,reference,42),again=Model.generate(cases.reference_weak,truthPoints,reference,42);
 assert.deepEqual(bank,again);
 assert.notDeepEqual(bank.pixels,Model.generate(cases.reference_weak,truthPoints,reference,43).pixels);
 const before=JSON.stringify(bank);Model.runAll(bank,truth);assert.equal(JSON.stringify(bank),before);
});
test('Delivered Python source matches the original experiment manifest',()=>{
 const manifest=require('../data/published/run_manifest.json');
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../research/run_experiments.py'))).digest('hex');
 assert.equal(hash,manifest.source_sha256);
});
