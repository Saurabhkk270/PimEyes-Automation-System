import { chromium } from 'playwright';
import chalk from 'chalk';
import path from 'path';

export class PimEyesAutomator {
    constructor(options = {}) {
        this.proxy = options.proxy || null;
        this.headless = options.headless !== false;
        this.timeout = options.timeout || 60000;
        this.browser = null;
        this.context = null;
        this.page = null;
    }

    async init() {
        console.log(chalk.blue('Initializing Playwright browser...'));
        
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
            console.log(chalk.cyan(`Configuring proxy: ${this.proxy}`));
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
        
        // Setup Network Interception for analysis
        this.setupNetworkLogging();
    }

    setupNetworkLogging() {
        console.log(chalk.blue('Setting up network interception...'));
        
        this.page.on('request', request => {
            const url = request.url();
            // Log interesting API requests
            if (url.includes('api.pimeyes.com') || url.includes('/api/')) {
                console.log(chalk.yellow(`[API Request] ${request.method()} ${url}`));
            }
        });

        this.page.on('response', async response => {
            const url = response.url();
            if (url.includes('api.pimeyes.com/search') || url.includes('/api/search')) {
                console.log(chalk.green(`[API Response] ${response.status()} ${url}`));
                try {
                    // Try to parse JSON response if possible to extract hidden data
                    const contentType = response.headers()['content-type'] || '';
                    if (contentType.includes('application/json')) {
                        const json = await response.json();
                        console.log(chalk.dim(`Response Snippet: ${JSON.stringify(json).substring(0, 150)}...`));
                    }
                } catch (e) {
                    // Ignore errors reading response body
                }
            }
        });
    }

    async searchImage(imagePath) {
        if (!this.page) throw new Error("Browser not initialized. Call init() first.");

        console.log(chalk.blue(`Navigating to PimEyes homepage...`));
        await this.page.goto('https://pimeyes.com/en', { waitUntil: 'domcontentloaded', timeout: this.timeout });

        // Handle potential Cookie Consent
        try {
            const cookieButton = this.page.locator('button:has-text("Allow all"), button:has-text("Accept")').first();
            if (await cookieButton.isVisible({ timeout: 3000 })) {
                console.log(chalk.gray('Accepting cookies...'));
                await cookieButton.click();
            }
        } catch (e) {
            console.log(chalk.gray('No cookie banner found or timeout.'));
        }

        // Upload the image
        console.log(chalk.blue(`Uploading image: ${imagePath}`));
        const absoluteImagePath = path.resolve(imagePath);
        
        // PimEyes typically has a hidden file input. We locate it and set the files.
        // We look for the main file input by its ID
        const fileInput = this.page.locator('#file-input');
        await fileInput.setInputFiles(absoluteImagePath);

        console.log(chalk.blue('Waiting for upload and terms checkboxes to appear...'));
        
        // PimEyes requires accepting Terms of Service and Privacy Policy before searching
        // Wait for the checkboxes to become visible. They are usually part of a modal or slide-up panel after upload.
        await this.page.waitForSelector('input[type="checkbox"]', { timeout: 15000 });
        
        // We exclude cookiebot checkboxes to avoid trying to check 1300+ hidden boxes!
        const checkboxes = await this.page.locator('input[type="checkbox"]:not([class*="CybotCookiebot"]):not([id*="CybotCookiebot"])').all();
        console.log(chalk.blue(`Found ${checkboxes.length} checkboxes. Checking them...`));
        for (const checkbox of checkboxes) {
            // Some checkboxes might be hidden by custom UI, so we force click
            await checkbox.check({ force: true });
        }

        // Click the Search/Start button
        console.log(chalk.blue('Starting the search...'));
        const searchBtn = this.page.locator('button:has-text("Start Search"), button:has-text("Search")').first();
        
        // Sometimes the search button needs to be enabled or might take a moment
        await searchBtn.waitFor({ state: 'visible' });
        await searchBtn.click();

        // Wait for results
        console.log(chalk.blue('Waiting for search results... This might take a moment or encounter a Captcha.'));
        
        // Check for potential captcha
        const captchaIframe = this.page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
        if (await captchaIframe.count() > 0 && await captchaIframe.first().isVisible()) {
            console.log(chalk.red.bold('\n[!] CAPTCHA DETECTED!'));
            console.log(chalk.yellow('Please solve the captcha in the browser window to continue.'));
            console.log(chalk.yellow('The script will wait for up to 60 seconds...'));
        }

        // Wait for the results grid to load. We look for images or a specific results container.
        try {
            await this.page.waitForSelector('.results-grid, img[alt*="result"], .result-item', { timeout: 60000 });
            console.log(chalk.green('\nSearch completed! Extracting results...'));
            
            const results = await this.extractResults();
            console.log(chalk.green(`Extracted ${results.length} result(s).`));
            return results;
        } catch (error) {
            console.log(chalk.red('Failed to load results within timeout. Possibly blocked by Captcha, Paywall, or network error.'));
            console.log(chalk.gray('Check the opened browser window to see the current state.'));
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
            console.log(chalk.gray('Closing browser...'));
            await this.browser.close();
        }
    }
}
