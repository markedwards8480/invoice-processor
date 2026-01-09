# Invoice to Zoho Books - Deployment Guide

AI-powered invoice processing that automatically uploads supplier invoices to Zoho Books.

## Features
- Upload PDF invoices
- AI extraction of vendor, line items, amounts, dates
- Automatic vendor creation in Zoho Books
- Direct bill creation via API
- Edit extracted data before upload
- Batch processing

## Quick Deploy to Railway

### 1. Push to GitHub
```bash
# Create a new GitHub repository
# Then push this code:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway will auto-detect the Node.js app and deploy it
5. Get your deployment URL (e.g., `https://your-app.up.railway.app`)

### 3. Configure Zoho Books
1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Create a "Self Client"
3. Add scope: `ZohoBooks.fullaccess.all`
4. Generate access token
5. Get your Organization ID from Zoho Books → Settings → Organization Profile

### 4. Use the App
1. Visit your Railway URL
2. Click "Settings" in the app
3. Enter:
   - Organization ID
   - Access Token
   - API Domain (select your region)
4. Upload invoice PDFs
5. Review extracted data
6. Click "Upload to Zoho Books"

## Local Development

### Setup
```bash
npm install
```

### Run locally
```bash
npm start
```

App runs on `http://localhost:3000`

## Environment Variables (Optional)
If you want to hide the Anthropic API key, set:
- `ANTHROPIC_API_KEY` - Your Anthropic API key (for invoice extraction)

Otherwise, the app uses the Claude API without a key (works in claude.ai artifacts).

## Project Structure
```
├── server.js          # Express backend (proxies Zoho API calls)
├── package.json       # Node dependencies
├── public/
│   ├── index.html     # Main HTML file
│   └── index.jsx      # React frontend
└── README.md          # This file
```

## API Endpoints

Backend provides these endpoints:

- `POST /api/claude/extract` - Extract data from PDF invoice
- `POST /api/zoho/vendor` - Get or create vendor in Zoho Books
- `POST /api/zoho/bill` - Create bill in Zoho Books

## Troubleshooting

### "Failed to fetch" errors
- Check your Zoho access token hasn't expired
- Verify Organization ID is correct
- Ensure API domain matches your Zoho region

### Token expired
- Self Client tokens expire quickly
- Generate a new token in Zoho API Console
- For production, implement refresh token flow

### Invoice extraction issues
- Ensure PDF is not password protected
- Check PDF is a real invoice (not just an image)
- Try uploading one invoice at a time

## Support
For issues or questions, check the Zoho Books API docs:
- https://www.zoho.com/books/api/v3/
