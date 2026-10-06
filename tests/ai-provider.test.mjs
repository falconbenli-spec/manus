import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredProvider } from '../app/ai-provider.mjs';

test('OpenAI-compatible provider stays server-side and uses the configured endpoint and model',async()=>{
  const calls=[];
  const provider=configuredProvider({
    AI_PROVIDER:'openai-compatible',
    AI_PROVIDER_NAME:'local-pilot',
    AI_BASE_URL:'https://models.example.test/v1/',
    AI_API_KEY:'secret-test-key',
    AI_MODEL:'model-test',
    AI_DATA_POLICY:'synthetic_only'
  },async(url,options)=>{
    calls.push({url,options});
    return {ok:true,async json(){return {choices:[{message:{content:'مسودة تجريبية'}}],usage:{prompt_tokens:12,completion_tokens:4},model:'model-test'};}};
  });

  assert.equal(provider.name,'local-pilot');
  assert.equal(provider.model,'model-test');
  assert.equal(provider.dataPolicy,'synthetic_only');
  assert.equal(provider.requiresGovernance,true);
  assert.equal(JSON.stringify(provider).includes('secret-test-key'),false);

  const result=await provider.complete({system:'تعليمات',user:'طلب',maxTokens:120});
  assert.deepEqual(result,{text:'مسودة تجريبية',input_tokens:12,output_tokens:4,model:'model-test'});
  assert.equal(calls[0].url,'https://models.example.test/v1/chat/completions');
  assert.equal(calls[0].options.headers.authorization,'Bearer secret-test-key');
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.model,'model-test');
  assert.equal(body.messages[0].role,'system');
  assert.equal(body.messages[1].role,'user');
});

test('provider configuration fails closed and permits plain HTTP only for a local model',()=>{
  assert.equal(configuredProvider({}),null);
  assert.throws(()=>configuredProvider({AI_PROVIDER:'openai-compatible',AI_BASE_URL:'http://models.example.test/v1',AI_API_KEY:'x',AI_MODEL:'m'}),/HTTPS/);
  const local=configuredProvider({AI_PROVIDER:'openai-compatible',AI_BASE_URL:'http://127.0.0.1:11434/v1',AI_API_KEY:'local',AI_MODEL:'qwen'});
  assert.equal(local.name,'openai-compatible');
  assert.equal(local.dataPolicy,'synthetic_only');
});
