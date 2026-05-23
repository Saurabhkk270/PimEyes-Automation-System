import { chromium } from 'playwright';
import chalk from 'chalk';
import path from 'path';

export class PimEyesAutomator {
    constructor(options = {}) {
        this.proxy = options.proxy || null;
        this.headless = options.headless !== false;
        this.timeout = options.timeout || 60000;
        this.onLog = options.onLog || null;
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    log(message, chalkFn) {
        if (chalkFn) {
            console.log(chalkFn(message));
        } else {
            console.log(message);
        }
        if (this.onLog) {
            this.onLog(message);
        }
    }

    async init() {
        this.log('Initializing Playwright browser...', chalk.blue);
        
        const launchOptions = {
            headless: this.headless,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        };

        // Configure proxy if provided (e.g., for HTTP Toolkit)
        if (this.proxy) {
            this.log(`Configuring proxy: ${this.proxy}`, chalk.cyan);
            launchOptions.proxy = { server: this.proxy };
            // Ignore HTTPS errors if using a proxy like HTTP Toolkit without trusting its CA globally
            launchOptions.ignoreHTTPSErrors = true; 
        }

        this.browser = await chromium.launch(launchOptions);
        this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });

        this.page = await this.context.newPage();

        // Speed Optimization: Block heavy ad/analytics trackers that slow down load times on Render
        await this.page.route('**/*', (route) => {
            const url = route.request().url().toLowerCase();
            if (
                url.includes('analytics') || 
                url.includes('tiktok') || 
                url.includes('facebook') || 
                url.includes('google-analytics') || 
                url.includes('doubleclick') || 
                url.includes('hotjar') ||
                url.includes('cookiebot')
            ) {
                route.abort();
            } else {
                route.continue();
            }
        });
        
        // Setup Network Interception for analysis
        this.setupNetworkLogging();
    }

    setupNetworkLogging() {
        this.log('Setting up network interception...', chalk.blue);
        
        this.page.on('request', request => {
            const url = request.url();
            // Log interesting API requests
            if (url.includes('api.pimeyes.com') || url.includes('/api/')) {
                this.log(`[API Request] ${request.method()} ${url}`, chalk.yellow);
            }
        });

        this.page.on('response', async response => {
            const url = response.url();
            if (url.includes('api.pimeyes.com/search') || url.includes('/api/search')) {
                this.log(`[API Response] ${response.status()} ${url}`, chalk.green);
                try {
                    // Try to parse JSON response if possible to extract hidden data
                    const contentType = response.headers()['content-type'] || '';
                    if (contentType.includes('application/json')) {
                        const json = await response.json();
                        this.log(`Response Snippet: ${JSON.stringify(json).substring(0, 150)}...`, chalk.dim);
                    }
                } catch (e) {
                    // Ignore errors reading response body
                }
            }
        });
    }

    async searchImage(imagePath) {
        if (!this.page) throw new Error("Browser not initialized. Call init() first.");

        this.log(`Navigating to PimEyes homepage...`, chalk.blue);
        await this.page.goto('https://pimeyes.com/en', { waitUntil: 'domcontentloaded', timeout: this.timeout });

        // Handle potential Cookie Consent
        try {
            const cookieButton = this.page.locator('button:has-text("Allow all"), button:has-text("Accept")').first();
            if (await cookieButton.isVisible({ timeout: 3000 })) {
                this.log('Accepting cookies...', chalk.gray);
                // click with low timeout and don't wait for post-navigation to prevent hangs
                await cookieButton.click({ timeout: 4000, noWaitAfter: true }).catch(() => {});
            }
        } catch (e) {
            this.log('No cookie banner found or timeout.', chalk.gray);
        }

        // Upload the image
        this.log(`Uploading image: ${imagePath}`, chalk.blue);
        const absoluteImagePath = path.resolve(imagePath);
        
        // Find the file input robustly (either by ID or fallback to standard file input)
        const fileInput = this.page.locator('input[type="file"], #file-input').first();
        await fileInput.setInputFiles(absoluteImagePath);

        this.log('Waiting for upload and terms checkboxes to appear...', chalk.blue);
        
        // Wait for the checkboxes to become attached to the DOM (they may be styled invisibly)
        await this.page.waitForSelector('input[type="checkbox"]', { state: 'attached', timeout: 25000 });
        
        // We exclude cookiebot checkboxes to avoid trying to check 1300+ hidden boxes!
        const checkboxes = await this.page.locator('input[type="checkbox"]:not([class*="CybotCookiebot"]):not([id*="CybotCookiebot"])').all();
        this.log(`Found ${checkboxes.length} checkboxes. Checking them...`, chalk.blue);
        for (const checkbox of checkboxes) {
            // Some checkboxes might be hidden by custom UI, so we force click
            await checkbox.check({ force: true });
        }

        // Click the Search/Start button
        this.log('Starting the search...', chalk.blue);
        const searchBtn = this.page.locator('button:has-text("Start Search"), button:has-text("Search")').first();
        
        // Sometimes the search button needs to be enabled or might take a moment
        await searchBtn.waitFor({ state: 'visible' });
        await searchBtn.click();

        // Wait for results
        this.log('Waiting for search results... This might take a moment or encounter a Captcha.', chalk.blue);
        
        // Check for potential captcha
        const captchaIframe = this.page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
        if (await captchaIframe.count() > 0 && await captchaIframe.first().isVisible()) {
            this.log('[!] CAPTCHA DETECTED!', chalk.red.bold);
            this.log('Please solve the captcha in the browser window to continue.', chalk.yellow);
            this.log('The script will wait for up to 60 seconds...', chalk.yellow);
        }

        // Wait for the results grid to load. We look for images or a specific results container.
        try {
            await this.page.waitForSelector('.results-grid, img[alt*="result"], .result-item', { timeout: 60000 });
            this.log('Search completed! Extracting results...', chalk.green);
            
            const results = await this.extractResults();
            this.log(`Extracted ${results.length} result(s).`, chalk.green);
            return results;
        } catch (error) {
            this.log('Failed to load results within timeout. Possibly blocked by Captcha, Paywall, or network error.', chalk.red);
            this.log('Check the opened browser window to see the current state.', chalk.gray);
            throw error;
        }
    }

    async extractResults() {
        // This attempts to extract the currently loaded result images.
        // PimEyes blurs results for non-premium users, but we can still extract the data URLs or metadata.
        const resultElements = await this.page.locator('.results-grid img, img.result-image').all();
        const extracted = [];
        
        for (const el of resultElements) {
            const src = await el.getAttribute('src');
            const alt = await el.getAttribute('alt');
            if (src) {
                extracted.push({ src, alt });
            }
        }
        return extracted;
    }

    async close() {
        if (this.browser) {
            this.log('Closing browser...', chalk.gray);
            await this.browser.close();
        }
    }
}
