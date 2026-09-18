import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const GOP_ENDPOINT = 'https://godofpanel.com/api/v2';

const API_KEY = process.env.GOP_API_KEY;

const ALLOWED_DOMAINS = {
  'ig-followers': 'instagram.com',
  'ig-likes':     'instagram.com',
  'tt-followers': 'tiktok.com',
  'tt-likes':     'tiktok.com',
  'fb-followers': 'facebook.com',
  'fb-likes':     'facebook.com',
};

// ── Idempotency (Redis) ─────────────────────────────────────────────
// IMPORTANT: NU mai folosim un Set în memorie — pe Vercel fiecare
// invocare a funcției poate rula într-un container/instanță diferită,
// deci memoria NU este comună între două livrări de webhook. Dacă
// Stripe trimite evenimentul de 2 ori (retry, timeout, etc.), un Set
// în memorie nu-l prinde a doua oară -> comanda se dubla.
//
// Aici folosim un lock atomic în Redis (Upstash REST API, compatibil
// și cu integrarea "Vercel KV", care e tot Upstash pe sub capotă).
// SET key value NX EX <ttl> este ATOMIC: dacă cheia există deja,
// comanda eșuează silent (result: null) și nu se suprascrie nimic —
// exact ce ne trebuie ca să prevenim o cursă (race condition) chiar
// dacă cele 2 evenimente ajung în paralel, la aceeași secundă.

const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LOCK_TTL_SECONDS = 60 * 60 * 24; // 24h — suficient cât să acopere orice retry Stripe

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error(
      'Redis (Vercel KV / Upstash) nu este configurat. ' +
      'Lipsesc variabilele de mediu KV_REST_API_URL / KV_REST_API_TOKEN ' +
      '(sau UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).'
    );
  }
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

// Încearcă să "prindă" lock-ul pentru această sesiune Stripe.
// Returnează true = prima dată (poți procesa comanda).
// Returnează false = deja procesată sau în curs de procesare pe altă instanță.
async function tryLockSession(sessionId) {
  const key = `stripe_session:${sessionId}`;
  const result = await redisCommand(['SET', key, '1', 'NX', 'EX', String(LOCK_TTL_SECONDS)]);
  return result === 'OK';
}

// Dacă plasarea comenzii la GodOfPanel eșuează (eroare reală,
// nu duplicat), eliberăm lock-ul ca un retry legitim de la Stripe să
// poată încerca din nou plasarea comenzii curat.
async function unlockSession(sessionId) {
  const key = `stripe_session:${sessionId}`;
  try {
    await redisCommand(['DEL', key]);
  } catch (err) {
    console.error('[webhook] Nu am putut elibera lock-ul:', err.message);
  }
}

function safeLogLink(link) {
  if (!link || link.length < 20) return link;
  return `${link.substring(0, 12)}...${link.slice(-8)}`;
}

// ── IMPORTANT: disable Vercel body parser to get raw body for Stripe ──
export const config = {
  api: {
    bodyParser: false,
  },
};

// Helper to read raw body from request stream
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Handler ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig            = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    return res.status(400).send(`Error reading body: ${err.message}`);
  }

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session                                = stripeEvent.data.object;
  const { app, service, serviceId, link, quantity, currency } = session.metadata;

  // ── Filtrare pe proprietar ──────────────────────────────────────────
  // Acest cont Stripe e folosit și de alte site-uri (villa-doro,
  // ig-recovery-pro etc). Stripe trimite orice eveniment din cont
  // către TOATE endpoint-urile înregistrate, indiferent care site a
  // generat plata. Fără verificarea asta, acest webhook ar plasa
  // comenzi și pentru plăți care nu au nicio legătură cu instant-viral.
  // IMPORTANT: aceeași verificare (cu propria valoare "app") trebuie
  // adăugată și în webhook-urile celorlalte site-uri, altfel ele vor
  // continua să proceseze orbește evenimentele de pe instant-viral.
  if (app !== 'instant-viral') {
    console.log(`[webhook] Eveniment ${session.id} nu aparține de instant-viral (app="${app}"). Ignor.`);
    return res.status(200).json({ received: true, ignored: true });
  }

  // ── Lock atomic: doar prima livrare a acestui eveniment trece mai departe ──
  let acquiredLock = false;
  try {
    acquiredLock = await tryLockSession(session.id);
  } catch (err) {
    // Dacă Redis nu e configurat sau pică, NU plasăm comanda "orbește"
    // (mai bine un retry Stripe mai târziu, decât risc de dublare).
    console.error('[webhook] Eroare la verificarea idempotenței:', err.message);
    return res.status(500).json({ error: 'Idempotency check failed, will retry.' });
  }

  if (!acquiredLock) {
    console.log(`[webhook] Sesiunea ${session.id} deja procesată (sau în curs). Ignor.`);
    return res.status(200).json({ received: true, idempotent: true });
  }

  console.log('Payment confirmed:', {
    sessionId: session.id,
    service,
    serviceId,
    link: safeLogLink(link),
    quantity,
    currency: currency || 'ron',
    amount: session.amount_total,
  });

  if (service && ALLOWED_DOMAINS[service]) {
    let hostname;
    try {
      hostname = new URL(link).hostname.replace(/^www\./, '');
    } catch {
      await unlockSession(session.id);
      return res.status(400).json({ error: 'Invalid link in metadata.' });
    }
    if (hostname !== ALLOWED_DOMAINS[service]) {
      await unlockSession(session.id);
      return res.status(400).json({ error: 'Metadata link does not match service.' });
    }
  }

  try {
    const params = new URLSearchParams({
      key:      API_KEY,
      action:   'add',
      service:  serviceId,
      link:     link.trim(),
      quantity: quantity,
    });

    const response = await fetch(GOP_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });

    const text = await response.text();
    console.log('[GodOfPanel] Response:', text.substring(0, 200));

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Răspuns neinteligibil de la provider — eliberăm lock-ul ca
      // un retry Stripe să poată încerca din nou.
      await unlockSession(session.id);
      return res.status(502).send('Invalid API response');
    }

    if (data.error) {
      // Eroare reală de la provider (nu duplicat) — eliberăm lock-ul.
      await unlockSession(session.id);
      return res.status(400).json({ error: data.error });
    }

    if (!data.order) {
      await unlockSession(session.id);
      return res.status(502).json({ error: 'Incomplete response from provider.' });
    }

    console.log('✅ Order placed via GodOfPanel, ID:', data.order);
    // Lock-ul rămâne activ (TTL 24h) — orice livrare ulterioară a
    // aceluiași eveniment Stripe va fi ignorată la pasul de mai sus.

  } catch (err) {
    console.error('Order placement error:', err.message);
    await unlockSession(session.id);
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ received: true });
}