// routes/auth.js — simple login for the shared counter/manager accounts.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';

router.post('/login', (req, res) => {
  const { nome, senha } = req.body;
  if (!nome || !senha) return res.status(400).json({ erro: 'Informe usuário e senha.' });

  const user = db.prepare('SELECT * FROM users WHERE nome = ?').get(nome);
  if (!user || !bcrypt.compareSync(senha, user.senha_hash)) {
    return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  }
  const token = jwt.sign({ id: user.id, nome: user.nome, papel: user.papel }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, usuario: { nome: user.nome, papel: user.papel } });
});

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Sessão expirada, faça login novamente.' });
  }
}

module.exports = { router, authMiddleware };
