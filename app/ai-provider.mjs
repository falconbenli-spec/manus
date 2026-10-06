const DEFAULT_ANTHROPIC_MODEL='claude-sonnet-5';
const POLICIES=new Set(['synthetic_only','internal_allowed']);

function dataPolicy(env){
  const value=env.AI_DATA_POLICY||'synthetic_only';
  if(!POLICIES.has(value))throw new Error('AI_DATA_POLICY must be synthetic_only or internal_allowed');
  return value;
}
function endpoint(value){
  let url;
  try{url=new URL(value);}catch{throw new Error('AI_BASE_URL must be an absolute URL');}
  const local=['localhost','127.0.0.1','::1'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('AI_BASE_URL must use HTTPS unless the model is local');
  return url.toString().replace(/\/+$/,'');
}
async function checked(response){
  if(!response.ok)throw Object.assign(new Error(`provider ${response.status??'failed'}`),{provider_status:response.status});
  return response.json();
}

export function configuredProvider(env=process.env,fetchImpl=globalThis.fetch){
  const selected=env.AI_PROVIDER||(env.ANTHROPIC_API_KEY?'anthropic':'');
  if(!selected)return null;
  if(typeof fetchImpl!=='function')throw new Error('fetch is unavailable');
  const policy=dataPolicy(env);
  if(selected==='anthropic'){
    const key=env.ANTHROPIC_API_KEY;if(!key)return null;
    const model=env.AI_MODEL||DEFAULT_ANTHROPIC_MODEL;
    return {name:'anthropic',model,dataPolicy:policy,requiresGovernance:true,async complete({system,user,maxTokens}){
      const body=await checked(await fetchImpl('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:maxTokens,system,messages:[{role:'user',content:user}]}),signal:AbortSignal.timeout(60000)}));
      return {text:(body.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').trim(),input_tokens:body.usage?.input_tokens??0,output_tokens:body.usage?.output_tokens??0,model:body.model??model};
    }};
  }
  if(selected!=='openai-compatible')throw new Error('AI_PROVIDER must be anthropic or openai-compatible');
  const base=endpoint(env.AI_BASE_URL||''),key=env.AI_API_KEY||'',model=env.AI_MODEL||'';
  if(!model)throw new Error('AI_MODEL is required for an OpenAI-compatible provider');
  const local=/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(base);
  if(!key&&!local)throw new Error('AI_API_KEY is required for a remote OpenAI-compatible provider');
  const name=(env.AI_PROVIDER_NAME||'openai-compatible').trim().slice(0,80)||'openai-compatible';
  return {name,model,dataPolicy:policy,requiresGovernance:true,async complete({system,user,maxTokens}){
    const headers={'content-type':'application/json'};if(key)headers.authorization=`Bearer ${key}`;
    const body=await checked(await fetchImpl(`${base}/chat/completions`,{method:'POST',headers,body:JSON.stringify({model,max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:user}]}),signal:AbortSignal.timeout(60000)}));
    const content=body.choices?.[0]?.message?.content;
    return {text:typeof content==='string'?content.trim():'',input_tokens:body.usage?.prompt_tokens??0,output_tokens:body.usage?.completion_tokens??0,model:body.model??model};
  }};
}
