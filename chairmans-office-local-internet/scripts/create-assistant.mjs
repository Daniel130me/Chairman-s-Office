import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vapiRequest } from '../src/vapi.mjs';

if (!process.env.VAPI_API_KEY) {
  console.error('Missing VAPI_API_KEY. Configure your local .env first.');
  process.exit(1);
}
const prompt = readFileSync(fileURLToPath(new URL('../AMARA_PROMPT.md', import.meta.url)), 'utf8');

const body = {
  name: 'Amara — Chairman\'s Office (Milestone A)',
  firstMessage: 'Good day, Chairman. This is Amara from your office. I hope you are doing well. I have prepared your executive briefing. Is now a convenient time, sir?',
  firstMessageInterruptionsEnabled: true,
  model: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.6,
    messages: [{ role: 'system', content: prompt }],
  },
  voice: {
    provider: 'openai',
    model: 'gpt-4o-mini-tts',
    voiceId: process.env.VAPI_VOICE_ID || 'alloy',
  },
  transcriber: { provider: 'openai', model: 'gpt-4o-mini-transcribe', language: 'en' },
  maxDurationSeconds: 300,
  voicemailDetection: 'off',
  backgroundSound: 'office',
  artifactPlan: {
    recordingEnabled: false,
    pcapEnabled: false,
    loggingEnabled: true,
    transcriptPlan: { enabled: true, assistantName: 'Amara', userName: 'Chairman' },
  },
};

try {
  const assistant = await vapiRequest({ apiKey: process.env.VAPI_API_KEY, path: '/assistant', method: 'POST', body });
  console.log('Amara assistant created. Save this ID in VAPI_ASSISTANT_ID:');
  console.log(assistant.id);
  console.log('Open Vapi dashboard to preview, choose the ideal female voice, and Publish the assistant if required.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
