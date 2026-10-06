# Pizzaria — Sistema de Gestão (PDV + Caixa + Dashboard)

Sistema completo: backend em Node.js (Express) + banco de dados SQLite + frontend web.
Funciona em qualquer navegador — computador do caixa, celular do gerente, etc — todos
acessando o mesmo servidor.

## O que está incluído
- **PDV**: lançamento de pedidos, canais de venda, troco automático, venda retroativa
- **Vendas Recentes**: busca, edição e cancelamento de pedidos (com auditoria)
- **Caixa**: abertura, sangrias/suprimentos, conferência cega e fechamento com relatório para impressão (PDF via impressão do navegador)
- **Dashboard**: faturamento, ticket médio, saldo em gaveta, ranking de sabores, faturamento por forma de pagamento
- **Login**: dois usuários iniciais — `Caixa` e `Gerente`, senha `pizzaria123` (troque depois, veja abaixo)

> Estoque, compras, contas a pagar e freelancers continuam controlados pela planilha
> Excel que já te entreguei — este sistema cobre o fluxo de balcão + caixa + gestão.
> Se depois você quiser esses módulos aqui dentro também, é só pedir.

---

## 1. Rodando localmente (para testar antes de publicar)

Pré-requisito: [Node.js](https://nodejs.org) instalado (versão 18 ou mais recente).

```bash
cd server
npm install
npm start
```

Abra `http://localhost:3000` no navegador. Pronto, já dá pra usar.

O banco de dados é o arquivo `server/pizzaria.db`, criado automaticamente na primeira
execução — não precisa configurar nada.

---

## 2. Publicando no Render (passo a passo)

O Render tem plano gratuito para começar e é o mais simples pra esse tipo de sistema.

### Passo 1 — Coloque o código no GitHub
1. Crie uma conta em [github.com](https://github.com) se ainda não tiver.
2. Crie um repositório novo (pode ser privado), por exemplo `pizzaria-sistema`.
3. Envie a pasta `server/` (o conteúdo deste pacote) para esse repositório.
   - Mais fácil: na página do repositório, clique em **"uploading an existing file"**
     e arraste todos os arquivos da pasta `server/`.
   - Ou, se você usa Git: 
     ```bash
     cd server
     git init
     git add .
     git commit -m "Sistema pizzaria"
     git branch -M main
     git remote add origin https://github.com/SEU-USUARIO/pizzaria-sistema.git
     git push -u origin main
     ```

### Passo 2 — Crie o Web Service no Render
1. Acesse [render.com](https://render.com) e crie uma conta (dá pra usar login do GitHub).
2. No painel, clique em **New +** → **Web Service**.
3. Conecte sua conta do GitHub e escolha o repositório `pizzaria-sistema`.
4. Preencha:
   - **Name**: `pizzaria-sistema` (ou o nome que quiser)
   - **Region**: a mais próxima do Brasil (ex: Ohio ou Oregon, o Render ainda não tem região no Brasil)
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (para testar) ou Starter (para uso real — o plano free "dorme" após 15 min sem uso, o que atrasa o primeiro acesso do dia)

### Passo 3 — Adicione um disco persistente (IMPORTANTE)
Sem isso, o banco de dados é apagado toda vez que o Render reinicia o servidor.
1. Ainda na tela de criação (ou depois, em **Settings** → **Disks**), clique em **Add Disk**.
2. **Name**: `dados`
3. **Mount Path**: `/data`
4. **Size**: 1 GB já é mais que suficiente.

### Passo 4 — Configure as variáveis de ambiente
Em **Environment**, adicione:
| Chave | Valor |
|---|---|
| `DB_PATH` | `/data/pizzaria.db` |
| `JWT_SECRET` | qualquer texto longo e aleatório (ex: gere em https://1password.com/password-generator) |
| `PORT` | `3000` (o Render define automaticamente, mas não custa colocar) |

### Passo 5 — Deploy
Clique em **Create Web Service**. O Render vai instalar as dependências e subir o
sistema. Em 2–3 minutos você recebe uma URL tipo `https://pizzaria-sistema.onrender.com`
— essa é a que você acessa do caixa e do celular do gerente.

### Passo 6 — Troque as senhas padrão
Assim que acessar pela primeira vez, faça login com `Caixa` / `pizzaria123` e
`Gerente` / `pizzaria123`. **Troque essas senhas** — por enquanto isso é feito
direto no banco (posso te passar um script simples pra isso, ou já deixo uma tela
de "trocar senha" na próxima versão, é só pedir).

---

## 3. Alternativas ao Render
- **Railway** (railway.app): processo quase idêntico, também tem volume persistente.
- **Fly.io**: um pouco mais técnico, mas mais barato para uso contínuo 24/7.

Qualquer uma funciona com este mesmo código — a única parte específica do Render
é o "Disco Persistente" (em outras plataformas o nome muda: "Volume" no Railway/Fly.io).

---

## Estrutura do projeto
```
server/
  server.js          → ponto de entrada
  db.js              → banco de dados (schema + usuários iniciais)
  routes/
    auth.js          → login
    pedidos.js        → PDV (criar, listar, buscar, editar, cancelar)
    caixa.js          → abertura, sangria/suprimento, fechamento
    dashboard.js      → indicadores e ranking
    estoque.js        → cadastro simples de insumos (bebidas etc.)
  public/
    index.html         → frontend (login + PDV + vendas + caixa + dashboard)
```
