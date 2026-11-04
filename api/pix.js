const { createHmac, timingSafeEqual } = require('node:crypto');
const QRCode = require('qrcode');

const api = 'https://api.usepinpay.com/functions/v1/api-v1/pix';
const flavors = ['Maracujá', 'Abacaxi com Hortelã', 'Frutas Vermelhas', 'Mix de Sabores'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const paymentId = /^[a-z0-9_-]{1,100}$/i;

function sign(id, secret) {
  return createHmac('sha256', secret).update('primefit-pix:' + id).digest('hex');
}

function validToken(id, token, secret) {
  return typeof id === 'string' && paymentId.test(id) &&
    typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(sign(id, secret)));
}

function value(input, limit = 120) {
  return typeof input === 'string' ? input.trim().slice(0, limit) : '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.PINPAY_SECRET_KEY;
  if (!secret) return res.status(503).json({ error: 'O Pix ainda não está disponível.' });
  const headers = { Authorization: 'Bearer ' + secret };

  try {
    if (req.method === 'GET') {
      const { id, token } = req.query;
      if (!validToken(id, token, secret)) return res.status(403).json({ error: 'Consulta inválida.' });
      const response = await fetch(api + '/' + encodeURIComponent(id), {
        headers, signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return res.status(502).json({ error: 'Não foi possível consultar o pagamento.' });
      const charge = await response.json();
      return res.status(200).json({ status: charge.status });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).end();
    }

    const order = req.body;
    if (!order || !Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > 99 ||
      !Number.isInteger(order.flavor) || !flavors[order.flavor] ||
      !['pac', 'sedex'].includes(order.shipping) || typeof order.reference !== 'string' ||
      !uuid.test(order.reference)) {
      return res.status(400).json({ error: 'Revise os itens do pedido.' });
    }

    const name = value(order.name);
    const email = value(order.email, 254);
    const cpf = value(order.cpf, 20).replace(/\D/g, '');
    const delivery = {
      cep: value(order.zip, 10).replace(/\D/g, ''),
      rua: value(order.street), numero: value(order.number, 30),
      complemento: value(order.complement), bairro: value(order.neighborhood),
      cidade: value(order.city), uf: value(order.state, 2)
    };
    const phone = value(order.phone, 20).replace(/\D/g, '');
    if (name.split(/\s+/).length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\d{11}$/.test(cpf) || !/^\d{10,13}$/.test(phone) || !/^\d{8}$/.test(delivery.cep) ||
      !delivery.rua || !delivery.numero || !delivery.bairro || !delivery.cidade ||
      !/^[A-Z]{2}$/.test(delivery.uf)) {
      return res.status(400).json({ error: 'Revise a identificação e o endereço de entrega.' });
    }

    const amount = Math.round(6990 * order.quantity * 95 / 100) + (order.shipping === 'sedex' ? 1792 : 0);
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (!host) return res.status(503).json({ error: 'O endereço do checkout precisa ser configurado.' });

    const response = await fetch(api, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': order.reference },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        amount,
        description: 'PrimeFit — ' + order.quantity + ' combo(s) de Magnésio & Inositol',
        customer: { name, email, document: { number: cpf } },
        metadata: {
          external_reference: order.reference,
          checkout_url: 'https://' + host + '/checkout.html',
          flavor: flavors[order.flavor], quantity: String(order.quantity),
          shipping: order.shipping, delivery: JSON.stringify(delivery), phone
        }
      })
    });

    const charge = await response.json();
    if (!response.ok || !paymentId.test(charge.id || '') || typeof charge.pix?.qr_code !== 'string' ||
      !charge.pix.qr_code) {
      console.error('PinPay create failed', { status: response.status, reference: order.reference });
      return res.status(502).json({ error: 'A PinPay não confirmou a cobrança. Confira os dados e tente novamente.' });
    }

    if (Number(charge.amount) !== amount) {
      console.error('PinPay amount mismatch', {
        reference: order.reference, expected: amount, received: Number(charge.amount)
      });
      return res.status(409).json({
        code: 'pix_amount_mismatch',
        error: 'A PinPay retornou um valor diferente do total. O QR Code foi bloqueado. Entre em contato com a loja.'
      });
    }

    const qr = await QRCode.toDataURL(charge.pix.qr_code, { width: 280, margin: 3 });
    return res.status(201).json({
      id: charge.id, token: sign(charge.id, secret), amount, code: charge.pix.qr_code,
      qr, expiresAt: charge.pix.expires_at,
      order: { flavor: flavors[order.flavor], quantity: order.quantity }
    });
  } catch {
    return res.status(502).json({ error: 'A comunicação com a PinPay falhou. Tente novamente.' });
  }
};
