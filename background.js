// Background service worker for Google Maps Data Scraper

// Store active tab information
let activeScrapingTab = null;

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'startScraping':
            activeScrapingTab = sender.tab.id;
            break;
        case 'stopScraping':
            activeScrapingTab = null;
            break;
        case 'getScrapingStatus':
            sendResponse({ isActive: activeScrapingTab !== null });
            break;
        case 'apiKeyUpdated':
            console.log('API key updated, clearing cache if any');
            // Clear any cached API key validation
            break;
        case 'fetchWebsiteData':
            // This would be used to fetch website data to extract emails
            // Due to CORS restrictions, this would need a proxy or API service
            fetchWebsiteData(message.url).then(sendResponse);
            return true; // Will respond asynchronously
        case 'scrapeWebsiteForEmails':
            // New enhanced website scraping for emails
            scrapeWebsiteForEmails(message.url, message.businessName).then(sendResponse);
            return true; // Will respond asynchronously
        case 'generateEmailWithAI':
            generateEmailWithAI(message.prompt, message.businessData).then(sendResponse);
            return true;
        case 'useGrokAPI':
            // Integration with Grok API for enhanced email extraction
            callGrokAPI(message.data).then(sendResponse);
            return true; // Will respond asynchronously
    }
});

// Function to fetch website data (would need CORS proxy in production)
async function fetchWebsiteData(url) {
    try {
        // In a production environment, you would:
        // 1. Use a CORS proxy service
        // 2. Or implement your own backend API
        // 3. Or use a service like Grok API
        
        // For now, return a placeholder
        return {
            success: false,
            message: 'Website fetching requires a backend service or CORS proxy'
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Enhanced function to scrape website for emails
async function scrapeWebsiteForEmails(url, businessName) {
    try {
        console.log('Attempting to scrape website for emails:', url);
        
        // Method 1: Try to use a CORS proxy service
        const proxyUrls = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://cors-anywhere.herokuapp.com/${url}`,
            `https://thingproxy.freeboard.io/fetch/${url}`
        ];
        
        let websiteContent = null;
        let successfulProxy = null;
        
        for (const proxyUrl of proxyUrls) {
            try {
                console.log('Trying proxy:', proxyUrl);
                const response = await fetch(proxyUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                if (response.ok) {
                    websiteContent = await response.text();
                    successfulProxy = proxyUrl;
                    console.log('Successfully fetched website content using proxy');
                    break;
                }
            } catch (proxyError) {
                console.log('Proxy failed:', proxyError);
                continue;
            }
        }
        
        if (!websiteContent) {
            // Method 2: Try to use the Grok API to analyze the website
            console.log('Direct website scraping failed, trying Grok API approach');
            return await analyzeWebsiteWithGrokAPI(url, businessName);
        }
        
        // Extract emails from website content
        const emails = extractEmailsFromWebsiteContent(websiteContent, businessName);
        
        if (emails.length > 0) {
            console.log('Found emails from website:', emails);
            return {
                success: true,
                emails: emails,
                method: 'website_scraping',
                proxy: successfulProxy
            };
        } else {
            console.log('No emails found in website content');
            return {
                success: false,
                message: 'No emails found in website content'
            };
        }
        
    } catch (error) {
        console.error('Website scraping error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Extract emails from website content
function extractEmailsFromWebsiteContent(content, businessName) {
    const emails = new Set();
    
    // Enhanced email regex pattern
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    const matches = content.match(emailPattern) || [];
    
    // Filter and validate emails
    matches.forEach(email => {
        const lowerEmail = email.toLowerCase();
        
        // Skip common false positives
        const blacklist = [
            'example.com',
            'example.org',
            'test.com',
            'localhost',
            'noreply@',
            'no-reply@',
            'donotreply@',
            '@2x',
            '@3x',
            'sentry.io',
            'gstatic.com',
            'googleapis.com',
            'google.com',
            'facebook.com',
            'twitter.com',
            'instagram.com',
            'linkedin.com',
            'youtube.com',
            'youtu.be',
            'bit.ly',
            'tinyurl.com',
            'goo.gl',
            'ow.ly',
            'short.link',
            'placeholder',
            'dummy',
            'fake',
            'invalid',
            'admin@',
            'webmaster@',
            'postmaster@',
            'hostmaster@',
            'abuse@',
            'security@',
            'privacy@',
            'legal@',
            'dmca@',
            'copyright@'
        ];
        
        const isBlacklisted = blacklist.some(blocked => lowerEmail.includes(blocked));
        
        if (!isBlacklisted && isValidEmailFormat(email)) {
            emails.add(email);
        }
    });
    
    // Prioritize emails that might be business-related
    const emailArray = Array.from(emails);
    const businessEmails = [];
    const otherEmails = [];
    
    emailArray.forEach(email => {
        const lowerEmail = email.toLowerCase();
        const localPart = lowerEmail.split('@')[0];
        
        // Business-related keywords
        const businessKeywords = [
            'info', 'contact', 'sales', 'support', 'admin', 'office', 'business',
            'service', 'help', 'inquiry', 'marketing', 'team', 'reception',
            'booking', 'reservations', 'orders', 'customerservice', 'hello',
            'welcome', 'general', 'mail', 'enquiry', 'enquiries', 'shop',
            'store', 'company', 'corp', 'inc', 'llc', 'group', 'services',
            'solutions', 'consulting', 'management', 'director', 'manager',
            'owner', 'ceo', 'president', 'founder', 'principal', 'partner'
        ];
        
        const hasBusinessKeywords = businessKeywords.some(keyword => localPart.includes(keyword));
        
        // Check if email domain matches business name
        const domain = lowerEmail.split('@')[1];
        const businessWords = businessName ? businessName.toLowerCase().split(' ') : [];
        const domainMatchesBusiness = businessWords.some(word => 
            word.length > 3 && domain.includes(word)
        );
        
        if (hasBusinessKeywords || domainMatchesBusiness) {
            businessEmails.push(email);
        } else {
            otherEmails.push(email);
        }
    });
    
    // Return business emails first, then other emails
    return [...businessEmails, ...otherEmails];
}

// Helper function to validate email format
function isValidEmailFormat(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

// Analyze website using Grok API when direct scraping fails
async function analyzeWebsiteWithGrokAPI(url, businessName) {
    try {
        const GROK_API_KEY = 'YOUR_GROK_API_KEY';
        const API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
        
        const websiteAnalysisPrompt = `
You are an expert at finding business contact information from websites. 
I need you to analyze the website ${url} for the business "${businessName || 'Unknown Business'}" and extract any email addresses.

Please provide your best analysis of what emails might be found on this website based on:
1. Common business email patterns for this type of business
2. Typical email formats businesses use
3. Industry-standard contact methods

Return the results in this JSON format:
{
    "emails": ["email1@example.com", "email2@example.com"],
    "confidence": "high|medium|low",
    "reasoning": "Brief explanation of why these emails are likely"
}

Focus on:
- Contact emails (info@, contact@, sales@, support@)
- Business domain emails that match the business name
- Industry-specific contact patterns

If no emails can be reasonably inferred, return an empty emails array.
`;

        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROK_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': chrome.runtime.getURL(''),
                'X-Title': 'Google Maps Data Scraper - Website Analysis'
            },
            body: JSON.stringify({
                model: 'x-ai/grok-3-mini-beta',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant specialized in finding business contact information. Always respond with valid JSON.'
                    },
                    {
                        role: 'user',
                        content: websiteAnalysisPrompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 300,
                top_p: 0.9
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content;
        
        if (!content) {
            throw new Error('No content received from API');
        }

        // Try to parse the JSON response
        let extractedData;
        try {
            const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
            extractedData = JSON.parse(cleanContent);
        } catch (parseError) {
            // If JSON parsing fails, try to extract emails using regex
            const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
            const emails = content.match(emailRegex) || [];
            
            extractedData = {
                emails: emails,
                confidence: 'low',
                reasoning: 'Extracted from unstructured response'
            };
        }

        if (extractedData.emails && extractedData.emails.length > 0) {
            console.log('Found emails from Grok API website analysis:', extractedData.emails);
            return {
                success: true,
                emails: extractedData.emails,
                method: 'grok_api_website_analysis',
                confidence: extractedData.confidence,
                reasoning: extractedData.reasoning
            };
        } else {
            return {
                success: false,
                message: 'No emails found through AI analysis'
            };
        }
        
    } catch (error) {
        console.error('Grok API website analysis error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Function to call Grok API for enhanced data extraction
async function callGrokAPI(data) {
    try {
        // API key should be stored in chrome.storage or environment variable
        // For demonstration, using a placeholder - users should add their own key
        const GROK_API_KEY = await getGrokAPIKey();
        
        console.log('Grok API Key length:', GROK_API_KEY ? GROK_API_KEY.length : 'null');
        
        if (!GROK_API_KEY || GROK_API_KEY === 'YOUR_GROK_API_KEY' || GROK_API_KEY.length < 10) {
            console.log('Grok API key not configured, skipping AI-enhanced extraction');
            return {
                success: false,
                message: 'Grok API key not configured or invalid. Please enter a valid API key in the extension settings.'
            };
        }

        // Using OpenRouter as the provider (most reliable option)
        const API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
        
        // Alternative endpoints you can use:
        // const API_ENDPOINT = 'https://api.aimlapi.com/v1/chat/completions';
        // const API_ENDPOINT = 'https://gateway.theturbo.ai/v1/chat/completions';
        
        // Enhanced prompt for better email extraction
        const extractionPrompt = `
You are an expert at finding business contact information. I need you to analyze the following business data and help find potential email addresses, phone numbers, and other contact information.

Business Information:
- Name: ${data.name || 'Unknown'}
- Address: ${data.address || 'Unknown'}
- Phone: ${data.phone || 'Unknown'}
- Website: ${data.website || 'Unknown'}
- Additional Information: ${data.additionalInfo || 'None'}

Please help me find contact information by:

1. **Email Address Analysis**: 
   - If a website is provided, suggest likely email patterns for this business
   - Consider common business email formats (info@, contact@, sales@, support@, hello@)
   - Look for patterns in the business name that might form email addresses
   - Consider the business type and industry-standard contact methods
   - For domains like example.com, suggest: info@example.com, contact@example.com, hello@example.com, admin@example.com, support@example.com

2. **Phone Number Analysis**:
   - Extract any additional phone numbers from the additional information
   - Look for alternative formats of existing numbers
   - Identify fax numbers or other contact numbers

3. **Contact Method Analysis**:
   - Identify social media profiles mentioned
   - Find any alternative contact methods
   - Look for physical addresses or location information

4. **Business Domain Analysis**:
   - If the business has a website, what domain-based emails are most likely?
   - What are common email patterns for this type of business?
   - Are there industry-specific contact methods?

Please provide your analysis in this JSON format:
{
    "emails": ["email1@example.com", "email2@example.com"],
    "phones": ["phone1", "phone2"],
    "social_media": ["profile1", "profile2"],
    "additional_contacts": ["contact1", "contact2"],
    "confidence": "high|medium|low",
    "reasoning": "Brief explanation of your analysis",
    "suggestions": ["suggestion1", "suggestion2"]
}

Focus on realistic, likely contact information based on the business data provided. If no specific information can be determined, provide educated guesses based on common business practices and patterns.

IMPORTANT: Always include at least 3-5 likely email addresses if a website domain is provided.

Return only valid JSON.
`;

        console.log('Calling Grok API for enhanced data extraction...');
        
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROK_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://google-maps-scraper.com',
                'X-Title': 'Google Maps Data Scraper'
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-3.1-8b-instruct:free', // Using free model
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant specialized in extracting and analyzing business contact information. Always respond with valid JSON and provide realistic, useful suggestions.'
                    },
                    {
                        role: 'user',
                        content: extractionPrompt
                    }
                ],
                temperature: 0.3, // Lower temperature for more consistent results
                max_tokens: 800, // Increased for more detailed responses
                top_p: 0.9
            })
        });

        console.log('Grok API Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Grok API HTTP error:', response.status, errorText);
            
            // Return a more helpful error message
            return {
                success: false,
                message: `API request failed (${response.status}). Please check your API key and try again.`,
                error: errorText
            };
        }

        const result = await response.json();
        console.log('Grok API full response:', result);
        
        // Extract the content from the response
        const content = result.choices?.[0]?.message?.content;
        
        if (!content) {
            console.error('No content received from API');
            return {
                success: false,
                message: 'No content received from API response'
            };
        }

        console.log('Grok API raw response:', content);

        // Try to parse the JSON response
        let extractedData;
        try {
            // Clean the response if it contains markdown formatting
            const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
            extractedData = JSON.parse(cleanContent);
            console.log('Successfully parsed JSON:', extractedData);
        } catch (parseError) {
            console.log('JSON parsing failed, trying regex extraction:', parseError);
            
            // If JSON parsing fails, try to extract information using regex
            const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
            const phoneRegex = /(\+?[\d\s\-\(\)]{10,})/g;
            
            const emails = content.match(emailRegex) || [];
            const phones = content.match(phoneRegex) || [];
            
            // Also try to extract from structured patterns in the response
            const structuredEmailRegex = /"emails":\s*\[(.*?)\]/g;
            const structuredPhoneRegex = /"phones":\s*\[(.*?)\]/g;
            
            extractedData = {
                emails: emails,
                phones: phones,
                confidence: 'low',
                reasoning: 'Extracted using regex due to JSON parsing failure'
            };
        }

        // Validate and clean the extracted data
        if (extractedData.emails) {
            extractedData.emails = extractedData.emails.filter(email => 
                email && email.includes('@') && email.includes('.') && email.length > 5
            );
        }
        
        if (extractedData.phones) {
            extractedData.phones = extractedData.phones.filter(phone => 
                phone && phone.replace(/\D/g, '').length >= 10
            );
        }
        
        console.log('Grok API final extracted data:', extractedData);
        
        return {
            success: true,
            data: extractedData,
            raw_response: content
        };
        
    } catch (error) {
        console.error('Grok API error:', error);
        return {
            success: false,
            message: 'API call failed: ' + error.message,
            error: error.toString()
        };
    }
}

// Function to get Grok API key from storage
async function getGrokAPIKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['grokApiKey'], (result) => {
            resolve(result.grokApiKey || 'YOUR_GROK_API_KEY');
        });
    });
}

// Function to set Grok API key in storage
async function setGrokAPIKey(apiKey) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ grokApiKey: apiKey }, () => {
            resolve();
        });
    });
}

// Generate email using AI with custom prompt
async function generateEmailWithAI(prompt, businessData) {
    try {
        const apiKey = await getGrokAPIKey();
        console.log('API Key length:', apiKey ? apiKey.length : 'null', 'First 10 chars:', apiKey ? apiKey.substring(0, 10) : 'null');
        
        if (!apiKey || apiKey === 'YOUR_GROK_API_KEY' || apiKey.length < 10) {
            console.error('Invalid API key:', apiKey);
            return {
                success: false,
                error: 'API key not configured or invalid. Please enter a valid API key in the extension settings.'
            };
        }

        // Use a more reliable endpoint for smaller requests
        const API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
        
        console.log('Sending request to:', API_ENDPOINT);
        console.log('Prompt:', prompt);
        
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://google-maps-scraper.com',
                'X-Title': 'Google Maps Data Scraper'
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-3.1-8b-instruct:free',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert at generating likely business email addresses based on business information. Respond only with the most likely email address in a valid email format, nothing else.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 50
            })
        });

        console.log('API Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('API Response data:', data);
        
        const generatedEmail = data.choices?.[0]?.message?.content?.trim();
        console.log('Generated email:', generatedEmail);

        // Validate the generated email
        if (generatedEmail && isValidEmailFormat(generatedEmail)) {
            return {
                success: true,
                email: generatedEmail
            };
        } else {
            // If the AI didn't generate a valid email, try to infer one
            const inferredEmail = inferBusinessEmail(businessData.name, businessData.type);
            console.log('Using inferred email:', inferredEmail);
            return {
                success: true,
                email: inferredEmail,
                source: 'inferred'
            };
        }
    } catch (error) {
        console.error('AI email generation error:', error);
        
        // Fallback to inferred email
        const inferredEmail = inferBusinessEmail(businessData.name, businessData.type);
        return {
            success: true,
            email: inferredEmail,
            source: 'inferred',
            note: 'API failed, using inferred email'
        };
    }
}

// Helper function to infer a business email when AI generation fails
function inferBusinessEmail(businessName, businessType) {
    // Remove special characters and spaces, convert to lowercase
    const cleanName = businessName.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 30); // Limit length
    
    // Common business email patterns
    const patterns = [
        `info@${cleanName}.com`,
        `contact@${cleanName}.com`,
        `hello@${cleanName}.com`,
        `${cleanName}@gmail.com`
    ];
    
    // Return the first pattern
    return patterns[0];
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('Google Maps Data Scraper installed successfully');
    
    // Set default storage values
    chrome.storage.local.set({
        scrapedData: [],
        settings: {
            delay: 1500,
            autoScroll: true,
            useGrokAPI: true
        }
    });
});

// Handle tab updates to detect navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (activeScrapingTab === tabId && changeInfo.status === 'complete') {
        // Tab has finished loading, could resume scraping if needed
        chrome.tabs.sendMessage(tabId, { action: 'pageUpdated' });
    }
});

// Handle tab closure
chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeScrapingTab === tabId) {
        activeScrapingTab = null;
    }
});

// Function to check if URL is Google Maps
function isGoogleMapsUrl(url) {
    return url && (url.includes('google.com/maps') || url.includes('maps.google.com'));
}

// Export data helper function
function exportToCSV(data) {
    const csv = convertToCSV(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    chrome.downloads.download({
        url: url,
        filename: `google-maps-data-${new Date().toISOString().split('T')[0]}.csv`,
        saveAs: true
    });
}

// Convert data to CSV format
function convertToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = ['Name', 'Address', 'Phone', 'Additional Phones', 'Website', 'Email', 'Additional Emails', 'Social Media', 'Other Contacts', 'Rating'];
    const csvHeaders = headers.join(',');
    
    const csvRows = data.map(item => {
        return [
            `"${item.name || ''}"`,
            `"${item.address || ''}"`,
            `"${item.phone || ''}"`,
            `"${(item.additional_phones || []).join('; ')}"`,
            `"${item.website || ''}"`,
            `"${item.email || ''}"`,
            `"${(item.additional_emails || []).join('; ')}"`,
            `"${(item.social_media || []).join('; ')}"`,
            `"${(item.additional_contacts || []).join('; ')}"`,
            `"${item.rating || ''}"`
        ].join(',');
    });
    
    return csvHeaders + '\n' + csvRows.join('\n');
} 