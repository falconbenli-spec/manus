import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { icon,ICON_NAMES } from '../app/static/icons.mjs';
import { icon as legacyIcon,navGlyph } from '../app/static/hr-design.mjs';
import { departmentMeta,metaFor,launcherResults } from '../app/static/request-picker.mjs';
import { hubLinks } from '../app/static/hubs-ui.mjs';
import { workspaceUI } from '../app/static/workspace-ui.mjs';
import { kit } from '../app/static/kit.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
test('service rows preserve action identity and approval text after removing decoration',()=>{
  const departments=[{id:'hr',name:'الموارد البشرية',sector:'الدعم'}];
  const services=[{id:'service-test',code:'HR-TEST',name_ar:'شهادة <مصطنعة>',description:'وصف للاختبار',department_id:'hr',section:'خطابات',approval_policy:{steps:['manager'],handler:'hr'}}];
  const html=launcherResults({departments,services,me:{department_id:'hr'},query:'شهادة',e,modules:[]});
  assert.match(html,/data-action="pick-service"/);assert.match(html,/data-id="service-test"/);
  assert.match(html,/شهادة &#60;مصطنعة&#62;/);assert.match(html,/مسار الاعتماد/);
  assert.doesNotMatch(html,/rq-row-icon|rq-go|<مصطنعة>/);
});
test('all retained icons share optical geometry and remain hidden from the accessible name',()=>{
  assert.equal(legacyIcon,icon);
  for(const name of ICON_NAMES){
    const svg=icon(name);
    for(const attribute of ['viewBox="0 0 24 24"','stroke-width="1.6"','stroke="currentColor"','stroke-linecap="round"','aria-hidden="true"','focusable="false"'])assert.ok(svg.includes(attribute),name+': '+attribute);
    assert.doesNotMatch(svg,/style=|<script|undefined/);
  }
  assert.match(navGlyph('leave').svg,/stroke-width="1.6"/);
  for(const meta of [...Object.values(departmentMeta),metaFor('unknown')])assert.match(meta.icon,/^<svg/);
});
test('navigation keeps destination, active state, escaped label and directional shared icon',()=>{
  const html=hubLinks('profile',[{key:'leave',label:'<إجازاتي>',label_en:'Leave'}],{e,label:'ملفي',current:'leave'});
  assert.match(html,/href="#leave"/);assert.match(html,/aria-current="page"/);
  assert.match(html,/&#60;إجازاتي&#62;/);assert.doesNotMatch(html,/<إجازاتي>/);
  assert.match(html,/glyph is-directional/);assert.match(html,/stroke-width="1.6"/);
});
test('workspace content preserves records and actions without repeated decorative icons',()=>{
  const data={space:{id:'space-test',name:'مصطنع',target_kind:'project'},people:{people:[]},
    files:{folders:[{id:'folder',name:'مجلد'}],documents:[{title:'مستند',current_revision:1,status:'open'}],files:[{label:'ملف',filename:'example.pdf',current_version:1,scan_state:'clean'}]},
    checkins:{checkins:[{id:'check',question:'سؤال دوري',cadence:'weekly',local_time:'09:00',cycles:[]}]},
    activity:{items:[{action:'تحديث',entity_type:'task'}]},report:{counts:{},workload:{}}};
  for(const tool of ['files','checkins','insights']){
    const html=workspaceUI.render({...data,active_tool:tool},{e,date:v=>v,ui:kit(e)});
    const panel=html.split('data-tool-panel="'+tool+'"')[1];
    assert.ok(panel,tool);assert.doesNotMatch(panel,/<svg/);
    assert.match(html,/aria-label="أدوات مساحة العمل"/);
    if(tool==='files'){assert.match(panel,/example.pdf/);assert.match(panel,/data-workspace-form="file-upload"/);}
    if(tool==='checkins')assert.match(panel,/سؤال دوري/);
    if(tool==='insights')assert.match(panel,/تحديث/);
    assert.doesNotMatch(html,/undefined|NaN|<script| style=/);
  }
});
test('icon SVG markup has one source; brand and appearance thumbnails are separate illustrations',()=>{
  const dir=new URL('../app/static/',import.meta.url);
  const exceptions=new Set(['icons.mjs','brand-logo.mjs','appearance-ui.mjs']);
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.mjs')&&!exceptions.has(f)))assert.doesNotMatch(readFileSync(new URL(file,dir),'utf8'),/<svg\b/,file);
  for(const file of ['request-picker.mjs','catalog-home-ui.mjs','service-page.mjs'])assert.doesNotMatch(readFileSync(new URL(file,dir),'utf8'),/rq-row-icon|CATEGORY_GLYPHS|glyph:'/,file);
});
