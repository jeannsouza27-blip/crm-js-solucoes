const API = '';
let token = localStorage.getItem('crm_token') || '';
let clientes = [];
let servicos = [];
let confirmCallback = null;
let paginaAtual = 1;
let tamanhoPagina = 10;
let ordenacao = { campo: null, dir: 1 };

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
  document.getElementById('app').style.display = 'flex';
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

// ===== TOASTS =====
function toast(mensagem, tipo = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = mensagem;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ===== NAVEGAÇÃO =====
function viewLabel(view) {
  return {
    dashboard: 'Dashboard', clientes: 'Clientes', pipeline: 'Pipeline',
    financeiro: 'Financeiro', servicos: 'Serviços', relatorios: 'Relatórios', configuracoes: 'Configurações'
  }[view] || view;
}

function mudarView(view) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  const el = document.getElementById('view-' + view);
  if (el) el.style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('breadcrumb').textContent = viewLabel(view);
  fecharSidebarMobile();
  if (view === 'clientes') renderizarTabela();
  if (view === 'financeiro') carregarFinanceiro();
  if (view === 'pipeline') renderizarPipeline();
  if (view === 'relatorios') carregarRelatorios();
  if (view === 'servicos') carregarServicos();
  if (view === 'configuracoes') carregarConfiguracoes();
}

function fecharSidebarMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

function toggleDropdown(id) {
  const el = document.getElementById(id);
  const estavaAberto = el.style.display === 'block';
  fecharDropdowns();
  el.style.display = estavaAberto ? 'none' : 'block';
}

function fecharDropdowns() {
  document.getElementById('notif-dropdown').style.display = 'none';
  document.getElementById('avatar-dropdown').style.display = 'none';
}

// ===== NOTIFICAÇÕES (vencimentos próximos/atrasados) =====
function chaveNotificacao(c) {
  return `${c.id}|${c.data_vencimento}`;
}

function getNotificacoesLidas() {
  try { return new Set(JSON.parse(localStorage.getItem('crm_notif_lidas') || '[]')); }
  catch { return new Set(); }
}

function marcarNotificacaoLida(c) {
  const lidas = getNotificacoesLidas();
  lidas.add(chaveNotificacao(c));
  localStorage.setItem('crm_notif_lidas', JSON.stringify([...lidas]));
}

function calcularNotificacoes() {
  const lidas = getNotificacoesLidas();
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return clientes
    .filter(c => c.data_vencimento && !c.pagamento_confirmado)
    .filter(c => !lidas.has(chaveNotificacao(c)))
    .filter(c => {
      const venc = new Date(c.data_vencimento + 'T00:00:00');
      const diff = Math.ceil((venc - hoje) / 86400000);
      return diff <= 3;
    })
    .sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
}

function atualizarNotificacoes() {
  const lista = calcularNotificacoes();
  const badge = document.getElementById('notif-badge');
  if (lista.length > 0) {
    badge.textContent = lista.length;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }

  const container = document.getElementById('notif-list');
  if (lista.length === 0) {
    container.innerHTML = '<div class="dropdown-empty">Nenhum vencimento próximo ou atrasado.</div>';
    return;
  }

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  container.innerHTML = lista.map(c => {
    const venc = new Date(c.data_vencimento + 'T00:00:00');
    const diff = Math.ceil((venc - hoje) / 86400000);
    const situacao = diff < 0 ? `Atrasado há ${Math.abs(diff)} dia(s)` : diff === 0 ? 'Vence hoje' : `Vence em ${diff} dia(s)`;
    return `
      <button type="button" class="dropdown-list-item" data-notif-id="${c.id}">
        <div class="nome-empresa">${esc(c.nome_empresa)}</div>
        <div style="font-size:12px;color:${vencimentoCor(c.data_vencimento)}">${situacao} — ${formatData(c.data_vencimento)}</div>
      </button>`;
  }).join('');
}

function abrirNotificacao(id) {
  const cliente = clientes.find(c => c.id === id);
  if (!cliente) return;
  marcarNotificacaoLida(cliente);
  fecharDropdowns();
  atualizarNotificacoes();
  abrirModal(cliente.id);
}

// ===== CLIENTES =====
async function carregarClientes() {
  clientes = await api('GET', '/api/clientes') || [];
  paginaAtual = 1;
  renderizarTabela();
  renderizarPipeline();
  atualizarStats();
  atualizarNotificacoes();
}

function atualizarStats() {
  document.getElementById('stat-total').textContent = clientes.length;
  document.getElementById('stat-servicos').textContent = formatBRL(clientes.reduce((s, c) => s + (c.valor_servico || 0), 0));
  document.getElementById('stat-mensais').textContent = formatBRL(clientes.reduce((s, c) => s + (c.valor_mensais || 0) + (c.valor_extra || 0), 0));
  document.getElementById('stat-ativos').textContent = clientes.filter(c => c.status === 'ativo').length;
}

function getClientesFiltrados() {
  const busca = document.getElementById('busca').value.toLowerCase();
  const status = document.getElementById('filtro-status').value;
  const segmento = document.getElementById('filtro-segmento').value;
  const pagamento = document.getElementById('filtro-pagamento').value;
  return clientes.filter(c => {
    const matchBusca = !busca ||
      c.nome_empresa.toLowerCase().includes(busca) ||
      (c.nome_contato || '').toLowerCase().includes(busca) ||
      (c.telefone || '').includes(busca);
    const matchStatus = !status || c.status === status;
    const matchSegmento = !segmento || c.segmento === segmento;
    const matchPagamento = !pagamento || c.forma_pagamento === pagamento;
    return matchBusca && matchStatus && matchSegmento && matchPagamento;
  });
}

function ordenarClientes(lista) {
  if (!ordenacao.campo) return lista;
  const campo = ordenacao.campo;
  const dir = ordenacao.dir;
  return [...lista].sort((a, b) => {
    let va, vb;
    if (campo === 'mensais_total') {
      va = (a.valor_mensais || 0) + (a.valor_extra || 0);
      vb = (b.valor_mensais || 0) + (b.valor_extra || 0);
    } else if (campo === 'valor_servico') {
      va = a.valor_servico || 0;
      vb = b.valor_servico || 0;
    } else if (campo === 'data_vencimento') {
      va = a.data_vencimento || '';
      vb = b.data_vencimento || '';
    } else {
      va = (a[campo] || '').toString().toLowerCase();
      vb = (b[campo] || '').toString().toLowerCase();
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

function atualizarSetaOrdenacao() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const seta = th.querySelector('.sort-arrow');
    seta.textContent = th.dataset.sort === ordenacao.campo ? (ordenacao.dir === 1 ? ' ▲' : ' ▼') : '';
  });
}

function renderizarTabela() {
  const lista = ordenarClientes(getClientesFiltrados());
  const tbody = document.getElementById('tabela-body');
  const vazia = document.getElementById('tabela-vazia');
  const paginacao = document.getElementById('paginacao');

  atualizarSetaOrdenacao();

  if (lista.length === 0) {
    tbody.innerHTML = '';
    document.getElementById('tabela').style.display = 'none';
    vazia.style.display = 'block';
    paginacao.style.display = 'none';
    return;
  }

  document.getElementById('tabela').style.display = 'table';
  vazia.style.display = 'none';
  paginacao.style.display = 'flex';

  const totalPaginas = Math.max(1, Math.ceil(lista.length / tamanhoPagina));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;
  const inicio = (paginaAtual - 1) * tamanhoPagina;
  const pagina = lista.slice(inicio, inicio + tamanhoPagina);

  tbody.innerHTML = pagina.map(c => `
    <tr>
      <td>
        <div class="nome-empresa">${esc(c.nome_empresa)}</div>
        ${c.nome_contato ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:2px">👤 ${esc(c.nome_contato)}</div>` : ''}
      </td>
      <td>
        ${c.telefone ? `<a href="tel:${esc(c.telefone)}" style="color:var(--accent);text-decoration:none">${esc(c.telefone)}</a>` : '<span style="color:var(--text-secondary)">—</span>'}
        ${c.whatsapp ? `<a href="https://wa.me/55${onlyDigits(c.whatsapp)}" target="_blank" rel="noopener" style="margin-left:6px" title="Abrir no WhatsApp">💬</a>` : ''}
      </td>
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

  document.getElementById('pagina-info').textContent = `Página ${paginaAtual} de ${totalPaginas}`;
  document.getElementById('pagina-anterior').disabled = paginaAtual <= 1;
  document.getElementById('pagina-proxima').disabled = paginaAtual >= totalPaginas;
}

// ===== MODAL =====
function abrirModal(id) {
  const c = id ? clientes.find(x => x.id === id) : null;
  document.getElementById('modal-titulo').textContent = c ? 'Editar Cliente' : 'Novo Cliente';
  document.getElementById('edit-id').value = c ? c.id : '';
  document.getElementById('f-nome').value = c ? c.nome_empresa : '';
  document.getElementById('f-cnpj').value = c ? (c.cnpj_cpf || '') : '';
  document.getElementById('f-segmento').value = c ? (c.segmento || '') : '';
  document.getElementById('f-porte').value = c ? (c.porte || '') : '';
  document.getElementById('f-website').value = c ? (c.website || '') : '';
  document.getElementById('f-cep').value = c ? (c.cep || '') : '';
  document.getElementById('f-endereco').value = c ? (c.endereco || '') : '';
  document.getElementById('f-numero').value = c ? (c.numero || '') : '';
  document.getElementById('f-bairro').value = c ? (c.bairro || '') : '';
  document.getElementById('f-cidade').value = c ? (c.cidade || '') : '';
  document.getElementById('f-uf').value = c ? (c.uf || '') : '';
  document.getElementById('f-contato').value = c ? (c.nome_contato || '') : '';
  document.getElementById('f-cargo').value = c ? (c.contato_cargo || '') : '';
  document.getElementById('f-telefone').value = c ? (c.telefone || '') : '';
  document.getElementById('f-whatsapp').value = c ? (c.whatsapp || '') : '';
  document.getElementById('f-email').value = c ? (c.email || '') : '';
  document.getElementById('f-forma-pagamento').value = c ? (c.forma_pagamento || '') : '';
  document.getElementById('f-servico').value = c ? c.valor_servico : '';
  document.getElementById('f-mensais').value = c ? c.valor_mensais : '';
  document.getElementById('f-extra').value = c ? (c.valor_extra || '') : '';
  document.getElementById('f-motivo-extra').value = c ? (c.motivo_extra || '') : '';
  document.getElementById('f-vencimento').value = c && c.data_vencimento ? c.data_vencimento.split('T')[0] : '';
  document.getElementById('f-pagamento-confirmado').checked = c ? !!c.pagamento_confirmado : false;
  document.getElementById('f-bloqueio-manual').checked = c ? !!c.bloqueio_manual : false;
  document.getElementById('f-cnpj-hint').textContent = '';
  document.getElementById('f-cnpj-hint').className = 'field-hint';
  atualizarTotalPreview();
  atualizarWhatsappLink();
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
    cnpj_cpf: document.getElementById('f-cnpj').value.trim(),
    segmento: document.getElementById('f-segmento').value,
    porte: document.getElementById('f-porte').value,
    website: document.getElementById('f-website').value.trim(),
    cep: document.getElementById('f-cep').value.trim(),
    endereco: document.getElementById('f-endereco').value.trim(),
    numero: document.getElementById('f-numero').value.trim(),
    bairro: document.getElementById('f-bairro').value.trim(),
    cidade: document.getElementById('f-cidade').value.trim(),
    uf: document.getElementById('f-uf').value.trim().toUpperCase(),
    nome_contato: document.getElementById('f-contato').value.trim(),
    contato_cargo: document.getElementById('f-cargo').value.trim(),
    telefone: document.getElementById('f-telefone').value.trim(),
    whatsapp: document.getElementById('f-whatsapp').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    forma_pagamento: document.getElementById('f-forma-pagamento').value,
    valor_servico: parseFloat(document.getElementById('f-servico').value) || 0,
    data_entrega: document.getElementById('f-data').value || null,
    valor_mensais: parseFloat(document.getElementById('f-mensais').value) || 0,
    valor_extra: parseFloat(document.getElementById('f-extra').value) || 0,
    motivo_extra: document.getElementById('f-motivo-extra').value.trim(),
    data_vencimento: document.getElementById('f-vencimento').value || null,
    pagamento_confirmado: document.getElementById('f-pagamento-confirmado').checked,
    bloqueio_manual: document.getElementById('f-bloqueio-manual').checked,
    status: document.getElementById('f-status').value,
    observacoes: document.getElementById('f-obs').value.trim()
  };

  const cnpjDigits = onlyDigits(body.cnpj_cpf);
  if (cnpjDigits && !validarCnpjCpf(cnpjDigits)) {
    erro.textContent = 'CNPJ/CPF inválido. Confira os dígitos ou deixe o campo em branco.';
    erro.style.display = 'block';
    return;
  }

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

// ===== FINANCEIRO =====
let financeiroData = null;

function mesAtualStr() {
  return new Date().toISOString().slice(0, 7);
}

async function carregarFinanceiro() {
  const mesInput = document.getElementById('fin-mes');
  if (!mesInput.value) mesInput.value = mesAtualStr();
  financeiroData = await api('GET', `/api/financeiro?mes=${mesInput.value}`);
  renderizarFinanceiro();
}

function financeiroStatusLabel(s) {
  return { pago: 'Pago', pendente: 'Pendente', atrasado: 'Atrasado', bloqueado: 'Bloqueado' }[s] || s;
}

function getCobrancasFiltradas() {
  if (!financeiroData) return [];
  const status = document.getElementById('fin-filtro-status').value;
  const forma = document.getElementById('fin-filtro-forma').value;
  return financeiroData.cobrancas.filter(c => {
    const matchStatus = !status || c.status === status;
    const matchForma = !forma || c.forma_pagamento === forma;
    return matchStatus && matchForma;
  });
}

function renderizarFinanceiro() {
  if (!financeiroData) return;
  const ov = financeiroData.overview;
  document.getElementById('fin-stat-total').textContent = formatBRL(ov.receita_total_mes);
  document.getElementById('fin-stat-recebido').textContent = formatBRL(ov.total_recebido);
  document.getElementById('fin-stat-projetos').textContent = formatBRL(ov.receita_projetos_mes);
  document.getElementById('fin-stat-pendente').textContent = formatBRL(ov.total_pendente);
  document.getElementById('fin-stat-atrasado').textContent = formatBRL(ov.total_atrasado);

  const cobrancas = getCobrancasFiltradas();
  const tbody = document.getElementById('fin-cobrancas-body');
  const tabela = document.getElementById('fin-tabela-cobrancas');
  const vazio = document.getElementById('fin-cobrancas-vazio');

  if (cobrancas.length === 0) {
    tbody.innerHTML = '';
    tabela.style.display = 'none';
    vazio.style.display = 'block';
  } else {
    tabela.style.display = 'table';
    vazio.style.display = 'none';
    tbody.innerHTML = cobrancas.map(c => `
      <tr>
        <td class="nome-empresa">${esc(c.nome_empresa)}</td>
        <td class="valor">${formatBRL(c.valor)}</td>
        <td style="color:${vencimentoCor(c.data_vencimento)}">${formatData(c.data_vencimento)}</td>
        <td><span class="badge badge-pagamento-${c.status === 'pago' ? 'ok' : c.status}">${financeiroStatusLabel(c.status)}</span></td>
        <td>${c.forma_pagamento ? esc(c.forma_pagamento) : '<span style="color:var(--text-secondary)">—</span>'}</td>
        <td>
          <div class="acoes" style="justify-content:flex-start">
            ${c.status !== 'pago'
              ? `<button type="button" class="btn-icon" data-fin-pagar-id="${c.id}">💰 Registrar</button>`
              : '<span style="color:var(--text-secondary)">—</span>'}
            ${c.status !== 'pago'
              ? `<button type="button" class="btn-icon" data-fin-bloquear-id="${c.id}">🛑 Bloquear</button>`
              : ''}
          </div>
        </td>
      </tr>
    `).join('');
  }

  const historico = financeiroData.historico || [];
  const tbodyH = document.getElementById('fin-historico-body');
  const tabelaH = document.getElementById('fin-tabela-historico');
  const vazioH = document.getElementById('fin-historico-vazio');

  if (historico.length === 0) {
    tbodyH.innerHTML = '';
    tabelaH.style.display = 'none';
    vazioH.style.display = 'block';
  } else {
    tabelaH.style.display = 'table';
    vazioH.style.display = 'none';
    tbodyH.innerHTML = historico.map(p => `
      <tr>
        <td class="nome-empresa">${esc(p.nome_empresa)}</td>
        <td class="valor">${formatBRL(p.valor)}</td>
        <td>${p.forma_pagamento ? esc(p.forma_pagamento) : '<span style="color:var(--text-secondary)">—</span>'}</td>
        <td>${formatData(p.data_pagamento)}</td>
        <td>${renderComprovante(p.comprovante)}</td>
      </tr>
    `).join('');
  }
}

function abrirPagar(id) {
  const c = financeiroData && financeiroData.cobrancas.find(x => x.id === id);
  if (!c) return;
  document.getElementById('pagar-cliente-id').value = id;
  document.getElementById('pagar-cliente-nome').textContent = c.nome_empresa;
  document.getElementById('pagar-forma').value = c.forma_pagamento || '';
  document.getElementById('pagar-data').value = new Date().toISOString().slice(0, 10);
  document.getElementById('pagar-comprovante').value = '';
  document.getElementById('pagar-error').style.display = 'none';
  document.getElementById('pagar-overlay').style.display = 'flex';
}

function fecharPagar() {
  document.getElementById('pagar-overlay').style.display = 'none';
}

function abrirBloquear(id) {
  const c = financeiroData && financeiroData.cobrancas.find(x => x.id === id);
  if (!c) return;

  const nomeContato = c.nome_contato || c.nome_empresa;
  const mensagemPadrao = `Olá ${nomeContato},\nSua assinatura está em atraso e foi bloqueada temporariamente por falta de pagamento. Entre em contato para regularizar sua situação.`;

  document.getElementById('bloquear-cliente-id').value = id;
  document.getElementById('bloquear-cliente-nome').textContent = c.nome_empresa;
  document.getElementById('bloquear-mensagem').value = mensagemPadrao;
  document.getElementById('bloquear-error').style.display = 'none';
  document.getElementById('bloquear-overlay').style.display = 'flex';
}

function fecharBloquear() {
  document.getElementById('bloquear-overlay').style.display = 'none';
}

async function confirmarPagamento(e) {
  e.preventDefault();
  const id = document.getElementById('pagar-cliente-id').value;
  const erro = document.getElementById('pagar-error');
  const body = {
    forma_pagamento: document.getElementById('pagar-forma').value,
    data_pagamento: document.getElementById('pagar-data').value || null,
    comprovante: document.getElementById('pagar-comprovante').value.trim()
  };
  try {
    const result = await api('POST', `/api/clientes/${id}/pagar`, body);
    if (!result || result.error) throw new Error((result && result.error) || 'Erro ao registrar pagamento');
    fecharPagar();
    toast('Pagamento registrado com sucesso.', 'sucesso');
    await carregarClientes();
    await carregarFinanceiro();
  } catch (err) {
    erro.textContent = err.message;
    erro.style.display = 'block';
  }
}

async function confirmarBloqueio(e) {
  e.preventDefault();
  const id = document.getElementById('bloquear-cliente-id').value;
  const erro = document.getElementById('bloquear-error');
  const mensagem = document.getElementById('bloquear-mensagem').value.trim();

  try {
    const result = await api('POST', `/api/clientes/${id}/bloquear`, { mensagem });
    if (!result || result.error) throw new Error((result && result.error) || 'Erro ao bloquear cliente');

    const cliente = clientes.find(x => x.id === parseInt(id, 10)) || (financeiroData && financeiroData.cobrancas.find(x => x.id === parseInt(id, 10)));
    const digits = onlyDigits(cliente?.whatsapp || '');
    const urlMensagem = mensagem || 'Olá, sua assinatura foi bloqueada temporariamente por falta de pagamento.';

    fecharBloquear();
    toast('Cliente bloqueado com sucesso.', 'sucesso');

    if (digits.length >= 10) {
      const whatsappUrl = `https://wa.me/55${digits}?text=${encodeURIComponent(urlMensagem)}`;
      window.open(whatsappUrl, '_blank', 'noopener');
    }

    await carregarClientes();
    await carregarFinanceiro();
  } catch (err) {
    erro.textContent = err.message;
    erro.style.display = 'block';
  }
}

function exportarFinanceiroCSV() {
  if (!financeiroData) return;
  const linhas = [['Cliente', 'Valor', 'Forma de Pagamento', 'Data do Pagamento', 'Comprovante']];
  financeiroData.historico.forEach(p => {
    linhas.push([p.nome_empresa, (p.valor || 0).toFixed(2).replace('.', ','), p.forma_pagamento || '', formatData(p.data_pagamento), p.comprovante || '']);
  });
  const csv = linhas.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `financeiro-${financeiroData.mes}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== PIPELINE (KANBAN) =====
const PIPELINE_COLUNAS = [
  { status: 'pendente', label: 'Em negociação' },
  { status: 'ativo', label: 'Ativo' },
  { status: 'pausado', label: 'Pausado' },
  { status: 'concluido', label: 'Concluído' },
  { status: 'cancelado', label: 'Cancelado' }
];

function renderizarPipeline() {
  const board = document.getElementById('pipeline-board');
  if (!board) return;
  board.innerHTML = PIPELINE_COLUNAS.map(col => {
    const itens = clientes.filter(c => c.status === col.status);
    const total = itens.reduce((s, c) => s + (c.valor_mensais || 0) + (c.valor_extra || 0), 0);
    const cards = itens.length
      ? itens.map(c => `
        <div class="pipeline-card" draggable="true" data-card-id="${c.id}" onclick="abrirModal(${c.id})">
          <div class="pipeline-card-nome">${esc(c.nome_empresa)}</div>
          ${c.nome_contato ? `<div class="pipeline-card-contato">👤 ${esc(c.nome_contato)}</div>` : ''}
          <div class="pipeline-card-rodape">
            <span class="pipeline-card-valor">${formatBRL((c.valor_mensais || 0) + (c.valor_extra || 0))}/mês</span>
          </div>
          ${c.data_vencimento ? `<div class="pipeline-card-venc" style="color:${vencimentoCor(c.data_vencimento)}">Vence ${formatData(c.data_vencimento)}</div>` : ''}
        </div>`).join('')
      : '<div class="pipeline-coluna-vazia">Nenhum cliente aqui.</div>';

    return `
      <div class="pipeline-coluna">
        <div class="pipeline-coluna-header">
          <div class="pipeline-coluna-titulo">
            <span>${col.label}</span>
            <span class="pipeline-coluna-count">${itens.length}</span>
          </div>
          <div class="pipeline-coluna-total">${formatBRL(total)}/mês</div>
        </div>
        <div class="pipeline-coluna-body" data-status="${col.status}">${cards}</div>
      </div>`;
  }).join('');
}

async function moverClientePipeline(id, novoStatus) {
  const c = clientes.find(x => x.id === id);
  if (!c || c.status === novoStatus) return;
  const body = {
    nome_empresa: c.nome_empresa, nome_contato: c.nome_contato, telefone: c.telefone,
    valor_servico: c.valor_servico, data_entrega: c.data_entrega, valor_mensais: c.valor_mensais,
    valor_extra: c.valor_extra, motivo_extra: c.motivo_extra, data_vencimento: c.data_vencimento,
    status: novoStatus, observacoes: c.observacoes, pagamento_confirmado: !!c.pagamento_confirmado,
    cnpj_cpf: c.cnpj_cpf, segmento: c.segmento, porte: c.porte, website: c.website, cep: c.cep,
    endereco: c.endereco, numero: c.numero, bairro: c.bairro, cidade: c.cidade, uf: c.uf,
    contato_cargo: c.contato_cargo, whatsapp: c.whatsapp, email: c.email, forma_pagamento: c.forma_pagamento
  };
  const result = await api('PUT', `/api/clientes/${id}`, body);
  if (!result || result.error) { toast((result && result.error) || 'Erro ao mover cliente', 'erro'); return; }
  toast(`${c.nome_empresa} movido para ${statusLabel(novoStatus)}.`, 'sucesso');
  await carregarClientes();
}

// ===== RELATÓRIOS =====
async function carregarRelatorios() {
  const data = await api('GET', '/api/relatorios/overview');
  if (!data) return;
  renderizarRelatoriosStats();
  renderizarGraficoReceita(data.receitaMensal || []);
  renderizarRankList('rel-lista-status', Object.entries(data.porStatus || {}).map(([k, v]) => ({ nome: statusLabel(k), valor: v })));
  renderizarRankList('rel-lista-segmento', Object.entries(data.porSegmento || {}).map(([k, v]) => ({ nome: k, valor: v })));
  renderizarRankList('rel-lista-forma', Object.entries(data.porFormaPagamento || {}).map(([k, v]) => ({ nome: k, valor: v })));
  renderizarTopClientes(data.topClientes || []);
}

function renderizarRelatoriosStats() {
  document.getElementById('rel-stat-total').textContent = clientes.length;
  document.getElementById('rel-stat-ativos').textContent = clientes.filter(c => c.status === 'ativo').length;
  const recorrente = clientes.reduce((s, c) => s + (c.valor_mensais || 0) + (c.valor_extra || 0), 0);
  document.getElementById('rel-stat-recorrente').textContent = formatBRL(recorrente);
  const comMensalidade = clientes.filter(c => (c.valor_mensais || 0) + (c.valor_extra || 0) > 0);
  document.getElementById('rel-stat-ticket').textContent = formatBRL(comMensalidade.length ? recorrente / comMensalidade.length : 0);
}

function renderizarGraficoReceita(receitaMensal) {
  const el = document.getElementById('rel-chart-receita');
  const max = Math.max(1, ...receitaMensal.flatMap(m => [m.recebido, m.projetos]));
  el.innerHTML = receitaMensal.map(m => {
    const [ano, mesNum] = m.mes.split('-');
    const nomeMes = new Date(Number(ano), Number(mesNum) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
    const alturaRecebido = Math.max(2, (m.recebido / max) * 100);
    const alturaProjetos = Math.max(2, (m.projetos / max) * 100);
    return `
      <div class="bar-chart-mes">
        <div class="bar-chart-bars">
          <div class="bar-chart-bar" style="height:${alturaRecebido}%;background:var(--series-1)">
            <span class="bar-tooltip">Recebido: ${formatBRL(m.recebido)}</span>
          </div>
          <div class="bar-chart-bar" style="height:${alturaProjetos}%;background:var(--series-2)">
            <span class="bar-tooltip">Projetos: ${formatBRL(m.projetos)}</span>
          </div>
        </div>
        <div class="bar-chart-label">${nomeMes}/${ano.slice(2)}</div>
      </div>`;
  }).join('');
}

function renderizarRankList(elId, itens) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (itens.length === 0) {
    el.innerHTML = '<div class="pipeline-coluna-vazia">Sem dados.</div>';
    return;
  }
  const ordenado = [...itens].sort((a, b) => b.valor - a.valor);
  const max = Math.max(1, ...ordenado.map(i => i.valor));
  el.innerHTML = ordenado.map(i => `
    <div class="rank-row">
      <div class="rank-row-top">
        <span class="rank-row-nome">${esc(i.nome)}</span>
        <span class="rank-row-valor">${i.valor}</span>
      </div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${(i.valor / max) * 100}%"></div></div>
    </div>`).join('');
}

function renderizarTopClientes(topClientes) {
  const tbody = document.getElementById('rel-top-body');
  const tabela = document.getElementById('rel-tabela-top');
  const vazio = document.getElementById('rel-top-vazio');
  if (!topClientes.length) {
    tbody.innerHTML = '';
    tabela.style.display = 'none';
    vazio.style.display = 'block';
    return;
  }
  tabela.style.display = 'table';
  vazio.style.display = 'none';
  tbody.innerHTML = topClientes.map(c => `
    <tr>
      <td class="nome-empresa">${esc(c.nome_empresa)}</td>
      <td class="valor">${formatBRL(c.total_mensal)}/mês</td>
    </tr>`).join('');
}

// ===== SERVIÇOS (CATÁLOGO) =====
async function carregarServicos() {
  servicos = await api('GET', '/api/servicos') || [];
  renderizarServicos();
}

function renderizarServicos() {
  const busca = document.getElementById('servico-busca').value.toLowerCase();
  const lista = servicos.filter(s => !busca || s.nome.toLowerCase().includes(busca));
  const tbody = document.getElementById('servicos-tabela-body');
  const tabela = document.getElementById('servicos-tabela');
  const vazia = document.getElementById('servicos-tabela-vazia');

  if (lista.length === 0) {
    tbody.innerHTML = '';
    tabela.style.display = 'none';
    vazia.style.display = 'block';
    return;
  }

  tabela.style.display = 'table';
  vazia.style.display = 'none';
  tbody.innerHTML = lista.map(s => `
    <tr>
      <td class="nome-empresa">${esc(s.nome)}</td>
      <td>${s.descricao ? esc(s.descricao) : '<span style="color:var(--text-secondary)">—</span>'}</td>
      <td class="valor">${formatBRL(s.valor)}</td>
      <td>
        <div class="acoes">
          <button class="btn-icon" onclick="abrirModalServico(${s.id})">✏️ Editar</button>
          <button class="btn-icon del" onclick="confirmarDeleteServico(${s.id})">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

function abrirModalServico(id) {
  const s = id ? servicos.find(x => x.id === id) : null;
  document.getElementById('servico-modal-titulo').textContent = s ? 'Editar Serviço' : 'Novo Serviço';
  document.getElementById('servico-edit-id').value = s ? s.id : '';
  document.getElementById('servico-nome').value = s ? s.nome : '';
  document.getElementById('servico-descricao').value = s ? (s.descricao || '') : '';
  document.getElementById('servico-valor').value = s ? s.valor : '';
  document.getElementById('servico-error').style.display = 'none';
  document.getElementById('servico-overlay').style.display = 'flex';
  document.getElementById('servico-nome').focus();
}

function fecharModalServico() {
  document.getElementById('servico-overlay').style.display = 'none';
}

async function salvarServico(e) {
  e.preventDefault();
  const id = document.getElementById('servico-edit-id').value;
  const erro = document.getElementById('servico-error');
  const body = {
    nome: document.getElementById('servico-nome').value.trim(),
    descricao: document.getElementById('servico-descricao').value.trim(),
    valor: parseFloat(document.getElementById('servico-valor').value) || 0
  };
  try {
    const result = id
      ? await api('PUT', `/api/servicos/${id}`, body)
      : await api('POST', '/api/servicos', body);
    if (!result || result.error) throw new Error((result && result.error) || 'Erro ao salvar serviço');
    fecharModalServico();
    toast('Serviço salvo com sucesso.', 'sucesso');
    await carregarServicos();
  } catch (err) {
    erro.textContent = err.message;
    erro.style.display = 'block';
  }
}

function confirmarDeleteServico(id) {
  confirmarAcao('Tem certeza que deseja excluir este serviço? Esta ação não pode ser desfeita.', async () => {
    await api('DELETE', `/api/servicos/${id}`);
    await carregarServicos();
  });
}

// ===== CONFIGURAÇÕES =====
async function carregarConfiguracoes() {
  const data = await api('GET', '/api/config');
  if (!data) return;
  document.getElementById('config-empresa-nome').value = data.empresa_nome || '';
  document.getElementById('config-usuario-atual').value = data.usuario_atual || '';
}

async function carregarBrandingPublico() {
  try {
    const r = await fetch(`${API}/api/config/publico`);
    const data = await r.json();
    const nome = (data && data.empresa_nome) || 'Js Soluções';
    document.getElementById('login-empresa-nome').textContent = nome;
    document.getElementById('sidebar-empresa-nome').textContent = nome;
  } catch (err) {
    // marca padrão já está no HTML; falha aqui não deve travar o login
  }
}

async function salvarDadosEmpresa(e) {
  e.preventDefault();
  const erro = document.getElementById('config-empresa-error');
  const body = { empresa_nome: document.getElementById('config-empresa-nome').value.trim() };
  const result = await api('PUT', '/api/config', body);
  if (!result || result.error) {
    erro.textContent = (result && result.error) || 'Erro ao salvar dados da empresa';
    erro.style.display = 'block';
    return;
  }
  erro.style.display = 'none';
  toast('Dados da empresa atualizados.', 'sucesso');
  await carregarBrandingPublico();
}

async function salvarSenha(e) {
  e.preventDefault();
  const erro = document.getElementById('config-senha-error');
  const novaSenha = document.getElementById('config-nova-senha').value;
  const confirmarSenha = document.getElementById('config-confirmar-senha').value;
  if (novaSenha !== confirmarSenha) {
    erro.textContent = 'A confirmação não confere com a nova senha.';
    erro.style.display = 'block';
    return;
  }
  const body = {
    senha_atual: document.getElementById('config-senha-atual').value,
    novo_usuario: document.getElementById('config-novo-usuario').value.trim(),
    nova_senha: novaSenha
  };
  const result = await api('POST', '/api/config/senha', body);
  if (!result || result.error) {
    erro.textContent = (result && result.error) || 'Erro ao alterar senha';
    erro.style.display = 'block';
    return;
  }
  erro.style.display = 'none';
  document.getElementById('config-senha-form').reset();
  toast('Senha alterada com sucesso.', 'sucesso');
  await carregarConfiguracoes();
}

// ===== CONFIRMAÇÃO GENÉRICA (exclusão de clientes ou serviços) =====
function confirmarAcao(mensagem, acao) {
  document.getElementById('confirm-texto').textContent = mensagem;
  confirmCallback = acao;
  document.getElementById('confirm-overlay').style.display = 'flex';
}

function fecharConfirm() {
  confirmCallback = null;
  document.getElementById('confirm-overlay').style.display = 'none';
}

async function executarConfirmacao() {
  if (!confirmCallback) return;
  const acao = confirmCallback;
  fecharConfirm();
  await acao();
}

function confirmarDelete(id) {
  confirmarAcao('Tem certeza que deseja excluir este cliente? Esta ação não pode ser desfeita.', async () => {
    await api('DELETE', `/api/clientes/${id}`);
    await carregarClientes();
  });
}

// ===== MÁSCARAS E VALIDAÇÃO =====
function onlyDigits(str) {
  return (str || '').replace(/\D/g, '');
}

function formatCnpjCpf(value) {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function validarCnpjCpf(digits) {
  if (digits.length === 11) return validarCPF(digits);
  if (digits.length === 14) return validarCNPJ(digits);
  return false;
}

function validarCPF(cpf) {
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cpf[10], 10);
}

function validarCNPJ(cnpj) {
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calcularDigito = (base) => {
    let soma = 0;
    let pos = base.length - 7;
    for (let i = base.length; i >= 1; i--) {
      soma += parseInt(base.charAt(base.length - i), 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const resultado = soma % 11;
    return resultado < 2 ? 0 : 11 - resultado;
  };
  const digitos = cnpj.substring(12);
  const d1 = calcularDigito(cnpj.substring(0, 12));
  if (d1 !== parseInt(digitos.charAt(0), 10)) return false;
  const d2 = calcularDigito(cnpj.substring(0, 13));
  return d2 === parseInt(digitos.charAt(1), 10);
}

function maskTelefone(value) {
  const v = onlyDigits(value).slice(0, 11);
  if (v.length > 10) return v.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (v.length > 6) return v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  if (v.length > 2) return v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
  return v;
}

function maskCep(value) {
  return onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
}

function atualizarWhatsappLink() {
  const digits = onlyDigits(document.getElementById('f-whatsapp').value);
  const link = document.getElementById('f-whatsapp-link');
  if (digits.length >= 10) {
    link.href = `https://wa.me/55${digits}`;
    link.style.display = 'inline-flex';
  } else {
    link.style.display = 'none';
  }
}

async function buscarCep() {
  const digits = onlyDigits(document.getElementById('f-cep').value);
  if (digits.length !== 8) return;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    const data = await r.json();
    if (data.erro) return;
    if (data.logradouro) document.getElementById('f-endereco').value = data.logradouro;
    if (data.bairro) document.getElementById('f-bairro').value = data.bairro;
    if (data.localidade) document.getElementById('f-cidade').value = data.localidade;
    if (data.uf) document.getElementById('f-uf').value = data.uf;
  } catch (err) {
    // autopreenchimento é best-effort; falha silenciosa não bloqueia o formulário
  }
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
  return { ativo: 'Ativo', concluido: 'Concluído', pendente: 'Em negociação', pausado: 'Pausado', cancelado: 'Cancelado' }[s] || s;
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

function renderComprovante(comprovante) {
  if (!comprovante) return '<span style="color:var(--text-secondary)">—</span>';
  if (/^https?:\/\//i.test(comprovante)) {
    return `<a href="${esc(comprovante)}" target="_blank" rel="noopener">📎 Ver comprovante</a>`;
  }
  return esc(comprovante);
}

// ===== EVENTS =====
document.getElementById('login-form').addEventListener('submit', login);
document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('btn-novo').addEventListener('click', () => abrirModal());
document.getElementById('modal-form').addEventListener('submit', salvarCliente);
document.getElementById('confirm-delete-btn').addEventListener('click', executarConfirmacao);

document.getElementById('busca').addEventListener('input', () => { paginaAtual = 1; renderizarTabela(); });
document.getElementById('filtro-status').addEventListener('change', () => { paginaAtual = 1; renderizarTabela(); });
document.getElementById('filtro-segmento').addEventListener('change', () => { paginaAtual = 1; renderizarTabela(); });
document.getElementById('filtro-pagamento').addEventListener('change', () => { paginaAtual = 1; renderizarTabela(); });

document.getElementById('f-mensais').addEventListener('input', atualizarTotalPreview);
document.getElementById('f-extra').addEventListener('input', atualizarTotalPreview);

document.getElementById('f-cnpj').addEventListener('input', (e) => {
  e.target.value = formatCnpjCpf(e.target.value);
  const digits = onlyDigits(e.target.value);
  const hint = document.getElementById('f-cnpj-hint');
  if (digits.length === 11 || digits.length === 14) {
    const valido = validarCnpjCpf(digits);
    hint.textContent = valido ? '✓ válido' : '✕ inválido';
    hint.className = 'field-hint ' + (valido ? 'field-hint-ok' : 'field-hint-erro');
  } else {
    hint.textContent = '';
    hint.className = 'field-hint';
  }
});

document.getElementById('f-telefone').addEventListener('input', (e) => { e.target.value = maskTelefone(e.target.value); });
document.getElementById('f-whatsapp').addEventListener('input', (e) => { e.target.value = maskTelefone(e.target.value); atualizarWhatsappLink(); });
document.getElementById('f-cep').addEventListener('input', (e) => { e.target.value = maskCep(e.target.value); });
document.getElementById('f-cep').addEventListener('blur', buscarCep);

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) fecharModal();
});

document.getElementById('confirm-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('confirm-overlay')) fecharConfirm();
});

document.getElementById('fin-mes').addEventListener('change', carregarFinanceiro);
document.getElementById('fin-filtro-status').addEventListener('change', renderizarFinanceiro);
document.getElementById('fin-filtro-forma').addEventListener('change', renderizarFinanceiro);
document.getElementById('fin-btn-exportar').addEventListener('click', exportarFinanceiroCSV);

document.getElementById('fin-card-pendente').addEventListener('click', () => {
  document.getElementById('fin-filtro-status').value = 'pendente';
  renderizarFinanceiro();
});
document.getElementById('fin-card-atrasado').addEventListener('click', () => {
  document.getElementById('fin-filtro-status').value = 'atrasado';
  renderizarFinanceiro();
});

document.getElementById('fin-cobrancas-body').addEventListener('click', (e) => {
  const pagarBtn = e.target.closest('[data-fin-pagar-id]');
  if (pagarBtn) {
    abrirPagar(parseInt(pagarBtn.dataset.finPagarId, 10));
    return;
  }

  const bloquearBtn = e.target.closest('[data-fin-bloquear-id]');
  if (bloquearBtn) {
    abrirBloquear(parseInt(bloquearBtn.dataset.finBloquearId, 10));
  }
});

document.getElementById('pagar-form').addEventListener('submit', confirmarPagamento);
document.getElementById('pagar-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('pagar-overlay')) fecharPagar();
});
document.getElementById('bloquear-form').addEventListener('submit', confirmarBloqueio);
document.getElementById('bloquear-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('bloquear-overlay')) fecharBloquear();
});

document.getElementById('btn-relatorio').addEventListener('click', abrirRelatorio);
document.getElementById('relatorio-mes').addEventListener('change', carregarRelatorio);

// Drag-and-drop do quadro Pipeline
document.getElementById('pipeline-board').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.pipeline-card');
  if (!card) return;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.cardId);
});

document.getElementById('pipeline-board').addEventListener('dragend', (e) => {
  const card = e.target.closest('.pipeline-card');
  if (card) card.classList.remove('dragging');
  document.querySelectorAll('.pipeline-coluna-body.drag-over').forEach(el => el.classList.remove('drag-over'));
});

document.getElementById('pipeline-board').addEventListener('dragover', (e) => {
  const coluna = e.target.closest('.pipeline-coluna-body');
  if (!coluna) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  coluna.classList.add('drag-over');
});

document.getElementById('pipeline-board').addEventListener('dragleave', (e) => {
  const coluna = e.target.closest('.pipeline-coluna-body');
  if (coluna && !coluna.contains(e.relatedTarget)) coluna.classList.remove('drag-over');
});

document.getElementById('pipeline-board').addEventListener('drop', (e) => {
  const coluna = e.target.closest('.pipeline-coluna-body');
  if (!coluna) return;
  e.preventDefault();
  coluna.classList.remove('drag-over');
  const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
  moverClientePipeline(id, coluna.dataset.status);
});

document.getElementById('relatorio-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('relatorio-overlay')) fecharRelatorio();
});

// Ordenação e paginação da tabela
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const campo = th.dataset.sort;
    if (ordenacao.campo === campo) ordenacao.dir *= -1;
    else { ordenacao.campo = campo; ordenacao.dir = 1; }
    renderizarTabela();
  });
});

document.getElementById('pagina-tamanho').addEventListener('change', (e) => {
  tamanhoPagina = parseInt(e.target.value, 10);
  paginaAtual = 1;
  renderizarTabela();
});
document.getElementById('pagina-anterior').addEventListener('click', () => {
  if (paginaAtual > 1) { paginaAtual--; renderizarTabela(); }
});
document.getElementById('pagina-proxima').addEventListener('click', () => {
  paginaAtual++; renderizarTabela();
});

// Navegação (sidebar, avatar, header)
document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => mudarView(btn.dataset.view));
});

document.getElementById('sidebar-collapse-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

document.getElementById('mobile-menu-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
});
document.getElementById('sidebar-overlay').addEventListener('click', fecharSidebarMobile);

document.getElementById('notif-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown('notif-dropdown');
});
document.getElementById('notif-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-notif-id]');
  if (!item) return;
  abrirNotificacao(parseInt(item.dataset.notifId, 10));
});
document.getElementById('avatar-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown('avatar-dropdown');
});
document.addEventListener('click', fecharDropdowns);

document.getElementById('busca-global').addEventListener('input', (e) => {
  document.getElementById('busca').value = e.target.value;
  if (e.target.value) mudarView('clientes');
  paginaAtual = 1;
  renderizarTabela();
});

// Serviços (catálogo)
document.getElementById('btn-novo-servico').addEventListener('click', () => abrirModalServico());
document.getElementById('servico-form').addEventListener('submit', salvarServico);
document.getElementById('servico-busca').addEventListener('input', renderizarServicos);
document.getElementById('servico-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('servico-overlay')) fecharModalServico();
});

// Configurações
document.getElementById('config-empresa-form').addEventListener('submit', salvarDadosEmpresa);
document.getElementById('config-senha-form').addEventListener('submit', salvarSenha);

// Marca (nome da empresa) — carregada mesmo antes do login
carregarBrandingPublico();

// Iniciar se já tiver token
if (token) iniciarApp();
