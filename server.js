const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'js-solucoes-secret-2026-mude-isso';
const ADMIN_USER = process.env.ADMIN_USER || 'jeann';
const ADMIN_PASS = process.env.ADMIN_PASS || 'js@2026';
const DB_PATH = process.env.DB_PATH || '/data/crm.db';

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_empresa TEXT NOT NULL,
    nome_contato TEXT DEFAULT '',
    telefone TEXT DEFAULT '',
    valor_servico REAL DEFAULT 0,
    data_entrega TEXT,
    valor_mensais REAL DEFAULT 0,
    valor_extra REAL DEFAULT 0,
    motivo_extra TEXT DEFAULT '',
    data_vencimento TEXT,
    pagamento_confirmado INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ativo',
    observacoes TEXT DEFAULT '',
    criado_em TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

// Migração segura para bancos já existentes
const cols = db.prepare('PRAGMA table_info(clientes)').all().map(c => c.name);
if (!cols.includes('nome_contato'))    db.exec("ALTER TABLE clientes ADD COLUMN nome_contato TEXT DEFAULT ''");
if (!cols.includes('telefone'))        db.exec("ALTER TABLE clientes ADD COLUMN telefone TEXT DEFAULT ''");
if (!cols.includes('valor_extra'))     db.exec('ALTER TABLE clientes ADD COLUMN valor_extra REAL DEFAULT 0');
if (!cols.includes('motivo_extra'))    db.exec("ALTER TABLE clientes ADD COLUMN motivo_extra TEXT DEFAULT ''");
if (!cols.includes('data_vencimento')) db.exec('ALTER TABLE clientes ADD COLUMN data_vencimento TEXT');
if (!cols.includes('pagamento_confirmado')) db.exec('ALTER TABLE clientes ADD COLUMN pagamento_confirmado INTEGER DEFAULT 0');
if (!cols.includes('cnpj_cpf'))        db.exec("ALTER TABLE clientes ADD COLUMN cnpj_cpf TEXT DEFAULT ''");
if (!cols.includes('segmento'))        db.exec("ALTER TABLE clientes ADD COLUMN segmento TEXT DEFAULT ''");
if (!cols.includes('porte'))           db.exec("ALTER TABLE clientes ADD COLUMN porte TEXT DEFAULT ''");
if (!cols.includes('website'))         db.exec("ALTER TABLE clientes ADD COLUMN website TEXT DEFAULT ''");
if (!cols.includes('cep'))             db.exec("ALTER TABLE clientes ADD COLUMN cep TEXT DEFAULT ''");
if (!cols.includes('endereco'))        db.exec("ALTER TABLE clientes ADD COLUMN endereco TEXT DEFAULT ''");
if (!cols.includes('numero'))          db.exec("ALTER TABLE clientes ADD COLUMN numero TEXT DEFAULT ''");
if (!cols.includes('bairro'))          db.exec("ALTER TABLE clientes ADD COLUMN bairro TEXT DEFAULT ''");
if (!cols.includes('cidade'))          db.exec("ALTER TABLE clientes ADD COLUMN cidade TEXT DEFAULT ''");
if (!cols.includes('uf'))              db.exec("ALTER TABLE clientes ADD COLUMN uf TEXT DEFAULT ''");
if (!cols.includes('contato_cargo'))   db.exec("ALTER TABLE clientes ADD COLUMN contato_cargo TEXT DEFAULT ''");
if (!cols.includes('whatsapp'))        db.exec("ALTER TABLE clientes ADD COLUMN whatsapp TEXT DEFAULT ''");
if (!cols.includes('email'))           db.exec("ALTER TABLE clientes ADD COLUMN email TEXT DEFAULT ''");
if (!cols.includes('forma_pagamento')) db.exec("ALTER TABLE clientes ADD COLUMN forma_pagamento TEXT DEFAULT ''");

db.exec(`
  CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    valor REAL NOT NULL,
    mes_referencia TEXT NOT NULL,
    criado_em TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

const colsPagamentos = db.prepare('PRAGMA table_info(pagamentos)').all().map(c => c.name);
if (!colsPagamentos.includes('forma_pagamento')) db.exec("ALTER TABLE pagamentos ADD COLUMN forma_pagamento TEXT DEFAULT ''");
if (!colsPagamentos.includes('comprovante'))     db.exec("ALTER TABLE pagamentos ADD COLUMN comprovante TEXT DEFAULT ''");
if (!colsPagamentos.includes('data_pagamento'))  db.exec('ALTER TABLE pagamentos ADD COLUMN data_pagamento TEXT');

function mesAtual() {
  return db.prepare("SELECT strftime('%Y-%m', 'now', 'localtime') AS mes").get().mes;
}

function hojeStr() {
  return db.prepare("SELECT date('now', 'localtime') AS d").get().d;
}

// Registra/remove o pagamento do mês corrente conforme o checkbox "pagamento_confirmado".
// O mês do registro é o da data de pagamento informada (permite dar baixa em meses atrasados);
// sem data informada, cai no mês corrente.
function sincronizarPagamento(clienteId, confirmado, valorTotal, formaPagamento, comprovante, dataPagamento) {
  const mes = dataPagamento ? dataPagamento.substring(0, 7) : mesAtual();
  const existente = db.prepare('SELECT id FROM pagamentos WHERE cliente_id=? AND mes_referencia=?').get(clienteId, mes);
  if (confirmado) {
    if (!existente) {
      db.prepare('INSERT INTO pagamentos (cliente_id, valor, mes_referencia, forma_pagamento, comprovante, data_pagamento) VALUES (?, ?, ?, ?, ?, ?)')
        .run(clienteId, valorTotal, mes, formaPagamento || '', comprovante || '', dataPagamento || hojeStr());
    }
  } else if (existente) {
    db.prepare('DELETE FROM pagamentos WHERE id=?').run(existente.id);
  }
}

function proximoMes(dataStr) {
  const [ano, mes, dia] = dataStr.split('-').map(Number);
  const ultimoDiaMesSeguinte = new Date(ano, mes + 1, 0).getDate();
  const novaData = new Date(ano, mes, Math.min(dia, ultimoDiaMesSeguinte));
  return `${novaData.getFullYear()}-${String(novaData.getMonth() + 1).padStart(2, '0')}-${String(novaData.getDate()).padStart(2, '0')}`;
}

// Quando o pagamento é confirmado agora (não estava confirmado antes), já avança
// o vencimento para o próximo mês e deixa o novo ciclo como pendente
function avancarCicloSeConfirmado(estavaConfirmado, confirmadoAgora, dataVencimento) {
  if (confirmadoAgora && !estavaConfirmado && dataVencimento) {
    return { dataVencimento: proximoMes(dataVencimento), pagamentoConfirmado: 0 };
  }
  return { dataVencimento: dataVencimento || null, pagamentoConfirmado: confirmadoAgora ? 1 : 0 };
}

// Backfill: clientes já marcados como confirmados antes de existir o histórico
// não tinham registro nenhum. Garante o registro do mês corrente para eles.
for (const c of db.prepare('SELECT id, valor_mensais, valor_extra, forma_pagamento FROM clientes WHERE pagamento_confirmado = 1').all()) {
  sincronizarPagamento(c.id, true, (c.valor_mensais || 0) + (c.valor_extra || 0), c.forma_pagamento, '', null);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Não autorizado' });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body || {};
  if (usuario === ADMIN_USER && senha === ADMIN_PASS) {
    const token = jwt.sign({ usuario }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Usuário ou senha incorretos' });
});

app.get('/api/clientes', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM clientes ORDER BY criado_em DESC').all());
});

app.post('/api/clientes', auth, (req, res) => {
  const { nome_empresa, nome_contato, telefone, valor_servico, data_entrega, valor_mensais, data_vencimento, status, observacoes, pagamento_confirmado,
    cnpj_cpf, segmento, porte, website, cep, endereco, numero, bairro, cidade, uf, contato_cargo, whatsapp, email, forma_pagamento } = req.body || {};
  if (!nome_empresa) return res.status(400).json({ error: 'Nome da empresa obrigatório' });
  const ciclo = avancarCicloSeConfirmado(false, !!pagamento_confirmado, data_vencimento || null);
  const r = db.prepare(`
    INSERT INTO clientes (nome_empresa, nome_contato, telefone, valor_servico, data_entrega, valor_mensais, valor_extra, motivo_extra, data_vencimento, pagamento_confirmado, status, observacoes,
      cnpj_cpf, segmento, porte, website, cep, endereco, numero, bairro, cidade, uf, contato_cargo, whatsapp, email, forma_pagamento)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nome_empresa, nome_contato || '', telefone || '', Number(valor_servico) || 0, data_entrega || null, Number(valor_mensais) || 0, Number(req.body.valor_extra) || 0, req.body.motivo_extra || '', ciclo.dataVencimento, ciclo.pagamentoConfirmado, status || 'ativo', observacoes || '',
    cnpj_cpf || '', segmento || '', porte || '', website || '', cep || '', endereco || '', numero || '', bairro || '', cidade || '', uf || '', contato_cargo || '', whatsapp || '', email || '', forma_pagamento || '');
  sincronizarPagamento(r.lastInsertRowid, !!pagamento_confirmado, (Number(valor_mensais) || 0) + (Number(req.body.valor_extra) || 0), forma_pagamento, '', null);
  res.status(201).json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/clientes/:id', auth, (req, res) => {
  const { nome_empresa, nome_contato, telefone, valor_servico, data_entrega, valor_mensais, data_vencimento, status, observacoes, pagamento_confirmado,
    cnpj_cpf, segmento, porte, website, cep, endereco, numero, bairro, cidade, uf, contato_cargo, whatsapp, email, forma_pagamento } = req.body || {};
  const anterior = db.prepare('SELECT pagamento_confirmado FROM clientes WHERE id=?').get(req.params.id);
  const estavaConfirmado = !!(anterior && anterior.pagamento_confirmado);
  const ciclo = avancarCicloSeConfirmado(estavaConfirmado, !!pagamento_confirmado, data_vencimento || null);
  db.prepare(`
    UPDATE clientes
    SET nome_empresa=?, nome_contato=?, telefone=?, valor_servico=?, data_entrega=?, valor_mensais=?, valor_extra=?, motivo_extra=?, data_vencimento=?, pagamento_confirmado=?, status=?, observacoes=?,
      cnpj_cpf=?, segmento=?, porte=?, website=?, cep=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, contato_cargo=?, whatsapp=?, email=?, forma_pagamento=?
    WHERE id=?
  `).run(nome_empresa, nome_contato || '', telefone || '', Number(valor_servico) || 0, data_entrega || null, Number(valor_mensais) || 0, Number(req.body.valor_extra) || 0, req.body.motivo_extra || '', ciclo.dataVencimento, ciclo.pagamentoConfirmado, status, observacoes || '',
    cnpj_cpf || '', segmento || '', porte || '', website || '', cep || '', endereco || '', numero || '', bairro || '', cidade || '', uf || '', contato_cargo || '', whatsapp || '', email || '', forma_pagamento || '', req.params.id);
  sincronizarPagamento(Number(req.params.id), !!pagamento_confirmado, (Number(valor_mensais) || 0) + (Number(req.body.valor_extra) || 0), forma_pagamento, '', null);
  res.json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id));
});

// Registro rápido de pagamento a partir do módulo Financeiro (sem precisar reenviar o formulário completo)
app.post('/api/clientes/:id/pagar', auth, (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id=?').get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });

  const { forma_pagamento, comprovante, data_pagamento } = req.body || {};

  // pagamento_confirmado é resetado para 0 assim que o ciclo avança (ver avancarCicloSeConfirmado),
  // então não serve para detectar clique duplicado — checamos se já existe registro no mês do pagamento.
  const mesDoPagamento = data_pagamento ? data_pagamento.substring(0, 7) : mesAtual();
  const jaPagoEsteMes = db.prepare('SELECT id FROM pagamentos WHERE cliente_id=? AND mes_referencia=?').get(cliente.id, mesDoPagamento);
  if (jaPagoEsteMes) return res.status(400).json({ error: 'Pagamento já registrado neste mês' });

  const formaFinal = forma_pagamento || cliente.forma_pagamento || '';
  const valorTotal = (cliente.valor_mensais || 0) + (cliente.valor_extra || 0);
  const ciclo = avancarCicloSeConfirmado(false, true, cliente.data_vencimento);

  db.prepare('UPDATE clientes SET data_vencimento=?, pagamento_confirmado=?, forma_pagamento=? WHERE id=?')
    .run(ciclo.dataVencimento, ciclo.pagamentoConfirmado, formaFinal, cliente.id);
  sincronizarPagamento(cliente.id, true, valorTotal, formaFinal, comprovante || '', data_pagamento || null);

  res.json(db.prepare('SELECT * FROM clientes WHERE id=?').get(cliente.id));
});

app.get('/api/clientes/:id/pagamentos', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM pagamentos WHERE cliente_id=? ORDER BY mes_referencia DESC, data_pagamento DESC').all(req.params.id));
});

app.get('/api/relatorio', auth, (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : mesAtual();
  const pagamentos = db.prepare(`
    SELECT p.id, p.valor, p.criado_em, c.nome_empresa
    FROM pagamentos p
    JOIN clientes c ON c.id = p.cliente_id
    WHERE p.mes_referencia = ?
    ORDER BY c.nome_empresa
  `).all(mes);
  const total = pagamentos.reduce((s, p) => s + p.valor, 0);
  res.json({ mes, total, pagamentos });
});

// Visão consolidada do módulo Financeiro: cobranças do ciclo atual + histórico do mês selecionado
app.get('/api/financeiro', auth, (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : mesAtual();
  const hoje = hojeStr();

  const historico = db.prepare(`
    SELECT p.id, p.cliente_id, p.valor, p.mes_referencia, p.forma_pagamento, p.comprovante, p.data_pagamento, p.criado_em, c.nome_empresa
    FROM pagamentos p JOIN clientes c ON c.id = p.cliente_id
    WHERE p.mes_referencia = ?
    ORDER BY p.data_pagamento DESC, c.nome_empresa
  `).all(mes);
  const pagosPorCliente = {};
  historico.forEach(p => { pagosPorCliente[p.cliente_id] = p; });

  const clientesRecorrentes = db.prepare('SELECT * FROM clientes WHERE valor_mensais > 0 OR valor_extra > 0').all();

  // O status "pago" é determinado pela existência de um registro em `pagamentos` para o mês
  // consultado — não pelo boolean `pagamento_confirmado`, que é resetado assim que o ciclo
  // avança para o próximo mês (ver avancarCicloSeConfirmado) e por isso não reflete o mês passado.
  const cobrancas = clientesRecorrentes.map(c => {
    const valor = (c.valor_mensais || 0) + (c.valor_extra || 0);
    const pago = pagosPorCliente[c.id];
    let status = 'pendente';
    if (pago) status = 'pago';
    else if (c.data_vencimento && c.data_vencimento < hoje) status = 'atrasado';
    return {
      id: c.id,
      nome_empresa: c.nome_empresa,
      valor,
      data_vencimento: c.data_vencimento,
      status,
      forma_pagamento: pago ? pago.forma_pagamento : c.forma_pagamento,
      pagamento_confirmado: !!pago,
      data_pagamento: pago ? pago.data_pagamento : null,
      comprovante: pago ? pago.comprovante : null
    };
  });

  const total_pendente = cobrancas.filter(c => c.status !== 'pago').reduce((s, c) => s + c.valor, 0);
  const total_atrasado = cobrancas.filter(c => c.status === 'atrasado').reduce((s, c) => s + c.valor, 0);

  const total_recebido = historico.reduce((s, p) => s + p.valor, 0);
  const receita_projetos = db.prepare(
    "SELECT COALESCE(SUM(valor_servico), 0) AS total FROM clientes WHERE data_entrega LIKE ?"
  ).get(mes + '%').total;

  res.json({
    mes,
    overview: {
      total_recebido,
      receita_projetos_mes: receita_projetos,
      receita_total_mes: total_recebido + receita_projetos,
      total_pendente,
      total_atrasado
    },
    cobrancas,
    historico
  });
});

app.delete('/api/clientes/:id', auth, (req, res) => {
  db.prepare('DELETE FROM pagamentos WHERE cliente_id = ?').run(req.params.id);
  db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`CRM The Carvalhos Barbearia rodando na porta ${PORT}`));
