// routes/categorias.js — cadastro de categorias de item usadas no PDV
// (ex: Pizza Inteira, Bebida, Sobremesa...). tipo='pizza' entra no ranking de
// sabores e consome a ficha técnica na fração indicada; tipo='consumo' baixa
// direto o insumo de mesmo nome no Estoque (como Bebida/Adicional hoje).
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM categorias_item ORDER BY tipo, nome').all());
});

// POST /api/categorias { nome, tipo, fracao }
router.post('/', (req, res) => {
  const { nome, tipo } = req.body;
  let { fracao } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Informe o nome da categoria.' });
  if (!['pizza', 'consumo'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  fracao = tipo === 'pizza' ? (Number(fracao) || 1) : 1;
  if (fracao <= 0 || fracao > 1) return res.status(400).json({ erro: 'A fração deve ser maior que 0 e no máximo 1 (ex: 0.5 para meia, 0.333 para terço).' });

  const existente = db.prepare('SELECT * FROM categorias_item WHERE nome = ?').get(nome);
  if (existente) {
    db.prepare('UPDATE categorias_item SET tipo=?, fracao=? WHERE id=?').run(tipo, fracao, existente.id);
    return res.json(db.prepare('SELECT * FROM categorias_item WHERE id=?').get(existente.id));
  }
  const info = db.prepare('INSERT INTO categorias_item (nome, tipo, fracao) VALUES (?,?,?)').run(nome, tipo, fracao);
  res.status(201).json(db.prepare('SELECT * FROM categorias_item WHERE id=?').get(info.lastInsertRowid));
});

// DELETE /api/categorias/:id — bloqueia se a categoria já foi usada em algum pedido ou produto cadastrado
router.delete('/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categorias_item WHERE id=?').get(req.params.id);
  if (!cat) return res.status(404).json({ erro: 'Categoria não encontrada.' });

  const emUsoPedidos = db.prepare('SELECT COUNT(*) n FROM itens_pedido WHERE categoria=?').get(cat.nome).n;
  const emUsoProdutos = db.prepare('SELECT COUNT(*) n FROM produtos WHERE categoria=?').get(cat.nome).n;
  if (emUsoPedidos > 0 || emUsoProdutos > 0) {
    return res.status(400).json({
      erro: `Não é possível remover: a categoria "${cat.nome}" já está em uso em ${emUsoPedidos} item(ns) de pedido e ${emUsoProdutos} produto(s) cadastrado(s). Deixe de usá-la em novas vendas se não quiser mais oferecê-la — os dados antigos continuam preservados.`
    });
  }

  db.prepare('DELETE FROM categorias_item WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
