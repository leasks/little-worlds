import { writeFileSync } from 'node:fs';
import { advance, seedWorld, validateWorld } from '../src/engine/index';
let world=seedWorld();
// Separate fixture; production settings and clocks are never touched.
for(let day=1;day<=30;day++) {
  const target=day*86400000/3;
  while(world.lastRealTime<target)world=advance(world,`day-${day}-tick-${world.tick}`,target);
}
validateWorld(world);
const report={mode:'LOCAL FIXTURE — no database or AI',villageDays:world.virtualTime/86400000,ticks:world.tick,eventCount:world.journal.length,randomState:world.randomState,creatures:world.creatures,aiRequests:0};
writeFileSync('docs/phase-1-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({villageDays:report.villageDays,ticks:world.tick,eventCount:world.journal.length,aiRequests:0}));
