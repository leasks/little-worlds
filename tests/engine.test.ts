import { describe,it,expect } from 'vitest';
import { advance,clock,seedWorld,validateWorld } from '../src/engine/index';
describe('deterministic simulation',()=>{
  it('calculates day/night and advances at 3x',()=>{expect(clock(86400000)).toEqual({day:2,hour:0,night:true});expect(advance(seedWorld(),'a',300000).virtualTime).toBe(900000);});
  it('does not mutate input; retries do not duplicate effects',()=>{const w=seedWorld();const next=advance(w,'a',300000);expect(w.tick).toBe(0);expect(advance(next,'a',600000)).toEqual(next);expect(next.journal).toHaveLength(3);});
  it('bounds downtime and retains backlog',()=>{const w=advance(seedWorld(),'a',1e12);expect(w.tick).toBe(96);expect(w.lastRealTime).toBe(96*300000);});
  it('rejects invalid state/input without mutating state',()=>{const w=seedWorld();expect(()=>advance(w,'a',-1)).toThrow();w.creatures[0]!.needs.health=101;expect(()=>advance(w,'b',300000)).toThrow();expect(w.tick).toBe(0);});
  it('does not consume an early request',()=>{expect(advance(seedWorld(),'a',1).receipts).toEqual([]);});
  it('runs 30 village days reproducibly without AI and preserves bounds',()=>{
    function run(){let w=seedWorld();for(let i=1;i<=30;i++)w=advance(w,`step-${i}`,i*96*300000);return w;}
    const a=run();expect(a).toEqual(run());expect(a.virtualTime/86400000).toBe(30);expect(a.tick).toBe(2880);expect(a.journal).toHaveLength(8640);validateWorld(a);
    expect(a.creatures.some(c=>Object.keys(c.relationships).length>0)).toBe(true);
    expect(a.creatures.every(c=>c.memories.length>0)).toBe(true);
  },60000);
});
