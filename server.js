const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

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
        accounts JSONB NOT NULL,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        `INSERT INTO config (key, value, updated_at) 
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) 
         DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
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
      config[row.key] = JSON.parse(row.value);
    });
    
    res.json(config);
  } catch (error) {
    console.error('Error loading config:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// API endpoint to save GL account mappings
app.post('/api/mappings/save', async (req, res) => {
  try {
    const { mappings } = req.body;
    
    for (const [keyword, accountId] of Object.entries(mappings)) {
      await pool.query(
        `INSERT INTO gl_mappings (keyword, account_id, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (keyword)
         DO UPDATE SET account_id = $2, updated_at = CURRENT_TIMESTAMP`,
        [keyword, accountId]
      );
    }
    
    res.json({ success: true, message: 'Mappings saved' });
  } catch (error) {
    console.error('Error saving mappings:', error);
    res.status(500).json({ error: 'Failed to save mappings' });
  }
});

// API endpoint to load GL account mappings
app.get('/api/mappings/load', async (req, res) => {
  try {
    const result = await pool.query('SELECT keyword, account_id FROM gl_mappings');
    
    const mappings = {};
    result.rows.forEach(row => {
      mappings[row.keyword] = row.account_id;
    });
    
    res.json({ mappings });
  } catch (error) {
    console.error('Error loading mappings:', error);
    res.status(500).json({ error: 'Failed to load mappings' });
  }
});

// API endpoint to cache GL accounts
app.post('/api/accounts/cache', async (req, res) => {
  try {
    const { accounts } = req.body;
    
    // Delete old cache
    await pool.query('DELETE FROM accounts_cache');
    
    // Insert new cache
    await pool.query(
      'INSERT INTO accounts_cache (accounts, cached_at) VALUES ($1, CURRENT_TIMESTAMP)',
      [JSON.stringify(accounts)]
    );
    
    res.json({ success: true, message: 'Accounts cached' });
  } catch (error) {
    console.error('Error caching accounts:', error);
    res.status(500).json({ error: 'Failed to cache accounts' });
  }
});

// API endpoint to load cached GL accounts
app.get('/api/accounts/cache', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT accounts, cached_at FROM accounts_cache ORDER BY cached_at DESC LIMIT 1'
    );
    
    if (result.rows.length > 0) {
      res.json({
        accounts: JSON.parse(result.rows[0].accounts),
        cachedAt: result.rows[0].cached_at
      });
    } else {
      res.json({ accounts: [], cachedAt: null });
    }
  } catch (error) {
    console.error('Error loading cached accounts:', error);
    res.status(500).json({ error: 'Failed to load cached accounts' });
  }
});

// Enable CORS for all origins (you can restrict this in production)
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Helper function to normalize vendor names for comparison
function normalizeVendorName(name) {
  return name
    .toUpperCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize spaces
    .trim();
}

// Helper function to calculate similarity between two strings
function calculateSimilarity(str1, str2) {
  const normalized1 = normalizeVendorName(str1);
  const normalized2 = normalizeVendorName(str2);
  
  // Exact match
  if (normalized1 === normalized2) return 1.0;
  
  // Check if one contains the other
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    return 0.8;
  }
  
  return 0;
}

// Proxy endpoint for Zoho Books API - Search/Create Vendor
app.post('/api/zoho/vendor', async (req, res) => {
  try {
    const { vendorName, organizationId, accessToken, apiDomain } = req.body;
    
    console.log('Searching for vendor:', vendorName);

    // Try multiple search strategies
    const searchStrategies = [
      // Strategy 1: Exact name search
      `contact_name=${encodeURIComponent(vendorName)}`,
      // Strategy 2: Uppercase name search
      `contact_name=${encodeURIComponent(vendorName.toUpperCase())}`,
      // Strategy 3: Contains search with first few words
      `contact_name_contains=${encodeURIComponent(vendorName.split(' ').slice(0, 3).join(' '))}`,
      // Strategy 4: Broad search with just first word (for companies)
      `contact_name_contains=${encodeURIComponent(vendorName.split(' ')[0])}`
    ];

    let allVendors = [];
    
    // Try each search strategy
    for (const searchParam of searchStrategies) {
      const searchUrl = `${apiDomain}/books/v3/contacts?organization_id=${organizationId}&${searchParam}`;
      console.log('Trying search:', searchParam);
      
      const searchResponse = await fetch(searchUrl, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.contacts && searchData.contacts.length > 0) {
          // Filter for vendors only
          const vendors = searchData.contacts.filter(c => c.contact_type === 'vendor' || c.is_vendor);
          allVendors.push(...vendors);
          console.log(`Found ${vendors.length} vendors with this strategy`);
        }
      }
    }

    // Remove duplicates by contact_id
    const uniqueVendors = Array.from(new Map(allVendors.map(v => [v.contact_id, v])).values());
    console.log(`Total unique vendors found: ${uniqueVendors.length}`);

    // Find best match using similarity scoring
    if (uniqueVendors.length > 0) {
      const vendorsWithScores = uniqueVendors.map(vendor => ({
        ...vendor,
        similarity: calculateSimilarity(vendorName, vendor.contact_name)
      }));

      // Sort by similarity score
      vendorsWithScores.sort((a, b) => b.similarity - a.similarity);
      
      console.log('Vendor matches:');
      vendorsWithScores.forEach(v => {
        console.log(`  - ${v.contact_name} (score: ${v.similarity})`);
      });

      // Use vendor if similarity is above threshold
      const bestMatch = vendorsWithScores[0];
      if (bestMatch.similarity >= 0.8) {
        console.log(`Using existing vendor: ${bestMatch.contact_name} (ID: ${bestMatch.contact_id})`);
        return res.json({ 
          vendorId: bestMatch.contact_id, 
          vendorName: bestMatch.contact_name,
          created: false 
        });
      } else {
        console.log(`Best match score ${bestMatch.similarity} too low, will create new vendor`);
      }
    }

    // Vendor doesn't exist, create new one
    console.log('Creating new vendor:', vendorName);
    
    const createUrl = `${apiDomain}/books/v3/contacts?organization_id=${organizationId}`;
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contact_name: vendorName.toUpperCase(), // Store in uppercase to match convention
        contact_type: 'vendor'
      })
    });

    const createData = await createResponse.json();
    
    if (createData.contact) {
      console.log('Created vendor:', createData.contact.contact_id);
      return res.json({ 
        vendorId: createData.contact.contact_id,
        vendorName: createData.contact.contact_name,
        created: true 
      });
    }

    return res.status(500).json({ 
      error: 'Failed to create vendor',
      details: createData
    });

  } catch (error) {
    console.error('Vendor creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for Zoho Books API - Create Bill
app.post('/api/zoho/bill', async (req, res) => {
  try {
    const { billData, organizationId, accessToken, apiDomain } = req.body;

    console.log('Creating bill in Zoho Books:', billData);
    
    // First, check if this invoice number already exists for this vendor
    const checkUrl = `${apiDomain}/books/v3/bills?organization_id=${organizationId}&vendor_id=${billData.vendor_id}&bill_number=${encodeURIComponent(billData.bill_number)}`;
    console.log('Checking for duplicate invoice:', billData.bill_number);
    
    const checkResponse = await fetch(checkUrl, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    if (checkResponse.ok) {
      const checkData = await checkResponse.json();
      if (checkData.bills && checkData.bills.length > 0) {
        console.log('Duplicate invoice found!');
        return res.status(409).json({ 
          error: 'Duplicate Invoice',
          message: `Invoice ${billData.bill_number} already exists for this vendor.`,
          existingBill: checkData.bills[0]
        });
      }
    }
    
    // No duplicate found, proceed with creation
    const url = `${apiDomain}/books/v3/bills?organization_id=${organizationId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `JSONString=${encodeURIComponent(JSON.stringify(billData))}`
    });

    const responseText = await response.text();
    console.log('Zoho API Response:', responseText);
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Failed to create bill',
        details: responseText
      });
    }

    const data = JSON.parse(responseText);
    res.json(data);

  } catch (error) {
    console.error('Bill creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for Zoho Books API - Get Chart of Accounts
app.post('/api/zoho/accounts', async (req, res) => {
  try {
    const { organizationId, accessToken, apiDomain } = req.body;

    console.log('Fetching chart of accounts from Zoho Books');
    
    const url = `${apiDomain}/books/v3/chartofaccounts?organization_id=${organizationId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Zoho API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Failed to fetch accounts',
        details: errorText
      });
    }

    const data = await response.json();
    
    // Filter to only expense accounts for simplicity
    const expenseAccounts = data.chartofaccounts || [];
    
    console.log(`Fetched ${expenseAccounts.length} accounts`);
    
    res.json({ accounts: expenseAccounts });

  } catch (error) {
    console.error('Accounts fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for Claude API - Extract invoice data
app.post('/api/claude/extract', async (req, res) => {
  try {
    const { base64Data } = req.body;

    console.log('Extracting invoice data with Claude...');

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || req.headers['x-anthropic-api-key'],
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64Data
                }
              },
              {
                type: "text",
                text: `Extract the following information from this supplier/vendor invoice and return ONLY a JSON object with no markdown formatting or backticks:

{
  "vendorName": "vendor/supplier name",
  "invoiceNumber": "invoice/bill number",
  "invoiceDate": "YYYY-MM-DD format",
  "dueDate": "YYYY-MM-DD format or null",
  "referenceNumber": "PO number or reference if available, else null",
  "currency": "currency code like USD, EUR, CAD, etc",
  "subtotal": numeric value (sum of all line item amounts, before tax),
  "tax": numeric value (tax amount only, not included in subtotal),
  "total": numeric value (subtotal + tax),
  "lineItems": [
    {
      "description": "item/service description",
      "quantity": numeric value,
      "rate": numeric value (unit price),
      "amount": numeric value (quantity × rate)
    }
  ],
  "notes": "any notes or additional information on the invoice, or null"
}

IMPORTANT: 
- Calculate subtotal by summing all line item amounts
- Subtotal should NOT include tax
- Total should equal subtotal + tax
- Each lineItem amount should equal quantity × rate
- If the invoice shows a total but no separate subtotal and tax, set tax to 0 and subtotal to equal the total

If any field is not found, use null. Return only the JSON object.`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Failed to extract invoice data',
        details: errorText
      });
    }

    const data = await response.json();
    
    // Extract the text content from Claude's response
    const textContent = data.content.find(item => item.type === 'text');
    if (!textContent) {
      return res.status(500).json({ error: 'No text response from Claude' });
    }

    // Parse the JSON from Claude's response
    let extractedData;
    try {
      // Remove any markdown code blocks if present
      const cleanText = textContent.text.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(cleanText);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', textContent.text);
      return res.status(500).json({ 
        error: 'Failed to parse extracted data',
        details: textContent.text
      });
    }

    res.json(extractedData);

  } catch (error) {
    console.error('Invoice extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
