# PimEyes Automation System

An automation and reverse engineering demonstration for PimEyes, built with **Node.js** and **Playwright**.

This system handles automated browser interactions, network interception, proxy routing (for HTTP Toolkit), and automated result extraction while handling common obstacles like Captchas and Paywalls.

## Features

- **Automated Workflow**: Navigates to PimEyes, handles cookie banners, automatically uploads a target image, accepts the terms of service, and initiates the search.
- **Network Analysis**: Intercepts and logs underlying API calls made by the React/Next.js frontend using Playwright's network monitoring.
- **Proxy/VPN Support**: Easily route traffic through **HTTP Toolkit** or rotating proxies to bypass IP bans or inspect the exact API payloads.
- **Evasion Techniques**: Uses Playwright arguments (`--disable-blink-features=AutomationControlled`) and a realistic User-Agent to reduce the likelihood of immediate blocks.
- **Captcha Handling**: Detects Captcha presence and pauses execution, allowing manual intervention if an automated solver isn't configured.
- **Result Extraction**: Scrapes the resulting image endpoints / metadata.

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **HTTP Toolkit** (Optional, for network traffic inspection)

## Installation

1. Install the dependencies:
   ```bash
   npm install
   ```

2. Install the Playwright browser binaries:
   ```bash
   npx playwright install chromium
   ```

## Usage

Run the automation tool via the CLI:

```bash
node index.js --image <path_to_your_image.jpg>
```

### Advanced Usage with HTTP Toolkit

To fulfill the specific requirement of analyzing the request flow via **HTTP Toolkit**:

1. Open **HTTP Toolkit**.
2. Note the proxy port it opens (usually `http://127.0.0.1:8000`).
3. Run the automation script passing the proxy flag:
   ```bash
   node index.js --image target.jpg --proxy http://127.0.0.1:8000
   ```
   
This routes all Playwright traffic through HTTP Toolkit, allowing you to intercept, pause, and modify the PimEyes API requests (e.g., the multipart form upload to `/api/search` or the polling mechanisms).

### Full CLI Options

```text
Options:
      --version   Show version number
  -i, --image     Path to the image to search                [string] [required]
  -p, --proxy     Proxy server URL (e.g., http://127.0.0.1:8000)        [string]
  -h, --headless  Run in headless mode (default: false)                [boolean]
  -t, --timeout   Timeout in milliseconds                     [number] [default: 60000]
      --help      Show help
```

## Addressing Assignment Requirements

1. **HTTP Toolkit Usage**: The script natively supports proxying through HTTP Toolkit using the `--proxy` flag. The script also ignores HTTPS errors (`ignoreHTTPSErrors: true`) to ensure seamless interception with HTTP Toolkit's local CA. Furthermore, Playwright's native `page.on('request')` is implemented to log API requests directly in the console as a secondary measure.
2. **Session Handling & Authentication**: The script handles immediate popups (like cookie consent). While PimEyes login isn't strictly required for a basic search, Playwright's `browser.newContext()` allows for session persistence if auth cookies are injected.
3. **Captchas**: Purely headless execution often triggers Cloudflare/hCaptcha. The tool defaults to `headless: false` and explicitly detects Captcha iframes, logging a warning to the console and pausing to allow the operator to solve it before continuing the workflow.
4. **Payment Wall**: If the final search results are behind a premium paywall, the script extracts what it can (the blurred previews and data URIs) and completes successfully without attempting to bypass the server-side payment verification.
