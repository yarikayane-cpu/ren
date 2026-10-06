// routes/estoque.js — cadastro simples de insumos (bebidas, mussarela, etc.)
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM estoque ORDER BY insumo').all();
  res.json(rows.map(r => ({ ...r, alerta: r.estoque_atual <= r.estoque_minimo })));
});

// POST /api/estoque { insumo, unidade, estoqueMinimo, estoqueAtual }
router.post('/', (req, res) => {
  const { insumo, unidade, estoqueMinimo, estoqueAtual } = req.body;
  if (!insumo) return res.status(400).json({ erro: 'Informe o nome do insumo.' });
  db.prepare(`
    INSERT INTO estoque (insumo, unidade, estoque_minimo, estoque_atual)
    VALUES (?,?,?,?)
    ON CONFLICT(insumo) DO UPDATE SET unidade=excluded.unidade, estoque_minimo=excluded.estoque_minimo
  `).run(insumo, unidade || 'un', Number(estoqueMinimo) || 0, Number(estoqueAtual) || 0);
  res.status(201).json(db.prepare('SELECT * FROM estoque WHERE insumo=?').get(insumo));
});

// DELETE /api/estoque/:insumo
router.delete('/:insumo', (req, res) => {
  db.prepare('DELETE FROM estoque WHERE insumo=?').run(req.params.insumo);
  res.json({ ok: true });
});

module.exports = router;

