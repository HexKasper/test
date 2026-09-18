const GOP_ENDPOINT = 'https://godofpanel.com/api/v2';

const API_KEY = process.env.GOP_API_KEY;

const ALLOWED_SERVICES = {
  7359: 'instagram.com',
  6672: 'instagram.com',
  5197: 'tiktok.com',
  4045: 'tiktok.com',
  2686: 'facebook.com',
  402:  'facebook.com',
};

const MIN_QTY = 100;
const MAX_QTY = 50000;

// ── Rate limiting ─────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 5;

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

function safeLogLink(link) {
  if (!link || link.length < 20) return link;
  return `${link.substring(0, 12)}...${link.slice(-8)}`;
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

  const { service, link, quantity, currency } = req.body;
  const serviceId = parseInt(service);

  if (!ALLOWED_SERVICES[serviceId])
    return res.status(400).json({ error: 'Invalid service.' });

  if (!link || typeof link !== 'string' || link.length > 500)
    return res.status(400).json({ error: 'Invalid link.' });

  let parsedUrl;
  try {
    parsedUrl = new URL(link);
  } catch {
    return res.status(400).json({ error: 'The link is not a valid URL.' });
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const expectedDomain = ALLOWED_SERVICES[serviceId];
  if (hostname !== expectedDomain) {
    return res.status(400).json({
      error: `Invalid link. Must be a link from ${expectedDomain}.`,
    });
  }

  const qty = parseInt(quantity);
  if (!qty || qty < MIN_QTY || qty > MAX_QTY) {
    return res.status(400).json({ error: `Invalid quantity (${MIN_QTY}–${MAX_QTY}).` });
  }

  try {
    const params = new URLSearchParams({
      key:      API_KEY,
      action:   'add',
      service:  serviceId,
      link:     link.trim(),
      quantity: qty,
    });

    console.log(`[GodOfPanel] Sending order: service=${serviceId}, qty=${qty}, link=${safeLogLink(link.trim())}, currency=${currency || 'RON'}`);

    const response = await fetch(GOP_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });

    const text = await response.text();
    console.log('[GodOfPanel] Raw response:', text.substring(0, 200));

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Unexpected response from server.');
    }

    if (data.error)  return res.status(502).json({ error: 'Order could not be processed.' });
    if (!data.order) throw new Error('Incomplete response from server.');

    return res.status(200).json({ order: data.order });

  } catch (err) {
    console.error('Order error:', err.message);
    return res.status(500).json({ error: err.message || 'Internal error.' });
  }
}