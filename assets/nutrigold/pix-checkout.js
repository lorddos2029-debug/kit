(() => {
  const form = document.getElementById('checkout-form');
  const button = form.querySelector('[type=submit]');
  const message = document.getElementById('payment-status');
  let pending = false;
  let previousOrder;
  let reference;
  let blockedOrder;

  form.addEventListener('primefit:generate-pix', async () => {
    if (pending) return;
    try {
      const cart = JSON.parse(localStorage.getItem('nutrigold.cart.v1') || '{}') || {};
      const order = { flavor: cart.flavor ?? 0, quantity: Number(document.getElementById('quantity').textContent) };
      for (const field of ['name', 'email', 'cpf', 'phone', 'zip', 'street', 'number',
        'complement', 'neighborhood', 'city', 'state', 'shipping']) {
        order[field] = form.elements[field].value;
      }
      const fingerprint = JSON.stringify(order);
      if (blockedOrder === fingerprint) {
        message.textContent = 'Já houve uma divergência de valor neste pedido. Entre em contato com a loja.';
        message.focus();
        return;
      }
      if (fingerprint !== previousOrder) {
        reference = crypto.randomUUID();
        previousOrder = fingerprint;
      }
      pending = true;
      button.disabled = true;
      button.textContent = 'Gerando Pix…';
      message.textContent = '';
      const response = await fetch('/api/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...order, reference })
      });
      const payment = await response.json();
      if (payment.code === 'pix_amount_mismatch') blockedOrder = fingerprint;
      if (!response.ok) throw new Error(payment.error);
      sessionStorage.setItem('primefit.pix', JSON.stringify(payment));
      location.assign('/pix');
    } catch (error) {
      message.textContent = error.message === 'Failed to fetch'
        ? 'Não foi possível conectar ao checkout. Tente novamente.'
        : (error instanceof SyntaxError ? 'Não foi possível gerar o Pix neste endereço.' : error.message);
      message.focus();
      button.disabled = false;
      button.textContent = 'Gerar Pix';
      pending = false;
    }
  });
})();
