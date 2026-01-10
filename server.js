const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (you can restrict this in production)
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Proxy endpoint for Zoho Books API - Search/Create Vendor
app.post('/api/zoho/vendor', async (req, res) => {
  try {
    const { vendorName, organizationId, accessToken, apiDomain } = req.body;

    console.log('Searching for vendor:', vendorName);

    // Search for existing vendor
    const searchUrl = `${apiDomain}/books/v3/contacts?organization_id=${organizationId}&contact_name=${encodeURIComponent(vendorName)}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData.contacts && searchData.contacts.length > 0) {
        // Check if any contact is a vendor
        const vendor = searchData.contacts.find(c => c.contact_type === 'vendor' || c.is_vendor);
        if (vendor) {
          console.log('Found existing vendor:', vendor.contact_id);
          return res.json({ vendorId: vendor.contact_id, created: false });
        }
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
        contact_name: vendorName,
        contact_type: 'vendor'
      })
    });

    const createData = await createResponse.json();
    
    if (createData.contact) {
      console.log('Created vendor:', createData.contact.contact_id);
      return res.json({ vendorId: createData.contact.contact_id, created: true });
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
  "subtotal": numeric value,
  "tax": numeric value,
  "total": numeric value,
  "lineItems": [
    {
      "description": "item/service description",
      "quantity": numeric value,
      "rate": numeric value (unit price),
      "amount": numeric value (total for this line)
    }
  ],
  "notes": "any notes or additional information on the invoice, or null"
}

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
