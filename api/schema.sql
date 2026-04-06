-- ALPHA INSIGHTS PRO: Database Schema (PostgreSQL / Neon)

-- 1. Tabela de Usuários
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    plan TEXT DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO')),
    stripe_id TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela de Logs de Uso (Para evitar abusos)
CREATE TABLE usage_logs (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    activity TEXT, -- EX: "ANALYZE_PDF", "ANALYZE_NEWS"
    tokens_estimate INTEGER, -- Estimativa de tokens usados
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Índices para performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_usage_user ON usage_logs(user_id);
