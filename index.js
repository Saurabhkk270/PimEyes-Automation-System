import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import fs from 'fs';
import { PimEyesAutomator } from './pimeyes.js';

const argv = yargs(hideBin(process.argv))
    .option('image', {
        alias: 'i',
        type: 'string',
        description: 'Path to the image to search',
        demandOption: true,
    })
    .option('proxy', {
        alias: 'p',
        type: 'string',
        description: 'Proxy server URL (e.g., http://127.0.0.1:8000 for HTTP Toolkit)',
    })
    .option('headless', {
        alias: 'h',
        type: 'boolean',
        description: 'Run in headless mode (default: false)',
        default: false, // We default to false so the user can solve Captchas if needed
    })
    .option('timeout', {
        alias: 't',
        type: 'number',
        description: 'Timeout in milliseconds',
        default: 60000,
    })
    .help()
    .argv;

async function main() {
    console.log(chalk.bold.magenta('\n=== PimEyes Automation System ===\n'));

    const { image, proxy, headless, timeout } = argv;

    if (!fs.existsSync(image)) {
        console.error(chalk.red(`Error: Image file not found at path: ${image}`));
        process.exit(1);
    }

    const automator = new PimEyesAutomator({ proxy, headless, timeout });

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

        // Keep the browser open for a bit if not headless so the user can inspect
        if (!headless) {
            console.log(chalk.yellow('\nKeeping browser open for 15 seconds for inspection...'));
            await new Promise(resolve => setTimeout(resolve, 15000));
        }

    } catch (error) {
        console.error(chalk.red.bold('\n[!] Automation Failed:'));
        console.error(chalk.red(error.message));
        
        if (!headless) {
            console.log(chalk.yellow('\nKeeping browser open for 30 seconds for debugging...'));
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    } finally {
        await automator.close();
    }
}

main();
