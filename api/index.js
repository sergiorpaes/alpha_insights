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

// --- VALIDAÇÃO DE STARTUP ---
const requiredVars = ['DATABASE_URL', 'GEMINI_API_KEY', 'STRIPE_SECRET_KEY'];
requiredVars.forEach(v => {
  if (!process.env[v] || process.env[v] === 'undefined' || process.env[v] === '') {
    console.error(`❌ ERRO CRÍTICO: Variável de ambiente ${v} não definida!`);
    process.exit(1);
  }
});

// 1. Configurações do Banco (Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

console.log("✅ Banco de dados configurado.");

// 2. Configurações da IA (Gemini)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const authenticateGoogleToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: "Token não fornecido." });

  try {
    // 1. Valida com o Google
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const googleUser = await response.json();

    if (googleUser.error) {
      console.error("Google Auth Error:", googleUser.error);
      return res.status(403).json({ error: "Sessão expirada. Faça login novamente." });
    }

    const email = googleUser.email;
    const name = googleUser.name || 'Usuário Alpha';

    // 2. Garante registro no Neon
    try {
      const userCheck = await pool.query('SELECT plan FROM users WHERE email = $1', [email]);
      
      if (userCheck.rows.length === 0) {
        await pool.query(
          'INSERT INTO users (email, full_name, plan) VALUES ($1, $2, $3)',
          [email, name, 'FREE']
        );
        req.user = { email, plan: 'FREE' };
      } else {
        req.user = { email, plan: userCheck.rows[0].plan };
      }
      next();
    } catch (dbError) {
      console.error("Neon DB Error:", dbError);
      return res.status(500).json({ error: "Erro ao acessar banco de dados Neon." });
    }

  } catch (error) {
    console.error("General Auth Middleware Error:", error);
    res.status(500).json({ error: "Falha de conexão com os serviços de autenticação." });
  }
};

// --- ENDPOINT: ANALISAR ---
app.post('/api/analisar', authenticateGoogleToken, async (req, res) => {
  const { prompt, perfil } = req.body;
  const { email, plan } = req.user;

  try {
    const paidProfiles = ['agressivo', 'sarcastico', 'legal'];
    if (plan === 'FREE' && paidProfiles.includes(perfil)) {
      return res.json({ error: '🛡️ PARE: Este perfil é exclusivo para membros PRO. <br> <a href="https://seu-site.com/assinar" target="_blank">Clique aqui para liberar</a>' });
    }

    // --- BÚSSOLA DE MODELOS (Fallback) ---
    // Como os modelos do Google mudam, testamos do mais moderno para o mais estável
    const modelsToTry = [
      "gemini-2.5-flash",
      "gemini-1.5-flash-latest", 
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro"
    ];

    let text = "";
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Tentando processar com o modelo: ${modelName}...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        text = response.text();
        console.log(`✅ Sucesso com o modelo: ${modelName}`);
        break; // Deu certo, sai do loop!
      } catch (e) {
        console.log(`❌ Falha no modelo ${modelName}: ${e.message.substring(0, 50)}...`);
        lastError = e;
      }
    }

    if (!text) {
      throw lastError; // Se todos falharem, joga o último erro pro catch principal
    }

    // Audit log (silencioso)
    pool.query('INSERT INTO usage_logs (user_id, activity) SELECT id, $1 FROM users WHERE email = $2', 
      [`ANALYZE_${perfil.toUpperCase()}`, email]).catch(e => console.error("Log error:", e));

    res.json({ text });
  } catch (error) {
    console.error("Gemini/Processing Error:", error);
    
    // Erros específicos do Google Gemini
    let userMessage = 'Erro ao gerar insight. Tente novamente em instantes.';
    if (error.message && error.message.includes('API key')) {
      userMessage = 'Erro: Chave API do Gemini inválida ou não configurada.';
    } else if (error.message && error.message.includes('quota')) {
      userMessage = 'Erro: Limite de uso do Gemini atingido.';
    } else if (error.message && error.message.includes('safety')) {
      userMessage = 'Erro: O Gemini bloqueou este conteúdo por segurança.';
    }

    res.status(500).json({ error: userMessage });
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
    const stripeCustomerId = session.customer; // O ID único do cliente no Stripe
    
    // Atualiza usuário para PRO e salva o ID do Stripe
    await pool.query(
      'UPDATE users SET plan = $1, stripe_id = $2 WHERE email = $3', 
      ['PRO', stripeCustomerId, customerEmail]
    );
    console.log(`✅ Assinatura PRO ativada para: ${customerEmail}`);
  } 
  
  else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    // Quando a assinatura é cancelada ou o pagamento de renovação falha
    const stripeObject = event.data.object;
    const stripeCustomerId = stripeObject.customer;
    
    if (stripeCustomerId) {
      // Rebaixa o usuário localizando pelo ID do Stripe
      await pool.query(
        'UPDATE users SET plan = $1 WHERE stripe_id = $2', 
        ['FREE', stripeCustomerId]
      );
      console.log(`❌ Assinatura expirada/falha. Usuário rebaixado para FREE (Stripe ID: ${stripeCustomerId})`);
    }
  }

  res.json({received: true});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Alpha Insights API rodando na porta ${PORT}`));
