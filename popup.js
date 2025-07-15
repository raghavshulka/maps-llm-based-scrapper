let isScrapingActive = false;
let scrapedData = [];
let emailStats = {
    direct: 0,
    website: 0,
    ai: 0,
    inferred: 0
};

// DOM elements
const scrapeBtn = document.getElementById('scrapeBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const businessCountSpan = document.getElementById('businessCount');
const emailCountSpan = document.getElementById('emailCount');
const resultsDiv = document.getElementById('results');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const autoScrollCheck = document.getElementById('autoScroll');
const useGrokAPICheck = document.getElementById('useGrokAPI');
const apiKeyInput = document.getElementById('apiKey');
const saveApiKeyBtn = document.getElementById('saveApiKey');
const customPromptInput = document.getElementById('customPrompt');

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize UI
    updateUI();
    
    // Load saved API key
    const apiKey = await getStoredApiKey();
    if (apiKey && apiKey !== 'YOUR_GROK_API_KEY') {
        document.getElementById('apiKey').value = apiKey;
    }
    
    // Load saved custom prompt
    const customPrompt = await getStoredCustomPrompt();
    if (customPrompt) {
        document.getElementById('customPrompt').value = customPrompt;
    } else {
        // Set default prompt
        const defaultPrompt = "Based on the business {businessName} which is a {businessType} located in {location}, what would be their most likely business email address?";
        document.getElementById('customPrompt').value = defaultPrompt;
        await saveCustomPrompt(defaultPrompt);
    }
    
    // Load saved settings
    chrome.storage.local.get(['settings'], (result) => {
        if (result.settings) {
            const settings = result.settings;
            if (settings.delay) document.getElementById('scrapeDelay').value = settings.delay;
            if (settings.autoScroll !== undefined) document.getElementById('autoScroll').checked = settings.autoScroll;
            if (settings.useGrokAPI !== undefined) document.getElementById('useGrokAPI').checked = settings.useGrokAPI;
        }
    });
    
    // Load saved data
    chrome.storage.local.get(['scrapedData', 'emailStats'], (result) => {
        if (result.scrapedData) {
            scrapedData = result.scrapedData;
            updateResults();
        }
        if (result.emailStats) {
            emailStats = result.emailStats;
            updateEmailStats();
        }
    });
    
    // Check if scraping is active
    chrome.runtime.sendMessage({ action: 'getScrapingStatus' }, (response) => {
        if (response && response.isActive) {
            isScrapingActive = true;
            updateUI();
        }
    });
    
    // Button event listeners
    document.getElementById('startScraping').addEventListener('click', startScraping);
    document.getElementById('stopScraping').addEventListener('click', stopScraping);
    document.getElementById('exportCSV').addEventListener('click', exportData);
    document.getElementById('clearData').addEventListener('click', clearData);
    document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
    document.getElementById('testApiKey').addEventListener('click', testApiKey);
    
    // Auto-save settings when changed
    document.getElementById('scrapeDelay').addEventListener('change', saveSettings);
    document.getElementById('autoScroll').addEventListener('change', saveSettings);
    document.getElementById('useGrokAPI').addEventListener('change', saveSettings);
    document.getElementById('customPrompt').addEventListener('input', debounce(saveCustomPromptFromInput, 1000));
    
    // Auto-save API key when user stops typing
    document.getElementById('apiKey').addEventListener('input', debounce(autoSaveApiKey, 2000));
    
    // Auto-update stats
    setInterval(updateStatsFromStorage, 1000);
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'dataScraped':
            handleScrapedData(message.data);
            break;
        case 'statusUpdate':
            updateStatus(message.status, message.type);
            break;
        case 'scrapingComplete':
            isScrapingActive = false;
            updateUI();
            updateStatus('Scraping complete!', 'success');
            break;
        case 'scrapingError':
            isScrapingActive = false;
            updateUI();
            updateStatus(`Error: ${message.error}`, 'error');
            break;
    }
});

// Start scraping
function startScraping() {
    // Check if we're on Google Maps
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];
        if (!tab.url || (!tab.url.includes('google.com/maps') && !tab.url.includes('maps.google.com'))) {
            updateStatus('Please navigate to Google Maps search results first', 'error');
            return;
        }
        
        isScrapingActive = true;
        updateUI();
        
        const settings = {
            delay: parseInt(document.getElementById('scrapeDelay').value) || 1500,
            autoScroll: document.getElementById('autoScroll').checked,
            useGrokAPI: document.getElementById('useGrokAPI').checked,
            customPrompt: document.getElementById('customPrompt').value
        };
        
        // Save settings
        saveSettings();
        
        chrome.tabs.sendMessage(tab.id, {
            action: 'startScraping',
            settings: settings
        });
        
        updateStatus('Starting scraping process...', 'warning');
    });
}

// Stop scraping
function stopScraping() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopScraping' });
    });
    
    isScrapingActive = false;
    updateUI();
    updateStatus('Scraping stopped', 'warning');
}

// Handle messages from content script
function handleScrapedData(data) {
    // Check if business already exists
    const existingIndex = scrapedData.findIndex(item => 
        item.name === data.name && item.address === data.address
    );
    
    if (existingIndex === -1) {
        // Track email source
        if (data.email) {
            if (data.email_source === 'inferred') {
                emailStats.inferred++;
            } else if (data.email_source === 'website') {
                emailStats.website++;
            } else if (data.email_source === 'ai') {
                emailStats.ai++;
            } else {
                emailStats.direct++;
            }
        }
        
        scrapedData.push(data);
        saveData();
        updateResults();
        updateEmailStats();
    }
}

// Update UI
function updateUI() {
    const startBtn = document.getElementById('startScraping');
    const stopBtn = document.getElementById('stopScraping');
    const exportBtn = document.getElementById('exportCSV');
    const clearBtn = document.getElementById('clearData');
    
    if (isScrapingActive) {
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        exportBtn.disabled = true;
        clearBtn.disabled = true;
    } else {
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        exportBtn.disabled = scrapedData.length === 0;
        clearBtn.disabled = scrapedData.length === 0;
    }
}

// Update status
function updateStatus(message, type = 'default') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

// Export data to CSV
function exportData() {
    if (scrapedData.length === 0) return;
    
    const csv = convertToCSV(scrapedData);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    
    chrome.downloads.download({
        url: url,
        filename: `google-maps-data-${new Date().toISOString().slice(0, 10)}.csv`
    });
    
    updateStatus('Data exported successfully!', 'success');
}

// Clear data
function clearData() {
    if (confirm('Are you sure you want to clear all scraped data?')) {
        scrapedData = [];
        emailStats = { direct: 0, website: 0, ai: 0, inferred: 0 };
        saveData();
        updateResults();
        updateEmailStats();
        updateUI();
        updateStatus('Data cleared', 'warning');
    }
}

// Save settings to storage
function saveSettings() {
    const settings = {
        delay: parseInt(document.getElementById('scrapeDelay').value) || 1500,
        autoScroll: document.getElementById('autoScroll').checked,
        useGrokAPI: document.getElementById('useGrokAPI').checked,
        customPrompt: document.getElementById('customPrompt').value
    };
    
    chrome.storage.local.set({ settings });
    saveCustomPrompt(settings.customPrompt);
}

// Auto-save API key function
async function autoSaveApiKey() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (apiKey && apiKey.length > 10) { // Basic validation
        try {
            await chrome.storage.local.set({ grokApiKey: apiKey });
            updateStatus('API key auto-saved', 'success');
            
            // Send message to background script
            chrome.runtime.sendMessage({ action: 'apiKeyUpdated' });
        } catch (error) {
            console.error('Failed to auto-save API key:', error);
        }
    }
}

// Save custom prompt from input
async function saveCustomPromptFromInput() {
    const prompt = document.getElementById('customPrompt').value;
    await saveCustomPrompt(prompt);
}

// Debounce function to limit API calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Test API key function
async function testApiKey() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (!apiKey) {
        updateStatus('Please enter an API key first', 'error');
        return;
    }
    
    if (apiKey.length < 10) {
        updateStatus('API key seems too short', 'error');
        return;
    }
    
    updateStatus('Testing API key...', 'warning');
    
    try {
        // Save the API key first
        await chrome.storage.local.set({ grokApiKey: apiKey });
        
        // Test with a simple prompt
        const testResponse = await chrome.runtime.sendMessage({
            action: 'generateEmailWithAI',
            prompt: 'Generate a test email for a business called "Test Company" located in "Test City"',
            businessData: {
                name: 'Test Company',
                type: 'test business',
                location: 'Test City'
            }
        });
        
        if (testResponse && testResponse.success) {
            updateStatus('API key is working! ✓', 'success');
        } else {
            updateStatus(`API test failed: ${testResponse.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        updateStatus(`API test error: ${error.message}`, 'error');
        console.error('API test error:', error);
    }
}

async function saveApiKey() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (!apiKey) {
        updateStatus('Please enter an API key', 'error');
        return;
    }
    
    if (apiKey.length < 10) {
        updateStatus('API key seems too short. Please check and try again.', 'error');
        return;
    }
    
    try {
        await chrome.storage.local.set({ grokApiKey: apiKey });
        updateStatus('API key saved successfully!', 'success');
        
        // Send message to background script
        chrome.runtime.sendMessage({ action: 'apiKeyUpdated' });
    } catch (error) {
        updateStatus('Failed to save API key. Please try again.', 'error');
        console.error('API key save error:', error);
    }
}

async function getStoredApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['grokApiKey'], (result) => {
            resolve(result.grokApiKey || '');
        });
    });
}

async function saveCustomPrompt(prompt) {
    await chrome.storage.local.set({ customPrompt: prompt });
}

async function getStoredCustomPrompt() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['customPrompt'], (result) => {
            resolve(result.customPrompt || '');
        });
    });
}

function updateEmailStats() {
    document.getElementById('directEmailCount').textContent = emailStats.direct;
    document.getElementById('websiteEmailCount').textContent = emailStats.website;
    document.getElementById('aiEmailCount').textContent = emailStats.ai;
    document.getElementById('inferredEmailCount').textContent = emailStats.inferred;
}

function updateResults() {
    const resultsDiv = document.getElementById('results');
    const businessCount = document.getElementById('businessCount');
    const emailCount = document.getElementById('emailCount');
    
    businessCount.textContent = scrapedData.length;
    emailCount.textContent = scrapedData.filter(item => item.email).length;
    
    if (scrapedData.length === 0) {
        resultsDiv.innerHTML = '<p style="text-align: center; color: #999;">No data scraped yet</p>';
        return;
    }
    
    resultsDiv.innerHTML = scrapedData.map((item, index) => {
        const emailDisplay = item.email 
            ? `<span class="email">${item.email}</span>` 
            : '<span class="no-email">No email found</span>';
        
        const additionalEmails = item.additional_emails && item.additional_emails.length > 0
            ? `<br>Additional: ${item.additional_emails.join(', ')}`
            : '';
        
        return `
            <div class="result-item">
                <h4>${index + 1}. ${item.name || 'Unknown Business'}</h4>
                <p>📍 ${item.address || 'No address'}</p>
                ${item.phone ? `<p>📞 ${item.phone}</p>` : ''}
                ${item.website ? `<p>🌐 ${item.website}</p>` : ''}
                <p>✉️ ${emailDisplay}${additionalEmails}</p>
                ${item.rating ? `<p>⭐ ${item.rating}</p>` : ''}
            </div>
        `;
    }).join('');
}

function updateStatsFromStorage() {
    if (isScrapingActive) {
        chrome.storage.local.get(['scrapedData', 'emailStats'], (result) => {
            if (result.scrapedData && result.scrapedData.length > scrapedData.length) {
                scrapedData = result.scrapedData;
                updateResults();
            }
            if (result.emailStats) {
                emailStats = result.emailStats;
                updateEmailStats();
            }
        });
    }
}

function convertToCSV(data) {
    const headers = ['Name', 'Address', 'Phone', 'Website', 'Email', 'Additional Emails', 'Rating'];
    const rows = data.map(item => [
        item.name || '',
        item.address || '',
        item.phone || '',
        item.website || '',
        item.email || '',
        (item.additional_emails || []).join('; '),
        item.rating || ''
    ]);
    
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    return csvContent;
}

function saveData() {
    chrome.storage.local.set({ 
        scrapedData: scrapedData,
        emailStats: emailStats
    });
} 