// routes/relatorio.js — junta faturamento, despesas, equipe e financeiro
// num único payload para o Relatório Gerencial em PDF.
const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const inicio = req.query.inicio || '2000-01-01';
  const fim = req.query.fim || '2100-01-01';
  const inicioData = inicio.slice(0, 10);
  const fimData = fim.slice(0, 10);

  const pedidos = db.prepare(`SELECT * FROM pedidos WHERE data_hora BETWEEN ? AND ? AND status != 'Cancelado'`).all(inicio, fim);
  const faturamento = pedidos.reduce((s, o) => s + o.total, 0);
  const totalPedidos = pedidos.length;
  const ticketMedio = totalPedidos ? faturamento / totalPedidos : 0;

  const porPagamento = { Dinheiro: 0, Pix: 0, 'Crédito': 0, 'Débito': 0 };
  if (pedidos.length) {
    const idsPagto = pedidos.map(o => o.id);
    const phPagto = idsPagto.map(() => '?').join(',');
    const pagamentos = db.prepare(`SELECT forma, valor FROM pagamentos_pedido WHERE pedido_id IN (${phPagto})`).all(...idsPagto);
    pagamentos.forEach(pg => { porPagamento[pg.forma] = (porPagamento[pg.forma] || 0) + pg.valor; });
  }

  const ids = pedidos.map(o => o.id);
  let ranking = [], rankingBebidas = [];
  const categoriasPizza = db.prepare(`SELECT nome, fracao FROM categorias_item WHERE tipo='pizza'`).all();
  const fracaoPorCategoria = {};
  categoriasPizza.forEach(c => { fracaoPorCategoria[c.nome] = c.fracao; });

  if (ids.length && categoriasPizza.length) {
    const ph = ids.map(() => '?').join(',');
    const phCat = categoriasPizza.map(() => '?').join(',');
    const itensPizza = db.prepare(`SELECT categoria, produto, quantidade FROM itens_pedido WHERE pedido_id IN (${ph}) AND categoria IN (${phCat})`).all(...ids, ...categoriasPizza.map(c => c.nome));
    const c1 = {};
    itensPizza.forEach(it => { const q = (fracaoPorCategoria[it.categoria] ?? 1) * it.quantidade; c1[it.produto] = (c1[it.produto] || 0) + q; });
    ranking = Object.entries(c1).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([sabor, qtd]) => ({ sabor, qtd }));

    const itensBeb = db.prepare(`SELECT produto, quantidade FROM itens_pedido WHERE pedido_id IN (${ph}) AND categoria='Bebida'`).all(...ids);
    const c2 = {};
    itensBeb.forEach(it => { c2[it.produto] = (c2[it.produto] || 0) + it.quantidade; });
    rankingBebidas = Object.entries(c2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([produto, qtd]) => ({ produto, qtd }));
  }

  const despesasCompras = db.prepare(`SELECT COALESCE(SUM(valor_total),0) v FROM compras WHERE data BETWEEN ? AND ?`).get(inicioData, fimData).v;
  const despesasContas = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM contas WHERE tipo='pagar' AND status='Pago' AND data_pagamento BETWEEN ? AND ?`).get(inicio, fim).v;
  const despesasEquipe = db.prepare(`SELECT COALESCE(SUM(valor+taxas_extras),0) v FROM pagamentos_equipe WHERE data BETWEEN ? AND ?`).get(inicioData, fimData).v;
  const totalDespesas = despesasCompras + despesasContas + despesasEquipe;
  const lucroEstimado = faturamento - totalDespesas;

  const contasPagarPendentes = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM contas WHERE tipo='pagar' AND status='Pendente'`).get().v;
  const contasReceberPendentes = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM contas WHERE tipo='receber' AND status='Pendente'`).get().v;
  const estoqueBaixo = db.prepare(`SELECT insumo, estoque_atual, estoque_minimo, unidade FROM estoque WHERE estoque_atual <= estoque_minimo`).all();

  const pagamentosEquipe = db.prepare(`
    SELECT pe.*, e.nome, e.funcao, e.tipo FROM pagamentos_equipe pe
    JOIN equipe e ON e.id = pe.equipe_id
    WHERE pe.data BETWEEN ? AND ?
    ORDER BY pe.data DESC
  `).all(inicioData, fimData);

  res.json({
    periodo: { inicio, fim },
    faturamento, totalPedidos, ticketMedio, porPagamento, ranking, rankingBebidas,
    despesasCompras, despesasContas, despesasEquipe, totalDespesas, lucroEstimado,
    contasPagarPendentes, contasReceberPendentes, estoqueBaixo, pagamentosEquipe
  });
});

module.exports = router;
