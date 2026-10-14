// Hosted twin of lib/assistant.js + the /api/ask route, so ask.html works
// without the PC. Secrets (set in Supabase, never in the repo):
//   ANTHROPIC_API_KEY  your Anthropic key
//   ASSISTANT_TOKEN    the shared token the phone page sends
// Deployed with verify_jwt off because auth is the token check below.
const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-haiku-5-5';
const MAX_TURNS = 20;
const SYSTEM =
  'You are a personal assistant heard through a phone speaker, replying to speech. ' +
  'Answer in one to three short plain sentences. No markdown, lists, or emoji. ' +
  'If a request is ambiguous, make the most reasonable assumption and say it briefly.';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Assistant-Token',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'method', message: 'POST only.' });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  const token = Deno.env.get('ASSISTANT_TOKEN');
  if (!key || !token) return reply(503, { error: 'not-configured', message: 'Secrets not set.' });
  if (req.headers.get('x-assistant-token') !== token) {
    return reply(401, { error: 'unauthorized', message: 'Wrong or missing token.' });
  }

  let parsed: { messages?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return reply(400, { error: 'bad-request', message: 'Invalid JSON body.' });
  }
  const messages = (Array.isArray(parsed.messages) ? parsed.messages : [])
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return reply(400, { error: 'bad-request', message: 'Last message must be from the user.' });
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM, messages }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return reply(502, { error: 'upstream', message: data?.error?.message ?? `HTTP ${r.status}` });
  const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  return reply(200, { reply: text });
});
