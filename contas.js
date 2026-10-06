// routes/contas.js — financeiro: contas a pagar e a receber.
const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/contas?tipo=pagar|receber
router.get('/', (req, res) => {
  const { tipo } = req.query;
  const rows = tipo
    ? db.prepare('SELECT * FROM contas WHERE tipo=? ORDER BY vencimento').all(tipo)
    : db.prepare('SELECT * FROM contas ORDER BY vencimento').all();
  res.json(rows);
});

// POST /api/contas { tipo, descricao, categoria, vencimento, valor }
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.tipo || !b.descricao || !(Number(b.valor) > 0)) {
    return res.status(400).json({ erro: 'Informe tipo, descrição e valor.' });
  }
  const info = db.prepare(`
    INSERT INTO contas (tipo, descricao, categoria, vencimento, valor) VALUES (?,?,?,?,?)
  `).run(b.tipo, b.descricao, b.categoria || '', b.vencimento || null, Number(b.valor));
  res.status(201).json(db.prepare('SELECT * FROM contas WHERE id=?').get(info.lastInsertRowid));
});

// POST /api/contas/:id/baixar { pagoViaSangria, sessaoId }  — marca como Pago/Recebido
router.post('/:id/baixar', (req, res) => {
  const conta = db.prepare('SELECT * FROM contas WHERE id=?').get(req.params.id);
  if (!conta) return res.status(404).json({ erro: 'Conta não encontrada.' });
  const novoStatus = conta.tipo === 'pagar' ? 'Pago' : 'Recebido';

  const tx = db.transaction(() => {
    db.prepare(`UPDATE contas SET status=?, pago_via_sangria=?, data_pagamento=datetime('now') WHERE id=?`)
      .run(novoStatus, req.body.pagoViaSangria ? 1 : 0, req.params.id);

    if (req.body.pagoViaSangria && conta.tipo === 'pagar') {
      const sessao = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto' ORDER BY id DESC LIMIT 1`).get();
      if (sessao) {
        db.prepare(`INSERT INTO movimentos_caixa (sessao_id, tipo, motivo, valor) VALUES (?,?,?,?)`)
          .run(sessao.id, 'Sangria', 'Pagamento: ' + conta.descricao, conta.valor);
      }
    }
  });
  tx();
  res.json(db.prepare('SELECT * FROM contas WHERE id=?').get(req.params.id));
});

module.exports = router;
