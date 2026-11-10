const providers = {
    groq: { key: 'GROQ_API_KEY', model: 'GROQ_MODEL', base: 'https://api.groq.com/openai/v1/chat/completions' },
    zai: { key: 'ZAI_API_KEY', model: 'ZAI_MODEL', base: 'https://api.z.ai/api/paas/v4/chat/completions' },
    openrouter: { key: 'OPENROUTER_API_KEY', model: 'OPENROUTER_MODEL', base: 'https://openrouter.ai/api/v1/chat/completions' },
    openai: { key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL', base: 'https://api.openai.com/v1/chat/completions' },
    gemini: { key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL' }
};
const defaults = { groq: 'llama-3.3-70b-versatile', gemini: 'gemini-2.5-flash', zai: 'glm-4.5-air', openrouter: 'openai/gpt-4o-mini', openai: 'gpt-4.1-mini' };
const failures = new Map();
export function aiStatus() { return Object.entries(providers).map(([name, p]) => ({ name, configured: !!process.env[p.key], model: process.env[p.model] || defaults[name], failures: failures.get(name)?.count || 0 })); }
async function query(name, system, prompt) {
    const p = providers[name], key = process.env[p.key], model = process.env[p.model] || defaults[name];
    let url = p.base, opts;
    if (name === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
        opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 850 } }) };
    } else {
        opts = { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(name === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': "Chairman's Office" } : {}) }, body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.7, max_tokens: 850 }) };
    }
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(11000) });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const data = await res.json();
    const output = name === 'gemini' ? data.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') : data.choices?.[0]?.message?.content;
    if (!output || typeof output !== 'string') throw new Error(`${name}: empty response`);
    return output.trim();
}
export async function askAI(system, prompt, fallback, validator) {
    const order = (process.env.AI_ORDER || 'groq,gemini,zai,openrouter,openai').split(',').map(x => x.trim()).filter(x => providers[x] && process.env[providers[x].key]);
    const attempted = [];
    for (const p of order) {
        const fail = failures.get(p) || { count: 0, until: 0 }; if (fail.until > Date.now()) continue;
        try { const raw = await query(p, system, prompt); const value = validator ? validator(raw) : raw; failures.set(p, { count: 0, until: 0 }); return { value, provider: p, attempted }; }
        catch (e) { attempted.push({ provider: p, error: String(e.message).slice(0, 100) }); const n = fail.count + 1; failures.set(p, { count: n, until: Date.now() + Math.min(60000, 1500 * (2 ** Math.min(n, 5))) }); }
    }
    return { value: typeof fallback === 'function' ? fallback() : fallback, provider: 'local-rules', attempted };
}
export function parseJSON(raw) { const match = String(raw).match(/\{[\s\S]*\}/); if (!match) throw new Error('No JSON object'); return JSON.parse(match[0]); }
