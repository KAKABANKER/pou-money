const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ SEGURANÇA ============
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https://api.qrserver.com"],
            connectSrc: ["'self'"]
        }
    }
}));

// CORS restrito
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'https://pou-money.onrender.com'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('CORS não permitido'));
    },
    credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ============ RATE LIMITING ============
const limiterGeral = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
});

const limiterLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
    skipSuccessfulRequests: true
});

app.use('/api/', limiterGeral);

// ============ ARQUIVOS ESTÁTICOS ============
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// ============ BANCO DE DADOS ============
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://pou_money_user:mXJ6GiPmWZUbYnIFKwopB7M4l5ANq2cU@dpg-d85p6ldi849s7384shbg-a/pou_money',
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

const JWT_SECRET = process.env.JWT_SECRET || 'pou_money_jwt_secret_2025_MUDE_EM_PRODUCAO';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'pou_money_refresh_secret_2025';

// ============ INICIALIZAR BANCO ============
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                cpf VARCHAR(14),
                telefone VARCHAR(20),
                senha_hash VARCHAR(255) NOT NULL,
                saldo DECIMAL(10,2) DEFAULT 10.00,
                moedas INT DEFAULT 100,
                pontos INT DEFAULT 0,
                nivel INT DEFAULT 1,
                data_cadastro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_admin BOOLEAN DEFAULT FALSE,
                ativo BOOLEAN DEFAULT TRUE,
                refresh_token TEXT,
                ultimo_login TIMESTAMP
            )
        `);
        console.log('✅ Tabela users OK');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS transacoes (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                tipo VARCHAR(20) NOT NULL,
                valor DECIMAL(10,2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pendente',
                payment_id VARCHAR(100),
                pix_qr_code TEXT,
                pix_code TEXT,
                chave_pix VARCHAR(200),
                data_solicitacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                data_conclusao TIMESTAMP
            )
        `);
        console.log('✅ Tabela transacoes OK');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                titulo VARCHAR(200) NOT NULL,
                mensagem TEXT NOT NULL,
                resposta TEXT,
                status VARCHAR(20) DEFAULT 'aberto',
                data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                data_resposta TIMESTAMP
            )
        `);
        console.log('✅ Tabela tickets OK');

        // Criar admin
        const adminCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@poumoney.com']);
        if (adminCheck.rows.length === 0) {
            const adminHash = await bcrypt.hash('Admin@2025!', 12);
            await pool.query(
                `INSERT INTO users (nome, email, senha_hash, is_admin, saldo, moedas)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['Administrador', 'admin@poumoney.com', adminHash, true, 10000, 100000]
            );
            console.log('✅ Admin criado: admin@poumoney.com / Admin@2025!');
        }

        console.log('🎉 Banco pronto!');
    } catch (err) {
        console.error('❌ Erro banco:', err.message);
    }
}

// ============ MIDDLEWARE ============
function autenticar(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado', expired: true });
        }
        return res.status(401).json({ error: 'Token inválido' });
    }
}

function autenticarAdmin(req, res, next) {
    autenticar(req, res, () => {
        if (!req.user.is_admin) return res.status(403).json({ error: 'Acesso negado' });
        next();
    });
}

// ============ ROTAS DE PÁGINAS (VIEWS) ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, 'views', 'cadastro.html')));
app.get('/jogos', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogos.html')));
app.get('/depositar', (req, res) => res.sendFile(path.join(__dirname, 'views', 'depositar.html')));
app.get('/sacar', (req, res) => res.sendFile(path.join(__dirname, 'views', 'sacar.html')));
app.get('/ranking', (req, res) => res.sendFile(path.join(__dirname, 'views', 'ranking.html')));
app.get('/suporte', (req, res) => res.sendFile(path.join(__dirname, 'views', 'suporte.html')));
app.get('/jogar', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogar.html')));
app.get('/jogo-clicker', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogo-clicker.html')));
app.get('/jogo-mines', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogo-mines.html')));
app.get('/jogo-crash', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogo-crash.html')));
app.get('/jogo-roleta', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogo-roleta.html')));

// Rotas ADMIN (ocultas)
app.get('/admin-entrar', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'admin-login.html')));
app.get('/admin-painel', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'painel-admin.html')));

// ============ API - HEALTH ============
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// ============ API - VERIFICAR TOKEN ============
async function verificarToken(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.json({ autenticado: false });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            'SELECT id, nome, email, saldo, moedas, pontos, nivel, is_admin, cpf, telefone FROM users WHERE id = $1 AND ativo = true',
            [decoded.id]
        );
        if (result.rows.length === 0) return res.json({ autenticado: false });
        res.json({ autenticado: true, user: result.rows[0] });
    } catch (err) {
        res.json({ autenticado: false });
    }
}

app.get('/api/verificar', verificarToken);
app.post('/api/verificar', verificarToken);

// ============ API - REFRESH TOKEN ============
app.post('/api/refresh-token', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token não fornecido' });
    try {
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1 AND refresh_token = $2 AND ativo = true',
            [decoded.id, refreshToken]
        );
        if (result.rows.length === 0) return res.status(401).json({ error: 'Refresh token inválido' });

        const user = result.rows[0];
        const newToken = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ success: true, token: newToken });
    } catch (err) {
        res.status(401).json({ error: 'Refresh token expirado' });
    }
});

// ============ API - LOGOUT ============
app.post('/api/logout', autenticar, async (req, res) => {
    try {
        await pool.query('UPDATE users SET refresh_token = NULL WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: true });
    }
});

// ============ API - LOGIN ============
app.post('/api/login', limiterLogin, async (req, res) => {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: 'Email e senha obrigatórios' });

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (result.rows.length === 0) {
            await new Promise(r => setTimeout(r, 500));
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        const user = result.rows[0];
        if (!user.ativo) return res.status(403).json({ error: 'Conta desativada' });

        const valid = await bcrypt.compare(senha, user.senha_hash);
        if (!valid) {
            await new Promise(r => setTimeout(r, 500));
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, is_admin: user.is_admin },
            JWT_SECRET,
            { expiresIn: '2h' }
        );
        const refreshToken = jwt.sign(
            { id: user.id },
            JWT_REFRESH_SECRET,
            { expiresIn: '30d' }
        );

        await pool.query('UPDATE users SET ultimo_login = NOW(), refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

        res.json({
            success: true,
            token,
            refreshToken,
            user: {
                id: user.id, nome: user.nome, email: user.email,
                saldo: parseFloat(user.saldo), moedas: user.moedas,
                pontos: user.pontos, nivel: user.nivel, is_admin: user.is_admin
            }
        });
    } catch (err) {
        console.error('Erro login:', err.message);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// ============ API - CADASTRO ============
app.post('/api/cadastrar', async (req, res) => {
    const { nome, email, cpf, telefone, senha } = req.body;

    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    if (senha.length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });

    try {
        const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
        if (exists.rows.length > 0) return res.status(400).json({ error: 'Email já cadastrado' });

        const hash = await bcrypt.hash(senha, 12);
        const result = await pool.query(
            `INSERT INTO users (nome, email, cpf, telefone, senha_hash)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, nome, email, saldo, moedas, pontos, nivel, is_admin`,
            [nome.trim(), email.toLowerCase().trim(), cpf || null, telefone || null, hash]
        );

        const token = jwt.sign({ id: result.rows[0].id, email: email, is_admin: false }, JWT_SECRET, { expiresIn: '2h' });
        const refreshToken = jwt.sign({ id: result.rows[0].id }, JWT_REFRESH_SECRET, { expiresIn: '30d' });
        await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, result.rows[0].id]);

        res.json({ success: true, token, refreshToken, user: result.rows[0] });
    } catch (err) {
        console.error('Erro cadastro:', err.message);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// ============ API - DEPÓSITO ============
app.post('/api/criar-deposito', autenticar, async (req, res) => {
    try {
        const { valor, cpf, telefone } = req.body;
        const valorNum = parseFloat(valor);
        if (!valorNum || valorNum < 10) return res.status(400).json({ error: 'Valor mínimo é R$ 10,00' });
        if (valorNum > 10000) return res.status(400).json({ error: 'Valor máximo é R$ 10.000,00' });

        if (cpf) {
            await pool.query('UPDATE users SET cpf = $1, telefone = $2 WHERE id = $3', [cpf, telefone || null, req.user.id]);
        }

        const paymentId = 'PIX_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const pixCode = `00020126580014BR.GOV.BCB.PIX0136${paymentId}5204000053039865406${(valorNum * 100).toFixed(0).padStart(6, '0')}5802BR5925POU MONEY LTDA6009SAO PAULO62140510${Date.now().toString().slice(-10)}6304ABCD`;
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pixCode)}`;

        await pool.query(
            `INSERT INTO transacoes (user_id, tipo, valor, status, payment_id, pix_qr_code, pix_code)
             VALUES ($1, 'deposito', $2, 'pendente', $3, $4, $5)`,
            [req.user.id, valorNum, paymentId, qrCodeUrl, pixCode]
        );

        res.json({
            success: true,
            payment: { id: paymentId, qr_code: qrCodeUrl, code: pixCode, value: valorNum }
        });
    } catch (err) {
        console.error('Erro depósito:', err.message);
        res.status(500).json({ error: 'Erro ao criar depósito' });
    }
});

// ============ API - JOGO CLICKER ============
app.post('/api/salvar-pontuacao', autenticar, async (req, res) => {
    try {
        const pts = Math.min(parseInt(req.body.pontuacao) || 0, 5000);
        const mds = Math.min(parseInt(req.body.moedas) || 0, 1000);

        if (pts <= 0 && mds <= 0) return res.status(400).json({ error: 'Pontuação inválida' });

        await pool.query('UPDATE users SET moedas = moedas + $1, pontos = pontos + $2 WHERE id = $3', [mds, pts, req.user.id]);
        await pool.query('UPDATE users SET nivel = GREATEST(1, FLOOR(pontos / 1000) + 1) WHERE id = $1', [req.user.id]);

        const userResult = await pool.query('SELECT saldo, moedas, pontos, nivel FROM users WHERE id = $1', [req.user.id]);
        res.json({ success: true, ...userResult.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar pontuação' });
    }
});

// ============ API - RANKING ============
app.get('/api/ranking', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;

        const result = await pool.query(
            'SELECT id, nome, pontos, nivel, moedas FROM users WHERE ativo = true AND is_admin = false ORDER BY pontos DESC LIMIT $1 OFFSET $2',
            [limit, offset]
        );
        const total = await pool.query('SELECT COUNT(*) FROM users WHERE ativo = true AND is_admin = false');

        res.json({ data: result.rows, page, total: parseInt(total.rows[0].count), totalPages: Math.ceil(total.rows[0].count / limit) });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar ranking' });
    }
});

app.get('/api/ranking/semanal', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, nome, pontos, nivel, moedas
             FROM users
             WHERE ativo = true AND is_admin = false
             ORDER BY pontos DESC LIMIT 100`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar ranking semanal' });
    }
});

// ============ API - TICKETS ============
app.post('/api/ticket', autenticar, async (req, res) => {
    try {
        const { titulo, mensagem } = req.body;
        if (!titulo || !mensagem) return res.status(400).json({ error: 'Título e mensagem obrigatórios' });
        if (titulo.length > 200) return res.status(400).json({ error: 'Título muito longo' });

        await pool.query('INSERT INTO tickets (user_id, titulo, mensagem) VALUES ($1, $2, $3)', [req.user.id, titulo.trim(), mensagem.trim()]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar ticket' });
    }
});

app.get('/api/meus-tickets', autenticar, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tickets WHERE user_id = $1 ORDER BY data_criacao DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar tickets' });
    }
});

// ============ API - ADMIN ============
app.get('/api/admin/usuarios', autenticarAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 50);
        const offset = (page - 1) * limit;
        const result = await pool.query(
            'SELECT id, nome, email, saldo, moedas, pontos, nivel, ativo, data_cadastro FROM users WHERE is_admin = false ORDER BY data_cadastro DESC LIMIT $1 OFFSET $2',
            [limit, offset]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar usuários' });
    }
});

app.get('/api/admin/transacoes', autenticarAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, u.nome as user_nome FROM transacoes t JOIN users u ON t.user_id = u.id ORDER BY t.data_solicitacao DESC LIMIT 200`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar transações' });
    }
});

app.get('/api/admin/tickets', autenticarAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, u.nome as user_nome FROM tickets t JOIN users u ON t.user_id = u.id ORDER BY t.data_criacao DESC`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar tickets' });
    }
});

app.post('/api/admin/ticket/:id/responder', autenticarAdmin, async (req, res) => {
    try {
        const { resposta } = req.body;
        if (!resposta) return res.status(400).json({ error: 'Resposta obrigatória' });
        await pool.query('UPDATE tickets SET resposta = $1, status = $2, data_resposta = NOW() WHERE id = $3', [resposta, 'respondido', req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao responder ticket' });
    }
});

// ============ 404 HANDLER ============
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Rota não encontrada' });
    }
    res.redirect('/');
});

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
    console.error('Erro:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// ============ INICIAR SERVIDOR ============
initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🚀 POU MONEY RODANDO                      ║
╠══════════════════════════════════════════════════════════════╣
║  📡 Porta: ${PORT}                                              ║
║  🔐 Admin: /admin-entrar                                      ║
║  👤 Admin: admin@poumoney.com                                 ║
║  🔑 Senha: Admin@2025!                                        ║
╚══════════════════════════════════════════════════════════════╝
        `);
    });
});