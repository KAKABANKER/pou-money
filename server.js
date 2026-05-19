const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // Serve arquivos da RAIZ

// CONEXÃO COM BANCO
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://pou_money_user:mXJ6GiPmWZUbYnIFKwopB7M4l5ANq2cU@dpg-d85p6ldi849s7384shbg-a/pou_money',
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'pou_money_jwt_secret_2025';

// ============ CRIAR TABELAS ============
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
                ativo BOOLEAN DEFAULT TRUE
            )
        `);
        console.log('✅ Tabela users OK');

        // Criar ADMIN
        const adminCheck = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@poumoney.com']);
        if (adminCheck.rows.length === 0) {
            const adminHash = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO users (nome, email, senha_hash, is_admin, saldo, moedas)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['Administrador', 'admin@poumoney.com', adminHash, true, 10000, 100000]
            );
            console.log('✅ Admin criado: admin@poumoney.com / admin123');
        }

        console.log('🎉 Banco pronto!');
    } catch (err) {
        console.error('❌ Erro banco:', err.message);
    }
}

// ============ ROTAS ============

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// CADASTRO
app.post('/api/cadastrar', async (req, res) => {
    console.log('📝 Cadastro:', req.body.email);
    const { nome, email, cpf, telefone, senha } = req.body;

    try {
        const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (exists.rows.length > 0) {
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        const hash = await bcrypt.hash(senha, 10);
        const result = await pool.query(
            `INSERT INTO users (nome, email, cpf, telefone, senha_hash)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, nome, email, saldo, moedas, pontos, nivel, is_admin`,
            [nome, email, cpf || null, telefone || null, hash]
        );

        const token = jwt.sign(
            { id: result.rows[0].id, email: email, is_admin: false },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ success: true, token, user: result.rows[0] });
    } catch (err) {
        console.error('Erro cadastro:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// LOGIN
app.post('/api/login', async (req, res) => {
    console.log('🔐 Login:', req.body.email);
    const { email, senha } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(senha, user.senha_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Email ou senha incorretos' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, is_admin: user.is_admin },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                saldo: parseFloat(user.saldo),
                moedas: user.moedas,
                pontos: user.pontos,
                nivel: user.nivel,
                is_admin: user.is_admin
            }
        });
    } catch (err) {
        console.error('Erro login:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// VERIFICAR TOKEN
app.post('/api/verificar', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.json({ autenticado: false });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const result = await pool.query(
            'SELECT id, nome, email, saldo, moedas, pontos, nivel, is_admin FROM users WHERE id = $1',
            [decoded.id]
        );
        if (result.rows.length === 0) return res.json({ autenticado: false });
        res.json({ autenticado: true, user: result.rows[0] });
    } catch (err) {
        res.json({ autenticado: false });
    }
});

// SALVAR PONTUAÇÃO
app.post('/api/salvar-pontuacao', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Não autenticado' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { pontuacao, moedas } = req.body;
        await pool.query(
            'UPDATE users SET moedas = moedas + $1, pontos = pontos + $2 WHERE id = $3',
            [moedas || 0, pontuacao, decoded.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar' });
    }
});

// DEPÓSITO
app.post('/api/criar-deposito', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Não autenticado' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { valor } = req.body;
        if (!valor || valor < 10) return res.status(400).json({ error: 'Valor mínimo R$10' });

        const mockQrCode = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=PIX_${Date.now()}`;
        const mockPixCode = `00020126360014BR.GOV.BCB.PIX0114${Date.now()}@pou.com.br5204000053039865404${valor * 100}5802BR5925POU MONEY6009SAO PAULO6304E2C7`;

        res.json({
            success: true,
            payment: { qr_code: mockQrCode, code: mockPixCode, value: valor }
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar depósito' });
    }
});

// RANKING
app.get('/api/ranking', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nome, pontos, nivel, moedas FROM users WHERE ativo = true AND is_admin = false ORDER BY pontos DESC LIMIT 100'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar ranking' });
    }
});

// ADMIN - USUÁRIOS
app.get('/api/admin/usuarios', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Não autenticado' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded.is_admin) return res.status(403).json({ error: 'Acesso negado' });
        const result = await pool.query('SELECT id, nome, email, saldo, moedas, pontos, nivel, ativo FROM users WHERE is_admin = false ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar usuários' });
    }
});

// ============ ROTAS DAS PÁGINAS HTML (TUDO NA RAIZ) ============
// ============ ROTAS DAS PÁGINAS HTML (USANDO /views) ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/views/login.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/views/cadastro.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'cadastro.html')));
app.get('/views/jogos.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogos.html')));
app.get('/views/depositar.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'depositar.html')));
app.get('/views/ranking.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'ranking.html')));
app.get('/views/suporte.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'suporte.html')));
app.get('/views/jogar.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogar.html')));
app.get('/views/jogo-clicker.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'jogo-clicker.html')));
app.get('/views/admin/admin-login.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'admin-login.html')));
app.get('/views/admin/painel-admin.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'painel-admin.html')));

// Rotas amigáveis
app.get('/login', (req, res) => res.redirect('/views/login.html'));
app.get('/cadastro', (req, res) => res.redirect('/views/cadastro.html'));
app.get('/jogos', (req, res) => res.redirect('/views/jogos.html'));
app.get('/depositar', (req, res) => res.redirect('/views/depositar.html'));
app.get('/ranking', (req, res) => res.redirect('/views/ranking.html'));
app.get('/suporte', (req, res) => res.redirect('/views/suporte.html'));
app.get('/jogar', (req, res) => res.redirect('/views/jogar.html'));
app.get('/admin-entrar', (req, res) => res.redirect('/views/admin/admin-login.html'));
app.get('/admin-painel', (req, res) => res.redirect('/views/admin/painel-admin.html'));
// 404 handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Rota não encontrada' });
    }
    res.redirect('/login');
});

// ============ INICIAR SERVIDOR ============
initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🚀 SERVIDOR RODANDO!                       ║
╠══════════════════════════════════════════════════════════════╣
║  📡 Porta: ${PORT}                                              ║
║  🌐 URL: http://localhost:${PORT}                               ║
║  👤 Admin: admin@poumoney.com                                 ║
║  🔑 Senha: admin123                                           ║
╚══════════════════════════════════════════════════════════════╝
        `);
    });
});