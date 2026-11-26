import test from 'node:test';
import assert from 'node:assert/strict';
import {providerOrder,aiStatus} from '../backend/src/ai.mjs';

test('AI_ORDER controls the provider priority',()=>{
  const previous=process.env.AI_ORDER;
  try{
    process.env.AI_ORDER='groq,gemini,zai,openrouter,openai';
    assert.deepEqual(providerOrder(),['groq','gemini','zai','openrouter','openai']);
  }finally{
    if(previous===undefined)delete process.env.AI_ORDER;else process.env.AI_ORDER=previous;
  }
});

test('AI_ORDER ignores unknown names and removes duplicates',()=>{
  const previous=process.env.AI_ORDER;
  try{
    process.env.AI_ORDER='groq,unknown,zai,groq';
    assert.deepEqual(providerOrder(),['groq','zai']);
  }finally{
    if(previous===undefined)delete process.env.AI_ORDER;else process.env.AI_ORDER=previous;
  }
});

test('provider status follows the configured order and model names',()=>{
  const previous={order:process.env.AI_ORDER,groq:process.env.GROQ_API_KEY,zai:process.env.ZAI_API_KEY,zaiModel:process.env.ZAI_MODEL};
  try{
    process.env.AI_ORDER='zai,groq';
    process.env.ZAI_API_KEY='test-key';
    process.env.GROQ_API_KEY='';
    process.env.ZAI_MODEL='glm-4.7-flash';
    assert.deepEqual(aiStatus(),[
      {name:'zai',model:'glm-4.7-flash',configured:true},
      {name:'groq',model:'openai/gpt-oss-20b',configured:false}
    ]);
  }finally{
    for(const [key,value] of [['AI_ORDER',previous.order],['GROQ_API_KEY',previous.groq],['ZAI_API_KEY',previous.zai],['ZAI_MODEL',previous.zaiModel]]){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
