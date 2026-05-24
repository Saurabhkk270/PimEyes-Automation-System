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

        // Load custom session cookies if provided (enables premium authentication and bypasses IP restrictions)
        if (process.env.PIMEYES_COOKIES) {
            try {
                const cookies = JSON.parse(process.env.PIMEYES_COOKIES);
                this.log(`Injecting ${cookies.length} session cookies for authentication...`, chalk.cyan);
                await this.context.addCookies(cookies);
            } catch (err) {
                this.log(`Failed to inject cookies: ${err.message}`, chalk.red);
            }
        }

        this.page = await this.context.newPage();

        // 1. Stealth & Anti-Fingerprinting Safeguards
        this.log('Injecting stealth anti-fingerprinting scripts into context...', chalk.cyan);
        await this.context.addInitScript(() => {
            // Mask the navigator.webdriver automation flag
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            // Overwrite languages to appear natural
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
            // Overwrite plugins array to look populated
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            // Mock WebGL Vendor & Renderer
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'Intel Open Source Technology Center';
                if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)';
                return getParameter.apply(this, arguments);
            };
        });

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
        this.capturedResults = [];
        
        this.page.on('request', request => {
            const url = request.url();
            // Log interesting API requests
            if (url.includes('api.pimeyes.com') || url.includes('/api/')) {
                this.log(`[API Request] ${request.method()} ${url}`, chalk.yellow);
            }
        });

        this.page.on('response', async response => {
            const url = response.url();
            if (url.includes('api.pimeyes.com/search') || url.includes('/api/search') || url.includes('/search/api')) {
                this.log(`[API Response] ${response.status()} ${url}`, chalk.green);
                try {
                    const contentType = response.headers()['content-type'] || '';
                    if (contentType.includes('application/json')) {
                        const json = await response.json();
                        this.log(`[Network Intercept] Captured search API response successfully!`, chalk.green);
                        
                        // Parse results from json response
                        let resultsArray = null;
                        if (Array.isArray(json)) {
                            resultsArray = json;
                        } else if (json && Array.isArray(json.results)) {
                            resultsArray = json.results;
                        } else if (json && Array.isArray(json.faces)) {
                            resultsArray = json.faces;
                        } else if (json && Array.isArray(json.items)) {
                            resultsArray = json.items;
                        } else if (json && json.data && Array.isArray(json.data.results)) {
                            resultsArray = json.data.results;
                        } else {
                            const findArray = (obj) => {
                                if (!obj || typeof obj !== 'object') return null;
                                for (const key in obj) {
                                    if (Array.isArray(obj[key]) && obj[key].length > 0 && typeof obj[key][0] === 'object') {
                                        return obj[key];
                                    }
                                    const sub = findArray(obj[key]);
                                    if (sub) return sub;
                                }
                                return null;
                            };
                            resultsArray = findArray(json);
                        }

                        if (resultsArray && resultsArray.length > 0) {
                            this.log(`[Network Intercept] Extracted ${resultsArray.length} items from API response.`, chalk.green);
                            const formatted = resultsArray.map(item => {
                                const src = item.src || item.thumbnail || item.image || item.url || item.thumbnailUrl || '';
                                const alt = item.alt || item.title || item.description || item.site || '';
                                return { src, alt };
                            }).filter(x => x.src);

                            if (formatted.length > 0) {
                                this.capturedResults = formatted;
                            }
                        }
                    }
                } catch (e) {
                    this.log(`Failed to parse network intercept: ${e.message}`, chalk.red);
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
        
        this.log('Waiting for upload to process and consent checkboxes to appear...', chalk.blue);
        
        let checkboxes = [];
        const startTime = Date.now();
        const maxWaitTime = 20000; // 20 seconds
        let skipCheckboxes = false;
        
        while (Date.now() - startTime < maxWaitTime) {
            // Check if results are already loading/loaded (e.g. if cookies skipped consent modal)
            const resultsCount = await this.page.locator('.results-grid, img[alt*="result"], .result-item').count();
            if (resultsCount > 0) {
                this.log('Results grid detected! Skipping checkbox consent.', chalk.green);
                skipCheckboxes = true;
                break;
            }

            // Check if the search button is already visible and no consent checkboxes are visible at all
            const searchBtnVisible = await this.page.locator('button:has-text("Start Search"), button:has-text("Search")').first().isVisible().catch(() => false);
            const anyCheckboxesCount = await this.page.locator('input[type="checkbox"]').count();
            
            if (searchBtnVisible && anyCheckboxesCount === 0) {
                this.log('Search button is visible and no checkboxes detected. Proceeding directly.', chalk.green);
                skipCheckboxes = true;
                break;
            }

            const allCheckboxes = await this.page.locator('input[type="checkbox"]').all();
            checkboxes = [];
            
            for (const cb of allCheckboxes) {
                const id = await cb.getAttribute('id');
                const classVal = (await cb.getAttribute('class') || '').toLowerCase();
                const idVal = (id || '').toLowerCase();
                
                if (classVal.includes('cookiebot') || idVal.includes('cookiebot')) {
                    continue;
                }
                
                const surroundingText = await cb.evaluate(el => {
                    const parentText = el.parentElement ? el.parentElement.textContent : '';
                    let labelText = '';
                    if (el.id) {
                        const label = document.querySelector(`label[for="${el.id}"]`);
                        if (label) labelText = label.textContent;
                    }
                    return (parentText + ' ' + labelText).toLowerCase();
                });

                // Filter specifically for consent-related checkboxes (exclude layout boxes like Desktop/Mobile view toggles)
                if (
                    surroundingText.includes('accept') || 
                    surroundingText.includes('consent') || 
                    surroundingText.includes('biometric') || 
                    surroundingText.includes('terms') || 
                    surroundingText.includes('privacy') || 
                    surroundingText.includes('adult') ||
                    surroundingText.includes('age') ||
                    surroundingText.includes('policy') ||
                    surroundingText.includes('agree')
                ) {
                    checkboxes.push(cb);
                }
            }
            
            if (checkboxes.length > 0) {
                this.log(`Found ${checkboxes.length} consent checkbox(es)! Waiting a brief moment to ensure all are fully rendered...`, chalk.green);
                await this.page.waitForTimeout(1500);
                
                // Query again to get the complete list after rendering completes
                const finalAllCheckboxes = await this.page.locator('input[type="checkbox"]').all();
                checkboxes = [];
                for (const cb of finalAllCheckboxes) {
                    const id = await cb.getAttribute('id');
                    const classVal = (await cb.getAttribute('class') || '').toLowerCase();
                    const idVal = (id || '').toLowerCase();
                    
                    if (classVal.includes('cookiebot') || idVal.includes('cookiebot')) {
                        continue;
                    }
                    
                    const surroundingText = await cb.evaluate(el => {
                        const parentText = el.parentElement ? el.parentElement.textContent : '';
                        let labelText = '';
                        if (el.id) {
                            const label = document.querySelector(`label[for="${el.id}"]`);
                            if (label) labelText = label.textContent;
                        }
                        return (parentText + ' ' + labelText).toLowerCase();
                    });

                    if (
                        surroundingText.includes('accept') || 
                        surroundingText.includes('consent') || 
                        surroundingText.includes('biometric') || 
                        surroundingText.includes('terms') || 
                        surroundingText.includes('privacy') || 
                        surroundingText.includes('adult') ||
                        surroundingText.includes('age') ||
                        surroundingText.includes('policy') ||
                        surroundingText.includes('agree')
                    ) {
                        checkboxes.push(cb);
                    }
                }
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Fallback: If 20 seconds elapsed and no consent-specific checkboxes were found, but we aren't skipping,
        // use any visible non-cookiebot checkboxes on the page.
        if (!skipCheckboxes && checkboxes.length === 0) {
            this.log('No consent-specific checkboxes found. Falling back to all non-cookiebot checkboxes...', chalk.yellow);
            const allCheckboxes = await this.page.locator('input[type="checkbox"]').all();
            for (const cb of allCheckboxes) {
                const id = await cb.getAttribute('id') || '';
                const classVal = await cb.getAttribute('class') || '';
                if (!classVal.toLowerCase().includes('cookiebot') && !id.toLowerCase().includes('cookiebot')) {
                    checkboxes.push(cb);
                }
            }
        }

        if (!skipCheckboxes) {
            this.log(`Checking ${checkboxes.length} checkboxes...`, chalk.blue);
            for (const checkbox of checkboxes) {
                try {
                    // Check if the checkbox is already checked (avoid toggling it off)
                    let isChecked = await checkbox.isChecked();
                    if (isChecked) {
                        this.log('Checkbox is already checked.', chalk.gray);
                        continue;
                    }

                    const id = await checkbox.getAttribute('id');
                    let clicked = false;

                    // 1. Try clicking the associated label with [for="id"]
                    if (id) {
                        const label = this.page.locator(`label[for="${id}"]`).first();
                        if (await label.count() > 0 && await label.isVisible()) {
                            this.log(`Clicking label for checkbox "${id}"`, chalk.gray);
                            await label.click();
                            clicked = true;
                        }
                    }

                    // 2. Try clicking the parent element (in case of visual component wrappers or nested labels)
                    if (!clicked) {
                        const parent = checkbox.locator('xpath=..');
                        if (await parent.count() > 0 && await parent.isVisible()) {
                            this.log(`Clicking parent of checkbox`, chalk.gray);
                            await parent.click();
                            clicked = true;
                        }
                    }

                    // 3. Fallback to programmatic check if clicking didn't check it or wasn't possible
                    isChecked = await checkbox.isChecked();
                    if (!isChecked) {
                        this.log(`Checkbox still unchecked. Programmatically checking...`, chalk.gray);
                        await checkbox.evaluate(node => {
                            if (!node.checked) {
                                node.checked = true;
                                node.dispatchEvent(new Event('click', { bubbles: true }));
                                node.dispatchEvent(new Event('change', { bubbles: true }));
                                node.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        });
                    }
                } catch (err) {
                    this.log(`Error checking checkbox: ${err.message}`, chalk.red);
                }
            }
        }

        // ====================================================================
        // THE ULTIMATE BYPASS CODE FOR THE SEARCH TIMEOUT LOOP
        // ====================================================================

        this.log("> Starting clean, direct search button execution...", chalk.cyan);

        try {
            // 1. Give the page 3 seconds to ensure everything is rendered in the background
            await this.page.waitForTimeout(3000);

            // 2. THE ABSOLUTE BYPASS: Skip standard Playwright locators entirely.
            // This injects raw JavaScript straight into the browser engine context.
            // It instantly scans the entire DOM for ANY button/element containing "search"
            // and fires a browser-level click event, bypassing all visibility blocks.
            this.log("Injecting direct DOM click event handler...", chalk.blue);
            
            const successMsg = await this.page.evaluate(() => {
                // Look through absolutely every clickable tag on the webpage
                const elements = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, div, span'));
                
                // Find the very first element that contains the word 'search' (case-insensitive)
                const targetButton = elements.find(el => {
                    const text = (el.textContent || el.value || '').toLowerCase();
                    const hasSearchText = text.includes('search');
                    const hasSearchClassOrId = (el.className && typeof el.className === 'string' && el.className.toLowerCase().includes('search')) || 
                                               (el.id && el.id.toLowerCase().includes('search'));
                    
                    return hasSearchText || hasSearchClassOrId;
                });

                if (targetButton) {
                    // Force focus, scroll it into view, and click it natively
                    targetButton.scrollIntoView({ block: 'center' });
                    targetButton.click();
                    return "SUCCESS: Target element found and clicked natively via DOM injection.";
                } else {
                    // If text searching fails, try to click the first form submit button as an ultimate backup
                    const submitButton = document.querySelector('button[type="submit"], input[type="submit"]');
                    if (submitButton) {
                        submitButton.click();
                        return "SUCCESS: Clicked the default form submit button.";
                    }
                    throw new Error("CRITICAL: No search text or submit elements exist in the DOM.");
                }
            });

            this.log(`> [SUCCESS] Search triggered successfully: ${successMsg}`, chalk.green);

        } catch (error) {
            this.log(`> [CRITICAL FAILURE] Direct injection failed: ${error.message}`, chalk.red);
            
            // Hard fallback: If everything else fails, just press the "Enter" key 
            // on the keyboard to force the active form to submit itself.
            this.log("Attempting keyboard form submission fallback...", chalk.yellow);
            await this.page.keyboard.press('Enter');
        }

        // ====================================================================
        // DEEP RESILIENT WAITING LOGIC FOR SEARCH RESULTS
        // ====================================================================

        this.log("> Waiting for search results... Checking network and URL states.", chalk.cyan);

        try {
            // 1. BETTER VISUAL DIAGNOSIS
            // Instead of guessing a CSS class, let's look at the web address (URL).
            // If the URL changes or adds query parameters (like ?search=...), we know the form submitted!
            this.log("Monitoring browser URL for changes...", chalk.blue);
            await this.page.waitForURL(/.*search.*/, { timeout: 15000 }).catch(() => {
                this.log("URL didn't change drastically, checking DOM states instead...", chalk.yellow);
            });

            // 2. THE CAPTCHA / ANTI-BOT SAFEGUARD
            // If a Cloudflare, Turnstile, or Google Captcha box appears, standard selectors will freeze.
            // We check if a common captcha frame or text exists on screen.
            const isCaptchaPresent = await this.page.evaluate(() => {
                const pageText = document.body.innerText.toLowerCase();
                return pageText.includes('captcha') || 
                       pageText.includes('checking your browser') || 
                       pageText.includes('verify you are human') ||
                       !!document.querySelector('iframe[src*="cloudflare"], iframe[src*="recaptcha"]');
            });

            if (isCaptchaPresent) {
                this.log("⚠️ [ATTENTION] A security Captcha has been detected on screen!", chalk.yellow.bold);
                this.log("Placing automation on PAUSE for 30 seconds. Please solve the puzzle in the browser window NOW...", chalk.yellow);
                
                // This pauses the script completely so you can physically click the puzzle boxes
                await this.page.waitForTimeout(30000); 
                this.log("Resuming automation after manual puzzle solver window...", chalk.green);
            }

            // 3. BROAD SELECTOR STRATEGY
            // Instead of waiting for a strict grid class (like .search-results-grid) which can change,
            // we wait for ANY structural container that looks like a table, list, or heading.
            this.log("Scanning page for rendered result containers...", chalk.blue);
            await Promise.any([
                this.page.waitForSelector('table', { state: 'visible', timeout: 15000 }),
                this.page.waitForSelector('[class*="result"], [id*="result"]', { state: 'visible', timeout: 15000 }),
                this.page.waitForSelector('h3, h2', { state: 'visible', timeout: 15000 }), // Common header styles for results
                this.page.waitForTimeout(10000) // Fallback safety wait if data loads via a weird div structure
            ]);

            this.log("> [SUCCESS] Search results successfully processed or bypass timer complete!", chalk.green);

            const results = await this.extractResults();
            this.log(`Extracted ${results.length} result(s).`, chalk.green);
            return results;

        } catch (error) {
            this.log(`> [ERROR] Failed to verify results screen element: ${error.message}`, chalk.red);
            this.log("Taking an emergency screenshot for your debugging review...", chalk.yellow);
            
            // This will save an image in your project folder showing exactly what the browser sees right now
            await this.page.screenshot({ path: 'search-results-failure-debug.png', fullPage: true });
            this.log("Screenshot saved as 'search-results-failure-debug.png'. Check this file to see if a Captcha or blank page is blocking you.", chalk.yellow);
            throw error;
        }
    }

    async extractResults() {
        // Strategy 1: If we successfully captured search API results at the network layer, return them!
        if (this.capturedResults && this.capturedResults.length > 0) {
            this.log(`Returning ${this.capturedResults.length} captured results from network interception.`, chalk.green);
            return this.capturedResults;
        }

        this.log("No network-intercepted results found. Falling back to DOM scraping...", chalk.yellow);

        // Strategy 2: Broad DOM selector matching
        const selectors = [
            '.results-grid img',
            'img.result-image',
            '.result-card img',
            'img[src*="pimeyes.com"]',
            'img[src*="images.pimeyes.com"]',
            '.results img',
            '.thumbnail img',
            'div.thumbnail img',
            '.result img'
        ];

        let resultElements = [];
        for (const sel of selectors) {
            try {
                const elms = await this.page.locator(sel).all();
                if (elms.length > 0) {
                    this.log(`Found ${elms.length} elements using selector: ${sel}`, chalk.green);
                    resultElements = elms;
                    break;
                }
            } catch (err) {
                // Ignore selector evaluation errors
            }
        }

        // Strategy 3: Scrape all non-UI image elements as a last resort fallback
        if (resultElements.length === 0) {
            this.log("No specific selectors matched. Scanning all image elements on page...", chalk.yellow);
            try {
                const allImages = await this.page.locator('img').all();
                for (const img of allImages) {
                    const src = await img.getAttribute('src') || '';
                    if (
                        src && 
                        !src.includes('logo') && 
                        !src.includes('icon') && 
                        !src.includes('avatar') && 
                        !src.includes('google') &&
                        !src.includes('facebook') &&
                        !src.includes('data:image/svg') &&
                        (src.includes('pimeyes') || src.startsWith('http'))
                    ) {
                        resultElements.push(img);
                    }
                }
            } catch (err) {
                this.log(`Error scanning DOM images: ${err.message}`, chalk.red);
            }
        }

        const extracted = [];
        const seen = new Set();

        for (const el of resultElements) {
            try {
                const src = await el.getAttribute('src');
                const alt = await el.getAttribute('alt') || 'Face Match Result';
                if (src && !seen.has(src)) {
                    seen.add(src);
                    extracted.push({ src, alt });
                }
            } catch (err) {
                // Ignore individual extraction failures
            }
        }

        this.log(`DOM scraping extracted ${extracted.length} unique image(s).`, chalk.green);
        return extracted;
    }

    async close() {
        if (this.browser) {
            this.log('Closing browser...', chalk.gray);
            await this.browser.close();
        }
    }
}
