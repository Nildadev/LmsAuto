/** Verify end-to-end: play video thật -> giải interaction -> đọc điểm cuối. */
const { resolveToken } = require('./_token');
const {launch,sleep}=require('../src/core/stealth');
const {findPlayerFrame}=require('../src/h5p/answers');
const {dismissAll}=require('../src/core/dismiss');
const {solveVideo}=require('../src/h5p/interactiveVideo');
// Bài Tuần 4 Video Toán 9 (summary + 2 MC, from 252s) đã verify trước đó.
const P='8d1fbc7f-bb02-4c6e-bb46-4f77bfb62d0f',C='6a9996e56a5fd5749c05f0aa',CS='f944b469-335c-47ca-bdfe-47d53d124494';
const url=`https://lms360.vn/xem-video?p=${P}&c=${C}&cs=${CS}`;
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
(async()=>{
const token=await resolveToken();
const {browser,context,page}=await launch({headless:true,token});
try{
  await page.goto(url,{waitUntil:'networkidle',timeout:45000}).catch(()=>{});
  await sleep(6000); await dismissAll(page); await sleep(800);
  const frame=await findPlayerFrame(page,12000);
  if(!frame){log('NO FRAME');return;}
  const splash=await frame.locator('.h5p-splash-play,.h5p-splash-main').first().boundingBox().catch(()=>null);
  if(splash)await page.mouse.click(splash.x+20,splash.y+20);
  await sleep(1500);
  const res=await solveVideo(page,frame,log);
  log('SOLVE RESULT:',JSON.stringify(res));
  await sleep(2000);
  // Đọc điểm từ màn kết quả cuối.
  const score=await frame.evaluate(()=>{
    const bar=document.querySelector('.h5p-joubelui-score-bar-progress,.h5p-joubelui-score-bar-full-score');
    const num=document.querySelector('.h5p-joubelui-score-numeric,.h5p-score-numeric,.h5p-joubelui-score-bar-counter');
    const sc=document.querySelector('.h5p-score');
    return {bar:(bar&&(bar.textContent||'').trim())||'',num:(num&&(num.textContent||'').trim())||'',sc:(sc&&(sc.textContent||'').trim()||'').slice(0,40)};
  });
  log('SCORE:',JSON.stringify(score));
  await page.screenshot({path:'/tmp/verify-iv-final.png',fullPage:false});
}finally{await context.close().catch(()=>{});await browser.close().catch(()=>{});}
})();
