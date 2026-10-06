// routes/fichas.js — ficha técnica: quanto de cada insumo um produto consome por unidade.
// Usado para baixar estoque automaticamente quando uma pizza é vendida.
const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/fichas  -> agrupado por produto
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM ficha_tecnica ORDER BY produto, insumo').all();
  const grouped = {};
  rows.forEach(r => {
    if (!grouped[r.produto]) grouped[r.produto] = [];
    grouped[r.produto].push(r);
  });
  res.json(grouped);
});

// POST /api/fichas { produto, itens: [{insumo, quantidadePorUnidade, unidade}] }
// Substitui a ficha técnica inteira daquele produto.
router.post('/', (req, res) => {
  const { produto, itens } = req.body;
  if (!produto || !Array.isArray(itens)) return res.status(400).json({ erro: 'Informe o produto e os itens da ficha técnica.' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ficha_tecnica WHERE produto=?').run(produto);
    const insert = db.prepare('INSERT INTO ficha_tecnica (produto, insumo, quantidade_por_unidade, unidade) VALUES (?,?,?,?)');
    for (const it of itens) {
      if (!it.insumo || !(Number(it.quantidadePorUnidade) > 0)) continue;
      insert.run(produto, it.insumo, Number(it.quantidadePorUnidade), it.unidade || 'g');
    }
  });
  tx();
  res.status(201).json(db.prepare('SELECT * FROM ficha_tecnica WHERE produto=?').all(produto));
});

// DELETE /api/fichas/:produto
router.delete('/:produto', (req, res) => {
  db.prepare('DELETE FROM ficha_tecnica WHERE produto=?').run(req.params.produto);
  res.json({ ok: true });
});

module.exports = router;
