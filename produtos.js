// routes/produtos.js — cadastro de produtos com preço padrão (sabores de pizza,
// bebidas, adicionais). Usado para auto-preencher o valor no PDV, evitando
// digitação manual de preço a cada venda.
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM produtos ORDER BY categoria, nome').all());
});

// POST /api/produtos { categoria, nome, preco } — cria ou atualiza o preço (upsert por categoria+nome)
router.post('/', (req, res) => {
  const { categoria, nome, preco } = req.body;
  const categoriaValida = db.prepare('SELECT 1 FROM categorias_item WHERE nome = ?').get(categoria);
  if (!categoriaValida) return res.status(400).json({ erro: 'Categoria inválida. Cadastre-a antes em "Categorias".' });
  if (!nome) return res.status(400).json({ erro: 'Informe o nome do produto.' });
  db.prepare(`
    INSERT INTO produtos (categoria, nome, preco) VALUES (?,?,?)
    ON CONFLICT(categoria, nome) DO UPDATE SET preco = excluded.preco
  `).run(categoria, nome, Number(preco) || 0);
  res.status(201).json(db.prepare('SELECT * FROM produtos WHERE categoria=? AND nome=?').get(categoria, nome));
});

// DELETE /api/produtos/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM produtos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
