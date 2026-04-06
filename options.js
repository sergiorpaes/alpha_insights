// Saves options to chrome.storage
const saveOptions = () => {
    const apiKey = document.getElementById('apiKey').value;
    chrome.storage.sync.set(
      { geminiApiKey: apiKey },
      () => {
        // Update status to let user know options were saved.
        const status = document.getElementById('status');
        status.textContent = 'Configurações salvas com sucesso!';
        status.className = 'success';
        setTimeout(() => {
          status.textContent = '';
          status.className = '';
        }, 3000);
      }
    );
  };
  
  // Restores select box and checkbox state using the preferences
  // stored in chrome.storage.
  const restoreOptions = () => {
    chrome.storage.sync.get(
      { geminiApiKey: '' },
      (items) => {
        document.getElementById('apiKey').value = items.geminiApiKey;
      }
    );
  };
  
  document.addEventListener('DOMContentLoaded', restoreOptions);
  document.getElementById('save').addEventListener('click', saveOptions);
