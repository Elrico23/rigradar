// One-button voice assistant backend. The phone page posts the running
// conversation here; this adds the API key (which never leaves the PC) and
// forwards to the Anthropic Messages API. Needs ANTHROPIC_API_KEY and
// ASSISTANT_TOKEN in the environment; without both the route reports itself
// as not configured instead of half-working.
const MODEL = process.env.ASSISTANT_MODEL || 'claude-haiku-5-5';
const MAX_TURNS = 20;
const SYSTEM =
  'You are a personal assistant heard through a phone speaker, replying to speech. ' +
  'Answer in one to three short plain sentences. No markdown, lists, or emoji. ' +
  'If a request is ambiguous, make the most reasonable assumption and say it briefly.';

function configured() {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ASSISTANT_TOKEN);
}

async function ask(messages) {
  const trimmed = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS);
  if (!trimmed.length || trimmed[trimmed.length - 1].role !== 'user') {
    return { status: 400, body: { error: 'bad-request', message: 'Last message must be from the user.' } };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM, messages: trimmed }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { status: 502, body: { error: 'upstream', message: data.error?.message || `HTTP ${r.status}` } };
  }
  const reply = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { status: 200, body: { reply } };
}

module.exports = { ask, configured };
