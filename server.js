const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create config table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create gl_mappings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gl_mappings (
        id SERIAL PRIMARY KEY,
        keyword VARCHAR(255) UNIQUE NOT NULL,
        account_id VARCHAR(255) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create accounts_cache table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts_cache (
        id SERIAL PRIMARY KEY,
        account_id VARCHAR(255) UNIQUE NOT NULL,
        account_name TEXT NOT NULL,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create transactions table for audit log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        vendor_name VARCHAR(255) NOT NULL,
        invoice_number VARCHAR(255) NOT NULL,
        invoice_date DATE,
        total_amount DECIMAL(10, 2),
        currency VARCHAR(10),
        status VARCHAR(50) NOT NULL,
        zoho_bill_id VARCHAR(255),
        extracted_data JSONB,
        error_message TEXT,
        file_name VARCHAR(255)
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

initializeDatabase();

// API endpoint to save configuration
app.post('/api/config/save', async (req, res) => {
  try {
    const config = req.body;
    
    // Store each config field
    for (const [key, value] of Object.entries(config)) {
      await pool.query(
        'INSERT INTO config (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP',
        [key, JSON.stringify(value)]
      );
    }

    res.json({ success: true, message: 'Configuration saved' });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// API endpoint to load configuration
app.get('/api/config/load', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM config');
    
    const config = {
      apiDomain: 'https://www.zohoapis.com',
      organizationId: '',
      accessToken: '',
      refreshToken: '',
      clientId: '',
      clientSecret: ''
    };

    result.rows.forEach(row => {
      try {
        config[row.key] = JSON.parse(row.value);
      } catch (e) {
        config[row.key] = row.value;
      }
    });

    res.json(config);
  } catch (error) {
    console.error('Error loading config:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// API endpoint to save GL mapping
app.post('/api/gl-mappings/save', async (req, res) => {
  try {
    const { keyword, accountId } = req.body;
    
    await pool.query(
      'INSERT INTO gl_mappings (keyword, account_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (keyword) DO UPDATE SET account_id = $2, updated_at = CURRENT_TIMESTAMP',
      [keyword.toLowerCase(), accountId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving GL mapping:', error);
    res.status(500).json({ error: 'Failed to save GL mapping' });
  }
});

// API endpoint to get GL mapping
app.get('/api/gl-mappings/get', async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword) {
      return res.json({ accountId: null });
    }
    
    const result = await pool.query(
      'SELECT account_id FROM gl_mappings WHERE keyword = $1',
      [keyword.toLowerCase()]
    );

    if (result.rows.length > 0) {
      res.json({ accountId: result.rows[0].account_id });
    } else {
      res.json({ accountId: null });
    }
  } catch (error) {
    console.error('Error getting GL mapping:', error);
    res.status(500).json({ error: 'Failed to get GL mapping' });
  }
});

// API endpoint to cache accounts
app.post('/api/accounts/cache', async (req, res) => {
  try {
    const { accounts } = req.body;
    
    if (!accounts || !Array.isArray(accounts)) {
      return res.status(400).json({ error: 'Invalid accounts data' });
    }
    
    // Clear old cache
    await pool.query('DELETE FROM accounts_cache');
    
    // Insert new cache
    for (const account of accounts) {
      await pool.query(
        'INSERT INTO accounts_cache (account_id, account_name, cached_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [account.account_id, account.account_name]
      );
    }

    res.json({ success: true, cached: accounts.length });
  } catch (error) {
    console.error('Error caching accounts:', error);
    res.status(500).json({ error: 'Failed to cache accounts' });
  }
});

// API endpoint to get cached accounts
app.get('/api/accounts/cached', async (req, res) => {
  try {
    const result = await pool.query('SELECT account_id, account_name FROM accounts_cache ORDER BY account_name');
    res.json({ accounts: result.rows });
  } catch (error) {
    console.error('Error getting cached accounts:', error);
    res.status(500).json({ error: 'Failed to get cached accounts' });
  }
});

// API endpoint to save transaction to ledger
app.post('/api/transactions/save', async (req, res) => {
  try {
    const { 
      vendorName, 
      invoiceNumber, 
      invoiceDate, 
      totalAmount, 
      currency, 
      status, 
      zohoBillId, 
      extractedData,
      errorMessage,
      fileName
    } = req.body;
    
    const result = await pool.query(
      `INSERT INTO transactions 
       (vendor_name, invoice_number, invoice_date, total_amount, currency, status, zoho_bill_id, extracted_data, error_message, file_name) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id`,
      [vendorName, invoiceNumber, invoiceDate, totalAmount, currency, status, zohoBillId, JSON.stringify(extractedData), errorMessage, fileName]
    );

    res.json({ success: true, transactionId: result.rows[0].id });
  } catch (error) {
    console.error('Error saving transaction:', error);
    res.status(500).json({ error: 'Failed to save transaction' });
  }
});

// API endpoint to get transaction history
app.get('/api/transactions/history', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    
    const result = await pool.query(
      `SELECT id, processed_at, vendor_name, invoice_number, invoice_date, total_amount, currency, status, zoho_bill_id, error_message, file_name
       FROM transactions 
       ORDER BY processed_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query('SELECT COUNT(*) FROM transactions');
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({ 
      transactions: result.rows,
      total: totalCount
    });
  } catch (error) {
    console.error('Error getting transaction history:', error);
    res.status(500).json({ error: 'Failed to get transaction history' });
  }
});

// API endpoint to get single transaction details
app.get('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting transaction:', error);
    res.status(500).json({ error: 'Failed to get transaction' });
  }
});

// Claude API endpoint for invoice extraction
app.post('/api/claude/extract', async (req, res) => {
  try {
    const { base64Data } = req.body;
    
    console.log('Extracting invoice data with Claude...');
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Data
              }
            },
            {
              type: 'text',
              text: `Extract invoice information from this PDF and return ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "vendorName": "vendor name",
  "invoiceNumber": "invoice number",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "currency": "CAD or USD",
  "lineItems": [
    {
      "description": "item description",
      "quantity": number,
      "rate": number,
      "amount": number
    }
  ],
  "subtotal": number,
  "tax": number,
  "total": number
}`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    const extractedText = data.content[0].text;
    
    // Parse the JSON response
    const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(400).json({ error: 'Could not extract JSON from response' });
    }
    
    const invoiceData = JSON.parse(jsonMatch[0]);
    console.log('Successfully extracted invoice data');
    
    res.json(invoiceData);
  } catch (error) {
    console.error('Error extracting invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

// Zoho API endpoints
app.post('/api/zoho/vendor', async (req, res) => {
  try {
    const { vendorName, config } = req.body;
    
    console.log('Creating/finding vendor:', vendorName);
    
    // Search for existing vendor
    const searchResponse = await fetch(
      `${config.apiDomain}/books/v3/contacts?organization_id=${config.organizationId}&contact_name=${encodeURIComponent(vendorName)}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${config.accessToken}`
        }
      }
    );

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Zoho search vendor error:', errorText);
      return res.status(searchResponse.status).json({ error: errorText });
    }

    const searchData = await searchResponse.json();
    
    if (searchData.contacts && searchData.contacts.length > 0) {
      console.log('Found existing vendor:', searchData.contacts[0].contact_id);
      return res.json({ vendorId: searchData.contacts[0].contact_id });
    }

    // Create new vendor
    console.log('Creating new vendor...');
    const createResponse = await fetch(
      `${config.apiDomain}/books/v3/contacts?organization_id=${config.organizationId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contact_name: vendorName,
          contact_type: 'vendor'
        })
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('Zoho create vendor error:', errorText);
      return res.status(createResponse.status).json({ error: errorText });
    }

    const createData = await createResponse.json();
    console.log('Created new vendor:', createData.contact.contact_id);
    res.json({ vendorId: createData.contact.contact_id });
  } catch (error) {
    console.error('Error with vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/zoho/bill', async (req, res) => {
  try {
    const { billData, config } = req.body;
    
    console.log('Creating bill in Zoho Books...');
    
    const response = await fetch(
      `${config.apiDomain}/books/v3/bills?organization_id=${config.organizationId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(billData)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Zoho create bill error:', errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    console.log('Successfully created bill:', data.bill.bill_id);
    res.json(data);
  } catch (error) {
    console.error('Error creating bill:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/zoho/accounts', async (req, res) => {
  try {
    const { organizationId, accessToken, apiDomain } = req.body;
    
    console.log('Fetching chart of accounts from Zoho...');
    
    const response = await fetch(
      `${apiDomain}/books/v3/chartofaccounts?organization_id=${organizationId}`,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Zoho accounts error:', errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    
    // Filter to only include expense accounts (for bills)
    const allAccounts = data.chartofaccounts || [];
    const expenseAccounts = allAccounts.filter(acc => 
      acc.account_type && acc.account_type.toLowerCase() === 'expense'
    );
    
    console.log(`Successfully fetched ${allAccounts.length} total accounts, ${expenseAccounts.length} expense accounts`);
    res.json({ accounts: expenseAccounts });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
