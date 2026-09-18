const GOP_ENDPOINT = 'https://godofpanel.com/api/v2';

const API_KEY = process.env.GOP_API_KEY;

// ── Rate limiting ─────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function checkRateLimit(clientIp) {
  const now = Date.now();
  const entry = rateLimitMap.get(clientIp);
  if (!entry) {
    rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  if (now > entry.resetTime) {
    rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetTime - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

// ── Helper: check a provider ──────────────────────────────────────
async function checkProvider(endpoint, apiKey, orderId) {
  const params = new URLSearchParams({
    key:    apiKey,
    action: 'status',
    order:  orderId,
  });

  const response = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  const text = await response.text();

  try {
    const data = JSON.parse(text);
    if (data.error) return { found: false };
    if (data.status) {
      return {
        found: true,
        data: {
          status:      data.status,
          start_count: data.start_count || '0',
          remains:     data.remains || '0',
          charge:      data.charge || '0',
          currency:    data.currency || 'RON', // Default RON
        },
      };
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}

// ── Handler ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter));
    return res.status(429).json({
      error: 'Too many attempts. Please try again later.',
      retryAfter: rateCheck.retryAfter,
    });
  }

  const orderId = String(req.body?.order || '').trim();

  if (!orderId || !/^\d+$/.test(orderId))
    return res.status(400).json({ error: 'Invalid order ID. Use digits only.' });

  try {
    const gopResult = await checkProvider(GOP_ENDPOINT, API_KEY, orderId);
    if (gopResult.found) {
      return res.status(200).json({ ...gopResult.data, provider: 'GodOfPanel', orderId });
    }
  } catch (err) {
    console.error('GodOfPanel check failed:', err.message);
  }

  return res.status(404).json({ error: 'Order not found.' });
}