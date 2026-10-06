// routes/caixasimples.js — registro rápido e independente de caixa, só para
// acompanhamento manual (não puxa vendas do PDV nem mexe em estoque/caixa oficial).
const express = require('express');
const db = require('../db');
const router = express.Router();

function serializeRegistro(r) {
  const pagamentos = db.prepare('SELECT * FROM caixa_simples_pagamentos WHERE caixa_simples_id = ? ORDER BY id').all(r.id);
  const somaPagamentos = pagamentos.reduce((s, p) => s + p.valor, 0);
  const esperado = r.abertura + r.vendas_dinheiro - somaPagamentos;
  const diferenca = r.fechamento - esperado;
  return { ...r, pagamentos, somaPagamentos, esperado, diferenca };
}

// GET /api/caixa-simples?data=YYYY-MM-DD (opcional, filtra por um dia específico)
router.get('/', (req, res) => {
  const { data } = req.query;
  const rows = data
    ? db.prepare('SELECT * FROM caixa_simples WHERE data = ? ORDER BY criado_em DESC').all(data)
    : db.prepare('SELECT * FROM caixa_simples ORDER BY data DESC, criado_em DESC LIMIT 200').all();
  res.json(rows.map(serializeRegistro));
});

// POST /api/caixa-simples { data, abertura, vendasDinheiro, fechamento, observacao, pagamentos:[{motivo,valor}] }
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.data) return res.status(400).json({ erro: 'Informe a data.' });
  const pagamentos = Array.isArray(b.pagamentos) ? b.pagamentos.filter(p => p.motivo || p.valor) : [];

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO caixa_simples (data, abertura, vendas_dinheiro, fechamento, observacao)
      VALUES (?,?,?,?,?)
    `).run(b.data, Number(b.abertura) || 0, Number(b.vendasDinheiro) || 0, Number(b.fechamento) || 0, b.observacao || '');
    const id = info.lastInsertRowid;
    const insertPag = db.prepare('INSERT INTO caixa_simples_pagamentos (caixa_simples_id, motivo, valor) VALUES (?,?,?)');
    for (const p of pagamentos) insertPag.run(id, p.motivo || '', Number(p.valor) || 0);
    return id;
  });

  const id = tx();
  res.status(201).json(serializeRegistro(db.prepare('SELECT * FROM caixa_simples WHERE id=?').get(id)));
});

// PUT /api/caixa-simples/:id — edita um registro (substitui os pagamentos)
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM caixa_simples WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ erro: 'Registro não encontrado.' });
  const b = req.body;
  const pagamentos = Array.isArray(b.pagamentos) ? b.pagamentos.filter(p => p.motivo || p.valor) : [];

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE caixa_simples SET data=?, abertura=?, vendas_dinheiro=?, fechamento=?, observacao=? WHERE id=?
    `).run(
      b.data ?? existing.data, Number(b.abertura ?? existing.abertura), Number(b.vendasDinheiro ?? existing.vendas_dinheiro),
      Number(b.fechamento ?? existing.fechamento), b.observacao ?? existing.observacao, req.params.id
    );
    db.prepare('DELETE FROM caixa_simples_pagamentos WHERE caixa_simples_id=?').run(req.params.id);
    const insertPag = db.prepare('INSERT INTO caixa_simples_pagamentos (caixa_simples_id, motivo, valor) VALUES (?,?,?)');
    for (const p of pagamentos) insertPag.run(req.params.id, p.motivo || '', Number(p.valor) || 0);
  });
  tx();

  res.json(serializeRegistro(db.prepare('SELECT * FROM caixa_simples WHERE id=?').get(req.params.id)));
});

// DELETE /api/caixa-simples/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM caixa_simples WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
