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
app.use(express.static('.'));

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
