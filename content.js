let isScrapingActive = false;
let scrapingSettings = {
    delay: 1500,
    autoScroll: true,
    useGrokAPI: true,
    customPrompt: "Based on the business {businessName} which is a {businessType} located in {location}, what would be their most likely business email address?"
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'startScraping':
            isScrapingActive = true;
            scrapingSettings = message.settings;
            startScrapingProcess();
            break;
        case 'stopScraping':
            isScrapingActive = false;
            break;
    }
});

// Start the scraping process
async function startScrapingProcess() {
    try {
        sendStatusUpdate('Initializing scraper...', 'warning');
        
        // Wait for the page to load with multiple fallback selectors
        await waitForElementWithFallbacks([
            '[role="article"]',
            '[data-result-index]',
            '.Nv2PK',
            '.TFQHme',
            '.bfdHYd',
            '.hfpxzc',
            '.VkpGBb'
        ], 15000);
        
        sendStatusUpdate('Google Maps page loaded successfully', 'success');
        
        let previousResultCount = 0;
        let noNewResultsCount = 0;
        
        while (isScrapingActive) {
            // Get all business results with multiple selectors
            const results = getBusinessResults();
            
            // Check if we have new results
            if (results.length === previousResultCount) {
                noNewResultsCount++;
                if (noNewResultsCount >= 3) {
                    sendStatusUpdate('No new results found. Completing...', 'warning');
                    break;
                }
            } else {
                noNewResultsCount = 0;
                if (results.length > 0) {
                    sendStatusUpdate(`Found ${results.length} business results, processing...`, 'success');
                }
            }
            
            previousResultCount = results.length;
            
            // Process each result
            for (let i = 0; i < results.length && isScrapingActive; i++) {
                const result = results[i];
                
                // Check if already processed
                if (result.dataset.scraped === 'true') continue;
                
                try {
                    // Click on the result to get more details
                    const clickableElement = findClickableElement(result);
                    if (clickableElement) {
                        clickableElement.click();
                        
                        // Wait for details panel to load
                        await sleep(1000);
                        
                        // Extract data
                        const data = await extractBusinessData();
                        
                        if (data && data.name) {
                            chrome.runtime.sendMessage({
                                action: 'dataScraped',
                                data: data
                            });
                        }
                        
                        // Mark as processed
                        result.dataset.scraped = 'true';
                        
                        // Add delay between scrapes
                        await sleep(scrapingSettings.delay);
                    }
                } catch (error) {
                    console.error('Error processing result:', error);
                }
            }
            
            // Auto-scroll if enabled
            if (scrapingSettings.autoScroll && isScrapingActive) {
                await autoScroll();
                await sleep(2000); // Wait for new results to load
            } else {
                break;
            }
        }
        
        chrome.runtime.sendMessage({ action: 'scrapingComplete' });
    } catch (error) {
        console.error('Scraping error:', error);
        let errorMessage = error.message;
        
        // Provide more helpful error messages
        if (error.message.includes('Timeout waiting for elements')) {
            errorMessage = 'Could not find Google Maps search results. Please make sure you are on a Google Maps search page with visible results.';
        }
        
        sendStatusUpdate(`Error: ${errorMessage}`, 'error');
        chrome.runtime.sendMessage({
            action: 'scrapingError',
            error: errorMessage
        });
    }
}

// Extract business data from the details panel
async function extractBusinessData() {
    try {
        const data = {};
        
        // Wait for details to load with retries
        await waitForElement('h1', 3000);
        
        // Additional wait for dynamic content to load
        await sleep(1000);
        
        // Extract name
        const nameElement = document.querySelector('h1');
        if (nameElement) {
            data.name = nameElement.textContent.trim();
        }
        
        // Extract business type and location
        let businessType = '';
        let location = '';
        
        // Try to get business type from categories
        const categoryElements = document.querySelectorAll('button[jsaction*="pane.rating.category"]');
        if (categoryElements.length > 0) {
            businessType = Array.from(categoryElements)
                .map(el => el.textContent.trim())
                .join(', ');
        }
        
        // Get location and address from address element
        const addressElement = document.querySelector('button[data-item-id="address"]');
        if (addressElement) {
            const addressText = addressElement.textContent.trim();
            data.address = addressText;
            location = addressText;
        }
        
        // Store business type and location for AI prompt
        data.businessType = businessType;
        data.location = location;
        
        // Extract phone
        const phoneElement = document.querySelector('button[data-item-id^="phone"]');
        if (phoneElement) {
            data.phone = phoneElement.textContent.trim();
        }
        
        // Extract website
        const websiteElement = document.querySelector('a[data-item-id="authority"]');
        if (websiteElement) {
            data.website = websiteElement.href;
        }
        
        // Extract rating
        const ratingElement = document.querySelector('span[role="img"][aria-label*="stars"]');
        if (ratingElement) {
            const ratingMatch = ratingElement.getAttribute('aria-label').match(/(\d+\.?\d*)/);
            if (ratingMatch) {
                data.rating = ratingMatch[1];
            }
        }
        
        // ENHANCED EMAIL EXTRACTION - Multiple attempts with retries
        let extractedEmails = [];
        let emailAttempts = 0;
        const maxEmailAttempts = 3;
        
        while (extractedEmails.length === 0 && emailAttempts < maxEmailAttempts) {
            emailAttempts++;
            console.log(`Email extraction attempt ${emailAttempts}/${maxEmailAttempts}`);
            
            // Wait for content to load more if this is a retry
            if (emailAttempts > 1) {
                await sleep(2000);
                
                // Try to expand any collapsed sections that might contain emails
                const expandableElements = document.querySelectorAll('[data-value="Show more"], [data-value="See more"], .show-more, .expand, .more-info, [aria-expanded="false"]');
                expandableElements.forEach(element => {
                    if (isElementInBusinessDetailsPanel(element)) {
                        try {
                            element.click();
                            console.log('Clicked expandable element');
                        } catch (e) {
                            // Ignore click errors
                        }
                    }
                });
                
                // Wait for expanded content to load
                await sleep(1000);
            }
            
            // Perform comprehensive email extraction
            extractedEmails = await extractEmailsComprehensively();
            
            if (extractedEmails.length > 0) {
                console.log(`Found ${extractedEmails.length} emails on attempt ${emailAttempts}`);
                break;
            } else {
                console.log(`No emails found on attempt ${emailAttempts}`);
            }
        }
        
        if (extractedEmails.length > 0) {
            data.email = extractedEmails[0];
            if (extractedEmails.length > 1) {
                data.additional_emails = extractedEmails.slice(1);
            }
            // Track email source - check if emails were marked as inferred
            if (extractedEmails._isInferred) {
                data.email_source = 'inferred';
            } else {
                data.email_source = 'direct';
            }
        }
        
        // Get additional text content for analysis
        const additionalInfo = await extractAdditionalBusinessInfo();
        data.additionalInfo = additionalInfo;
        
        // If we have business data but no email found, try website scraping (if website exists)
        if (data.name && extractedEmails.length === 0 && data.website) {
            console.log('Attempting website scraping for emails...');
            try {
                const websiteResponse = await chrome.runtime.sendMessage({
                    action: 'scrapeWebsiteForEmails',
                    url: data.website,
                    businessName: data.name
                });
                
                if (websiteResponse && websiteResponse.success && websiteResponse.emails && websiteResponse.emails.length > 0) {
                    console.log('Found emails from website scraping:', websiteResponse.emails);
                    data.email = websiteResponse.emails[0];
                    if (websiteResponse.emails.length > 1) {
                        data.additional_emails = websiteResponse.emails.slice(1);
                    }
                    data.email_source = 'website';
                    extractedEmails = websiteResponse.emails;
                }
            } catch (websiteError) {
                console.log('Website scraping failed:', websiteError);
            }
        }
        
        // If we still have no emails and Grok API is enabled, try that
        if (data.name && extractedEmails.length === 0 && scrapingSettings.useGrokAPI) {
            console.log('Attempting Grok API for email extraction...');
            try {
                const grokResponse = await chrome.runtime.sendMessage({
                    action: 'useGrokAPI',
                    data: data
                });
                
                if (grokResponse && grokResponse.success && grokResponse.data) {
                    // Merge the Grok API results
                    if (grokResponse.data.emails && grokResponse.data.emails.length > 0) {
                        console.log('Found emails from Grok API:', grokResponse.data.emails);
                        data.email = grokResponse.data.emails[0];
                        data.additional_emails = grokResponse.data.emails.slice(1);
                        data.email_source = 'ai';
                    }
                    
                    if (grokResponse.data.phones && grokResponse.data.phones.length > 0) {
                        // Add additional phones if not already present
                        const additionalPhones = grokResponse.data.phones.filter(phone => 
                            phone !== data.phone && phone.length > 6
                        );
                        if (additionalPhones.length > 0) {
                            data.additional_phones = additionalPhones;
                        }
                    }
                    
                    if (grokResponse.data.social_media && grokResponse.data.social_media.length > 0) {
                        data.social_media = grokResponse.data.social_media;
                    }
                    
                    if (grokResponse.data.additional_contacts && grokResponse.data.additional_contacts.length > 0) {
                        data.additional_contacts = grokResponse.data.additional_contacts;
                    }
                }
            } catch (grokError) {
                console.log('Grok API extraction failed:', grokError);
            }
        }
        
        // If we still have no emails and Grok API is enabled, try that
        if (data.name && extractedEmails.length === 0 && scrapingSettings.useGrokAPI) {
            console.log('Attempting Grok API for email extraction...');
            try {
                const grokResponse = await chrome.runtime.sendMessage({
                    action: 'useGrokAPI',
                    data: data
                });
                
                if (grokResponse && grokResponse.success && grokResponse.data) {
                    // Merge the Grok API results
                    if (grokResponse.data.emails && grokResponse.data.emails.length > 0) {
                        console.log('Found emails from Grok API:', grokResponse.data.emails);
                        data.email = grokResponse.data.emails[0];
                        data.additional_emails = grokResponse.data.emails.slice(1);
                        data.email_source = 'ai';
                    }
                    
                    if (grokResponse.data.phones && grokResponse.data.phones.length > 0) {
                        // Add additional phones if not already present
                        const additionalPhones = grokResponse.data.phones.filter(phone => 
                            phone !== data.phone && phone.length > 6
                        );
                        if (additionalPhones.length > 0) {
                            data.additional_phones = additionalPhones;
                        }
                    }
                    
                    if (grokResponse.data.social_media && grokResponse.data.social_media.length > 0) {
                        data.social_media = grokResponse.data.social_media;
                    }
                    
                    if (grokResponse.data.additional_contacts && grokResponse.data.additional_contacts.length > 0) {
                        data.additional_contacts = grokResponse.data.additional_contacts;
                    }
                }
            } catch (grokError) {
                console.log('Grok API extraction failed:', grokError);
            }
        }
        
        // If we have business data but no email found, try AI generation
        if (data.name && !data.email && scrapingSettings.useGrokAPI) {
            console.log('Attempting AI email generation...');
            try {
                // Replace placeholders in custom prompt
                const prompt = scrapingSettings.customPrompt
                    .replace('{businessName}', data.name)
                    .replace('{businessType}', data.businessType || 'business')
                    .replace('{location}', data.location || 'unknown location');
                
                const aiResponse = await chrome.runtime.sendMessage({
                    action: 'generateEmailWithAI',
                    prompt: prompt,
                    businessData: {
                        name: data.name,
                        type: data.businessType,
                        location: data.location
                    }
                });
                
                if (aiResponse && aiResponse.success && aiResponse.email) {
                    console.log('Generated email with AI:', aiResponse.email);
                    data.email = aiResponse.email;
                    data.email_source = 'ai';
                }
            } catch (aiError) {
                console.log('AI email generation failed:', aiError);
            }
        }
        
        // Log final results
        if (data.email) {
            console.log('Successfully extracted email:', data.email, 'Source:', data.email_source);
        } else {
            console.log('No email found for business:', data.name);
        }
        
        return data;
        
    } catch (error) {
        console.error('Error extracting business data:', error);
        return null;
    }
}

// Comprehensive email extraction from multiple sources
async function extractEmailsComprehensively() {
    const emails = new Set();
    
    // First, get the user's email to filter it out
    const userEmail = getUserEmail();
    console.log('User email detected:', userEmail);
    
    // Get business name and website for inference
    const businessName = document.querySelector('h1')?.textContent?.trim() || '';
    const websiteElement = document.querySelector('a[data-item-id="authority"]');
    const websiteUrl = websiteElement?.href || '';
    const domain = extractDomainFromUrl(websiteUrl);
    
    // Enhanced Priority Method: Look for business email in the most likely locations first
    const priorityBusinessEmailSelectors = [
        // Direct business contact sections
        '[data-item-id="email"]',
        '[data-item-id*="contact"]',
        '[data-item-id*="phone:email"]',
        '[data-item-id*="email:primary"]',
        'a[href^="mailto:"]',
        '.section-contact-info',
        '.contact-info',
        '.business-contact',
        '.section-contact',
        '.contact-details',
        '.business-info',
        
        // Business description and about areas
        '[data-item-id="description"]',
        '[data-item-id="about"]',
        '[data-item-id="editorial"]',
        '[data-section-id="editorial"]',
        '.PbZDve', // Business description
        '.PYvSYb', // About section
        '.LBgpqf', // Details section
        '.AeaXub', // Additional info
        '.section-editorial-quote',
        '.section-editorial-text',
        '.section-editorial-content',
        '.section-description',
        '.section-about',
        '.rogA2c', // Business details
        '.section-business-details',
        '.section-info-definition',
        '.section-info-hover-text',
        '.section-editorial-attribution',
        '.section-editorial-review',
        
        // Business hours and info sections
        '[data-item-id="oh"]',
        '[data-item-id="hours"]',
        '.section-info-line',
        '.section-info-text',
        '.section-info-definition',
        '.section-info-hover-text',
        '.section-hours',
        '.section-open-hours',
        '.t39EBf', // Hours section
        '.OqCZI', // Hours details
        '.Io6YTe', // Contact section
        '.section-contact-line',
        '.section-contact-text',
        
        // Additional contact sections
        '.section-directions-text',
        '.section-directions-description',
        '.section-review-text',
        '.section-review-content',
        '.section-overview-text',
        '.section-overview-content',
        '.section-hero-header-description',
        '.section-hero-header-text',
        
        // New Google Maps selectors (frequently updated)
        '[data-value*="@"]',
        '[data-email]',
        '[data-contact-email]',
        '[data-business-email]',
        '[title*="@"]',
        '[aria-label*="@"]',
        '[data-tooltip*="@"]',
        '.email-link',
        '.contact-email',
        '.business-email',
        '.email-address',
        '.contact-address',
        '.email-info',
        '.contact-info-item',
        '.business-contact-item',
        '.info-item',
        '.contact-method',
        '.business-method',
        '.business-contact-method',
        
        // Generic containers that might contain emails
        '.section-layout',
        '.section-layout-root',
        '.section-hero-header',
        '.section-info',
        '.section-editorial',
        '.section-reviews',
        '.section-contact-info',
        '.section-hours',
        '.section-about',
        '.section-description',
        '.section-directions',
        '.section-overview',
        '.section-business-details',
        
        // NEW: Additional selectors for hidden or dynamic content
        '[data-test-id*="contact"]',
        '[data-test-id*="email"]',
        '.contact-card',
        '.info-card',
        '.business-card',
        'span[aria-label*="email"]',
        'span[aria-label*="Email"]',
        'span[aria-label*="contact"]',
        'div[aria-label*="email"]',
        'div[aria-label*="Email"]',
        'div[aria-label*="contact"]',
        '[data-email-address]',
        '[data-contact-method]',
        '.widget-pane-link',
        '.widget-pane-info',
        '.place-result-info',
        '.place-contact-info',
        '.ugiz4pqJLAG__primary-text',
        '.ugiz4pqJLAG__secondary-text',
        '.RcCsl', // Info text
        '.MyEned', // Label text
        '.section-result-text-content',
        '.section-result-details',
        '.section-result-action',
        '.section-result-icon',
        '[data-tooltip*="Email"]',
        '[data-tooltip*="email"]',
        '[data-tooltip*="Contact"]',
        '[data-tooltip*="contact"]'
    ];
    
    // Search in priority locations first with enhanced extraction
    console.log('Searching for emails in priority locations...');
    for (const selector of priorityBusinessEmailSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            if (isElementInBusinessDetailsPanel(element)) {
                // For mailto links, extract href
                if (element.tagName === 'A' && element.href.startsWith('mailto:')) {
                    const email = element.href.replace('mailto:', '').split('?')[0];
                    if (email && isValidBusinessEmail(email, userEmail)) {
                        emails.add(email);
                        console.log('Found email in mailto link:', email);
                    }
                }
                
                // For other elements, extract from text content
                const foundEmails = extractEmailsFromTextEnhanced(element.textContent);
                foundEmails.forEach(email => {
                    if (isValidBusinessEmail(email, userEmail)) {
                        emails.add(email);
                        console.log('Found email in text content:', email);
                    }
                });
                
                // Check all data attributes for emails
                const dataAttrs = element.attributes;
                for (let i = 0; i < dataAttrs.length; i++) {
                    const attr = dataAttrs[i];
                    if (attr.value && attr.value.includes('@')) {
                        const foundEmails = extractEmailsFromTextEnhanced(attr.value);
                        foundEmails.forEach(email => {
                            if (isValidBusinessEmail(email, userEmail)) {
                                emails.add(email);
                                console.log('Found email in data attribute:', email);
                            }
                        });
                    }
                }
                
                // Check innerHTML for emails (sometimes emails are in hidden elements)
                if (element.innerHTML && element.innerHTML.includes('@')) {
                    const foundEmails = extractEmailsFromTextEnhanced(element.innerHTML);
                    foundEmails.forEach(email => {
                        if (isValidBusinessEmail(email, userEmail)) {
                            emails.add(email);
                            console.log('Found email in innerHTML:', email);
                        }
                    });
                }
                
                // NEW: Check for obfuscated emails (e.g., "contact [at] example [dot] com")
                const obfuscatedEmails = extractObfuscatedEmails(element.textContent);
                obfuscatedEmails.forEach(email => {
                    if (isValidBusinessEmail(email, userEmail)) {
                        emails.add(email);
                        console.log('Found obfuscated email:', email);
                    }
                });
            }
        });
    }
    
    // NEW: Deep search in all text nodes
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (node.textContent && node.textContent.includes('@') && 
                    isElementInBusinessDetailsPanel(node.parentElement)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }
        }
    );
    
    let textNode;
    while (textNode = walker.nextNode()) {
        const foundEmails = extractEmailsFromTextEnhanced(textNode.textContent);
        foundEmails.forEach(email => {
            if (isValidBusinessEmail(email, userEmail)) {
                emails.add(email);
                console.log('Found email in text node:', email);
            }
        });
    }
    
    // Enhanced Method: Check for emails in all clickable elements
    const clickableElements = document.querySelectorAll('a, button, [role="button"], [onclick], [data-click]');
    clickableElements.forEach(element => {
        if (isElementInBusinessDetailsPanel(element)) {
            const text = element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '';
            const foundEmails = extractEmailsFromTextEnhanced(text);
            foundEmails.forEach(email => {
                if (isValidBusinessEmail(email, userEmail)) {
                    emails.add(email);
                    console.log('Found email in clickable element:', email);
                }
            });
        }
    });
    
    // NEW: Look for contact page links and attempt to infer emails
    const contactLinks = findContactPageLinks();
    console.log('Found contact page links:', contactLinks);
    
    // Enhanced Method: Check for emails in structured data and JSON-LD
    const scriptTags = document.querySelectorAll('script[type="application/ld+json"]');
    scriptTags.forEach(script => {
        try {
            const jsonData = JSON.parse(script.textContent);
            const jsonString = JSON.stringify(jsonData);
            const foundEmails = extractEmailsFromTextEnhanced(jsonString);
            foundEmails.forEach(email => {
                if (isValidBusinessEmail(email, userEmail)) {
                    emails.add(email);
                    console.log('Found email in structured data:', email);
                }
            });
        } catch (e) {
            // Ignore invalid JSON
        }
    });
    
    // Enhanced Method: Check for emails in meta tags
    const metaTags = document.querySelectorAll('meta[content*="@"]');
    metaTags.forEach(meta => {
        const content = meta.getAttribute('content');
        if (content) {
            const foundEmails = extractEmailsFromTextEnhanced(content);
            foundEmails.forEach(email => {
                if (isValidBusinessEmail(email, userEmail)) {
                    emails.add(email);
                    console.log('Found email in meta tag:', email);
                }
            });
        }
    });
    
    // Enhanced Method: Check for emails in reviews with more targeted approach
    const reviewSelectors = [
        '.MyEned', // Review text
        '.wiI7pd', // Review content
        '.GHT2ce', // Review section
        '.jJc9Ad', // Review body
        '.rsqaWe', // Review text content
        '.K7oBsc', // Review details
        '.GWSFIe', // Review area
        '.section-review-text',
        '.section-review-content',
        '.review-text',
        '.review-content',
        '.review-body',
        '.user-review',
        '.business-review'
    ];
    
    reviewSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            if (isElementInBusinessDetailsPanel(element)) {
                const foundEmails = extractEmailsFromTextEnhanced(element.textContent);
                foundEmails.forEach(email => {
                    if (isValidBusinessEmail(email, userEmail)) {
                        emails.add(email);
                        console.log('Found email in review:', email);
                    }
                });
            }
        });
    });
    
    // Enhanced Method: Check for emails in social media and website links
    const socialAndWebsiteLinks = document.querySelectorAll('a[href*="facebook"], a[href*="twitter"], a[href*="instagram"], a[href*="linkedin"], a[href*="yelp"], a[href*="foursquare"], a[href*="website"], a[href*="http"]');
    socialAndWebsiteLinks.forEach(link => {
        if (isElementInBusinessDetailsPanel(link)) {
            const href = link.href;
            const text = link.textContent;
            const foundEmails = extractEmailsFromTextEnhanced(text + ' ' + href);
            foundEmails.forEach(email => {
                if (isValidBusinessEmail(email, userEmail)) {
                    emails.add(email);
                    console.log('Found email in social/website link:', email);
                }
            });
        }
    });
    
    // Enhanced Method: Check for emails in hidden or collapsed sections
    const hiddenSelectors = [
        '[style*="display: none"]',
        '[style*="visibility: hidden"]',
        '.collapsed',
        '.hidden',
        '.expandable',
        '.show-more',
        '.additional-info',
        '.more-info',
        '.extra-info',
        '.expanded-content',
        '.toggle-content'
    ];
    
    hiddenSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            if (isElementInBusinessDetailsPanel(element)) {
                const foundEmails = extractEmailsFromTextEnhanced(element.textContent || element.innerHTML);
                foundEmails.forEach(email => {
                    if (isValidBusinessEmail(email, userEmail)) {
                        emails.add(email);
                        console.log('Found email in hidden section:', email);
                    }
                });
            }
        });
    });
    
    // Enhanced Method: Check for emails in images alt text and titles
    const images = document.querySelectorAll('img[alt*="@"], img[title*="@"]');
    images.forEach(img => {
        if (isElementInBusinessDetailsPanel(img)) {
            const alt = img.getAttribute('alt') || '';
            const title = img.getAttribute('title') || '';
            const foundEmails = extractEmailsFromTextEnhanced(alt + ' ' + title);
            foundEmails.forEach(email => {
                if (isValidBusinessEmail(email, userEmail)) {
                    emails.add(email);
                    console.log('Found email in image alt/title:', email);
                }
            });
        }
    });
    
    // NEW: If we have a domain but no emails found yet, try email inference
    if (emails.size === 0 && domain) {
        console.log('No emails found directly, trying email inference from domain:', domain);
        const inferredEmails = inferCommonBusinessEmails(domain, businessName);
        
        // Only add the most likely inferred emails (top 5)
        const mostLikelyInferred = inferredEmails.slice(0, 5);
        console.log('Inferred possible emails:', mostLikelyInferred);
        
        // These are inferred, so we'll mark them for tracking
        mostLikelyInferred.forEach(email => {
            if (isValidBusinessEmail(email, userEmail)) {
                emails.add(email);
            }
        });
        
        // If we added inferred emails, return them with a flag
        if (emails.size > 0) {
            const allEmails = Array.from(emails);
            // Mark that these are inferred by returning a special structure
            allEmails._isInferred = true;
            console.log(`Email extraction complete: 0 found, ${allEmails.length} inferred`);
            return allEmails;
        }
    }
    
    // Return found emails
    const allEmails = Array.from(emails);
    console.log(`Email extraction complete: ${allEmails.length} found, 0 inferred`);
    
    return allEmails;
}

// Extract additional business information for AI analysis
async function extractAdditionalBusinessInfo() {
    let additionalInfo = '';
    
    // Get business description
    const descriptionElement = document.querySelector('[data-item-id="description"]');
    if (descriptionElement) {
        additionalInfo += descriptionElement.textContent + ' ';
    }
    
    // Get business hours
    const hoursElement = document.querySelector('[data-item-id="oh"]');
    if (hoursElement) {
        additionalInfo += hoursElement.textContent + ' ';
    }
    
    // Get recent reviews (first few)
    const reviewElements = document.querySelectorAll('.MyEned, .wiI7pd');
    let reviewCount = 0;
    reviewElements.forEach(review => {
        if (reviewCount < 3) { // Only get first 3 reviews
            additionalInfo += review.textContent.substring(0, 200) + ' ';
            reviewCount++;
        }
    });
    
    // Get business categories/types
    const categoryElements = document.querySelectorAll('.DkEaL');
    categoryElements.forEach(category => {
        additionalInfo += category.textContent + ' ';
    });
    
    // Get any contact or about information
    const aboutElements = document.querySelectorAll('.PbZDve, .PYvSYb, .LBgpqf');
    aboutElements.forEach(about => {
        additionalInfo += about.textContent + ' ';
    });
    
    return additionalInfo.trim();
}

// Get user's email from the page (to filter it out)
function getUserEmail() {
    let userEmail = null;
    
    // Method 1: Check for user profile information
    const profileSelectors = [
        '[data-ogsr-up] img[alt*="@"]',
        '[data-ogsr-up] img[data-value*="@"]',
        '.gb_A img[alt*="@"]',
        '.gb_A img[data-value*="@"]',
        '.gb_A img[data-email]',
        '.gb_A [data-email]',
        '.gb_A [title*="@"]',
        '.gb_A [aria-label*="@"]',
        '.gb_A .gb_Ab',
        '.gb_A .gb_Ac',
        'img[alt*="@gmail.com"]',
        'img[title*="@gmail.com"]',
        '[data-account-email]',
        '[data-user-email]'
    ];
    
    for (const selector of profileSelectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
            const alt = element.getAttribute('alt');
            const title = element.getAttribute('title');
            const dataEmail = element.getAttribute('data-email');
            const dataAccountEmail = element.getAttribute('data-account-email');
            const dataUserEmail = element.getAttribute('data-user-email');
            const ariaLabel = element.getAttribute('aria-label');
            
            const textToCheck = [alt, title, dataEmail, dataAccountEmail, dataUserEmail, ariaLabel, element.textContent]
                .join(' ');
            
            const emails = extractEmailsFromText(textToCheck);
            if (emails.length > 0) {
                userEmail = emails[0];
                return;
            }
        });
        
        if (userEmail) break;
    }
    
    // Method 2: Check for user menu or profile dropdown
    const menuSelectors = [
        '.gb_A',
        '.gb_u',
        '.gb_z',
        '.gb_lb',
        '.gb_H',
        '.gb_mb',
        '.gb_nb'
    ];
    
    if (!userEmail) {
        for (const selector of menuSelectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                const emails = extractEmailsFromText(element.textContent);
                if (emails.length > 0) {
                    userEmail = emails[0];
                    return;
                }
            });
            
            if (userEmail) break;
        }
    }
    
    // Method 3: Check for common user email patterns in scripts or meta tags
    if (!userEmail) {
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
            const content = script.textContent || script.innerHTML;
            if (content.includes('gmail.com') || content.includes('@')) {
                const emails = extractEmailsFromText(content);
                // Look for gmail addresses as they're likely user emails
                const gmailEmails = emails.filter(email => email.includes('gmail.com'));
                if (gmailEmails.length > 0) {
                    userEmail = gmailEmails[0];
                    return;
                }
            }
        });
    }
    
    return userEmail;
}

// Check if an element is part of the business details panel
function isElementInBusinessDetailsPanel(element) {
    if (!element) return false;
    
    // Check if element is in the main content area (not header, nav, etc.)
    const businessPanelSelectors = [
        '[data-section-id="pane"]',
        '[data-section-id="overlay"]',
        '.section-layout-root',
        '.section-layout',
        '.section-hero-header',
        '.section-info',
        '.section-editorial',
        '.section-reviews',
        '.section-contact-info',
        '.section-hours',
        '.section-about',
        '.section-description',
        '.section-directions',
        '.section-overview',
        '.section-business-details',
        '.rogA2c',
        '.PbZDve',
        '.PYvSYb',
        '.LBgpqf',
        '.AeaXub',
        '.Io6YTe',
        '.t39EBf',
        '.OqCZI'
    ];
    
    // Check if element is within any business panel
    for (const selector of businessPanelSelectors) {
        const panel = document.querySelector(selector);
        if (panel && panel.contains(element)) {
            return true;
        }
    }
    
    // Check if element is in the right side panel (business details)
    const rightPanel = document.querySelector('[data-section-id="pane"]');
    if (rightPanel && rightPanel.contains(element)) {
        return true;
    }
    
    // Exclude elements from header, navigation, and user profile areas
    const excludeSelectors = [
        '.gb_A', // Google header
        '.gb_u', // User menu
        '.gb_z', // Account info
        '.gb_lb', // Profile area
        '.gb_H', // Header elements
        '.gb_mb', // Menu bar
        '.gb_nb', // Navigation
        '[data-section-id="searchbox"]',
        '[data-section-id="directions"]',
        '[data-section-id="navbar"]',
        '[data-section-id="header"]',
        'nav',
        'header',
        '.navbar',
        '.header',
        '.navigation'
    ];
    
    for (const selector of excludeSelectors) {
        const excludeElement = document.querySelector(selector);
        if (excludeElement && excludeElement.contains(element)) {
            return false;
        }
    }
    
    return true;
}

// Validate email format and filter out user's email
function isValidBusinessEmail(email, userEmail) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const lowerEmail = email.toLowerCase();
    
    // Check basic format
    if (!emailRegex.test(email)) {
        return false;
    }
    
    // Filter out user's own email
    if (userEmail && lowerEmail === userEmail.toLowerCase()) {
        console.log('Filtered out user email:', email);
        return false;
    }
    
    // Filter out common false positives and invalid domains
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
        'maps.google.com',
        'youtu.be',
        'youtube.com',
        'bit.ly',
        'tinyurl.com',
        'goo.gl',
        'ow.ly',
        'short.link',
        'placeholder',
        'dummy',
        'fake',
        'invalid'
    ];
    
    for (const blocked of blacklist) {
        if (lowerEmail.includes(blocked)) {
            return false;
        }
    }
    
    // Additional validation for business emails
    const domain = lowerEmail.split('@')[1];
    
    // Reject if domain is too short (likely invalid)
    if (domain.length < 4) {
        return false;
    }
    
    // Reject if domain doesn't have a proper TLD
    const tldParts = domain.split('.');
    if (tldParts.length < 2 || tldParts[tldParts.length - 1].length < 2) {
        return false;
    }
    
    // Check for suspicious patterns that indicate non-business emails
    const localPart = lowerEmail.split('@')[0];
    const suspiciousPatterns = [
        /^[a-z]{1,3}[0-9]{4,}$/, // Pattern like: ab1234, a12345 (likely personal)
        /^[0-9]{4,}$/, // Only numbers (likely personal)
        /^(test|demo|sample|temp)/, // Test emails
        /^(user|admin|root|system)$/, // Generic system emails
        /^[a-z]{1,2}[0-9]{1,2}$/ // Pattern like: a1, ab12 (likely personal)
    ];
    
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(localPart));
    
    // Personal email providers - now we're more lenient
    const personalEmailProviders = [
        'gmail.com',
        'yahoo.com',
        'hotmail.com',
        'outlook.com',
        'aol.com',
        'icloud.com',
        'me.com',
        'mac.com',
        'live.com',
        'msn.com',
        'protonmail.com',
        'yandex.com',
        'mail.com',
        'inbox.com'
    ];
    
    const isPersonalProvider = personalEmailProviders.some(provider => lowerEmail.endsWith('@' + provider));
    
    // If it's a personal provider, check for business indicators
    if (isPersonalProvider) {
        // Business keywords that suggest it's a business email
        const businessKeywords = [
            'info', 'contact', 'sales', 'support', 'admin', 'office', 'business', 
            'service', 'help', 'inquiry', 'marketing', 'team', 'reception',
            'booking', 'reservations', 'orders', 'customerservice', 'hello',
            'welcome', 'general', 'mail', 'enquiry', 'enquiries', 'shop',
            'store', 'company', 'corp', 'inc', 'llc', 'group', 'services',
            'solutions', 'consulting', 'management', 'director', 'manager',
            'owner', 'ceo', 'president', 'founder', 'principal', 'partner'
        ];
        
        // Check if the local part contains business keywords
        const hasBusinessKeywords = businessKeywords.some(keyword => localPart.includes(keyword));
        
        // Also check if the local part looks like a business name (multiple words, etc.)
        const businessNamePatterns = [
            /^[a-z]+[a-z0-9]*[a-z]+$/, // businessname (at least 2 chars, ends with letter)
            /^[a-z]+[._-][a-z]+/, // business.name, business-name, business_name
            /^[a-z]{4,}[0-9]{1,3}$/ // businessname1, businessname12
        ];
        
        const looksLikeBusiness = businessNamePatterns.some(pattern => pattern.test(localPart));
        
        // If it's a personal provider but looks suspicious and has no business indicators, reject it
        if (isSuspicious && !hasBusinessKeywords && !looksLikeBusiness) {
            console.log('Filtered out suspicious personal email:', email);
            return false;
        }
        
        // If it's a personal provider but has business indicators, accept it
        if (hasBusinessKeywords || looksLikeBusiness) {
            console.log('Found business email on personal provider:', email);
            return true;
        }
        
        // For other personal provider emails, we'll be more lenient and accept them
        // unless they match obvious personal patterns
        const obviousPersonalPatterns = [
            /^[a-z]+[0-9]{4,}$/, // firstname1234, lastname5678
            /^[a-z]{1,2}[0-9]{4,}$/, // ab1234, a12345
            /^[a-z]+\.[a-z]+[0-9]{2,}$/, // john.doe99, jane.smith123
            /^[a-z]+[0-9]{4,}[a-z]*$/ // john1234, jane5678abc
        ];
        
        const isObviouslyPersonal = obviousPersonalPatterns.some(pattern => pattern.test(localPart));
        
        if (isObviouslyPersonal) {
            console.log('Filtered out obviously personal email:', email);
            return false;
        }
    }
    
    // For non-personal providers (business domains), accept unless suspicious
    if (!isPersonalProvider && !isSuspicious) {
        console.log('Found business domain email:', email);
        return true;
    }
    
    // Accept emails that passed all filters
    console.log('Accepted email:', email);
    return true;
}

// Validate email format (keep original for backward compatibility)
function isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const lowerEmail = email.toLowerCase();
    
    // Check basic format
    if (!emailRegex.test(email)) {
        return false;
    }
    
    // Filter out common false positives
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
        'linkedin.com'
    ];
    
    for (const blocked of blacklist) {
        if (lowerEmail.includes(blocked)) {
            return false;
        }
    }
    
    return true;
}

// Auto-scroll to load more results
async function autoScroll() {
    const scrollableSelectors = [
        '[role="feed"]',
        '.m6QErb.DxyBCb.kA9KIf.dS8AEf',
        '[role="main"]',
        '.siAUzd',
        '.tTVLSc',
        '.scroll-wrapper',
        '.results-container',
        '.scrollable-y'
    ];
    
    let scrollableElement = null;
    
    for (const selector of scrollableSelectors) {
        const element = document.querySelector(selector);
        if (element && element.scrollHeight > element.clientHeight) {
            scrollableElement = element;
            break;
        }
    }
    
    if (scrollableElement) {
        scrollableElement.scrollTo({
            top: scrollableElement.scrollHeight,
            behavior: 'smooth'
        });
        console.log('Scrolled within container');
    } else {
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });
        console.log('Scrolled page window');
    }
}

// Helper function to wait for an element
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const checkElement = () => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                reject(new Error(`Timeout waiting for element: ${selector}`));
            } else {
                setTimeout(checkElement, 100);
            }
        };
        
        checkElement();
    });
}

// Helper function to wait for an element with multiple fallback selectors
function waitForElementWithFallbacks(selectors, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const checkElements = () => {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    console.log(`Found element with selector: ${selector}`);
                    resolve(element);
                    return;
                }
            }
            
            if (Date.now() - startTime > timeout) {
                reject(new Error(`Timeout waiting for elements: ${selectors.join(', ')}`));
            } else {
                setTimeout(checkElements, 100);
            }
        };
        
        checkElements();
    });
}

// Get business results using multiple selectors
function getBusinessResults() {
    const selectors = [
        '[role="article"]',
        '[data-result-index]',
        '.Nv2PK',
        '.TFQHme',
        '.bfdHYd',
        '.hfpxzc',
        '.VkpGBb'
    ];
    
    let results = [];
    
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            console.log(`Found ${elements.length} results with selector: ${selector}`);
            results = Array.from(elements);
            break;
        }
    }
    
    // If no results found with any selector, try a more general approach
    if (results.length === 0) {
        console.log('No results found with specific selectors, trying general approach...');
        // Look for elements that might be business listings
        const possibleResults = document.querySelectorAll('div[jsaction*="click"]:not([role="button"]):not([role="link"])');
        results = Array.from(possibleResults).filter(el => {
            const text = el.textContent;
            return text && text.length > 10 && text.length < 500;
        });
        if (results.length > 0) {
            console.log(`Found ${results.length} results with general approach`);
        } else {
            console.log('No results found with any approach');
        }
    }
    
    return results;
}

// Find clickable element within a business result
function findClickableElement(result) {
    const clickableSelectors = [
        'a[href*="/maps/place/"]',
        'a[href*="maps/place"]',
        'a[data-cid]',
        'a[href*="place_id"]',
        'div[jsaction*="click"]',
        'div[role="button"]',
        '.hfpxzc',
        '.VkpGBb'
    ];
    
    for (const selector of clickableSelectors) {
        const element = result.querySelector(selector);
        if (element) {
            return element;
        }
    }
    
    // If no specific clickable element found, try clicking the result itself
    if (result.getAttribute('jsaction') || result.onclick) {
        return result;
    }
    
    // Last resort: find any clickable child element
    const anyClickable = result.querySelector('a, button, [role="button"], [jsaction*="click"]');
    return anyClickable;
}

// Helper function to sleep
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Send status update to popup
function sendStatusUpdate(status, type = 'default') {
    chrome.runtime.sendMessage({
        action: 'statusUpdate',
        status: status,
        type: type
    });
}

// Extract emails from text
function extractEmailsFromText(text) {
    const emails = [];
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
    const matches = text.match(emailRegex);
    
    if (matches) {
        matches.forEach(email => {
            if (isValidEmail(email)) {
                emails.push(email.toLowerCase());
            }
        });
    }
    
    return [...new Set(emails)]; // Remove duplicates
}

// Enhanced email extraction with multiple patterns
function extractEmailsFromTextEnhanced(text) {
    const emails = new Set();
    
    // Multiple regex patterns for different email formats
    const emailPatterns = [
        // Standard email pattern
        /([a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,})/gi,
        // Email with quotes
        /["']([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/gi,
        // Email in brackets
        /[<\[]([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[>\]]/gi,
        // Email with mailto:
        /mailto:([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
        // Email with spaces around @
        /([a-zA-Z0-9._-]+)\s*@\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
        // Email with unicode characters
        /([a-zA-Z0-9._\u0080-\uFFFF-]+@[a-zA-Z0-9.\u0080-\uFFFF-]+\.[a-zA-Z]{2,})/gi
    ];
    
    emailPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            let email = match[1] || match[0];
            // Handle the space pattern specially
            if (match[2]) {
                email = match[1].trim() + '@' + match[2].trim();
            }
            email = email.toLowerCase().trim();
            if (isValidEmail(email)) {
                emails.add(email);
            }
        }
    });
    
    return Array.from(emails);
}

// Extract obfuscated emails (e.g., "contact [at] example [dot] com")
function extractObfuscatedEmails(text) {
    const emails = new Set();
    
    // Common obfuscation patterns
    const obfuscationPatterns = [
        // [at] and [dot] pattern
        /([a-zA-Z0-9._-]+)\s*\[at\]\s*([a-zA-Z0-9.-]+)\s*\[dot\]\s*([a-zA-Z]{2,})/gi,
        // (at) and (dot) pattern
        /([a-zA-Z0-9._-]+)\s*\(at\)\s*([a-zA-Z0-9.-]+)\s*\(dot\)\s*([a-zA-Z]{2,})/gi,
        // @ replaced with "at" and . replaced with "dot"
        /([a-zA-Z0-9._-]+)\s+at\s+([a-zA-Z0-9.-]+)\s+dot\s+([a-zA-Z]{2,})/gi,
        // @ replaced with " at " and . replaced with " dot "
        /([a-zA-Z0-9._-]+)\s+AT\s+([a-zA-Z0-9.-]+)\s+DOT\s+([a-zA-Z]{2,})/gi,
        // Various symbols instead of @
        /([a-zA-Z0-9._-]+)\s*[@＠]\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
        // Spaces or underscores instead of dots
        /([a-zA-Z0-9._-]+)@([a-zA-Z0-9-]+)[\s_]([a-zA-Z]{2,})/gi
    ];
    
    obfuscationPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            let email;
            if (match[3]) {
                // For patterns with separate domain parts
                email = match[1] + '@' + match[2] + '.' + match[3];
            } else if (match[2]) {
                // For patterns with complete domain
                email = match[1] + '@' + match[2];
            }
            
            if (email) {
                email = email.toLowerCase().trim();
                if (isValidEmail(email)) {
                    emails.add(email);
                }
            }
        }
    });
    
    return Array.from(emails);
}

// Extract domain from URL
function extractDomainFromUrl(url) {
    if (!url) return '';
    try {
        const urlObj = new URL(url);
        let domain = urlObj.hostname;
        // Remove www. prefix
        domain = domain.replace(/^www\./, '');
        return domain;
    } catch (e) {
        return '';
    }
}

// Find contact page links
function findContactPageLinks() {
    const contactLinks = [];
    const contactKeywords = [
        'contact', 'contacto', 'kontakt', 'contato', 'contatto',
        'email', 'e-mail', 'mail',
        'about', 'about-us', 'aboutus', 'sobre',
        'connect', 'reach', 'get-in-touch',
        'support', 'help', 'customer-service',
        'inquiry', 'enquiry', 'inquire',
        'message', 'write', 'feedback'
    ];
    
    // Look for links containing contact-related keywords
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach(link => {
        if (isElementInBusinessDetailsPanel(link)) {
            const href = link.href.toLowerCase();
            const text = link.textContent.toLowerCase();
            const ariaLabel = (link.getAttribute('aria-label') || '').toLowerCase();
            
            const hasContactKeyword = contactKeywords.some(keyword => 
                href.includes(keyword) || 
                text.includes(keyword) || 
                ariaLabel.includes(keyword)
            );
            
            if (hasContactKeyword) {
                contactLinks.push({
                    url: link.href,
                    text: link.textContent,
                    type: 'contact_page'
                });
            }
        }
    });
    
    return contactLinks;
}

// Infer common business emails based on domain
function inferCommonBusinessEmails(domain, businessName) {
    if (!domain || domain.includes('google.com') || domain.includes('facebook.com')) {
    return [];
    }
    
    const emails = new Set();
    
    // Common business email prefixes
    const commonPrefixes = [
        'info', 'contact', 'hello', 'admin', 'support',
        'sales', 'enquiries', 'enquiry', 'mail', 'office',
        'reception', 'general', 'team', 'help', 'service',
        'customerservice', 'customer.service', 'customer-service',
        'reservations', 'booking', 'bookings', 'orders',
        'shop', 'store', 'online', 'web', 'website'
    ];
    
    // Add domain-based emails
    commonPrefixes.forEach(prefix => {
        emails.add(`${prefix}@${domain}`);
    });
    
    // Try to create emails based on business name
    if (businessName) {
        const cleanName = businessName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 20);
        
        if (cleanName.length > 3) {
            emails.add(`${cleanName}@${domain}`);
            emails.add(`info@${cleanName}.com`);
            emails.add(`contact@${cleanName}.com`);
        }
        
        // Try first word of business name
        const firstWord = businessName.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (firstWord.length > 3) {
            emails.add(`${firstWord}@${domain}`);
        }
    }
    
    return Array.from(emails);
}

// Check for emails in various page elements
function findEmailsInPage() {
    const emails = new Set();
    
    // Check all text content
    const allText = document.body.innerText;
    const foundEmails = extractEmailsFromText(allText);
    foundEmails.forEach(email => emails.add(email));
    
    // Check links
    const links = document.querySelectorAll('a[href^="mailto:"]');
    links.forEach(link => {
        const email = link.href.replace('mailto:', '').split('?')[0];
        if (email) emails.add(email);
    });
    
    // Check meta tags
    const metaTags = document.querySelectorAll('meta[content*="@"]');
    metaTags.forEach(meta => {
        const content = meta.getAttribute('content');
        const metaEmails = extractEmailsFromText(content);
        metaEmails.forEach(email => emails.add(email));
    });
    
    return Array.from(emails);
} 