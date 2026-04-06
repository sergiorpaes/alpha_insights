// ALPHA INSIGHTS PRO: Backend API (Koyeb / Node.js)
// Este código deve ser implantado no Koyeb como um WebService.

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// 1. Configurações do Banco (Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 2. Configurações da IA (Gemini)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- ENDPOINT: ANALISAR (O CORAÇÃO DO SISTEMA) ---
app.post('/api/analisar', authenticateToken, async (req, res) => {
  const { prompt, perfil } = req.body;
  const userEmail = req.user.email;

  try {
    // 1. Verificar Plano no Banco (Neon)
    const userRes = await pool.query('SELECT plan FROM users WHERE email = $1', [userEmail]);
    const userPlan = userRes.rows[0]?.plan || 'FREE';

    // 2. Bloquear Perfis Pagos para usuários Free
    const paidProfiles = ['agressivo', 'sarcastico', 'legal'];
    if (userPlan === 'FREE' && paidProfiles.includes(perfil)) {
      return res.status(403).json({ error: 'Upgrade para PRO necessário para este perfil.' });
    }

    // 3. Chamar Gemini (Protegido e Privado)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // 4. Logar Uso
    await pool.query('INSERT INTO usage_logs (user_id, activity) SELECT id, $1 FROM users WHERE email = $2', 
      [`ANALYZE_${perfil.toUpperCase()}`, userEmail]);

    res.json({ text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno no processamento de IA.' });
  }
});

// --- WEBHOOK STRIPE (PARA ATUALIZAR STATUS PRO) ---
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details.email;
    
    // Atualiza usuário para PRO no Neon
    await pool.query('UPDATE users SET plan = $1 WHERE email = $2', ['PRO', customerEmail]);
  }

  res.json({received: true});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Alpha Insights API rodando na porta ${PORT}`));
