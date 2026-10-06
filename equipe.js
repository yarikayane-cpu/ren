// routes/equipe.js — cadastro de freelancers (motoboy, pizzaiolo, ajudante, garçom)
// e funcionários fixos, e lançamento/extrato de pagamentos.
const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/equipe?ativos=1
router.get('/', (req, res) => {
  const rows = req.query.ativos
    ? db.prepare('SELECT * FROM equipe WHERE ativo=1 ORDER BY nome').all()
    : db.prepare('SELECT * FROM equipe ORDER BY nome').all();
  res.json(rows);
});

// POST /api/equipe { nome, tipo, funcao, valorPadrao, chavePix }
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.nome || !['Freelancer', 'Fixo'].includes(b.tipo)) {
    return res.status(400).json({ erro: 'Informe nome e tipo (Freelancer ou Fixo).' });
  }
  const info = db.prepare(`
    INSERT INTO equipe (nome, tipo, funcao, valor_padrao, chave_pix) VALUES (?,?,?,?,?)
  `).run(b.nome, b.tipo, b.funcao || '', Number(b.valorPadrao) || 0, b.chavePix || '');
  res.status(201).json(db.prepare('SELECT * FROM equipe WHERE id=?').get(info.lastInsertRowid));
});

// POST /api/equipe/:id/desativar
router.post('/:id/desativar', (req, res) => {
  db.prepare('UPDATE equipe SET ativo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/equipe/:id/pagamentos — extrato de uma pessoa
router.get('/:id/pagamentos', (req, res) => {
  const rows = db.prepare('SELECT * FROM pagamentos_equipe WHERE equipe_id=? ORDER BY data DESC').all(req.params.id);
  res.json(rows);
});

// POST /api/equipe/:id/pagamentos { data, descricao, valor, taxasExtras, formaPagamento }
router.post('/:id/pagamentos', (req, res) => {
  const pessoa = db.prepare('SELECT * FROM equipe WHERE id=?').get(req.params.id);
  if (!pessoa) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
  const b = req.body;
  const valor = Number(b.valor) || 0;
  const taxas = Number(b.taxasExtras) || 0;
  if (valor <= 0) return res.status(400).json({ erro: 'Informe um valor válido.' });
  const data = b.data || new Date().toISOString().slice(0, 10);
  const lancadoComoSangria = b.formaPagamento === 'Dinheiro do Caixa';

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO pagamentos_equipe (equipe_id, data, descricao, valor, taxas_extras, forma_pagamento, lancado_como_sangria)
      VALUES (?,?,?,?,?,?,?)
    `).run(pessoa.id, data, b.descricao || '', valor, taxas, b.formaPagamento || '', lancadoComoSangria ? 1 : 0);

    if (lancadoComoSangria) {
      const sessao = db.prepare(`SELECT * FROM caixa_sessoes WHERE status='aberto' ORDER BY id DESC LIMIT 1`).get();
      if (sessao) {
        db.prepare(`INSERT INTO movimentos_caixa (sessao_id, tipo, motivo, valor) VALUES (?,?,?,?)`)
          .run(sessao.id, 'Sangria', `Pagamento ${pessoa.nome} (${pessoa.funcao || pessoa.tipo})`, valor + taxas);
      }
    }
    return info.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json(db.prepare('SELECT * FROM pagamentos_equipe WHERE id=?').get(id));
});

// GET /api/equipe/pagamentos/periodo?inicio=&fim=  — relatório de repasses (todas as pessoas)
router.get('/pagamentos/periodo', (req, res) => {
  const inicio = req.query.inicio || '2000-01-01';
  const fim = req.query.fim || '2100-01-01';
  const rows = db.prepare(`
    SELECT pe.*, e.nome, e.funcao, e.tipo FROM pagamentos_equipe pe
    JOIN equipe e ON e.id = pe.equipe_id
    WHERE pe.data BETWEEN ? AND ?
    ORDER BY pe.data DESC
  `).all(inicio, fim);
  res.json(rows);
});

module.exports = router;
