import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require('../.claude/preview-tools/node_modules/playwright');
const base=process.env.SMOKE_URL??'http://127.0.0.1:4410';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 await page.waitForFunction(()=>document.querySelectorAll('#creations option').length>1);
 const id=await page.locator('#creations option').nth(1).getAttribute('value');await page.selectOption('#creations',id);
 await page.locator('#inspect').waitFor({state:'visible'});assert.match(await page.locator('#inspect-detail').innerText(),/Created by/);
 await page.mouse.move(600,400);await page.mouse.down();await page.mouse.move(750,400,{steps:6});await page.mouse.up();assert.equal(await page.locator('#follow').getAttribute('aria-pressed'),'false');
 await page.locator('#follow').click();assert.equal(await page.locator('#follow').getAttribute('aria-pressed'),'true');
 await page.screenshot({path:'.claude/preview-tools/safehouse-smoke/inspection.png'});
 const admin=await browser.newPage();await admin.goto(base+'/admin');await admin.getByRole('button',{name:'Pause AI generation',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('phase').textContent.includes('PAUSED'));
 await admin.locator('#inj-user').fill('inspect-smoke');await admin.locator('#inj-text').fill(`Paint #${id.slice(0,8)} blue`);await admin.locator('#inj-send').click();
 await page.waitForFunction(()=>document.getElementById('label').textContent.startsWith('Finished'),{},{timeout:90000});
 await page.reload();await page.waitForFunction(()=>document.getElementById('phase').textContent.includes('PAUSED'));
 const mobile=await browser.newPage({viewport:{width:400,height:800},reducedMotion:'reduce'});await mobile.goto(base);await mobile.waitForFunction(()=>document.querySelectorAll('#creations option').length>1);await mobile.selectOption('#creations',id);await mobile.locator('#inspect').waitFor({state:'visible'});await mobile.screenshot({path:'.claude/preview-tools/safehouse-smoke/inspection-mobile.png'});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await admin.getByRole('button',{name:'Resume AI generation',exact:true}).click();assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,inspection:true,manualOverride:true,pausedQuickEdit:true,mobile:true,errors}));
}finally{await browser.close()}
