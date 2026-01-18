import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import pg from 'pg';
import FormData from 'form-data';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
        rejectUnauthorized: false
    }
});

// Test database connection and create table
async function initDatabase() {
    try {
        console.log('Connecting to database...');
        const client = await pool.connect();
        console.log('✅ Database connected successfully!');
        
        // Create mappings table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS account_mappings (
                id SERIAL PRIMARY KEY,
                keyword TEXT NOT NULL UNIQUE,
                account_id TEXT NOT NULL,
                account_name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ Database tables initialized');
        client.release();
    } catch (err) {
        console.error('❌ Database initialization error:', err);
        throw err;
    }
}

app.use(express.json());
app.use(express.static('public'));

// Get configuration - now from environment variables
app.get('/api/config', async (req, res) => {
    try {
        console.log('GET /api/config - Loading from environment variables');
        
        const config = {
            apiDomain: process.env.ZOHO_API_DOMAIN || '',
            organizationId: process.env.ZOHO_ORGANIZATION_ID || '',
            accessToken: process.env.ZOHO_ACCESS_TOKEN || '',
            refreshToken: process.env.ZOHO_REFRESH_TOKEN || '',
            clientId: process.env.ZOHO_CLIENT_ID || '',
            clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
            anthropicApiKey: process.env.ANTHROPIC_API_KEY || ''
        };
        
        console.log('Configuration loaded from environment:', {
            hasApiDomain: !!config.apiDomain,
            hasOrgId: !!config.organizationId,
            hasAccessToken: !!config.accessToken,
            hasAnthropicKey: !!config.anthropicApiKey
        });
        
        res.json(config);
    } catch (err) {
        console.error('Error loading config:', err);
        res.status(500).json({ error: err.message });
    }
});

// Save configuration - no longer needed but keep for compatibility
app.post('/api/config', async (req, res) => {
    console.log('POST /api/config - Config is now managed via environment variables');
    res.json({ 
        success: true, 
        message: 'Configuration is managed via environment variables in Railway' 
    });
});

// Get GL accounts from Zoho
app.post('/api/get-gl-accounts', async (req, res) => {
    try {
        console.log('Fetching GL accounts from Zoho...');
        
        // Use environment variables instead of request body
        const apiDomain = process.env.ZOHO_API_DOMAIN;
        const organizationId = process.env.ZOHO_ORGANIZATION_ID;
        const accessToken = process.env.ZOHO_ACCESS_TOKEN;
        
        if (!apiDomain || !organizationId || !accessToken) {
            throw new Error('Missing Zoho configuration in environment variables');
        }
        
        const response = await fetch(
            `${apiDomain}/books/v3/chartofaccounts?organization_id=${organizationId}`,
            {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                }
            }
        );
        
        const data = await response.json();
        console.log('GL accounts fetched:', data.chartofaccounts?.length || 0);
        res.json(data);
    } catch (err) {
        console.error('Error fetching GL accounts:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get account mappings
app.get('/api/mappings', async (req, res) => {
    try {
        console.log('GET /api/mappings - Fetching mappings from database');
        const client = await pool.connect();
        
        const result = await client.query(
            'SELECT keyword, account_id, account_name FROM account_mappings ORDER BY keyword'
        );
        
        const mappings = {};
        result.rows.forEach(row => {
            mappings[row.keyword] = {
                account_id: row.account_id,
                account_name: row.account_name
            };
        });
        
        client.release();
        console.log('Mappings loaded:', Object.keys(mappings).length);
        res.json(mappings);
    } catch (err) {
        console.error('Error loading mappings:', err);
        res.status(500).json({ error: err.message });
    }
});

// Save account mapping
app.post('/api/mappings', async (req, res) => {
    try {
        console.log('POST /api/mappings - Saving mapping');
        const { keyword, account_id, account_name } = req.body;
        const client = await pool.connect();
        
        await client.query(
            `INSERT INTO account_mappings (keyword, account_id, account_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (keyword)
             DO UPDATE SET account_id = $2, account_name = $3`,
            [keyword, account_id, account_name]
        );
        
        client.release();
        console.log('Mapping saved:', keyword);
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving mapping:', err);
        res.status(500).json({ error: err.message });
    }
});

// Process invoice with Claude
app.post('/api/process-invoice', upload.single('file'), async (req, res) => {
    try {
        console.log('Processing invoice:', req.file?.originalname);
        const pdfBuffer = req.file.buffer;
        const base64Pdf = pdfBuffer.toString('base64');
        
        const { glAccounts, mappings } = req.body;
        
        // Use API key from environment
        const apiKey = process.env.ANTHROPIC_API_KEY;
        
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured in environment variables');
        }
        
        const prompt = `Extract all line items from this invoice. For each line item, provide:
1. Description
2. Amount
3. Suggested GL account (choose from the provided list)
4. Your reasoning

Available GL Accounts:
${glAccounts}

Known mappings (use these when keywords match):
${mappings}

Format your response as JSON array of objects with: description, amount, suggestedAccount, accountId, reasoning`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4000,
                messages: [{
                    role: 'user',
                    content: [{
                        type: 'document',
                        source: {
                            type: 'base64',
                            media_type: 'application/pdf',
                            data: base64Pdf
                        }
                    }, {
                        type: 'text',
                        text: prompt
                    }]
                }]
            })
        });

        const data = await response.json();
        console.log('Claude response received');
        res.json(data);
    } catch (err) {
        console.error('Error processing invoice:', err);
        res.status(500).json({ error: err.message });
    }
});

// Upload to Zoho Books
app.post('/api/upload-to-zoho', async (req, res) => {
    try {
        console.log('Uploading to Zoho Books...');
        const { invoiceData, pdfFile } = req.body;
        
        // Use credentials from environment
        const apiDomain = process.env.ZOHO_API_DOMAIN;
        const organizationId = process.env.ZOHO_ORGANIZATION_ID;
        const accessToken = process.env.ZOHO_ACCESS_TOKEN;
        
        if (!apiDomain || !organizationId || !accessToken) {
            throw new Error('Missing Zoho configuration in environment variables');
        }
        
        // Implementation for Zoho upload
        // This would need the full invoice creation logic
        
        res.json({ success: true, message: 'Upload functionality to be implemented' });
    } catch (err) {
        console.error('Error uploading to Zoho:', err);
        res.status(500).json({ error: err.message });
    }
});

// Initialize database and start server
const PORT = process.env.PORT || 3000;

initDatabase()
    .then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
            console.log(`🔑 Zoho configured: ${process.env.ZOHO_API_DOMAIN ? 'Yes' : 'No'}`);
            console.log(`🤖 Anthropic configured: ${process.env.ANTHROPIC_API_KEY ? 'Yes' : 'No'}`);
        });
    })
    .catch(err => {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    });
