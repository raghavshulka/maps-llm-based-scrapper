# Google Maps Data Scraper - Enhanced Email Finder

A powerful Chrome extension that extracts business contact information from Google Maps search results with advanced email finding capabilities.

## 🚀 Enhanced Features

### Multi-Method Email Extraction
- **Direct Extraction**: Finds emails directly displayed in Google Maps listings
- **Deep DOM Search**: Searches through hidden elements, data attributes, and text nodes
- **Obfuscated Email Detection**: Detects emails written as "contact [at] example [dot] com"
- **Website Scraping**: Attempts to extract emails from business websites (via CORS proxies)
- **AI-Powered Extraction**: Uses Grok API to intelligently find and suggest emails
- **Smart Email Inference**: Generates likely business emails based on domain patterns

### Email Finding Success Rate
The extension uses multiple strategies to maximize email finding:
1. First attempts direct extraction from Google Maps
2. If no email found, tries website scraping
3. Uses AI analysis for intelligent extraction
4. Falls back to domain-based inference for common patterns

## 📊 Features

- **Automated Scraping**: Automatically clicks through search results
- **Email Statistics**: Tracks email sources (Direct, Website, AI, Inferred)
- **Auto-Scroll**: Loads more results automatically
- **CSV Export**: Export all scraped data to CSV format
- **Smart Filtering**: Filters out personal emails and focuses on business contacts
- **Real-time Updates**: See results as they're scraped

## 🛠 Installation

1. Clone this repository or download the ZIP file
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your toolbar

## 📖 How to Use

1. **Navigate to Google Maps** and perform a search (e.g., "restaurants in New York")
2. **Click the extension icon** to open the popup
3. **Configure settings**:
   - Set delay between scrapes (default: 1500ms)
   - Enable/disable auto-scroll
   - Enable/disable AI enhancement
   - Add your Grok API key for AI features
4. **Click "Start Scraping"** to begin
5. **Monitor progress** with real-time statistics
6. **Export data** to CSV when complete

## ⚙️ Configuration

### API Key Setup (Optional but Recommended)
1. Get a Grok API key from [x.ai/api](https://x.ai/api)
2. Enter the key in the extension settings
3. Save to enable AI-powered email extraction

### Scraping Settings
- **Delay**: Time between scraping each business (500-5000ms)
- **Auto-scroll**: Automatically load more results
- **AI Enhancement**: Use Grok API for better email detection

## 📊 Email Detection Methods

### 1. Direct Extraction (Fastest)
Searches for emails in:
- Business description sections
- Contact information areas
- Hidden data attributes
- Structured data (JSON-LD)

### 2. Website Scraping
When a business website is found:
- Attempts to fetch website content
- Extracts emails from contact pages
- Uses multiple CORS proxy services

### 3. AI Analysis
Using Grok API:
- Analyzes business information
- Suggests likely email patterns
- Finds alternative contact methods

### 4. Smart Inference
Based on domain and business name:
- Generates common patterns (info@, contact@, etc.)
- Creates business-specific emails
- Industry-standard formats

## 🔍 What Data is Extracted

- Business Name
- Address
- Phone Number
- Website URL
- Email Address(es)
- Additional Contact Info
- Business Rating

## 🎯 Tips for Better Results

1. **Use specific searches**: More targeted searches yield better results
2. **Enable all methods**: Keep all extraction methods enabled
3. **Add API key**: Significantly improves email finding rate
4. **Adjust delay**: Lower delays are faster but may miss data
5. **Check additional emails**: Some businesses have multiple emails

## ⚠️ Important Notes

- This extension is for legitimate business research purposes
- Respect privacy and terms of service
- Some websites block automated access
- Email inference provides likely but not guaranteed addresses
- API usage may incur costs (check Grok API pricing)

## 🔧 Troubleshooting

### Low Email Finding Rate
1. Ensure API key is configured correctly
2. Check that all extraction methods are enabled
3. Try increasing the scrape delay
4. Verify you're on a Google Maps search results page

### Extension Not Working
1. Refresh the Google Maps page
2. Check Chrome extension permissions
3. Ensure you're on Google Maps (not Google Search)
4. Check the browser console for errors

## 📝 Privacy

- All data is stored locally in your browser
- No data is sent to external servers (except for API calls if enabled)
- API keys are stored securely in Chrome's local storage

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 📄 License

This project is for educational and research purposes only. Use responsibly and in accordance with applicable laws and terms of service.