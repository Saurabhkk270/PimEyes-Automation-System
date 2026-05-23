import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { PimEyesAutomator } from './pimeyes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse arguments
const argv = yargs(hideBin(process.argv))
    .option('image', {
        alias: 'i',
        type: 'string',
        description: 'Path to the image to search (triggers CLI mode)',
        demandOption: false,
    })
    .option('proxy', {
        alias: 'p',
        type: 'string',
        description: 'Proxy server URL (e.g., http://127.0.0.1:8000 for HTTP Toolkit)',
    })
    .option('headless', {
        alias: 'h',
        type: 'boolean',
        description: 'Run in headless mode (default: false for CLI, true for Web)',
    })
    .option('timeout', {
        alias: 't',
        type: 'number',
        description: 'Timeout in milliseconds',
        default: 60000,
    })
    .help()
    .argv;

// Check if we should run in CLI mode
const runCli = !!argv.image;

if (runCli) {
    runCommandLineMode();
} else {
    runWebServerMode();
}

// ==========================================
// 1. CLI Mode Implementation
// ==========================================
async function runCommandLineMode() {
    console.log(chalk.bold.magenta('\n=== PimEyes Automation CLI ===\n'));

    const { image, proxy, headless, timeout } = argv;
    const isHeadless = headless !== false; // Default to true, false only if explicitly false

    if (!fs.existsSync(image)) {
        console.error(chalk.red(`Error: Image file not found at path: ${image}`));
        process.exit(1);
    }

    const automator = new PimEyesAutomator({ 
        proxy, 
        headless: isHeadless, 
        timeout 
    });

    try {
        await automator.init();
        const results = await automator.searchImage(image);
        
        console.log(chalk.bold.green('\n--- Automation Complete ---'));
        console.log(chalk.white(`Successfully extracted ${results.length} results.`));
        
        if (results.length > 0) {
            console.log(chalk.cyan('\nFirst few results:'));
            results.slice(0, 3).forEach((r, idx) => {
                console.log(`[${idx + 1}] Source: ${r.src.substring(0, 80)}...`);
            });
        }

        if (!isHeadless) {
            console.log(chalk.yellow('\nKeeping browser open for 15 seconds for inspection...'));
            await new Promise(resolve => setTimeout(resolve, 15000));
        }

    } catch (error) {
        console.error(chalk.red.bold('\n[!] Automation Failed:'));
        console.error(chalk.red(error.message));
        
        if (!isHeadless) {
            console.log(chalk.yellow('\nKeeping browser open for 30 seconds for debugging...'));
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    } finally {
        await automator.close();
    }
}

// ==========================================
// 2. Web Server Mode Implementation
// ==========================================
function runWebServerMode() {
    const app = express();
    const port = process.env.PORT || 3000;

    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Configure Multer for file uploads
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, uploadsDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    });
    const upload = multer({ storage });

    // Job Store to hold active job details
    const jobs = {};

    // Middleware
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // API: Start Search Job
    app.post('/api/search', upload.single('image'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file uploaded' });
        }

        const jobId = Date.now().toString() + Math.round(Math.random() * 1000);
        const imagePath = req.file.path;

        // Initialize empty job
        jobs[jobId] = {
            status: 'running',
            logs: [],
            results: [],
            error: null
        };

        // Start background process
        runBackgroundSearch(jobId, imagePath);

        res.json({ jobId });
    });

    // API: Get Search Job Status
    app.get('/api/search/status/:jobId', (req, res) => {
        const { jobId } = req.params;
        const job = jobs[jobId];

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json(job);
    });

    // Start background search wrapper
    async function runBackgroundSearch(jobId, imagePath) {
        const job = jobs[jobId];
        const pushLog = (msg) => {
            job.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
        };

        pushLog('Starting automated PimEyes search...');

        const automator = new PimEyesAutomator({
            proxy: argv.proxy || null,
            headless: true, // Always headless on the server
            timeout: argv.timeout,
            onLog: (msg) => {
                pushLog(msg);
            }
        });

        try {
            await automator.init();
            const results = await automator.searchImage(imagePath);
            job.status = 'completed';
            job.results = results;
            pushLog(`Search finished successfully. Found ${results.length} result(s).`);
        } catch (error) {
            job.status = 'failed';
            job.error = error.message;
            pushLog(`Search failed: ${error.message}`);
        } finally {
            await automator.close();
            // Delete the temp file to save space
            fs.unlink(imagePath, (err) => {
                if (err) console.error(`Error deleting temp file: ${imagePath}`, err);
                else pushLog('Temporary upload file cleaned up.');
            });
        }
    }

    // Serve index.html for all other routes (Single Page App)
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.listen(port, () => {
        console.log(chalk.bold.green(`\n=== PimEyes Web Server Running ===`));
        console.log(chalk.cyan(`Local URL: http://localhost:${port}`));
        console.log(chalk.gray(`Press Ctrl+C to terminate\n`));
    });
}
