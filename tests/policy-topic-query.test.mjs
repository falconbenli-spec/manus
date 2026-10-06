import test from 'node:test';
import assert from 'node:assert/strict';
import {terms,stem,buildIndex,score,relevant} from '../app/policy-retrieval.mjs';
test('سؤال سياسة الإجازات يطابق موضوع الإجازة ولا يطابق كلمة سياسة وحدها',()=>{
  const articles=[
    {id:'general',title:'قرارات وسياسات',in_force:true,paragraphs:[{text:'يجوز للمنشأة إصدار سياسات خاصة بها تمنح العامل حقوقًا أفضل.'}]},
    {id:'leave',title:'الإجازات السنوية',in_force:true,paragraphs:[{text:'الإجازة السنوية تمنح للموظف وفق الرصيد المتاح.'}]}
  ];
  for(const question of ['وش سياسة الإجازات؟','وش سياسه الاجازات','ايش سياسات الإجازات؟']){
    const index=buildIndex(articles),query=terms(question).map(term=>({term:stem(term),weight:1}));
    const ranked=relevant(index,query,score(index,query));
    assert.equal(ranked[0]?.doc.article.id,'leave',question);
    assert.ok(ranked.every(r=>r.doc.article.id!=='general'),question);
  }
});
