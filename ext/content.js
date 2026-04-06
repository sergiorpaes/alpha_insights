// Enhanced extraction engine for Alpha Insights
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageContent") {
    let textoExtraido = "";

    // 1. Check for PDF Text Layers (Chrome/Edge PDF Viewer)
    const layers = document.querySelectorAll(".textLayer");
    if (layers.length > 0) {
      textoExtraido = Array.from(layers)
        .map(l => l.innerText)
        .join("\n");
    }

    // 2. If no PDF layers, look for article/main content (HTML)
    if (!textoExtraido || textoExtraido.trim().length < 200) {
      const selectors = [
        ".news-body--content",
        ".news-body",
        ".news-main",
        ".LiveBlogBody-articleBody",
        ".FeaturedContent-articleBody",
        ".Article-articleBody",
        ".noticia-interna",
        "article",
        ".news-content",
        ".post-content",
        ".article-body",
        "main",
        ".content"
      ];

      for (let selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText.trim().length > 300) {
          textoExtraido = el.innerText;
          break;
        }
      }
    }

    // 3. Fallback to full body text if nothing specific found
    if (!textoExtraido || textoExtraido.trim().length < 100) {
      // Remove noisy elements before capturing body text
      const noise = ["nav", "footer", "aside", ".sidebar", "header", ".ads", ".comments", "script", "style", ".recaptcha", "#recaptcha"];
      const bodyClone = document.body.cloneNode(true);
      noise.forEach(s => {
        bodyClone.querySelectorAll(s).forEach(n => n.remove());
      });
      textoExtraido = bodyClone.innerText;
    }

    // 4. Return result (capped for API efficiency)
    if (!textoExtraido || textoExtraido.trim().length < 50) {
        sendResponse({ content: null });
    } else {
        // Clean up common whitespace noise
        const cleanText = textoExtraido
            .replace(/\s\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();
        sendResponse({ content: cleanText.substring(0, 18000) });
    }
  }
  return true;
});