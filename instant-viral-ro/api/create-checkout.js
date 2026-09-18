const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const ALLOWED_DOMAINS = {
  'ig-followers': 'instagram.com',
  'ig-likes':     'instagram.com',
  'tt-followers': 'tiktok.com',
  'tt-likes':     'tiktok.com',
  'fb-followers': 'facebook.com',
  'fb-likes':     'facebook.com',
};

const SERVICE_NAMES = {
  'ig-followers': 'Instagram Followers',
  'ig-likes':     'Instagram Likes',
  'tt-followers': 'TikTok Followers',
  'tt-likes':     'TikTok Likes',
  'fb-followers': 'Facebook Followers',
  'fb-likes':     'Facebook Likes',
};

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

const SITE_URL = process.env.SITE_URL || 'https://instant-viral.vercel.app';

// ── Path validation ───────────────────────────────────────────────
function validatePath(pathname, service) {
  const path = pathname.toLowerCase();
  if (path === '/' || path === '') {
    return 'Invalid link. Must be a direct link to a profile or post.';
  }
  switch (service) {
    case 'ig-followers':
      if (/^\/(p\/|reel\/|tv\|stories\/)/.test(path))
        return 'For Instagram followers, use the profile link, not a post link.';
      break;
    case 'ig-likes':
      if (!/^\/(p\/|reel\/|tv\/)/.test(path) && !/^\/[^/]+$/.test(path))
        return 'For Instagram likes, use the direct link to your post or Reel.';
      break;
    case 'tt-followers':
      if (/^\/video\//.test(path))
        return 'For TikTok followers, use the profile link (@username), not a video link.';
      break;
    case 'tt-likes':
      if (!/^\/video\//.test(path) && !/^\/@[^/]+$/.test(path))
        return 'For TikTok likes, use the direct link to your video.';
      break;
    case 'fb-followers':
      if (/^\/(photo\/|video\/|posts\/|groups\/)/.test(path))
        return 'For Facebook followers, use your profile or page link.';
      break;
    case 'fb-likes':
      if (!/^\/(photo\/|video\/|posts\/|[^/]+\/posts\/|[^/]+)$/.test(path))
        return 'For Facebook likes, use the direct link to your post or page.';
      break;
  }
  return null;
}

// ── Handler ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter));
    return res.status(429).json({
      error: 'Too many attempts. Please try again later.',
      retryAfter: rateCheck.retryAfter,
    });
  }

  const { service, quantity, price, link, serviceId, currency } = req.body;

  if (!service || !quantity || !price || !link || !serviceId)
    return res.status(400).json({ error: 'Missing required fields.' });

  if (!ALLOWED_DOMAINS[service])
    return res.status(400).json({ error: 'Invalid service.' });

  let parsedUrl;
  try {
    parsedUrl = new URL(link);
  } catch {
    return res.status(400).json({ error: 'The link is not a valid URL.' });
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const expectedDomain = ALLOWED_DOMAINS[service];
  if (hostname !== expectedDomain) {
    return res.status(400).json({
      error: `Invalid link. Must be a link from ${expectedDomain} (e.g. https://www.${expectedDomain}/yourprofile).`,
    });
  }

  const pathError = validatePath(parsedUrl.pathname, service);
  if (pathError) return res.status(400).json({ error: pathError });

  // Folosim RON ca monedă - verificăm dacă Stripe suportă RON
  // RON este suportat de Stripe pentru plăți cu card
  const currencyCode = 'ron'; // codul pentru RON în Stripe

  try {
    // Convertim prețul în bani (cenți pentru USD, dar pentru RON folosim bani)
    // Pentru RON, unit_amount este în bani (1 RON = 100 bani)
    const unitAmount = Math.round(parseFloat(price) * 100);

    console.log(`Creating checkout session: ${unitAmount} ${currencyCode.toUpperCase()} for ${quantity} ${SERVICE_NAMES[service]}`);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: currencyCode, // 'ron'
          product_data: {
            name: `${parseInt(quantity).toLocaleString()} ${SERVICE_NAMES[service]}`,
            description: `Link: ${link.substring(0, 60)}${link.length > 60 ? '...' : ''}`,
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&service=${encodeURIComponent(service)}&qty=${quantity}`,
      cancel_url: `${SITE_URL}/`,
      metadata: {
        app: 'instant-viral',
        service,
        quantity: quantity.toString(),
        link: link.trim(),
        serviceId: serviceId.toString(),
        currency: currencyCode,
      },
    });

    const orderId = 'IV-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    return res.status(200).json({ url: session.url, orderId });

  } catch (err) {
    console.error('Stripe error:', err.message);
    // Dacă RON nu funcționează, încercăm cu EUR ca fallback
    if (err.message.includes('currency')) {
      console.log('RON might not be supported, trying EUR...');
      try {
        const fallbackSession = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'eur',
              product_data: {
                name: `${parseInt(quantity).toLocaleString()} ${SERVICE_NAMES[service]}`,
                description: `Link: ${link.substring(0, 60)}${link.length > 60 ? '...' : ''}`,
              },
              unit_amount: Math.round(parseFloat(price) * 100),
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&service=${encodeURIComponent(service)}&qty=${quantity}`,
          cancel_url: `${SITE_URL}/`,
          metadata: {
            app: 'instant-viral',
            service,
            quantity: quantity.toString(),
            link: link.trim(),
            serviceId: serviceId.toString(),
            currency: 'eur',
          },
        });
        return res.status(200).json({ url: fallbackSession.url, orderId: 'IV-' + Math.random().toString(36).slice(2, 10).toUpperCase() });
      } catch (fallbackErr) {
        console.error('Fallback EUR also failed:', fallbackErr.message);
        return res.status(500).json({ error: 'Payment processing error. Please try again.' });
      }
    }
    return res.status(500).json({ error: 'Payment processing error. Please try again.' });
  }
}