// Regressão do bug de perda de pagamentos ao editar cliente / mover no Pipeline.
// Sobe o server.js real contra um banco SQLite temporário, com dados fictícios.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3000 + Math.floor(Math.random() * 1000) + 5000;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-teste-'));
let srv;
let stderr = '';
let token;

function mesLocal(offset) {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
}
const MES_ATUAL = mesLocal(0);
const MES_ANTERIOR = mesLocal(-1);

async function api(method, p, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function buscarCliente(id) {
  return (await api('GET', '/api/clientes')).body.find(c => c.id === id);
}

async function buscarPagamentos(id) {
  return (await api('GET', `/api/clientes/${id}/pagamentos`)).body.map(p => p.mes_referencia).sort();
}

// Cliente com mensalidade, vencimento, forma de pagamento, bloqueio manual e
// dois pagamentos registrados pelo Financeiro ("Registrar Pagamento").
async function criarClienteComPagamentos(nome) {
  const { body: c } = await api('POST', '/api/clientes', {
    nome_empresa: nome, nome_contato: 'Contato Ficticio', telefone: '(00) 00000-0000',
    valor_mensais: 500, data_vencimento: `${MES_ANTERIOR}-05`, forma_pagamento: 'Pix',
    status: 'ativo', observacoes: 'original', bloqueio_manual: true
  });
  await api('POST', `/api/clientes/${c.id}/pagar`, { forma_pagamento: 'Pix', data_pagamento: `${MES_ANTERIOR}-04` });
  await api('POST', `/api/clientes/${c.id}/pagar`, { forma_pagamento: 'Pix', data_pagamento: `${MES_ATUAL}-04` });
  const cliente = await buscarCliente(c.id);
  assert.deepEqual(await buscarPagamentos(c.id), [MES_ANTERIOR, MES_ATUAL], 'pré-condição: dois pagamentos');
  assert.equal(cliente.bloqueio_manual, 1, 'pré-condição: bloqueio ativo');
  assert.equal(cliente.pagamento_confirmado, 0, 'pré-condição: ciclo avançou e flag voltou a 0');
  return cliente;
}

// Réplica do body que o modal "Editar Cliente" envia (salvarCliente em public/app.js)
function bodyModal(c, alteracoes) {
  const campos = ['nome_empresa', 'cnpj_cpf', 'segmento', 'porte', 'website', 'cep', 'endereco', 'numero', 'bairro',
    'cidade', 'uf', 'nome_contato', 'contato_cargo', 'telefone', 'whatsapp', 'email', 'forma_pagamento',
    'valor_servico', 'data_entrega', 'valor_mensais', 'valor_extra', 'motivo_extra', 'data_vencimento', 'status', 'observacoes'];
  const body = {};
  for (const k of campos) body[k] = c[k];
  body.pagamento_confirmado = !!c.pagamento_confirmado;
  body.bloqueio_manual = !!c.bloqueio_manual;
  return { ...body, ...alteracoes };
}

before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DB_PATH: path.join(TMP, 'teste.db'), PORT: String(PORT), JWT_SECRET: 'teste', ADMIN_USER: 'teste', ADMIN_PASS: 'teste123' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  srv.stderr.on('data', d => { stderr += d; });
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + '/api/config/publico'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'teste', senha: 'teste123' })
  });
  token = (await r.json()).token;
});

after(async () => {
  // Espera o servidor sair: no Windows o .db fica travado enquanto o processo existe
  const saiu = new Promise(r => srv.once('exit', r));
  srv.kill();
  await saiu;
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('editar cliente alterando só observações preserva os pagamentos e o bloqueio', async () => {
  const c = await criarClienteComPagamentos('Ficticia Modal');
  const r = await api('PUT', `/api/clientes/${c.id}`, bodyModal(c, { observacoes: 'alterado' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await buscarPagamentos(c.id), [MES_ANTERIOR, MES_ATUAL]);
  const depois = await buscarCliente(c.id);
  assert.equal(depois.bloqueio_manual, 1);
  assert.equal(depois.observacoes, 'alterado');
});

test('mover no Pipeline (envia só o status) preserva os pagamentos e o bloqueio', async () => {
  const c = await criarClienteComPagamentos('Ficticia Pipeline');
  const r = await api('PUT', `/api/clientes/${c.id}`, { status: 'pausado' });
  assert.equal(r.status, 200);
  assert.deepEqual(await buscarPagamentos(c.id), [MES_ANTERIOR, MES_ATUAL]);
  const depois = await buscarCliente(c.id);
  assert.equal(depois.bloqueio_manual, 1);
  assert.equal(depois.status, 'pausado');
});

test('chamador antigo do Pipeline (objeto inteiro sem bloqueio_manual) não destrói dado', async () => {
  const c = await criarClienteComPagamentos('Ficticia Pipeline Antigo');
  const body = bodyModal(c, { status: 'pausado' });
  delete body.bloqueio_manual;
  const r = await api('PUT', `/api/clientes/${c.id}`, body);
  assert.equal(r.status, 200);
  assert.deepEqual(await buscarPagamentos(c.id), [MES_ANTERIOR, MES_ATUAL]);
  assert.equal((await buscarCliente(c.id)).bloqueio_manual, 1);
});

test('update parcial com um só campo não altera nenhum outro campo', async () => {
  const c = await criarClienteComPagamentos('Ficticia Parcial');
  const r = await api('PUT', `/api/clientes/${c.id}`, { observacoes: 'só isto' });
  assert.equal(r.status, 200);
  const depois = await buscarCliente(c.id);
  assert.deepEqual(depois, { ...c, observacoes: 'só isto' });
  assert.deepEqual(await buscarPagamentos(c.id), [MES_ANTERIOR, MES_ATUAL]);
});

test('desmarcar de verdade um pagamento confirmado continua removendo e registra no log', async () => {
  // Sem vencimento o ciclo não avança, então a flag fica gravada como 1
  const { body: c } = await api('POST', '/api/clientes', {
    nome_empresa: 'Ficticia Desmarcar', valor_mensais: 300, forma_pagamento: 'Boleto', pagamento_confirmado: true
  });
  assert.equal(c.pagamento_confirmado, 1);
  assert.deepEqual(await buscarPagamentos(c.id), [MES_ATUAL]);

  const r = await api('PUT', `/api/clientes/${c.id}`, bodyModal(c, { pagamento_confirmado: false }));
  assert.equal(r.status, 200);
  assert.deepEqual(await buscarPagamentos(c.id), []);
  assert.equal((await buscarCliente(c.id)).pagamento_confirmado, 0);
  assert.match(stderr, new RegExp(`\\[pagamento-removido\\].*"cliente_id":${c.id}\\b`));
});

test('update de cliente inexistente responde 404', async () => {
  const r = await api('PUT', '/api/clientes/999999', { status: 'ativo' });
  assert.equal(r.status, 404);
});
