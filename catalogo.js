// routes/catalogo.js — nomes já cadastrados oficialmente (Ficha Técnica, Produtos
// e Estoque), usados para popular os dropdowns do PDV. Propositalmente NÃO inclui
// o histórico bruto de vendas: assim, um erro de digitação feito uma vez no PDV
// não vira sugestão permanente para as próximas vendas — só o que foi de fato
// cadastrado (com preço, ficha técnica ou insumo) aparece na lista.
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const categoriasPizza = db.prepare(`SELECT nome FROM categorias_item WHERE tipo='pizza'`).all().map(c => c.nome);
  const categoriasConsumo = db.prepare(`SELECT nome FROM categorias_item WHERE tipo='consumo'`).all().map(c => c.nome);

  const phPizza = categoriasPizza.map(() => '?').join(',') || "''";
  const sabores = db.prepare(`
    SELECT produto FROM ficha_tecnica
    UNION
    SELECT nome AS produto FROM produtos WHERE categoria IN (${phPizza})
    ORDER BY produto
  `).all(...categoriasPizza).map(r => r.produto);

  const phConsumo = categoriasConsumo.map(() => '?').join(',') || "''";
  const insumos = db.prepare(`
    SELECT insumo AS produto FROM estoque
    UNION
    SELECT nome AS produto FROM produtos WHERE categoria IN (${phConsumo})
    ORDER BY produto
  `).all(...categoriasConsumo).map(r => r.produto);

  res.json({ sabores, insumos });
});

module.exports = router;
