export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(204, null, request);
    }

    if (request.method !== 'POST') {
      return corsResponse(405, { error: 'Method not allowed' }, request);
    }

    try {
      const body = await request.json();
      const { name, email, message, turnstileToken } = body;

      if (!name || !email || !message) {
        return corsResponse(400, { error: 'All fields are required' }, request);
      }

      // Verify Turnstile
      const turnstileOk = await verifyTurnstile(turnstileToken, request.headers.get('CF-Connecting-IP'), env.TURNSTILE_SECRET_KEY);
      if (!turnstileOk) {
        return corsResponse(403, { error: 'Verification failed' }, request);
      }

      // Send email via MailChannels (free from Workers)
      await sendEmail(env, { name, email, message });

      return corsResponse(200, { success: true }, request);
    } catch (err) {
      return corsResponse(500, { error: 'Server error' }, request);
    }
  }
};

async function verifyTurnstile(token, ip, secret) {
  if (!token || !secret) return false;

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret,
      response: token,
      remoteip: ip,
    }),
  });

  const data = await res.json();
  return data.success === true;
}

async function sendEmail(env, { name, email, message }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `Nullvariable Contact Form <${env.FROM_EMAIL}>`,
      to: [env.CONTACT_EMAIL],
      reply_to: email,
      subject: `Contact form: ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Email send failed: ${res.status} ${err}`);
  }
}

const ALLOWED_ORIGINS = [
  'https://nullvariable.com',
  'https://www.nullvariable.com',
];

function corsResponse(status, body, request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  return new Response(
    body ? JSON.stringify(body) : null,
    { status, headers }
  );
}
