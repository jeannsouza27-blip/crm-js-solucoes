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
  const { nome_empresa, nome_contato, telefone, valor_servico, data_entrega, valor_mensais, data_vencimento, status, observacoes, pagamento_confirmado } = req.body || {};
  if (!nome_empresa) return res.status(400).json({ error: 'Nome da empresa obrigatório' });
  const r = db.prepare(`
    INSERT INTO clientes (nome_empresa, nome_contato, telefone, valor_servico, data_entrega, valor_mensais, valor_extra, motivo_extra, data_vencimento, pagamento_confirmado, status, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nome_empresa, nome_contato || '', telefone || '', Number(valor_servico) || 0, data_entrega || null, Number(valor_mensais) || 0, Number(req.body.valor_extra) || 0, req.body.motivo_extra || '', data_vencimento || null, pagamento_confirmado ? 1 : 0, status || 'ativo', observacoes || '');
  res.status(201).json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/clientes/:id', auth, (req, res) => {
  const { nome_empresa, nome_contato, telefone, valor_servico, data_entrega, valor_mensais, data_vencimento, status, observacoes, pagamento_confirmado } = req.body || {};
  db.prepare(`
    UPDATE clientes
    SET nome_empresa=?, nome_contato=?, telefone=?, valor_servico=?, data_entrega=?, valor_mensais=?, valor_extra=?, motivo_extra=?, data_vencimento=?, pagamento_confirmado=?, status=?, observacoes=?
    WHERE id=?
  `).run(nome_empresa, nome_contato || '', telefone || '', Number(valor_servico) || 0, data_entrega || null, Number(valor_mensais) || 0, Number(req.body.valor_extra) || 0, req.body.motivo_extra || '', data_vencimento || null, pagamento_confirmado ? 1 : 0, status, observacoes || '', req.params.id);
  res.json(db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id));
});

app.delete('/api/clientes/:id', auth, (req, res) => {
  db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`CRM JS Soluções rodando na porta ${PORT}`));
