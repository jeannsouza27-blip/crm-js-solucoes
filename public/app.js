const API = '';
let token = localStorage.getItem('crm_token') || '';
let clientes = [];
let deletandoId = null;

// ===== AUTH =====
async function login(e) {
  e.preventDefault();
  const usuario = document.getElementById('usuario').value;
  const senha = document.getElementById('senha').value;
  const erro = document.getElementById('login-error');

  try {
    const r = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro ao fazer login');
    token = data.token;
    localStorage.setItem('crm_token', token);
    erro.style.display = 'none';
    iniciarApp();
  } catch (err) {
    erro.textContent = err.message;
    erro.style.display = 'block';
  }
}

function logout() {
  localStorage.removeItem('crm_token');
  token = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

// ===== INICIAR =====
async function iniciarApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  await carregarClientes();
}

// ===== API HELPERS =====
async function api(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) { logout(); return null; }
  return r.json();
}

// ===== CLIENTES =====
async function carregarClientes() {
  clientes = await api('GET', '/api/clientes') || [];
  renderizarTabela();
  atualizarStats();
}

function atualizarStats() {
  const filtrados = getClientesFiltrados();
  document.getElementById('stat-total').textContent = clientes.length;
  document.getElementById('stat-servicos').textContent = formatBRL(clientes.reduce((s, c) => s + (c.valor_servico || 0), 0));
  document.getElementById('stat-mensais').textContent = formatBRL(clientes.reduce((s, c) => s + (c.valor_mensais || 0) + (c.valor_extra || 0), 0));
  document.getElementById('stat-ativos').textContent = clientes.filter(c => c.status === 'ativo').length;
}

function getClientesFiltrados() {
  const busca = document.getElementById('busca').value.toLowerCase();
  const status = document.getElementById('filtro-status').value;
  return clientes.filter(c => {
    const matchBusca = !busca ||
      c.nome_empresa.toLowerCase().includes(busca) ||
      (c.nome_contato || '').toLowerCase().includes(busca) ||
      (c.telefone || '').includes(busca);
    const matchStatus = !status || c.status === status;
    return matchBusca && matchStatus;
  });
}

function renderizarTabela() {
  const lista = getClientesFiltrados();
  const tbody = document.getElementById('tabela-body');
  const vazia = document.getElementById('tabela-vazia');

  if (lista.length === 0) {
    tbody.innerHTML = '';
    document.getElementById('tabela').style.display = 'none';
    vazia.style.display = 'block';
    return;
  }

  document.getElementById('tabela').style.display = 'table';
  vazia.style.display = 'none';

  tbody.innerHTML = lista.map(c => `
    <tr>
      <td>
        <div class="nome-empresa">${esc(c.nome_empresa)}</div>
        ${c.nome_contato ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">👤 ${esc(c.nome_contato)}</div>` : ''}
      </td>
      <td>${c.telefone ? `<a href="tel:${esc(c.telefone)}" style="color:var(--accent);text-decoration:none">${esc(c.telefone)}</a>` : '<span style="color:var(--text-secondary)">—</span>'}</td>
      <td class="valor">${formatBRL(c.valor_servico)}</td>
      <td>
        <div class="valor">${formatBRL((c.valor_mensais || 0) + (c.valor_extra || 0))}/mês</div>
        ${c.valor_extra ? `<div style="font-size:11px;color:var(--text-secondary)">${formatBRL(c.valor_mensais)} + ${formatBRL(c.valor_extra)} extra</div>` : ''}
        ${c.data_vencimento ? `<div style="font-size:12px;color:${vencimentoCor(c.data_vencimento)}">${formatData(c.data_vencimento)}</div>` : ''}
      </td>
      <td>${c.data_entrega ? formatData(c.data_entrega) : '<span style="color:var(--text-secondary)">—</span>'}</td>
      <td><span class="badge badge-pagamento-${c.pagamento_confirmado ? 'ok' : 'pendente'}">${c.pagamento_confirmado ? '✅ Confirmado' : '⏳ Pendente'}</span></td>
      <td><span class="badge badge-${c.status}">${statusLabel(c.status)}</span></td>
      <td>
        <div class="acoes">
          <button class="btn-icon" onclick="abrirModal(${c.id})">✏️ Editar</button>
          <button class="btn-icon del" onclick="confirmarDelete(${c.id})">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ===== MODAL =====
function abrirModal(id) {
  const c = id ? clientes.find(x => x.id === id) : null;
  document.getElementById('modal-titulo').textContent = c ? 'Editar Cliente' : 'Novo Cliente';
  document.getElementById('edit-id').value = c ? c.id : '';
  document.getElementById('f-nome').value = c ? c.nome_empresa : '';
  document.getElementById('f-contato').value = c ? (c.nome_contato || '') : '';
  document.getElementById('f-telefone').value = c ? (c.telefone || '') : '';
  document.getElementById('f-servico').value = c ? c.valor_servico : '';
  document.getElementById('f-mensais').value = c ? c.valor_mensais : '';
  document.getElementById('f-extra').value = c ? (c.valor_extra || '') : '';
  document.getElementById('f-motivo-extra').value = c ? (c.motivo_extra || '') : '';
  document.getElementById('f-vencimento').value = c && c.data_vencimento ? c.data_vencimento.split('T')[0] : '';
  document.getElementById('f-pagamento-confirmado').checked = c ? !!c.pagamento_confirmado : false;
  atualizarTotalPreview();
  document.getElementById('f-data').value = c && c.data_entrega ? c.data_entrega.split('T')[0] : '';
  document.getElementById('f-status').value = c ? c.status : 'ativo';
  document.getElementById('f-obs').value = c ? c.observacoes : '';
  document.getElementById('modal-error').style.display = 'none';
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('f-nome').focus();
}

function fecharModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

async function salvarCliente(e) {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const erro = document.getElementById('modal-error');
  const body = {
    nome_empresa: document.getElementById('f-nome').value.trim(),
    nome_contato: document.getElementById('f-contato').value.trim(),
    telefone: document.getElementById('f-telefone').value.trim(),
    valor_servico: parseFloat(document.getElementById('f-servico').value) || 0,
    data_entrega: document.getElementById('f-data').value || null,
    valor_mensais: parseFloat(document.getElementById('f-mensais').value) || 0,
    valor_extra: parseFloat(document.getElementById('f-extra').value) || 0,
    motivo_extra: document.getElementById('f-motivo-extra').value.trim(),
    data_vencimento: document.getElementById('f-vencimento').value || null,
    pagamento_confirmado: document.getElementById('f-pagamento-confirmado').checked,
    status: document.getElementById('f-status').value,
    observacoes: document.getElementById('f-obs').value.trim()
  };

  try {
    const result = id
      ? await api('PUT', `/api/clientes/${id}`, body)
      : await api('POST', '/api/clientes', body);
    if (!result || result.error) throw new Error(result?.error || 'Erro ao salvar');
    fecharModal();
    await carregarClientes();
  } catch (err) {
    erro.textContent = err.message;
    erro.style.display = 'block';
  }
}

// ===== RELATÓRIO MENSAL =====
function abrirRelatorio() {
  const mesInput = document.getElementById('relatorio-mes');
  if (!mesInput.value) mesInput.value = new Date().toISOString().slice(0, 7);
  document.getElementById('relatorio-overlay').style.display = 'flex';
  carregarRelatorio();
}

function fecharRelatorio() {
  document.getElementById('relatorio-overlay').style.display = 'none';
}

async function carregarRelatorio() {
  const mes = document.getElementById('relatorio-mes').value;
  const data = await api('GET', `/api/relatorio?mes=${mes}`);
  const pagamentos = (data && data.pagamentos) || [];
  const tbody = document.getElementById('relatorio-tabela-body');
  const tabela = document.getElementById('relatorio-tabela');
  const vazio = document.getElementById('relatorio-vazio');

  document.getElementById('relatorio-total').textContent = formatBRL(data ? data.total : 0);

  if (pagamentos.length === 0) {
    tbody.innerHTML = '';
    tabela.style.display = 'none';
    vazio.style.display = 'block';
    return;
  }

  tabela.style.display = 'table';
  vazio.style.display = 'none';
  tbody.innerHTML = pagamentos.map(p => `
    <tr>
      <td>${esc(p.nome_empresa)}</td>
      <td class="valor">${formatBRL(p.valor)}</td>
      <td>${new Date(p.criado_em.replace(' ', 'T')).toLocaleDateString('pt-BR')}</td>
    </tr>
  `).join('');
}

// ===== DELETE =====
function confirmarDelete(id) {
  deletandoId = id;
  document.getElementById('confirm-overlay').style.display = 'flex';
}

function fecharConfirm() {
  deletandoId = null;
  document.getElementById('confirm-overlay').style.display = 'none';
}

async function executarDelete() {
  if (!deletandoId) return;
  await api('DELETE', `/api/clientes/${deletandoId}`);
  fecharConfirm();
  await carregarClientes();
}

// ===== UTILS =====
function formatBRL(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatData(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('pt-BR');
}

function statusLabel(s) {
  return { ativo: 'Ativo', concluido: 'Concluído', pendente: 'Pendente' }[s] || s;
}

function atualizarTotalPreview() {
  const mensais = parseFloat(document.getElementById('f-mensais').value) || 0;
  const extra   = parseFloat(document.getElementById('f-extra').value)   || 0;
  const preview = document.getElementById('total-preview');
  const motivoRow = document.getElementById('motivo-extra-row');
  if (mensais > 0 || extra > 0) {
    document.getElementById('total-valor').textContent = formatBRL(mensais + extra);
    preview.style.display = 'flex';
    preview.style.flexDirection = 'column';
  } else {
    preview.style.display = 'none';
  }
  motivoRow.style.display = extra > 0 ? 'block' : 'none';
  if (extra === 0) document.getElementById('f-motivo-extra').value = '';
}

function vencimentoCor(d) {
  if (!d) return 'var(--text-secondary)';
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const venc = new Date(d + 'T00:00:00');
  const diff = Math.ceil((venc - hoje) / 86400000);
  if (diff < 0) return '#f87171';
  if (diff <= 5) return '#fbbf24';
  return 'var(--text-secondary)';
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ===== EVENTS =====
document.getElementById('login-form').addEventListener('submit', login);
document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('btn-novo').addEventListener('click', () => abrirModal());
document.getElementById('modal-form').addEventListener('submit', salvarCliente);
document.getElementById('confirm-delete-btn').addEventListener('click', executarDelete);
document.getElementById('busca').addEventListener('input', renderizarTabela);
document.getElementById('filtro-status').addEventListener('change', renderizarTabela);
document.getElementById('f-mensais').addEventListener('input', atualizarTotalPreview);
document.getElementById('f-extra').addEventListener('input', atualizarTotalPreview);

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) fecharModal();
});

document.getElementById('confirm-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('confirm-overlay')) fecharConfirm();
});

document.getElementById('btn-relatorio').addEventListener('click', abrirRelatorio);
document.getElementById('relatorio-mes').addEventListener('change', carregarRelatorio);

document.getElementById('relatorio-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('relatorio-overlay')) fecharRelatorio();
});

// Iniciar se já tiver token
if (token) iniciarApp();
