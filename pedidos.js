// routes/pedidos.js — PDV: create, list, search, edit, cancel orders.
const express = require('express');
const db = require('../db');
const router = express.Router();

function serializeOrder(o) {
  const itens = db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ?').all(o.id);
  const pagamentos = db.prepare('SELECT * FROM pagamentos_pedido WHERE pedido_id = ?').all(o.id);
  return { ...o, retroativo: !!o.retroativo, itens, pagamentos };
}

const FORMAS_VALIDAS = ['Dinheiro', 'Pix', 'Crédito', 'Débito'];

// Aceita tanto o formato antigo (pagamento + valorPago únicos) quanto o novo
// (pagamentos: [{forma, valor, valorPago}]), sempre retornando uma lista normalizada.
// Lança erro se a soma dos pagamentos não bater com o total do pedido.
function normalizarPagamentos(b, total) {
  let entradas;
  if (Array.isArray(b.pagamentos) && b.pagamentos.length > 0) {
    entradas = b.pagamentos.map(p => ({
      forma: p.forma,
      valor: Number(p.valor) || 0,
      valorPago: p.forma === 'Dinheiro' ? (Number(p.valorPago) || Number(p.valor) || 0) : (Number(p.valor) || 0)
    }));
  } else {
    // formato legado: uma forma só, para pedidos antigos ou chamadas simples de API
    const forma = b.pagamento || 'Pix';
    entradas = [{ forma, valor: total, valorPago: forma === 'Dinheiro' ? (Number(b.valorPago) || total) : total }];
  }

  for (const e of entradas) {
    if (!FORMAS_VALIDAS.includes(e.forma)) throw new Error(`Forma de pagamento inválida: ${e.forma}`);
  }

  const somaValores = entradas.reduce((s, e) => s + e.valor, 0);
  if (Math.abs(somaValores - total) > 0.02) {
    throw new Error(`A soma dos pagamentos (${somaValores.toFixed(2)}) não bate com o total do pedido (${total.toFixed(2)}).`);
  }

  const comTroco = entradas.map(e => ({
    ...e,
    troco: e.forma === 'Dinheiro' ? Math.max(e.valorPago - e.valor, 0) : 0
  }));

  const pagamentoAgregado = comTroco.length > 1 ? 'Dividido' : comTroco[0].forma;
  const valorPagoAgregado = comTroco.reduce((s, e) => s + e.valorPago, 0);
  const trocoAgregado = comTroco.reduce((s, e) => s + e.troco, 0);

  return { entradas: comTroco, pagamentoAgregado, valorPagoAgregado, trocoAgregado };
}

function salvarPagamentos(pedidoId, entradas) {
  db.prepare('DELETE FROM pagamentos_pedido WHERE pedido_id = ?').run(pedidoId);
  const insert = db.prepare('INSERT INTO pagamentos_pedido (pedido_id, forma, valor, valor_pago, troco) VALUES (?,?,?,?,?)');
  for (const e of entradas) insert.run(pedidoId, e.forma, e.valor, e.valorPago, e.troco);
}

function registrarAuditoria(entidadeId, acao, usuario, detalhes) {
  db.prepare(`INSERT INTO auditoria (entidade, entidade_id, acao, usuario, detalhes) VALUES ('pedido', ?, ?, ?, ?)`)
    .run(entidadeId, acao, usuario || 'Desconhecido', detalhes || '');
}

function resumoItens(itens) {
  return itens.map(it => `${it.quantidade}x ${it.produto} (${it.categoria})`).join(', ') || 'sem itens';
}

// Busca os dados de uma categoria de item cadastrada (tipo 'pizza' ou 'consumo', e fração).
function infoCategoria(nome) {
  return db.prepare('SELECT * FROM categorias_item WHERE nome = ?').get(nome);
}

// Ajusta o estoque a partir de uma lista de itens vendidos.
// direcao = -1 para dar baixa (venda nova), +1 para devolver ao estoque (reverter uma venda antiga, ex: ao editar/cancelar).
function ajustarEstoquePorItens(itens, direcao) {
  const deduzir = db.prepare(`UPDATE estoque SET estoque_atual = estoque_atual + ? WHERE insumo = ?`);
  const buscarFicha = db.prepare(`SELECT insumo, quantidade_por_unidade FROM ficha_tecnica WHERE produto = ?`);
  for (const it of itens) {
    const cat = infoCategoria(it.categoria);
    if (!cat) continue; // categoria desconhecida/removida: não sabemos como baixar estoque, ignora com segurança
    if (cat.tipo === 'consumo') {
      deduzir.run(direcao * (Number(it.quantidade) || 0), it.produto);
    } else if (cat.tipo === 'pizza') {
      const qtdEquivalente = cat.fracao * (Number(it.quantidade) || 0);
      const ficha = buscarFicha.all(it.produto);
      for (const ing of ficha) {
        deduzir.run(direcao * ing.quantidade_por_unidade * qtdEquivalente, ing.insumo);
      }
    }
  }
}

// GET /api/pedidos?busca=&limite=&inicio=&fim=  (inicio/fim são ISO datetime, para filtrar por dia)
router.get('/', (req, res) => {
  const { busca, limite, inicio, fim } = req.query;
  const clauses = [];
  const params = [];
  if (busca) {
    clauses.push('(comanda LIKE ? OR cliente LIKE ?)');
    params.push(`%${busca}%`, `%${busca}%`);
  }
  if (inicio && fim) {
    clauses.push('data_hora BETWEEN ? AND ?');
    params.push(inicio, fim);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`SELECT * FROM pedidos ${where} ORDER BY data_hora DESC LIMIT ?`).all(...params, Number(limite) || 200);
  res.json(rows.map(serializeOrder));
});

// GET /api/pedidos/export?busca=&inicio=&fim=  — CSV com uma linha por ITEM (pizza, bebida, adicional)
// Usa os mesmos filtros da listagem, mas sem limite de linhas.
router.get('/export', (req, res) => {
  const { busca, inicio, fim } = req.query;
  const clauses = [];
  const params = [];
  if (busca) {
    clauses.push('(comanda LIKE ? OR cliente LIKE ?)');
    params.push(`%${busca}%`, `%${busca}%`);
  }
  if (inicio && fim) {
    clauses.push('data_hora BETWEEN ? AND ?');
    params.push(inicio, fim);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const pedidos = db.prepare(`SELECT * FROM pedidos ${where} ORDER BY data_hora DESC`).all(...params);

  const escapeCsv = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const header = [
    'ID Pedido', 'Comanda', 'Cliente', 'Canal', 'Data', 'Hora', 'Status',
    'Forma Pagamento', 'Detalhe Pagamentos', 'Frete', 'Total Pedido', 'Operador', 'Retroativo',
    'Categoria Item', 'Produto', 'Quantidade', 'Valor Unitário', 'Valor Total Item'
  ];
  const linhas = [header.join(';')];

  const buscarItens = db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ?');
  const buscarPagamentos = db.prepare('SELECT * FROM pagamentos_pedido WHERE pedido_id = ?');
  for (const p of pedidos) {
    const itens = buscarItens.all(p.id);
    const pagamentos = buscarPagamentos.all(p.id);
    const detalhePagamentos = pagamentos.map(pg => `${pg.forma}: ${pg.valor.toFixed(2)}`).join(' | ');
    const dt = new Date(p.data_hora);
    const dataFmt = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const horaFmt = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    if (itens.length === 0) {
      linhas.push([
        p.id, p.comanda, p.cliente, p.canal, dataFmt, horaFmt, p.status,
        p.pagamento, detalhePagamentos, p.frete, p.total, p.operador, p.retroativo ? 'Sim' : 'Não',
        '', '', '', '', ''
      ].map(escapeCsv).join(';'));
    } else {
      for (const it of itens) {
        linhas.push([
          p.id, p.comanda, p.cliente, p.canal, dataFmt, horaFmt, p.status,
          p.pagamento, detalhePagamentos, p.frete, p.total, p.operador, p.retroativo ? 'Sim' : 'Não',
          it.categoria, it.produto, it.quantidade, it.valor_unitario, (it.quantidade * it.valor_unitario).toFixed(2)
        ].map(escapeCsv).join(';'));
      }
    }
  }

  const csv = '\uFEFF' + linhas.join('\n'); // BOM para o Excel abrir acentos corretamente
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vendas_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

// POST /api/pedidos  { comanda, cliente, canal, itens:[{categoria,produto,quantidade,valorUnitario}], frete,
//                       pagamentos:[{forma,valor,valorPago}]  -- ou, formato antigo: pagamento, valorPago --
//                       retroativo, dataHora, operador, sessaoId }
router.post('/', (req, res) => {
  const b = req.body;
  if (!Array.isArray(b.itens) || b.itens.length === 0) {
    return res.status(400).json({ erro: 'O pedido precisa de ao menos um item.' });
  }
  const subtotal = b.itens.reduce((s, it) => s + (Number(it.quantidade) * Number(it.valorUnitario) || 0), 0);
  const frete = Number(b.frete) || 0;
  const total = subtotal + frete;

  let pagInfo;
  try {
    pagInfo = normalizarPagamentos(b, total);
  } catch (e) {
    return res.status(400).json({ erro: e.message });
  }

  const dataHora = b.dataHora || new Date().toISOString();

  const insertPedido = db.prepare(`
    INSERT INTO pedidos (comanda, cliente, canal, frete, total, pagamento, valor_pago, troco, retroativo, data_hora, operador, sessao_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO itens_pedido (pedido_id, categoria, produto, quantidade, valor_unitario) VALUES (?,?,?,?,?)
  `);

  const tx = db.transaction(() => {
    const info = insertPedido.run(
      b.comanda || null, b.cliente || null, b.canal, frete, total, pagInfo.pagamentoAgregado,
      pagInfo.valorPagoAgregado, pagInfo.trocoAgregado, b.retroativo ? 1 : 0, dataHora, b.operador || null, b.sessaoId || null
    );
    const pedidoId = info.lastInsertRowid;
    for (const it of b.itens) {
      insertItem.run(pedidoId, it.categoria, it.produto, Number(it.quantidade) || 1, Number(it.valorUnitario) || 0);
    }
    ajustarEstoquePorItens(b.itens, -1);
    salvarPagamentos(pedidoId, pagInfo.entradas);
    return pedidoId;
  });

  const pedidoId = tx();
  registrarAuditoria(pedidoId, 'Criado', req.user?.nome, `Pedido criado com ${b.itens.length} item(ns): ${resumoItens(b.itens)}`);
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(pedidoId);
  res.status(201).json(serializeOrder(pedido));
});

// PUT /api/pedidos/:id  (edição: recalcula total a partir dos itens enviados, reajusta estoque e pagamentos)
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (existing.status === 'Cancelado') return res.status(400).json({ erro: 'Pedido cancelado não pode ser editado.' });

  const b = req.body;
  const itensNovos = Array.isArray(b.itens) ? b.itens : null;
  const itensAntigosParaLog = db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ?').all(id);

  const subtotal = (itensNovos || itensAntigosParaLog)
    .reduce((s, it) => s + (Number(it.quantidade) * Number(it.valorUnitario ?? it.valor_unitario) || 0), 0);
  const frete = b.frete != null ? Number(b.frete) : existing.frete;
  const total = subtotal + frete;

  let pagInfo;
  try {
    // Se o corpo não trouxer pagamentos/pagamento novos, mantém a forma antiga do pedido (recalculando contra o novo total).
    const bodyComPagamento = (Array.isArray(b.pagamentos) || b.pagamento) ? b : { ...b, pagamento: existing.pagamento, valorPago: existing.valor_pago };
    pagInfo = normalizarPagamentos(bodyComPagamento, total);
  } catch (e) {
    return res.status(400).json({ erro: e.message });
  }

  const tx = db.transaction(() => {
    if (itensNovos) {
      ajustarEstoquePorItens(itensAntigosParaLog, +1); // devolve ao estoque o que foi baixado antes
      db.prepare('DELETE FROM itens_pedido WHERE pedido_id = ?').run(id);
      const insertItem = db.prepare(`INSERT INTO itens_pedido (pedido_id, categoria, produto, quantidade, valor_unitario) VALUES (?,?,?,?,?)`);
      for (const it of itensNovos) insertItem.run(id, it.categoria, it.produto, Number(it.quantidade) || 1, Number(it.valorUnitario) || 0);
      ajustarEstoquePorItens(itensNovos, -1); // baixa o estoque com os itens novos
    }

    db.prepare(`
      UPDATE pedidos SET comanda=?, cliente=?, canal=?, frete=?, total=?, pagamento=?, valor_pago=?, troco=?, status='Editado', atualizado_em=datetime('now')
      WHERE id=?
    `).run(
      b.comanda ?? existing.comanda, b.cliente ?? existing.cliente, b.canal ?? existing.canal,
      frete, total, pagInfo.pagamentoAgregado, pagInfo.valorPagoAgregado, pagInfo.trocoAgregado, id
    );
    salvarPagamentos(id, pagInfo.entradas);
  });
  tx();

  const detalhes = itensNovos
    ? `Itens alterados: de [${resumoItens(itensAntigosParaLog)}] para [${resumoItens(itensNovos)}]`
    : `Dados do pedido alterados (comanda/cliente/pagamento/frete)`;
  registrarAuditoria(id, 'Editado', req.user?.nome, detalhes);

  res.json(serializeOrder(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id)));
});

// POST /api/pedidos/:id/cancelar  { motivo }  — devolve os itens ao estoque
router.post('/:id/cancelar', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ erro: 'Pedido não encontrado.' });
  if (existing.status === 'Cancelado') return res.status(400).json({ erro: 'Esse pedido já está cancelado.' });

  const tx = db.transaction(() => {
    const itens = db.prepare('SELECT * FROM itens_pedido WHERE pedido_id = ?').all(id);
    ajustarEstoquePorItens(itens, +1);
    db.prepare(`UPDATE pedidos SET status='Cancelado', motivo_cancelamento=?, atualizado_em=datetime('now') WHERE id=?`)
      .run(req.body.motivo || 'Não informado', id);
  });
  tx();
  registrarAuditoria(id, 'Cancelado', req.user?.nome, `Motivo: ${req.body.motivo || 'Não informado'}`);
  res.json(serializeOrder(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id)));
});

// GET /api/pedidos/:id/historico — histórico de auditoria (quem criou/editou/cancelou e quando)
router.get('/:id/historico', (req, res) => {
  const rows = db.prepare(`SELECT * FROM auditoria WHERE entidade='pedido' AND entidade_id=? ORDER BY criado_em DESC`).all(req.params.id);
  res.json(rows);
});

module.exports = router;
