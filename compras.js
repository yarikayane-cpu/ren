// routes/compras.js — lançamento de notas de compra. Cada compra atualiza
// automaticamente o estoque (entrada) e o custo médio do insumo.
const express = require('express');
const db = require('../db');
const router = express.Router();

function upsertEstoqueInsumo(insumo, unidade) {
  const exists = db.prepare('SELECT 1 FROM estoque WHERE insumo=?').get(insumo);
  if (!exists) {
    db.prepare('INSERT INTO estoque (insumo, unidade, estoque_minimo, estoque_atual) VALUES (?,?,0,0)').run(insumo, unidade || 'un');
  }
}

// GET /api/compras?limite=
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM compras ORDER BY data DESC, id DESC LIMIT ?').all(Number(req.query.limite) || 200);
  res.json(rows);
});

// POST /api/compras { data, fornecedor, formaPagamento, nota, insumo, quantidade, unidade, valorUnitario }
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.insumo || !(Number(b.quantidade) > 0)) {
    return res.status(400).json({ erro: 'Informe o insumo e a quantidade.' });
  }
  const quantidade = Number(b.quantidade);
  const valorUnitario = Number(b.valorUnitario) || 0;
  const valorTotal = quantidade * valorUnitario;
  const data = b.data || new Date().toISOString().slice(0, 10);

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO compras (data, fornecedor, forma_pagamento, nota, insumo, quantidade, unidade, valor_unitario, valor_total)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(data, b.fornecedor || '', b.formaPagamento || '', b.nota || '', b.insumo, quantidade, b.unidade || 'un', valorUnitario, valorTotal);

    upsertEstoqueInsumo(b.insumo, b.unidade);
    const item = db.prepare('SELECT * FROM estoque WHERE insumo=?').get(b.insumo);
    const novoTotalQtd = item.estoque_atual + quantidade;
    const novoCustoMedio = novoTotalQtd > 0
      ? ((item.estoque_atual * item.custo_medio) + (quantidade * valorUnitario)) / novoTotalQtd
      : item.custo_medio;
    db.prepare('UPDATE estoque SET estoque_atual=?, custo_medio=? WHERE insumo=?').run(novoTotalQtd, novoCustoMedio, b.insumo);

    return info.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json(db.prepare('SELECT * FROM compras WHERE id=?').get(id));
});

module.exports = router;
