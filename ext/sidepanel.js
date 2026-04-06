import * as pdfjsLib from './lib/pdf.mjs';
import { checkAuth, loginWithGoogle, logout } from './auth.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.mjs';

// --- CONFIGURAÇÃO GLOBAL ---
// Substitua pela URL da sua API no Koyeb após o deploy
const BACKEND_URL = "https://sua-app-no-koyeb.koyeb.app"; 

// --- INICIALIZAÇÃO ---
window.addEventListener('load', async () => {
    await checkAuth();
});

document.getElementById('btnLogin')?.addEventListener('click', async () => {
    await loginWithGoogle();
});

document.getElementById('userProfile')?.addEventListener('click', async () => {
    if (confirm("Deseja sair da sua conta?")) {
        await logout();
    }
});

const getApiKey = async () => {
    const res = await chrome.storage.local.get(['user']);
    return res.user ? res.user.token : null;
};

// --- UTILITÁRIOS DE UI ---
const showLoading = (message) => {
    const output = document.getElementById('output');
    output.innerHTML = `
        <div class="loading-container">
            <div class="spinner"></div>
            <p>${message}</p>
        </div>`;
};

const showError = (message) => {
    const output = document.getElementById('output');
    output.innerHTML = `<div class="error-message">⚠️ ${message}</div>`;
};

const updateSentimentGauge = (score, label) => {
    const fill = document.querySelector('.gauge-fill');
    const text = document.querySelector('.score-text');
    
    const rotation = (score / 100) * 0.5;
    fill.style.transform = `rotate(${rotation}turn)`;
    
    // Cor dinâmica baseada no score
    let color = "#ff5252"; // Baixa
    if (score > 30) color = "#ffd740"; // Neutro
    if (score > 65) color = "#64ffda"; // Alta
    
    fill.style.background = color;
    text.style.color = color;

    // Contador animado
    let current = 0;
    const interval = setInterval(() => {
        if (current >= score) {
            text.textContent = score;
            clearInterval(interval);
        } else {
            current++;
            text.textContent = current;
        }
    }, 10);
};

const displayResult = (data) => {
    const output = document.getElementById('output');
    output.innerHTML = `
        <div class="sentiment-box">
            <div class="gauge">
                <div class="gauge-body"></div>
                <div class="gauge-fill"></div>
                <div class="gauge-cover">
                    <span class="score-text">0</span>
                </div>
            </div>
            <div class="sentiment-label">${data.sentiment || "Analisando..."}</div>
            <div class="gauge-legend">
                <span class="legend-info" title="0-30: Baixa | 31-65: Neutro | 66-100: Alta">ⓘ Entenda o Score</span>
            </div>
        </div>
        <div class="resumo-card">
            <div class="resumo-text">${data.summary}</div>
            <div class="sugestao-container">
                <span class="sugestao-title">📍 Insight Acionável:</span>
                <span class="sugestao-content">${data.suggestion}</span>
            </div>
            <div class="analysis-stats">
              📁 ${data.pages ? data.pages + ' páginas |' : ''} 🔍 ${data.chars.toLocaleString()} caracteres processados
            </div>
        </div>`;
    
    setTimeout(() => updateSentimentGauge(data.score || 50, data.sentiment || "Neutro"), 100);
};

// --- HANDLER PRINCIPAL DE ANÁLISE ---
document.getElementById('btnAnalisar').addEventListener('click', async () => {
    const output = document.getElementById('output');
    const manualArea = document.getElementById('manualArea');
    const perfil = document.getElementById('selectPerfil').value;
  
    let textoParaAnalisar = manualArea.value.trim();
    let numPagesResult = 0;
  
    // 1. Captura de Conteúdo (PDF ou Web)
    if (!textoParaAnalisar) {
      showLoading("Escaneando mercado...");
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        const detection = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.contentType
        }).catch(() => [{ result: '' }]);
        
        const isPDF = detection[0].result === 'application/pdf' || 
                      tab.url.toLowerCase().endsWith('.pdf') || 
                      (tab.url.includes('chrome-extension://') && tab.url.includes('pdf'));
  
        if (isPDF) {
            const response = await fetch(tab.url);
            const arrayBuffer = await response.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            numPagesResult = pdf.numPages;
            
            let fullText = "";
            for (let i = 1; i <= numPagesResult; i++) {
                showLoading(`Lendo PDF... Página ${i} de ${numPagesResult}`);
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => item.str).join(" ");
                fullText += pageText + "\n";
                if (i % 10 === 0) await new Promise(r => setTimeout(r, 10));
            }
            textoParaAnalisar = fullText;
        } else {
          const response = await chrome.tabs.sendMessage(tab.id, { action: "getPageContent" }).catch(() => null);
          
          if (response && response.content) {
            textoParaAnalisar = response.content;
          } else {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const selects = ['.news-body--content', '.news-body', '.LiveBlogBody-articleBody', '.FeaturedContent-articleBody', '.Article-articleBody', 'article', 'main', '.content', '.post-content', '.news-text'];
                for (let s of selects) {
                    const el = document.querySelector(s);
                    if (el && el.innerText.length > 300) return el.innerText;
                }
                return document.body.innerText;
              }
            });
            textoParaAnalisar = results[0]?.result?.trim();
          }
        }
      } catch (e) { 
          console.error(e);
      }
    }
  
    if (!textoParaAnalisar || textoParaAnalisar.length < 100) {
      output.innerHTML = `<div class="error-message">⚠️ Captura falhou. Use a caixa manual abaixo.</div>`;
      manualArea.style.display = "block";
      return;
    }
  
    showLoading("IA Alpha processando...");
  
    // 2. Preparação do Prompt para o Backend
    const profileInstructions = {
      agressivo: "Análise focada em oportunidades de crescimento rápido e alto risco.",
      conservador: "Análise voltada para preservação de patrimônio e dividendos.",
      sarcastico: "O Cético. Foco em encontrar falhas no discurso corporativo.",
      legal: "Análise técnica, jurídica e conformidade formal."
    };
  
    const personaInstruction = profileInstructions[perfil] || "";
    const isFormal = perfil === 'legal';
  
    const prompt = `Aja como analista PRO perfil ${perfil.toUpperCase()}. ${personaInstruction}
      ${isFormal ? 'Tom extremamente formal.' : 'Tom direto.'}
      Analise o documento completo e retorne APENAS o formato especificado.
      
      FORMATO:
      SENTIMENTO: [Alta/Baixa/Neutro]
      SCORE: [0-100]
      TITULO: [Título]
      RESUMO: [Analise]
      SUGESTAO: [Dica]
      
      Texto: ${textoParaAnalisar.substring(0, 200000)}`;
  
    // 3. Chamada ao Backend SaaS (Koyeb)
    const token = await getApiKey(); 
  
    try {
        const res = await fetch(`${BACKEND_URL}/api/analisar`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ prompt, perfil })
        });
  
        const data = await res.json();
        
        if (data.error) {
            if (data.error.includes("PRO")) {
                showError(`💎 ${data.error} <br><br> <a href="https://seu-site-netlify.com/checkout" target="_blank" style="color:var(--accent)">Assinar PRO</a>`);
            } else {
                showError(data.error);
            }
            return;
        }
  
        if (data.text) {
            const respText = data.text;
            
            const sentiment = (respText.match(/SENTIMENTO:\s*(.*)/i) || [,"Neutro"])[1].trim().replace(/\*/g, '');
            const score = parseInt((respText.match(/SCORE:\s*(\d+)/i) || [,50])[1]);
            const title = (respText.match(/TITULO:\s*(.*)/i) || [,"Nova Insight"])[1].trim().replace(/\*/g, '');
            const summary = (respText.match(/RESUMO:\s*([\s\S]*?)(?=SUGESTAO:|$)/i) || [,""])[1].trim().replace(/\*/g, '');
            const suggestion = (respText.match(/SUGESTAO:\s*([\s\S]*)/i) || [,""])[1].trim().replace(/\*/g, '');
  
            displayResult({ 
                title, sentiment, score, summary, suggestion, 
                chars: textoParaAnalisar.length, pages: numPagesResult 
            });
            manualArea.style.display = "none";
        }
    } catch (e) { 
        showError("Falha na conexão com o servidor Pro."); 
    }
});

document.getElementById('btnLimpar').addEventListener('click', () => {
    document.getElementById('output').innerHTML = "";
    const manual = document.getElementById('manualArea');
    manual.value = "";
    manual.style.display = "none";
});