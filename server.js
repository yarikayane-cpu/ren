// server.js — entry point. Serves the API and the static frontend (public/).
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { router: authRouter, authMiddleware } = require('./routes/auth');
const pedidosRouter = require('./routes/pedidos');
const caixaRouter = require('./routes/caixa');
const dashboardRouter = require('./routes/dashboard');
const estoqueRouter = require('./routes/estoque');
const comprasRouter = require('./routes/compras');
const fichasRouter = require('./routes/fichas');
const contasRouter = require('./routes/contas');
const equipeRouter = require('./routes/equipe');
const relatorioRouter = require('./routes/relatorio');
const catalogoRouter = require('./routes/catalogo');
const produtosRouter = require('./routes/produtos');
const categoriasRouter = require('./routes/categorias');
const caixaSimplesRouter = require('./routes/caixasimples');

const app = express();
app.use(cors());
app.use(express.json());

// login is public; everything else under /api requires a valid token
app.use('/api/auth', authRouter);
app.use('/api', authMiddleware);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/caixa', caixaRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/estoque', estoqueRouter);
app.use('/api/compras', comprasRouter);
app.use('/api/fichas', fichasRouter);
app.use('/api/contas', contasRouter);
app.use('/api/equipe', equipeRouter);
app.use('/api/relatorio', relatorioRouter);
app.use('/api/catalogo', catalogoRouter);
app.use('/api/produtos', produtosRouter);
app.use('/api/categorias', categoriasRouter);
app.use('/api/caixa-simples', caixaSimplesRouter);

// static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pizzaria — servidor rodando na porta ${PORT}`));
