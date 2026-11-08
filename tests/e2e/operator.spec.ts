import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { test,expect,type Page } from '@playwright/test';
import { OperatorRepository } from '../../src/repositories/operator';
import { tokenHash,type AgentRole } from '../../src/repositories/caretaker';
import { defaultSettings } from '../../src/narrative/engine';
import { seedProposal } from '../fixtures/narrative';
const url=process.env.TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Local TEST_DATABASE_URL required');
const admin=new Pool({connectionString:url}),runtime=new Pool({connectionString:url,options:'-c role=little_worlds_runtime'}),repo=new OperatorRepository(runtime);
let fixture:{world:string;operator:string;caretaker:string;narrator:string;operatorId:string};
test.beforeEach(async()=>{
 const world=await repo.seed(undefined,Date.now());await admin.query('UPDATE little_worlds.world_settings SET is_test=true WHERE world_id=$1',[world]);
 await admin.query('UPDATE little_worlds.narrative_settings SET settings=$2 WHERE world_id=$1',[world,JSON.stringify({...defaultSettings,earliestDiscovery:0,minGap:0,rareMinGap:0,maxPerDay:5})]);
 const tokens={operator:randomBytes(32).toString('hex'),caretaker:randomBytes(32).toString('hex'),narrator:randomBytes(32).toString('hex')};let operatorId='';
 for(const role of Object.keys(tokens) as AgentRole[]){const credential=await admin.query("INSERT INTO little_worlds.agent_credentials(world_id,actor_id,token_hash,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour') RETURNING id",[world,`local-${role}`,tokenHash(tokens[role]),role]);if(role==='operator')operatorId=credential.rows[0].id;}
 fixture={world,...tokens,operatorId};
});
test.afterEach(async()=>{await admin.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE world_id=$1',[fixture.world]);});
test.afterAll(async()=>{await runtime.end();await admin.end();});
async function login(page:Page){await page.goto('/');await page.getByLabel('Village ID',{exact:true}).fill(fixture.world);await page.getByLabel('Operator key',{exact:true}).fill(fixture.operator);await page.getByRole('button',{name:'Enter the village'}).click();await expect(page.getByRole('heading',{name:'The First Village',exact:true})).toBeVisible();}
test('private login, opaque cookie and logout',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'Welcome to the village.'})).toBeVisible();expect((await page.request.get('/api/operator')).status()).toBe(401);
 await page.getByLabel('Village ID',{exact:true}).fill(fixture.world);await page.getByLabel('Operator key',{exact:true}).fill(fixture.caretaker);await page.getByRole('button',{name:'Enter the village'}).click();await expect(page.getByRole('form',{name:'Operator sign in'}).getByRole('alert')).toBeVisible();
 await login(page);const cookies=await page.context().cookies();const session=cookies.find(c=>c.name==='lw_operator');expect(session?.httpOnly).toBe(true);expect(session?.sameSite).toBe('Strict');expect(session?.value).not.toBe(fixture.operator);
 const storage=await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]));expect(storage).not.toContain(fixture.operator);
 await page.getByRole('button',{name:/Sign out/}).click();await expect(page.getByRole('heading',{name:'Welcome to the village.'})).toBeVisible();expect((await page.request.get('/api/operator')).status()).toBe(401);
});
test('interactive map, keyboard selection and creature profiles fit the viewport',async({page},info)=>{
 await login(page);await page.getByRole('button',{name:'Village Pond',exact:true}).click();await expect(page.getByRole('heading',{name:'Village Pond',exact:true})).toBeVisible();
 const square=page.getByRole('button',{name:'Village Square',exact:true});await square.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Village Square',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Inspect Moss',exact:true}).click();const profile=page.getByRole('region',{name:'Moss profile'});await expect(profile).toBeVisible();await expect(profile.getByText('Little tendencies')).toBeVisible();await expect(profile.getByRole('heading',{name:'Friendships',exact:true})).toBeVisible();expect(await profile.getByRole('meter').count()).toBe(4);
 const overflowing=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);expect(overflowing).toBe(false);
 await page.screenshot({path:`test-results/${info.project.name}-village.png`,fullPage:true});
});
test('test tick, pause/resume and journal filters use persisted state',async({page})=>{
 await login(page);await page.getByRole('button',{name:/Operator desk/}).click();await page.getByRole('button',{name:/Run one tick/}).click();await expect(page.getByRole('status')).toHaveText('1 simulation tick completed.');
 await page.getByRole('button',{name:'Pause village',exact:true}).click();await expect(page.getByRole('status')).toHaveText('The village is paused.');await expect(page.getByRole('button',{name:'Advance test ticks',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Resume village',exact:true}).click();await expect(page.getByRole('status')).toHaveText('The village has resumed.');await page.getByLabel('Test ticks',{exact:true}).fill('4');await page.getByRole('button',{name:'Advance test ticks',exact:true}).click();await expect(page.getByRole('status')).toHaveText('4 simulation ticks completed.');
 await page.getByRole('button',{name:'Village journal',exact:true}).click();await page.getByLabel('Filter by creature').selectOption('pip');await page.getByLabel('Filter by event source').selectOption('simulation');await page.getByLabel('Filter by event type').fill('activity');await expect(page.locator('.journal-entry')).toHaveCount(5);
 await page.getByText('Inspect recorded effects',{exact:true}).first().click();await expect(page.locator('pre').first()).toContainText('needsAfter');expect((await repo.read(fixture.world)).tick).toBe(5);
});
test('operator reviews untrusted proposal text and sees quest progress',async({page})=>{
 const cp=await repo.authenticate(fixture.caretaker,fixture.world);for(const target_id of ['pip','moss'] as const)await repo.act(cp,{actor_id:'local-caretaker',target_id,action:'visit_location',parameters:{location_id:'garden'},idempotency_key:randomUUID()});
 const description='<img src=x onerror="window.untrustedExecuted=true"> A gentle light in the garden.';
 const submitted=await page.request.post(`/api/worlds/${fixture.world}/proposals`,{headers:{Authorization:`Bearer ${fixture.narrator}`},data:{request_id:'browser-story',proposal:{...seedProposal,description}}});expect(submitted.status()).toBe(202);
 await login(page);await page.getByRole('button',{name:/Operator desk/}).click();await expect(page.getByText(description,{exact:true})).toBeVisible();expect(await page.locator('img[src="x"]').count()).toBe(0);await page.getByRole('button',{name:'Approve proposal',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Proposal accepted.');
 await page.getByRole('button',{name:'Little mysteries',exact:true}).click();await expect(page.getByRole('heading',{name:'The Glowing Seed',exact:true})).toBeVisible();await expect(page.getByRole('progressbar',{name:'Quest progress'})).toHaveAttribute('value','0');
 for(const [action,parameters] of [['investigate_discovery',{discovery_id:'glowing_seed'}],['visit_location',{location_id:'pond'}],['visit_location',{location_id:'garden'}],['plant_crop',{}],['tend_crop',{}]]){
  const response=await page.request.post(`/api/worlds/${fixture.world}/actions`,{headers:{Authorization:`Bearer ${fixture.caretaker}`},data:{actor_id:'local-caretaker',target_id:'pip',action,parameters,idempotency_key:randomUUID()}});expect(response.status()).toBe(200);
 }
 await page.getByRole('button',{name:'Refresh village',exact:true}).click();await expect(page.getByText('Completed story',{exact:true})).toBeVisible();await expect(page.locator('.quest-clues li')).toHaveCount(4);expect((await repo.read(fixture.world)).creatures[0]!.inventory.seed_charm).toBe(1);
});
test('confirmed local reset preserves old journal and root revocation closes derived access',async({page})=>{
 await login(page);await page.getByRole('button',{name:/Operator desk/}).click();await page.getByRole('button',{name:/Run one tick/}).click();await expect(page.getByRole('status')).toHaveText('1 simulation tick completed.');await page.getByRole('button',{name:'Reset local test village…',exact:true}).click();const confirm=page.getByRole('button',{name:'Confirm fresh test village',exact:true});await expect(confirm).toBeDisabled();await page.getByLabel('Type RESET TEST VILLAGE to confirm').fill('RESET TEST VILLAGE');await confirm.click();await expect(page.getByRole('status')).toContainText('A fresh test village is ready');
 const response=await page.request.get('/api/operator');const state=(await response.json()).result;expect(state.world.id).not.toBe(fixture.world);expect(state.world.tick).toBe(0);expect((await repo.read(fixture.world)).journal).toHaveLength(3);
 await admin.query('UPDATE little_worlds.agent_credentials SET revoked=true WHERE id=$1',[fixture.operatorId]);await page.reload();await expect(page.getByRole('heading',{name:'Welcome to the village.'})).toBeVisible();
});
