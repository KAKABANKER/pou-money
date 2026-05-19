// server.js - Versão completa
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações JWT
const JWT_SECRET = process.env.JWT_SECRET || 'pou_money_jwt_secret_2025';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'pou_money_refresh_secret_2025';

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Banco de dados SQLite
const Database = require('better-sqlite3');
const db = new Database('pou_money.db');

// Inicializar banco de dados
function initDatabase() {
    // Usuários
    db.exec(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            cpf TEXT,
            telefone TEXT,
            senha TEXT NOT NULL,
            saldo REAL DEFAULT 0,
            moedas INTEGER DEFAULT 0,
            pontos INTEGER DEFAULT 0,
            nivel INTEGER DEFAULT 1,
            is_admin INTEGER DEFAULT 0,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Refresh tokens
    db.exec(`
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            FOREIGN KEY (user_id) REFERENCES usuarios(id)
        )
    `);

    // Tickets de suporte
    db.exec(`
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            titulo TEXT NOT NULL,
            mensagem TEXT NOT NULL,
            resposta TEXT,
            status TEXT DEFAULT 'aberto',
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            data_resposta DATETIME,
            FOREIGN KEY (user_id) REFERENCES usuarios(id)
        )
    `);

    // Depósitos
    db.exec(`
        CREATE TABLE IF NOT EXISTS depositos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            valor REAL NOT NULL,
            status TEXT DEFAULT 'pendente',
            txid TEXT,
            qr_code TEXT,
            pix_code TEXT,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            data_confirmacao DATETIME,
            FOREIGN KEY (user_id) REFERENCES usuarios(id)
        )
    `);

    // Partidas de Crash
    db.exec(`
        CREATE TABLE IF NOT EXISTS crash_partidas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            aposta REAL NOT NULL,
            multiplicador REAL,
            ganho REAL,
            status TEXT DEFAULT 'pendente',
            game_token TEXT UNIQUE,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES usuarios(id)
        )
    `);

    // Partidas de Mines
    db.exec(`
        CREATE TABLE IF NOT EXISTS mines_partidas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            aposta REAL NOT NULL,
            num_minas INTEGER NOT NULL,
            multiplicador REAL,
            ganho REAL,
            posicoes_minas TEXT,
            posicoes_reveladas TEXT,
            status TEXT DEFAULT 'pendente',
            game_token TEXT UNIQUE,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES usuarios(id)
        )
    `);

    // Ranking semanal
    db.exec(`
        CREATE TABLE IF NOT EXISTS ranking_semanal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            pontos_semana INTEGER DEFAULT 0,
            semana INTEGER DEFAULT (strftime('%W', 'now')),
            ano INTEGER DEFAULT (strftime('%Y', 'now')),
            UNIQUE(user_id, semana, ano),
            FOREIGN KEY (user_id) REFERENCES usuarios(id)
        )
    `);

    // Verificar/criar admin
    const admin = db.prepare('SELECT * FROM usuarios WHERE email = ?').get('admin@poumoney.com');
    if (!admin) {
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync('admin123', salt);
        db.prepare(`INSERT INTO usuarios (nome, email, senha, is_admin, saldo) VALUES (?, ?, ?, ?, ?)`)
            .run('Administrador', 'admin@poumoney.com', hash, 1, 10000);
        console.log('👑 Admin criado: admin@poumoney.com / admin123');
    }

    console.log('🎉 Banco pronto!');
}

initDatabase();

// ========== FUNÇÕES AUXILIARES ==========
function gerarToken(userId, isAdmin = false) {
    return jwt.sign({ userId, isAdmin }, JWT_SECRET, { expiresIn: '1h' });
}

function gerarRefreshToken(userId) {
    const token = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    db.prepare('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
        .run(userId, token, expiresAt.toISOString());
    return token;
}

function verificarToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

function getUserFromToken(token) {
    const decoded = verificarToken(token);
    if (!decoded) return null;
    const user = db.prepare('SELECT id, nome, email, saldo, moedas, pontos, nivel, is_admin FROM usuarios WHERE id = ?')
        .get(decoded.userId);
    return user;
}

// ========== ROTAS DE PÁGINAS ==========
const viewsPath = path.join(__dirname, 'views');

app.get('/', (req, res) => {
    res.sendFile(path.join(viewsPath, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(viewsPath, 'login.html'));
});

app.get('/cadastro', (req, res) => {
    res.sendFile(path.join(viewsPath, 'cadastro.html'));
});

app.get('/jogos', (req, res) => {
    res.sendFile(path.join(viewsPath, 'jogos.html'));
});

app.get('/jogar', (req, res) => {
    res.sendFile(path.join(viewsPath, 'jogar.html'));
});

app.get('/jogo-crash', (req, res) => {
    res.sendFile(path.join(viewsPath, 'jogo-crash.html'));
});

app.get('/jogo-mines', (req, res) => {
    res.sendFile(path.join(viewsPath, 'jogo-mines.html'));
});

app.get('/depositar', (req, res) => {
    res.sendFile(path.join(viewsPath, 'depositar.html'));
});

app.get('/ranking', (req, res) => {
    res.sendFile(path.join(viewsPath, 'ranking.html'));
});

app.get('/suporte', (req, res) => {
    res.sendFile(path.join(viewsPath, 'suporte.html'));
});

app.get('/app', (req, res) => {
    res.sendFile(path.join(viewsPath, 'app.html'));
});

// ========== API ROTAS ==========

// Cadastro
app.post('/api/cadastrar', async (req, res) => {
    const { nome, email, cpf, telefone, senha } = req.body;
    
    if (!nome || !email || !senha) {
        return res.json({ success: false, error: 'Preencha os campos obrigatórios' });
    }
    
    if (senha.length < 6) {
        return res.json({ success: false, error: 'Senha deve ter no mínimo 6 caracteres' });
    }
    
    const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existing) {
        return res.json({ success: false, error: 'Email já cadastrado' });
    }
    
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(senha, salt);
    
    const stmt = db.prepare(`INSERT INTO usuarios (nome, email, cpf, telefone, senha, saldo, moedas) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
    
    try {
        const result = stmt.run(nome, email, cpf || null, telefone || null, hash, 10.00, 100);
        const token = gerarToken(result.lastInsertRowid, false);
        const refreshToken = gerarRefreshToken(result.lastInsertRowid);
        
        res.json({ success: true, token, refreshToken, user: { id: result.lastInsertRowid, nome, email } });
    } catch (err) {
        res.json({ success: false, error: 'Erro ao criar usuário' });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { email, senha } = req.body;
    
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!user) {
        return res.json({ success: false, error: 'Email ou senha incorretos' });
    }
    
    if (!bcrypt.compareSync(senha, user.senha)) {
        return res.json({ success: false, error: 'Email ou senha incorretos' });
    }
    
    const token = gerarToken(user.id, user.is_admin === 1);
    const refreshToken = gerarRefreshToken(user.id);
    
    res.json({
        success: true,
        token,
        refreshToken,
        user: {
            id: user.id,
            nome: user.nome,
            email: user.email,
            is_admin: user.is_admin === 1,
            saldo: user.saldo,
            moedas: user.moedas,
            pontos: user.pontos,
            nivel: user.nivel
        }
    });
});

// Verificar token
app.get('/api/verificar', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ autenticado: false });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    
    if (!user) {
        return res.json({ autenticado: false, expired: true });
    }
    
    res.json({ autenticado: true, user });
});

// Refresh token
app.post('/api/refresh-token', (req, res) => {
    const { refreshToken } = req.body;
    
    const stored = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > datetime("now")').get(refreshToken);
    if (!stored) {
        return res.json({ success: false });
    }
    
    const user = db.prepare('SELECT id, is_admin FROM usuarios WHERE id = ?').get(stored.user_id);
    if (!user) {
        return res.json({ success: false });
    }
    
    const newToken = gerarToken(user.id, user.is_admin === 1);
    res.json({ success: true, token: newToken });
});

// Logout
app.post('/api/logout', (req, res) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.substring(7);
        const decoded = verificarToken(token);
        if (decoded) {
            db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(decoded.userId);
        }
    }
    res.json({ success: true });
});

// Salvar pontuação do clicker
app.post('/api/salvar-pontuacao', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false, error: 'Não autenticado' });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false, error: 'Sessão inválida' });
    }
    
    const { pontuacao, moedas } = req.body;
    
    const stmt = db.prepare(`UPDATE usuarios SET pontos = pontos + ?, moedas = moedas + ? WHERE id = ?`);
    stmt.run(pontuacao || 0, moedas || 0, user.id);
    
    // Atualizar ranking semanal
    const semana = new Date().getWeek();
    const ano = new Date().getFullYear();
    db.prepare(`INSERT INTO ranking_semanal (user_id, pontos_semana, semana, ano) 
        VALUES (?, ?, ?, ?) 
        ON CONFLICT(user_id, semana, ano) DO UPDATE SET pontos_semana = pontos_semana + ?`)
        .run(user.id, pontuacao || 0, semana, ano, pontuacao || 0);
    
    const novoUser = db.prepare('SELECT saldo, moedas, pontos, nivel FROM usuarios WHERE id = ?').get(user.id);
    res.json({ success: true, ...novoUser });
});

// Ranking geral
app.get('/api/ranking', (req, res) => {
    const ranking = db.prepare(`SELECT nome, pontos, moedas, nivel FROM usuarios ORDER BY pontos DESC LIMIT 50`).all();
    res.json(ranking);
});

// Ranking semanal
app.get('/api/ranking/semanal', (req, res) => {
    const semana = new Date().getWeek();
    const ano = new Date().getFullYear();
    const ranking = db.prepare(`
        SELECT u.nome, rs.pontos_semana as pontos_semana, u.pontos, u.nivel, u.moedas
        FROM ranking_semanal rs
        JOIN usuarios u ON rs.user_id = u.id
        WHERE rs.semana = ? AND rs.ano = ?
        ORDER BY rs.pontos_semana DESC LIMIT 50
    `).all(semana, ano);
    res.json(ranking);
});

// Tickets
app.post('/api/ticket', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false, error: 'Não autenticado' });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false });
    }
    
    const { titulo, mensagem } = req.body;
    if (!titulo || !mensagem) {
        return res.json({ success: false, error: 'Preencha todos os campos' });
    }
    
    db.prepare('INSERT INTO tickets (user_id, titulo, mensagem) VALUES (?, ?, ?)')
        .run(user.id, titulo, mensagem);
    
    res.json({ success: true });
});

app.get('/api/meus-tickets', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json([]);
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json([]);
    }
    
    const tickets = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY data_criacao DESC').all(user.id);
    res.json(tickets);
});

// Depósito PIX (simulado)
app.post('/api/criar-deposito', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false, error: 'Não autenticado' });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false });
    }
    
    const { valor, cpf, telefone } = req.body;
    
    if (!valor || valor < 10) {
        return res.json({ success: false, error: 'Valor mínimo R$ 10,00' });
    }
    
    // Simular PIX
    const txid = crypto.randomBytes(16).toString('hex');
    const pixCode = `00020126360014BR.GOV.BCB.PIX0114${cpf || '12345678909'}5204000053039865404${valor.toFixed(2)}5802BR5925POU MONEY6009SAO PAULO62240520${txid}6304`;
    
    // QR Code simulado (URL de placeholder)
    const qrCode = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixCode)}`;
    
    db.prepare(`INSERT INTO depositos (user_id, valor, txid, qr_code, pix_code, status) 
        VALUES (?, ?, ?, ?, ?, 'pendente')`)
        .run(user.id, valor, txid, qrCode, pixCode);
    
    res.json({
        success: true,
        payment: {
            qr_code: qrCode,
            code: pixCode,
            txid: txid
        }
    });
});

// ========== JOGO CRASH ==========
const partidasCrash = new Map();

app.post('/api/jogo/crash/apostar', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false, error: 'Não autenticado' });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false });
    }
    
    const { aposta } = req.body;
    
    if (!aposta || aposta < 0.5) {
        return res.json({ success: false, error: 'Aposta mínima: R$ 0,50' });
    }
    
    if (user.saldo < aposta) {
        return res.json({ success: false, error: 'Saldo insuficiente' });
    }
    
    // Debita o saldo
    db.prepare('UPDATE usuarios SET saldo = saldo - ? WHERE id = ?').run(aposta, user.id);
    
    const gameToken = crypto.randomBytes(16).toString('hex');
    db.prepare(`INSERT INTO crash_partidas (user_id, aposta, game_token, status) VALUES (?, ?, ?, 'apostado')`)
        .run(user.id, aposta, gameToken);
    
    res.json({ success: true, gameToken });
});

app.post('/api/jogo/crash/cashout', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false });
    }
    
    const { gameToken, multiplicador } = req.body;
    
    const partida = db.prepare('SELECT * FROM crash_partidas WHERE game_token = ? AND user_id = ? AND status = "apostado"')
        .get(gameToken, user.id);
    
    if (!partida) {
        return res.json({ success: false, error: 'Partida não encontrada' });
    }
    
    const ganho = partida.aposta * multiplicador;
    db.prepare('UPDATE usuarios SET saldo = saldo + ? WHERE id = ?').run(ganho, user.id);
    db.prepare(`UPDATE crash_partidas SET multiplicador = ?, ganho = ?, status = 'cashout' WHERE game_token = ?`)
        .run(multiplicador, ganho, gameToken);
    
    const novoSaldo = db.prepare('SELECT saldo FROM usuarios WHERE id = ?').get(user.id).saldo;
    
    res.json({ success: true, ganhou: true, ganho, novoSaldo, crashPoint: multiplicador + 0.5 });
});

// ========== JOGO MINES ==========
const partidasMines = new Map();

app.post('/api/jogo/mines/iniciar', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false, error: 'Não autenticado' });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false });
    }
    
    const { aposta, num_minas } = req.body;
    
    if (!aposta || aposta < 0.5) {
        return res.json({ success: false, error: 'Aposta mínima: R$ 0,50' });
    }
    
    if (num_minas < 1 || num_minas > 24) {
        return res.json({ success: false, error: 'Número de minas inválido' });
    }
    
    if (user.saldo < aposta) {
        return res.json({ success: false, error: 'Saldo insuficiente' });
    }
    
    // Gerar posições das minas
    const totalCells = 25;
    const posicoesMinas = [];
    const shuffled = Array.from({ length: totalCells }, (_, i) => i);
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < num_minas; i++) {
        posicoesMinas.push(shuffled[i]);
    }
    
    // Debita o saldo
    db.prepare('UPDATE usuarios SET saldo = saldo - ? WHERE id = ?').run(aposta, user.id);
    
    const gameToken = crypto.randomBytes(16).toString('hex');
    db.prepare(`INSERT INTO mines_partidas (user_id, aposta, num_minas, posicoes_minas, game_token, status) 
        VALUES (?, ?, ?, ?, ?, 'jogando')`)
        .run(user.id, aposta, num_minas, JSON.stringify(posicoesMinas), gameToken);
    
    res.json({ success: true, gameToken });
});

app.post('/api/jogo/mines/revelar', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false });
    }
    
    const { gameToken, posicao } = req.body;
    
    const partida = db.prepare('SELECT * FROM mines_partidas WHERE game_token = ? AND user_id = ? AND status = "jogando"')
        .get(gameToken, user.id);
    
    if (!partida) {
        return res.json({ success: false, error: 'Partida não encontrada' });
    }
    
    const posicoesMinas = JSON.parse(partida.posicoes_minas);
    let reveladas = partida.posicoes_reveladas ? JSON.parse(partida.posicoes_reveladas) : [];
    
    // Verifica se explodiu
    if (posicoesMinas.includes(posicao)) {
        db.prepare(`UPDATE mines_partidas SET status = 'explodiu' WHERE game_token = ?`).run(gameToken);
        return res.json({ success: true, explodiu: true, aposta: partida.aposta, posicoesMinas });
    }
    
    // Adiciona posição revelada
    if (!reveladas.includes(posicao)) {
        reveladas.push(posicao);
    }
    
    // Calcula multiplicador (quanto mais células seguras reveladas, maior o multiplicador)
    const safeCells = 25 - partida.num_minas;
    const multiplicador = 1 + (reveladas.length / safeCells) * 4;
    const ganhoAtual = partida.aposta * multiplicador;
    
    db.prepare(`UPDATE mines_partidas SET posicoes_reveladas = ?, multiplicador = ? WHERE game_token = ?`)
        .run(JSON.stringify(reveladas), multiplicador, gameToken);
    
    res.json({
        success: true,
        explodiu: false,
        newGameToken: gameToken,
        reveladas: reveladas.length,
        multiplicador: parseFloat(multiplicador.toFixed(2)),
        ganhoAtual: parseFloat(ganhoAtual.toFixed(2))
    });
});

app.post('/api/jogo/mines/cashout', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.json({ success: false });
    }
    
    const token = auth.substring(7);
    const user = getUserFromToken(token);
    if (!user) {
        return res.json({ success: false });
    }
    
    const { gameToken } = req.body;
    
    const partida = db.prepare('SELECT * FROM mines_partidas WHERE game_token = ? AND user_id = ? AND status = "jogando"')
        .get(gameToken, user.id);
    
    if (!partida) {
        return res.json({ success: false, error: 'Partida não encontrada' });
    }
    
    const multiplicador = partida.multiplicador || 1;
    const ganho = partida.aposta * multiplicador;
    
    db.prepare('UPDATE usuarios SET saldo = saldo + ? WHERE id = ?').run(ganho, user.id);
    db.prepare(`UPDATE mines_partidas SET status = 'cashout', ganho = ? WHERE game_token = ?`)
        .run(ganho, gameToken);
    
    const novoSaldo = db.prepare('SELECT saldo FROM usuarios WHERE id = ?').get(user.id).saldo;
    
    res.json({ success: true, ganho, novoSaldo });
});

// Helper para semana do ano
Date.prototype.getWeek = function() {
    const date = new Date(this);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};

// Servir arquivos estáticos
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Inicialização
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});