// Regressão: restart do servidor não pode criar pagamento que não aconteceu.
// Sobe o server.js real duas vezes contra o mesmo banco temporário, com dados fictícios.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = 3000 + Math.floor(Math.random() * 1000) + 6000;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-teste-'));
const DB_PATH = path.join(TMP, 'teste.db');

async function subirServidor() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DB_PATH, PORT: String(PORT), JWT_SECRET: 'teste', ADMIN_USER: 'teste', ADMIN_PASS: 'teste123' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE + '/api/config/publico'); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  return srv;
}

async function derrubarServidor(srv) {
  const saiu = new Promise(r => srv.once('exit', r));
  srv.kill();
  await saiu;
}

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('restart em mês novo não cria pagamento para cliente com pagamento_confirmado = 1', async () => {
  let srv = await subirServidor();
  const { token } = await (await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'teste', senha: 'teste123' })
  })).json();
  // Sem vencimento o ciclo não avança e a flag fica gravada como 1: é o alvo do backfill
  const c = await (await fetch(BASE + '/api/clientes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nome_empresa: 'Ficticia Backfill', valor_mensais: 300, forma_pagamento: 'Boleto', pagamento_confirmado: true })
  })).json();
  assert.equal(c.pagamento_confirmado, 1);
  await derrubarServidor(srv);

  // Simula a virada do mês: o cliente continua com flag = 1 e não tem registro no mês corrente
  const db = new Database(DB_PATH);
  db.prepare('DELETE FROM pagamentos WHERE cliente_id = ?').run(c.id);
  db.close();

  srv = await subirServidor();
  await derrubarServidor(srv);

  const db2 = new Database(DB_PATH, { readonly: true });
  const n = db2.prepare('SELECT COUNT(*) AS n FROM pagamentos WHERE cliente_id = ?').get(c.id).n;
  db2.close();
  assert.equal(n, 0, 'o boot criou um pagamento que não aconteceu');
});
