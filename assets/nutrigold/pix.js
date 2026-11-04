(() => {
  const get = id => document.getElementById(id);
  const status = get('pix-status');
  let payment;
  try { payment = JSON.parse(sessionStorage.getItem('primefit.pix')); } catch {}
  if (!payment?.id || !payment.code || !payment.qr?.startsWith('data:image/png;base64,')) {
    status.textContent = 'Nenhum Pix gerado nesta aba. Volte ao checkout para criar a cobrança.';
    return;
  }

  const details = get('pix-details');
  const qr = get('pix-qr');
  qr.src = payment.qr;
  get('pix-code').value = payment.code;
  get('pix-amount').textContent = (payment.amount / 100).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL'
  });
  const expires = Date.parse(payment.expiresAt);
  if (Number.isFinite(expires)) {
    get('pix-expiration').textContent = 'Válido até ' +
      new Date(expires).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
  details.hidden = false;
  status.textContent = 'Aguardando pagamento.';
  let timer;
  let checking = false;

  async function refresh() {
    if (checking) return;
    checking = true;
    clearTimeout(timer);
    try {
      const query = new URLSearchParams({ id: payment.id, token: payment.token });
      const response = await fetch('/api/pix?' + query, { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result.status === 'paid') {
        status.textContent = 'Pagamento confirmado pela PinPay.';
        details.hidden = true;
        return;
      }
      if (['expired', 'canceled', 'cancelled', 'failed', 'refunded'].includes(result.status) ||
          (Number.isFinite(expires) && Date.now() >= expires)) {
        status.textContent = 'Esta cobrança está indisponível. Volte ao checkout para gerar um novo Pix.';
        details.hidden = true;
        return;
      }
      status.textContent = 'Aguardando pagamento.';
    } catch {
      status.textContent = 'Não foi possível consultar o pagamento agora. Tentaremos novamente.';
    } finally {
      checking = false;
    }
    timer = setTimeout(refresh, 12000);
  }

  get('pix-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(payment.code);
      get('copy-status').textContent = 'Código copiado.';
    } catch {
      get('pix-code').select();
      get('copy-status').textContent = 'Código selecionado. Copie pelo menu do seu dispositivo.';
    }
  });
  get('pix-refresh').addEventListener('click', refresh);
  refresh();
})();
