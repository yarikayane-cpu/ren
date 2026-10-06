// db.js — SQLite database setup for the Pizzaria system.
// Uses a single file (pizzaria.db) so it works with zero external services.
// For hosting on Railway/Render, mount a persistent volume and point DB_PATH there.
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pizzaria.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  papel TEXT NOT NULL CHECK(papel IN ('caixa','gerente')),
  senha_hash TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sabores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS estoque (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insumo TEXT NOT NULL UNIQUE,
  unidade TEXT DEFAULT 'un',
  estoque_minimo REAL DEFAULT 0,
  estoque_atual REAL DEFAULT 0,
  custo_medio REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS caixa_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operador TEXT NOT NULL,
  fundo_inicial REAL NOT NULL DEFAULT 0,
  aberto_em TEXT DEFAULT (datetime('now')),
  fechado_em TEXT,
  valor_contado REAL,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto','fechado')),
  data_referencia TEXT
);

CREATE TABLE IF NOT EXISTS movimentos_caixa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessao_id INTEGER NOT NULL REFERENCES caixa_sessoes(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('Sangria','Suprimento')),
  motivo TEXT,
  valor REAL NOT NULL,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comanda TEXT,
  cliente TEXT,
  canal TEXT NOT NULL,
  frete REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  pagamento TEXT NOT NULL,
  valor_pago REAL,
  troco REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Ativo' CHECK(status IN ('Ativo','Editado','Cancelado')),
  motivo_cancelamento TEXT,
  observacao TEXT,
  retroativo INTEGER DEFAULT 0,
  data_hora TEXT NOT NULL,
  operador TEXT,
  sessao_id INTEGER REFERENCES caixa_sessoes(id),
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  produto TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  valor_unitario REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  fornecedor TEXT,
  forma_pagamento TEXT,
  nota TEXT,
  insumo TEXT NOT NULL,
  quantidade REAL NOT NULL,
  unidade TEXT DEFAULT 'un',
  valor_unitario REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);

-- Ficha técnica: quanto de cada insumo 1 unidade de um produto (ex: 1 pizza Calabresa) consome.
CREATE TABLE IF NOT EXISTS ficha_tecnica (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto TEXT NOT NULL,
  insumo TEXT NOT NULL,
  quantidade_por_unidade REAL NOT NULL,
  unidade TEXT DEFAULT 'g',
  UNIQUE(produto, insumo)
);

CREATE TABLE IF NOT EXISTS contas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('pagar','receber')),
  descricao TEXT NOT NULL,
  categoria TEXT,
  vencimento TEXT,
  valor REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pendente' CHECK(status IN ('Pendente','Pago','Recebido')),
  pago_via_sangria INTEGER DEFAULT 0,
  data_pagamento TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('Freelancer','Fixo')),
  funcao TEXT,
  valor_padrao REAL DEFAULT 0,
  chave_pix TEXT,
  ativo INTEGER DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pagamentos_equipe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipe_id INTEGER NOT NULL REFERENCES equipe(id),
  data TEXT NOT NULL,
  descricao TEXT,
  valor REAL NOT NULL DEFAULT 0,
  taxas_extras REAL DEFAULT 0,
  forma_pagamento TEXT,
  lancado_como_sangria INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade TEXT NOT NULL,
  entidade_id INTEGER NOT NULL,
  acao TEXT NOT NULL,
  usuario TEXT,
  detalhes TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pagamentos_pedido (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  forma TEXT NOT NULL CHECK(forma IN ('Dinheiro','Pix','Crédito','Débito')),
  valor REAL NOT NULL DEFAULT 0,
  valor_pago REAL,
  troco REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pedidos_data ON pedidos(data_hora);
CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_compras_data ON compras(data);
CREATE INDEX IF NOT EXISTS idx_ficha_produto ON ficha_tecnica(produto);
CREATE INDEX IF NOT EXISTS idx_pagamentos_equipe_data ON pagamentos_equipe(data);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria TEXT NOT NULL,
  nome TEXT NOT NULL,
  preco REAL NOT NULL DEFAULT 0,
  UNIQUE(categoria, nome)
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON auditoria(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pedido ON pagamentos_pedido(pedido_id);

-- Registro simples de caixa: um cadastro manual e independente do sistema de
-- vendas, só para acompanhamento. NÃO se conecta com pedidos, caixa_sessoes
-- ou estoque — é intencionalmente separado, para conferência rápida.
CREATE TABLE IF NOT EXISTS caixa_simples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  abertura REAL NOT NULL DEFAULT 0,
  vendas_dinheiro REAL NOT NULL DEFAULT 0,
  fechamento REAL NOT NULL DEFAULT 0,
  observacao TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS caixa_simples_pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caixa_simples_id INTEGER NOT NULL REFERENCES caixa_simples(id) ON DELETE CASCADE,
  motivo TEXT,
  valor REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_caixa_simples_data ON caixa_simples(data);
CREATE INDEX IF NOT EXISTS idx_caixa_simples_pagamentos ON caixa_simples_pagamentos(caixa_simples_id);

-- Categorias de item do PDV, cadastráveis pelo usuário (ex: Pizza Inteira, Bebida, Sobremesa...).
-- tipo='pizza': entra no ranking de sabores e consome a ficha técnica, na fração indicada.
-- tipo='consumo': dá baixa direta no insumo de mesmo nome no Estoque (ex: Bebida, Adicional).
CREATE TABLE IF NOT EXISTS categorias_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK(tipo IN ('pizza','consumo')),
  fracao REAL NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now'))
);
`);

// Seed a default login on first run: caixa / gerente, both password "pizzaria123"
// IMPORTANT: change these passwords after first login in production.
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const hash = bcrypt.hashSync('pizzaria123', 10);
  const insert = db.prepare('INSERT INTO users (nome, papel, senha_hash) VALUES (?,?,?)');
  insert.run('Caixa', 'caixa', hash);
  insert.run('Gerente', 'gerente', hash);
  console.log('Usuários padrão criados: "Caixa" e "Gerente", senha inicial: pizzaria123 (troque depois!)');
}

// Migração: bancos antigos têm um CHECK fixo na coluna categoria de itens_pedido
// e produtos (só aceitava as 5 categorias originais). Agora categorias são
// cadastráveis pelo usuário, então removemos essa restrição fixa, preservando
// todos os dados existentes. SQLite não permite alterar um CHECK diretamente,
// por isso recriamos a tabela.
function removerCheckCategoria(tabela, colunasExtra) {
  const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(tabela);
  if (schema && schema.sql.includes('CHECK(categoria')) {
    const colunas = colunasExtra.join(', ');
    db.exec(`
      ALTER TABLE ${tabela} RENAME TO ${tabela}_old_migracao;
      CREATE TABLE ${tabela} (${colunasExtra.map(c => c).join(',\n')});
      INSERT INTO ${tabela} SELECT * FROM ${tabela}_old_migracao;
      DROP TABLE ${tabela}_old_migracao;
    `);
    console.log(`Migração aplicada: restrição fixa de categoria removida em "${tabela}".`);
  }
}

removerCheckCategoria('itens_pedido', [
  'id INTEGER PRIMARY KEY AUTOINCREMENT',
  'pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE',
  'categoria TEXT NOT NULL',
  'produto TEXT NOT NULL',
  'quantidade REAL NOT NULL DEFAULT 1',
  'valor_unitario REAL NOT NULL DEFAULT 0'
]);
db.exec('CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id);');

removerCheckCategoria('produtos', [
  'id INTEGER PRIMARY KEY AUTOINCREMENT',
  'categoria TEXT NOT NULL',
  'nome TEXT NOT NULL',
  'preco REAL NOT NULL DEFAULT 0',
  'UNIQUE(categoria, nome)'
]);

// Semeia as categorias padrão na primeira execução (não mexe se o usuário já tiver cadastrado/alterado algo).
const categoriaCount = db.prepare('SELECT COUNT(*) AS n FROM categorias_item').get().n;
if (categoriaCount === 0) {
  const insertCat = db.prepare('INSERT INTO categorias_item (nome, tipo, fracao) VALUES (?,?,?)');
  insertCat.run('Pizza Inteira', 'pizza', 1);
  insertCat.run('Pizza Meia', 'pizza', 0.5);
  insertCat.run('Pizza Terço', 'pizza', 1 / 3);
  insertCat.run('Bebida', 'consumo', 1);
  insertCat.run('Adicional', 'consumo', 1);
  console.log('Categorias padrão cadastradas: Pizza Inteira, Pizza Meia, Pizza Terço, Bebida, Adicional.');
}

// Migração: adiciona a coluna "observacao" em pedidos para bancos já existentes
// (SQLite permite ADD COLUMN diretamente, sem precisar recriar a tabela).
const colunasPedidos = db.prepare(`PRAGMA table_info(pedidos)`).all().map(c => c.name);
if (!colunasPedidos.includes('observacao')) {
  db.exec(`ALTER TABLE pedidos ADD COLUMN observacao TEXT;`);
  console.log('Migração aplicada: coluna "observacao" adicionada em pedidos.');
}

// Migração: adiciona "data_referencia" em caixa_sessoes, para permitir abrir/fechar
// um caixa com data retroativa (útil para quem lança as vendas dias depois).
const colunasCaixa = db.prepare(`PRAGMA table_info(caixa_sessoes)`).all().map(c => c.name);
if (!colunasCaixa.includes('data_referencia')) {
  db.exec(`ALTER TABLE caixa_sessoes ADD COLUMN data_referencia TEXT;`);
  console.log('Migração aplicada: coluna "data_referencia" adicionada em caixa_sessoes.');
}

module.exports = db;
