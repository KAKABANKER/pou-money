const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pasta pública
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Servir arquivos HTML da pasta views
app.use(express.static(path.join(__dirname, 'views')));

// DEBUG
console.log('DIRNAME:', __dirname);
console.log(
  'INDEX EXISTS:',
  fs.existsSync(path.join(__dirname, 'views', 'index.html'))
);

// ROTAS
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/jogos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'jogos.html'));
});

app.get('/cadastro', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'cadastro.html'));
});

app.get('/depositar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'depositar.html'));
});

app.get('/jogar', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'jogar.html'));
});

app.get('/jogo-crash', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'jogo-crash.html'));
});

app.get('/jogo-mines', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'jogo-mines.html'));
});

app.get('/suporte', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'suporte.html'));
});

// Inicialização
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});