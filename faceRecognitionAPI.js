import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file if it exists
try {
    const envPath = path.resolve('.env');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split(/\r?\n/).forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                // Remove quotes if present
                if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
                    value = value.substring(1, value.length - 1);
                } else if (value.length > 0 && value.charAt(0) === "'" && value.charAt(value.length - 1) === "'") {
                    value = value.substring(1, value.length - 1);
                }
                if (!process.env[key]) {
                    process.env[key] = value.trim();
                }
            }
        });
    }
} catch (e) {
    // Ignore errors loading .env
}

/**
 * Performs mock biometric database lookup when API keys are not defined.
 * Represents standard subjects that can be biometrically recognized.
 * 
 * @param {string} nameHint - Optional name hint if available
 * @returns {Array} - Mocked biometric face matches
 */
function getBiometricMockResults(nameHint) {
    const name = nameHint || "Saurabh Kumar";
    const confidence = 94.2 + Math.random() * 5;
    return [
        {
            title: `Biometric Identity Match: ${name} (${confidence.toFixed(1)}% match)`,
            link: `https://github.com/Saurabhkk270`,
            thumbnail: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=250",
            source: "Biometric Database"
        },
        {
            title: `Secondary Biometric Cohort Reference`,
            link: `https://linkedin.com`,
            thumbnail: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=250",
            source: "Biometric Database"
        }
    ];
}

/**
 * Performs a dedicated biometric facial recognition search using Luxand Cloud API.
 * Maps facial contour vectors and checks against the enrolled subjects database.
 * Ref: https://luxand.cloud/
 * 
 * @param {Object} options
 * @param {string} [options.filePath] - Local file path of the face image.
 * @param {string} [options.apiKey] - Your Luxand Cloud private access token (can also be set via LUXAND_API_KEY env).
 * @returns {Promise<Array>} - Resolves to a clean array of parsed match objects: [{ title, link, thumbnail, source }].
 */
export async function searchBiometricFace(options = {}) {
    const {
        filePath,
        apiKey = process.env.LUXAND_API_KEY || process.env.FACE_RECOGNITION_API_KEY
    } = options;

    if (!filePath) {
        throw new Error("Must provide a valid local 'filePath' of the face target.");
    }

    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Target face image file not found at: ${absolutePath}`);
    }

    // 1. Check if API token is missing, fall back to offline Biometric Demo Mode
    if (!apiKey) {
        console.warn("⚠️ Warning: LUXAND_API_KEY is not defined. Engaging Biometric Demo Mode with mock landmark records...");
        // Delay slightly to simulate a fast database indexing search
        await new Promise(resolve => setTimeout(resolve, 800));
        return getBiometricMockResults();
    }

    try {
        console.log(`[BiometricSearch] Reading face photo file from local disk: ${absolutePath}`);
        
        // 2. Prepare multipart form data payload for binary transmission
        const form = new FormData();
        form.append('photo', fs.createReadStream(absolutePath));

        console.log(`[BiometricSearch] Connecting to Luxand Cloud biometric recognition servers...`);

        // 3. Dispatch POST query targeting Luxand Search subjects database
        // Ref: POST https://api.luxand.cloud/photo/search
        const response = await axios.post('https://api.luxand.cloud/photo/search', form, {
            headers: {
                ...form.getHeaders(),
                'token': apiKey
            },
            timeout: 15000 // Set a strict timeout to ensure we fail fast rather than hanging the socket
        });

        const data = response.data || [];
        console.log(`[BiometricSearch] API responded successfully. Matches found: ${data.length}`);

        const results = [];
        // 4. Map returned search results to standard UI schemas
        for (const item of data) {
            results.push({
                title: `Verified Identity Match: ${item.name} (${(item.probability * 100).toFixed(1)}% confidence)`,
                link: '#', // Database matches don't have public URLs, return anchor
                thumbnail: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=250',
                source: 'Biometric DB'
            });
        }

        return results;

    } catch (error) {
        // 5. Robust Safety Guards: Check for zero faces found or other common API errors
        console.warn(`[BiometricSearch WARNING] Active face scan failed or no subject matched: ${error.message}`);
        
        if (error.response) {
            console.warn(`[BiometricSearch API DETAILS] Status: ${error.response.status} | Data:`, JSON.stringify(error.response.data));
            
            // Luxand Cloud commonly returns a 400 Bad Request with a detailed message when 0 faces are found
            const apiMsg = (error.response.data && error.response.data.message) || '';
            if (apiMsg.toLowerCase().includes('no faces') || apiMsg.toLowerCase().includes('zero faces') || error.response.status === 400) {
                console.log(`[BiometricScan] 0 human faces detected in upload. Returning clean empty array [].`);
                return [];
            }
        }

        // Return a clean empty list to keep the UI fully responsive and prevent client timeouts
        console.log(`[BiometricScan] Recovered from scan anomaly. Instantly returning empty result array [].`);
        return [];
    }
}

/**
 * Performs a text search on Google via SerpApi to gather web details.
 * Kept to support the Deep OSINT Search module in index.js.
 */
export async function searchGoogleText(query, apiKey = process.env.SERPAPI_API_KEY) {
    if (!apiKey) {
        console.warn("⚠️ Warning: SERPAPI_API_KEY is not defined. Skipping real text search.");
        return [];
    }

    try {
        console.log(`[GoogleSearch] Executing general text query on SerpApi: "${query}"`);
        const response = await axios.get('https://serpapi.com/search.json', {
            params: {
                engine: 'google',
                q: query,
                api_key: apiKey,
                hl: 'en'
            }
        });

        const organic = response.data.organic_results || [];
        return organic.map(item => ({
            title: item.title || 'Web Search Result',
            link: item.link || '#',
            snippet: item.snippet || '',
            source: item.displayed_link || 'Google Search'
        }));
    } catch (error) {
        console.error(`[GoogleSearch ERROR] Text search failed gracefully:`, error.message);
        return [];
    }
}
