const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
// Invoice processor backend

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
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `JSONString=${encodeURIComponent(JSON.stringify({
        contact_name: vendorName,
        contact_type: 'vendor'
      }))}`
    });

    const createText = await createResponse.text();
    console.log('Create vendor response:', createText);

    if (!createResponse.ok) {
      return res.status(createResponse.status).json({ 
        error: 'Failed to create vendor',
        details: createText 
      });
    }

    const createData = JSON.parse(createText);
    res.json({ vendorId: createData.contact.contact_id, created: true });

  } catch (error) {
    console.error('Vendor error:', error);
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
        "x-api-key": process.env.ANTHROPIC_API_KEY || req.headers['x-anthropic-api-key']
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
        error: 'Failed to extract data',
        details: errorText 
      });
    }

    const data = await response.json();
    const textContent = data.content
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("");

    const cleanText = textContent.replace(/```json|```/g, "").trim();
    const extractedData = JSON.parse(cleanText);

    res.json(extractedData);

  } catch (error) {
    console.error('Extraction error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
