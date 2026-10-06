// routes/dashboard.js — indicadores agregados por período.
const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/dashboard?inicio=ISO&fim=ISO
router.get('/', (req, res) => {
  const inicio = req.query.inicio || '2000-01-01';
  const fim = req.query.fim || '2100-01-01';

  const base = db.prepare(`
    SELECT * FROM pedidos WHERE data_hora BETWEEN ? AND ? AND status != 'Cancelado'
  `).all(inicio, fim);

  const faturamento = base.reduce((s, o) => s + o.total, 0);
  const totalPedidos = base.length;
  const ticketMedio = totalPedidos ? faturamento / totalPedidos : 0;

  const porPagamento = {};
  for (const p of ['Dinheiro', 'Pix', 'Crédito', 'Débito']) porPagamento[p] = 0;
  if (base.length) {
    const idsPagto = base.map(o => o.id);
    const placeholdersPagto = idsPagto.map(() => '?').join(',');
    const pagamentos = db.prepare(`SELECT forma, valor FROM pagamentos_pedido WHERE pedido_id IN (${placeholdersPagto})`).all(...idsPagto);
    pagamentos.forEach(pg => { porPagamento[pg.forma] = (porPagamento[pg.forma] || 0) + pg.valor; });
  }

  const idsStr = base.map(o => o.id);
  let ranking = [];
  let rankingBebidas = [];
  let totalPizzasVendidas = 0;
  let totalBebidasVendidas = 0;
  const categoriasPizza = db.prepare(`SELECT nome, fracao FROM categorias_item WHERE tipo='pizza'`).all();
  const fracaoPorCategoria = {};
  categoriasPizza.forEach(c => { fracaoPorCategoria[c.nome] = c.fracao; });

  if (idsStr.length && categoriasPizza.length) {
    const placeholders = idsStr.map(() => '?').join(',');
    const placeholdersCat = categoriasPizza.map(() => '?').join(',');
    const itensPizza = db.prepare(`
      SELECT categoria, produto, quantidade FROM itens_pedido
      WHERE pedido_id IN (${placeholders}) AND categoria IN (${placeholdersCat})
    `).all(...idsStr, ...categoriasPizza.map(c => c.nome));
    const counts = {};
    itensPizza.forEach(it => {
      const qtd = (fracaoPorCategoria[it.categoria] ?? 1) * it.quantidade;
      counts[it.produto] = (counts[it.produto] || 0) + qtd;
      totalPizzasVendidas += qtd; // soma TODOS os sabores, não só os que entram no top 10 exibido
    });
    ranking = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([sabor, qtd]) => ({ sabor, qtd }));

    const itensBebida = db.prepare(`
      SELECT produto, quantidade FROM itens_pedido
      WHERE pedido_id IN (${placeholders}) AND categoria = 'Bebida'
    `).all(...idsStr);
    const countsBebida = {};
    itensBebida.forEach(it => {
      countsBebida[it.produto] = (countsBebida[it.produto] || 0) + it.quantidade;
      totalBebidasVendidas += it.quantidade;
    });
    rankingBebidas = Object.entries(countsBebida).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([produto, qtd]) => ({ produto, qtd }));
  }

  const sessaoAberta = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto' ORDER BY id DESC LIMIT 1`).get();
  let saldoGaveta = 0;
  if (sessaoAberta) {
    const vd = db.prepare(`
      SELECT COALESCE(SUM(pp.valor),0) v FROM pagamentos_pedido pp
      JOIN pedidos p ON p.id = pp.pedido_id
      WHERE p.sessao_id=? AND pp.forma='Dinheiro' AND p.status!='Cancelado'
    `).get(sessaoAberta.id).v;
    const sg = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM movimentos_caixa WHERE sessao_id=? AND tipo='Sangria'`).get(sessaoAberta.id).v;
    const sp = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM movimentos_caixa WHERE sessao_id=? AND tipo='Suprimento'`).get(sessaoAberta.id).v;
    saldoGaveta = sessaoAberta.fundo_inicial + vd + sp - sg;
  }

  const estoqueBaixo = db.prepare(`SELECT insumo, estoque_atual, estoque_minimo FROM estoque WHERE estoque_atual <= estoque_minimo`).all();

  const contasPagarPendentes = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM contas WHERE tipo='pagar' AND status='Pendente'`).get().v;
  const contasReceberPendentes = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM contas WHERE tipo='receber' AND status='Pendente'`).get().v;

  res.json({ faturamento, totalPedidos, ticketMedio, saldoGaveta, porPagamento, ranking, rankingBebidas, totalPizzasVendidas, totalBebidasVendidas, estoqueBaixo, contasPagarPendentes, contasReceberPendentes });
});

module.exports = router;
