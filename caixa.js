// routes/caixa.js — abertura, sangrias/suprimentos e fechamento de caixa.
const express = require('express');
const db = require('../db');
const router = express.Router();

function sessaoResumo(sessao) {
  const vendasDinheiro = db.prepare(`
    SELECT COALESCE(SUM(pp.valor),0) AS v FROM pagamentos_pedido pp
    JOIN pedidos p ON p.id = pp.pedido_id
    WHERE p.sessao_id = ? AND p.status != 'Cancelado' AND pp.forma = 'Dinheiro'
  `).get(sessao.id).v;
  const sangrias = db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM movimentos_caixa WHERE sessao_id=? AND tipo='Sangria'`).get(sessao.id).v;
  const suprimentos = db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM movimentos_caixa WHERE sessao_id=? AND tipo='Suprimento'`).get(sessao.id).v;
  const esperado = sessao.fundo_inicial + vendasDinheiro + suprimentos - sangrias;
  const movimentos = db.prepare(`SELECT * FROM movimentos_caixa WHERE sessao_id=? ORDER BY criado_em DESC`).all(sessao.id);

  const categoriasPizza = db.prepare(`SELECT nome, fracao FROM categorias_item WHERE tipo='pizza'`).all();
  let qtdPizzas = 0;
  if (categoriasPizza.length) {
    const phCat = categoriasPizza.map(() => '?').join(',');
    const fracaoPorCategoria = {};
    categoriasPizza.forEach(c => { fracaoPorCategoria[c.nome] = c.fracao; });
    const itensPizza = db.prepare(`
      SELECT ip.categoria, ip.quantidade FROM itens_pedido ip
      JOIN pedidos p ON p.id = ip.pedido_id
      WHERE p.sessao_id = ? AND p.status != 'Cancelado' AND ip.categoria IN (${phCat})
    `).all(sessao.id, ...categoriasPizza.map(c => c.nome));
    qtdPizzas = itensPizza.reduce((s, it) => s + (fracaoPorCategoria[it.categoria] ?? 1) * it.quantidade, 0);
  }
  const totalPedidos = db.prepare(`SELECT COUNT(*) n FROM pedidos WHERE sessao_id=? AND status != 'Cancelado'`).get(sessao.id).n;
  const faturamento = db.prepare(`SELECT COALESCE(SUM(total),0) v FROM pedidos WHERE sessao_id=? AND status != 'Cancelado'`).get(sessao.id).v;

  return { ...sessao, vendasDinheiro, sangrias, suprimentos, esperado, movimentos, qtdPizzas, totalPedidos, faturamento };
}

// GET /api/caixa/atual — sessão aberta, se houver
router.get('/atual', (req, res) => {
  const sessao = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto' ORDER BY id DESC LIMIT 1`).get();
  if (!sessao) return res.json(null);
  res.json(sessaoResumo(sessao));
});

// POST /api/caixa/abrir { operador, fundoInicial, data? }
// "data" (YYYY-MM-DD) é opcional — usada para lançar um caixa com data retroativa
// (útil pra quem faz o fechamento/conferência dias depois da venda real).
// Quando informada, o fechamento desse caixa também usa essa mesma data,
// mantendo abertura e fechamento no mesmo dia no histórico.
router.post('/abrir', (req, res) => {
  const aberta = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto'`).get();
  if (aberta) return res.status(400).json({ erro: 'Já existe um caixa aberto.' });
  const { operador, fundoInicial, data } = req.body;
  if (!operador) return res.status(400).json({ erro: 'Informe o operador.' });

  let abertoEm = null; // null deixa o SQLite usar datetime('now') via DEFAULT
  let dataReferencia = null;
  if (data) {
    dataReferencia = data;
    abertoEm = `${data}T11:00:00.000Z`; // 08:00 no horário de Brasília
  }

  const info = abertoEm
    ? db.prepare(`INSERT INTO caixa_sessoes (operador, fundo_inicial, aberto_em, data_referencia) VALUES (?,?,?,?)`)
        .run(operador, Number(fundoInicial) || 0, abertoEm, dataReferencia)
    : db.prepare(`INSERT INTO caixa_sessoes (operador, fundo_inicial) VALUES (?,?)`)
        .run(operador, Number(fundoInicial) || 0);

  res.status(201).json(sessaoResumo(db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(info.lastInsertRowid)));
});

// POST /api/caixa/movimento { tipo, motivo, valor }
router.post('/movimento', (req, res) => {
  const sessao = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto' ORDER BY id DESC LIMIT 1`).get();
  if (!sessao) return res.status(400).json({ erro: 'Nenhum caixa aberto.' });
  const { tipo, motivo, valor } = req.body;
  if (!['Sangria', 'Suprimento'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  if (!(Number(valor) > 0)) return res.status(400).json({ erro: 'Valor inválido.' });
  db.prepare(`INSERT INTO movimentos_caixa (sessao_id, tipo, motivo, valor) VALUES (?,?,?,?)`).run(sessao.id, tipo, motivo || '', Number(valor));
  res.status(201).json(sessaoResumo(db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(sessao.id)));
});

// POST /api/caixa/fechar { valorContado }
router.post('/fechar', (req, res) => {
  const sessao = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto' ORDER BY id DESC LIMIT 1`).get();
  if (!sessao) return res.status(400).json({ erro: 'Nenhum caixa aberto.' });
  const resumo = sessaoResumo(sessao);
  const valorContado = Number(req.body.valorContado) || 0;
  // Se o caixa foi aberto com data retroativa, o fechamento usa essa mesma data
  // (20:30 no horário de Brasília), em vez do momento real em que você está mexendo no sistema.
  const fechadoEm = sessao.data_referencia ? `${sessao.data_referencia}T23:30:00.000Z` : null;
  if (fechadoEm) {
    db.prepare(`UPDATE caixa_sessoes SET status='fechado', fechado_em=?, valor_contado=? WHERE id=?`).run(fechadoEm, valorContado, sessao.id);
  } else {
    db.prepare(`UPDATE caixa_sessoes SET status='fechado', fechado_em=datetime('now'), valor_contado=? WHERE id=?`).run(valorContado, sessao.id);
  }
  res.json({ ...resumo, valorContado, diferenca: valorContado - resumo.esperado });
});

// GET /api/caixa/historico?data=YYYY-MM-DD  — sessões fechadas, opcionalmente filtradas por dia
router.get('/historico', (req, res) => {
  const { data } = req.query;
  const rows = data
    ? db.prepare(`SELECT * FROM caixa_sessoes WHERE status='fechado' AND date(fechado_em)=date(?) ORDER BY fechado_em DESC`).all(data)
    : db.prepare(`SELECT * FROM caixa_sessoes WHERE status='fechado' ORDER BY fechado_em DESC LIMIT 60`).all();
  res.json(rows.map(sessaoResumo));
});

// GET /api/caixa/:id/relatorio — dados completos para (re)imprimir o relatório daquela sessão
router.get('/:id/relatorio', (req, res) => {
  const sessao = db.prepare(`SELECT * FROM caixa_sessoes WHERE id=?`).get(req.params.id);
  if (!sessao) return res.status(404).json({ erro: 'Sessão de caixa não encontrada.' });
  const resumo = sessaoResumo(sessao);
  const pedidos = db.prepare(`SELECT * FROM pedidos WHERE sessao_id=?`).all(sessao.id);
  const pedidosComItens = pedidos.map(p => ({
    ...p, itens: db.prepare('SELECT * FROM itens_pedido WHERE pedido_id=?').all(p.id)
  }));
  res.json({ ...resumo, pedidos: pedidosComItens });
});

// PUT /api/caixa/atual { operador, fundoInicial, data? } — edita o caixa aberto atualmente
router.put('/atual', (req, res) => {
  const sessao = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto' ORDER BY id DESC LIMIT 1`).get();
  if (!sessao) return res.status(400).json({ erro: 'Nenhum caixa aberto.' });
  const { operador, fundoInicial, data } = req.body;
  if (!operador) return res.status(400).json({ erro: 'Informe o operador.' });

  if (data) {
    db.prepare(`UPDATE caixa_sessoes SET operador=?, fundo_inicial=?, aberto_em=?, data_referencia=? WHERE id=?`)
      .run(operador, Number(fundoInicial) || 0, `${data}T11:00:00.000Z`, data, sessao.id);
  } else {
    db.prepare(`UPDATE caixa_sessoes SET operador=?, fundo_inicial=? WHERE id=?`).run(operador, Number(fundoInicial) || 0, sessao.id);
  }
  res.json(sessaoResumo(db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(sessao.id)));
});

// PUT /api/caixa/movimento/:id { tipo, motivo, valor } — corrige uma sangria/suprimento lançada
router.put('/movimento/:id', (req, res) => {
  const mov = db.prepare('SELECT * FROM movimentos_caixa WHERE id=?').get(req.params.id);
  if (!mov) return res.status(404).json({ erro: 'Movimentação não encontrada.' });
  const { tipo, motivo, valor } = req.body;
  if (!['Sangria', 'Suprimento'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });
  if (!(Number(valor) > 0)) return res.status(400).json({ erro: 'Valor inválido.' });
  db.prepare(`UPDATE movimentos_caixa SET tipo=?, motivo=?, valor=? WHERE id=?`).run(tipo, motivo || '', Number(valor), req.params.id);
  const sessao = db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(mov.sessao_id);
  res.json(sessaoResumo(sessao));
});

// DELETE /api/caixa/movimento/:id — remove uma sangria/suprimento lançada por engano
router.delete('/movimento/:id', (req, res) => {
  const mov = db.prepare('SELECT * FROM movimentos_caixa WHERE id=?').get(req.params.id);
  if (!mov) return res.status(404).json({ erro: 'Movimentação não encontrada.' });
  db.prepare('DELETE FROM movimentos_caixa WHERE id=?').run(req.params.id);
  const sessao = db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(mov.sessao_id);
  res.json(sessaoResumo(sessao));
});

// POST /api/caixa/:id/reabrir — reabre um caixa fechado por engano (só se não houver outro caixa aberto)
router.post('/:id/reabrir', (req, res) => {
  const aberta = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto'`).get();
  if (aberta) return res.status(400).json({ erro: 'Já existe um caixa aberto. Feche-o antes de reabrir outro.' });
  const sessao = db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(req.params.id);
  if (!sessao) return res.status(404).json({ erro: 'Sessão de caixa não encontrada.' });
  if (sessao.status !== 'fechado') return res.status(400).json({ erro: 'Essa sessão não está fechada.' });
  db.prepare(`UPDATE caixa_sessoes SET status='aberto', fechado_em=NULL, valor_contado=NULL WHERE id=?`).run(sessao.id);
  res.json(sessaoResumo(db.prepare('SELECT * FROM caixa_sessoes WHERE id=?').get(sessao.id)));
});

module.exports = router;
