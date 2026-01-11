const { useState, useEffect } = React;

function InvoiceProcessor() {
  const [config, setConfig] = useState({
    apiDomain: 'https://www.zohoapis.com',
    organizationId: '',
    accessToken: '',
    refreshToken: '',
    clientId: '',
    clientSecret: ''
  });
  
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [currentPreview, setCurrentPreview] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accountMappings, setAccountMappings] = useState({});

  // Load config from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('zohoConfig');
    if (saved) {
      setConfig(JSON.parse(saved));
    }
    
    const savedLog = localStorage.getItem('activityLog');
    if (savedLog) {
      setActivityLog(JSON.parse(savedLog));
    }
    
    const savedMappings = localStorage.getItem('accountMappings');
    if (savedMappings) {
      setAccountMappings(JSON.parse(savedMappings));
    }
    
    const savedAccounts = localStorage.getItem('zohoAccounts');
    if (savedAccounts) {
      setAccounts(JSON.parse(savedAccounts));
    }
  }, []);

  // Save config to localStorage
  const saveConfig = () => {
    localStorage.setItem('zohoConfig', JSON.stringify(config));
    setShowSettings(false);
    addToLog('success', 'Settings saved successfully');
    // Fetch accounts after saving config
    fetchAccounts();
  };

  // Fetch Chart of Accounts from Zoho Books
  const fetchAccounts = async () => {
    if (!config.organizationId || !config.accessToken) {
      return;
    }

    try {
      addToLog('info', 'Fetching chart of accounts from Zoho Books...');
      
      const response = await fetch('/api/zoho/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: config.organizationId,
          accessToken: config.accessToken,
          apiDomain: config.apiDomain
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch accounts');
      }

      const data = await response.json();
      const loadedAccounts = data.accounts || [];
      setAccounts(loadedAccounts);
      
      // Save to localStorage
      localStorage.setItem('zohoAccounts', JSON.stringify(loadedAccounts));
      
      addToLog('success', `✓ Loaded ${loadedAccounts.length} accounts from Zoho Books`);
      
    } catch (error) {
      addToLog('error', `Failed to load accounts: ${error.message}`);
    }
  };

  // Auto-suggest account based on line item description
  const suggestAccount = (description) => {
    const desc = description.toLowerCase();
    
    // Check saved mappings first
    for (const [keyword, accountId] of Object.entries(accountMappings)) {
      if (desc.includes(keyword.toLowerCase())) {
        return accountId;
      }
    }
    
    // Default keyword matching
    const keywords = {
      'shipping': ['shipping', 'freight', 'delivery', 'ship'],
      'fee': ['fee', 'charge', 'service'],
      'minimum': ['minimum', 'min'],
      'credit card': ['credit card', 'cc', 'payment processing'],
      'sticker': ['sticker', 'label', 'packaging']
    };
    
    for (const [category, terms] of Object.entries(keywords)) {
      if (terms.some(term => desc.includes(term))) {
        // Find matching account
        const account = accounts.find(a => 
          a.account_name.toLowerCase().includes(category) ||
          a.account_name.toLowerCase().includes(terms[0])
        );
        if (account) return account.account_id;
      }
    }
    
    // Return first expense account as fallback
    const expenseAccount = accounts.find(a => 
      a.account_type === 'expense' || 
      a.account_name.toLowerCase().includes('expense')
    );
    
    return expenseAccount?.account_id || '';
  };

  // Save account mapping for future use
  const saveAccountMapping = (description, accountId) => {
    // Extract key terms from description
    const keywords = description.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(' ')
      .filter(word => word.length > 3);
    
    if (keywords.length > 0) {
      const newMappings = { ...accountMappings };
      keywords.forEach(keyword => {
        newMappings[keyword] = accountId;
      });
      setAccountMappings(newMappings);
      localStorage.setItem('accountMappings', JSON.stringify(newMappings));
    }
  };

  // Automatically refresh access token when expired
  const refreshAccessToken = async () => {
    if (!config.refreshToken || !config.clientId || !config.clientSecret) {
      addToLog('error', 'Cannot refresh token: Missing refresh token or client credentials');
      return null;
    }

    try {
      addToLog('info', 'Refreshing access token...');

      const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          refresh_token: config.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'refresh_token'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to refresh token');
      }

      const data = await response.json();
      
      if (data.access_token) {
        // Update config with new access token
        const newConfig = {
          ...config,
          accessToken: data.access_token
        };
        setConfig(newConfig);
        localStorage.setItem('zohoConfig', JSON.stringify(newConfig));
        
        addToLog('success', '✓ Access token refreshed successfully');
        return data.access_token;
      } else {
        throw new Error('No access token in response');
      }
    } catch (error) {
      addToLog('error', `Failed to refresh access token: ${error.message}. Please update your credentials in Settings.`);
      return null;
    }
  };

  // Add entry to activity log
  const addToLog = (type, message, details = null) => {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type, // success, error, info, warning
      message,
      details
    };
    
    const newLog = [entry, ...activityLog].slice(0, 100); // Keep last 100 entries
    setActivityLog(newLog);
    localStorage.setItem('activityLog', JSON.stringify(newLog));
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    const newFiles = selectedFiles.map(file => ({
      id: Date.now() + Math.random(),
      file,
      status: 'pending', // pending, processing, success, error
      extractedData: null,
      error: null
    }));
    
    setFiles([...files, ...newFiles]);
    addToLog('info', `${selectedFiles.length} file(s) added to queue`);
  };

  // Extract data from PDF
  const extractInvoiceData = async (fileObj) => {
    const file = fileObj.file;
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64Data = event.target.result.split(',')[1];
          
          const response = await fetch('/api/claude/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64Data })
          });

          if (!response.ok) {
            throw new Error('Failed to extract invoice data');
          }

          const data = await response.json();
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  // Process a single invoice
  const processSingleInvoice = async (fileObj) => {
    try {
      // Extract data
      addToLog('info', `Extracting data from ${fileObj.file.name}...`);
      const extractedData = await extractInvoiceData(fileObj);
      
      // Auto-suggest accounts for each line item
      if (extractedData.lineItems && accounts.length > 0) {
        extractedData.lineItems = extractedData.lineItems.map(item => {
          const suggestedAccountId = item.account_id || suggestAccount(item.description);
          const suggestedAccount = accounts.find(a => a.account_id === suggestedAccountId);
          
          return {
            ...item,
            account_id: suggestedAccountId,
            account_search: suggestedAccount?.account_name || '',
            account_dropdown_open: false
          };
        });
      }
      
      // Update file with extracted data
      const updatedFile = {
        ...fileObj,
        extractedData,
        status: 'extracted'
      };
      
      setFiles(prev => prev.map(f => f.id === fileObj.id ? updatedFile : f));
      
      // Show preview for user to review
      setCurrentPreview(updatedFile);
      setEditMode(true);
      
      addToLog('success', `Data extracted from ${fileObj.file.name}`);
      return updatedFile;
      
    } catch (error) {
      const updatedFile = {
        ...fileObj,
        status: 'error',
        error: error.message
      };
      
      setFiles(prev => prev.map(f => f.id === fileObj.id ? updatedFile : f));
      addToLog('error', `Failed to extract from ${fileObj.file.name}: ${error.message}`);
      throw error;
    }
  };

  // Upload to Zoho Books
  const uploadToZoho = async (fileObj, retryCount = 0) => {
    if (!fileObj.extractedData) {
      throw new Error('No data extracted');
    }

    const data = fileObj.extractedData;
    
    try {
      addToLog('info', `Searching for vendor: ${data.vendorName}...`);
      
      // Search/Create Vendor
      const vendorResponse = await fetch('/api/zoho/vendor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorName: data.vendorName,
          organizationId: config.organizationId,
          accessToken: config.accessToken,
          apiDomain: config.apiDomain
        })
      });

      // Auto-retry with refreshed token on 401
      if (vendorResponse.status === 401 && retryCount === 0) {
        addToLog('warning', 'Access token expired, refreshing...');
        const newToken = await refreshAccessToken();
        if (newToken) {
          // Retry with new token
          return uploadToZoho(fileObj, 1);
        } else {
          throw new Error('Access token expired. Please update your token in Settings.');
        }
      }

      if (!vendorResponse.ok) {
        const errorData = await vendorResponse.json().catch(() => ({}));
        
        // Provide specific error messages
        if (vendorResponse.status === 401) {
          throw new Error('Access token expired or invalid. Please generate a new token in Settings.');
        } else if (vendorResponse.status === 400) {
          throw new Error('Invalid organization ID or access token. Please check your settings.');
        } else {
          throw new Error(errorData.error || errorData.details || 'Failed to find/create vendor. Check your Zoho credentials.');
        }
      }

      const vendorData = await vendorResponse.json();
      
      if (vendorData.created) {
        addToLog('warning', `⚠ Created new vendor: ${vendorData.vendorName}`);
      } else {
        addToLog('success', `✓ Found existing vendor: ${vendorData.vendorName}`);
      }

      // Create Bill
      addToLog('info', `Creating bill ${data.invoiceNumber}...`);
      
      const billData = {
        vendor_id: vendorData.vendorId,
        bill_number: data.invoiceNumber,
        date: data.invoiceDate,
        due_date: data.dueDate || data.invoiceDate,
        reference_number: data.referenceNumber || '',
        currency_code: data.currency || 'CAD',
        line_items: data.lineItems.map(item => ({
          description: item.description,
          rate: item.rate,
          quantity: item.quantity,
          account_id: item.account_id,
          item_order: data.lineItems.indexOf(item)
        })),
        notes: data.notes || ''
      };

      const billResponse = await fetch('/api/zoho/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billData,
          organizationId: config.organizationId,
          accessToken: config.accessToken,
          apiDomain: config.apiDomain
        })
      });

      if (!billResponse.ok) {
        const errorData = await billResponse.json().catch(() => ({}));
        
        // Check if it's a duplicate invoice
        if (billResponse.status === 409) {
          throw new Error(`Duplicate invoice detected: ${errorData.message || `Invoice ${data.invoiceNumber} already exists for this vendor`}`);
        } else if (billResponse.status === 401) {
          throw new Error('Access token expired. Please generate a new token in Settings.');
        } else if (billResponse.status === 400) {
          throw new Error(`Invalid bill data: ${errorData.error || errorData.details || 'Please check the invoice details'}`);
        } else {
          throw new Error(errorData.error || errorData.details || 'Failed to create bill in Zoho Books');
        }
      }

      const billResult = await billResponse.json();
      
      addToLog('success', `✓ Invoice ${data.invoiceNumber} uploaded successfully! Amount: $${data.total?.toFixed(2) || '0.00'} ${data.currency || 'CAD'}`);

      return billResult;
      
    } catch (error) {
      addToLog('error', `✗ Failed to upload ${data.invoiceNumber}: ${error.message}`);
      throw error;
    }
  };

  // Process current preview
  const confirmAndUpload = async () => {
    if (!currentPreview) return;
    
    try {
      setProcessing(true);
      await uploadToZoho(currentPreview);
      
      setFiles(prev => prev.map(f => 
        f.id === currentPreview.id ? { ...f, status: 'success' } : f
      ));
      
    } catch (error) {
      setFiles(prev => prev.map(f => 
        f.id === currentPreview.id ? { ...f, status: 'error', error: error.message } : f
      ));
    } finally {
      setProcessing(false);
      // Always close modal after upload attempt
      setCurrentPreview(null);
      setEditMode(false);
    }
  };

  // Update extracted data during edit
  const updateExtractedData = (field, value) => {
    setCurrentPreview(prev => ({
      ...prev,
      extractedData: {
        ...prev.extractedData,
        [field]: value
      }
    }));
  };

  // Update line item
  const updateLineItem = (index, field, value) => {
    const updatedData = {
      ...currentPreview.extractedData,
      lineItems: currentPreview.extractedData.lineItems.map((item, i) => 
        i === index ? { ...item, [field]: value } : item
      )
    };
    
    // Recalculate subtotal and total
    const newSubtotal = updatedData.lineItems.reduce((sum, item) => {
      const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0);
      return sum + amount;
    }, 0);
    
    const newTotal = newSubtotal + (parseFloat(updatedData.tax) || 0);
    
    updatedData.subtotal = newSubtotal;
    updatedData.total = newTotal;
    
    setCurrentPreview(prev => ({
      ...prev,
      extractedData: updatedData
    }));
  };

  // Process all pending files
  const processAllFiles = async () => {
    setProcessing(true);
    
    const pendingFiles = files.filter(f => f.status === 'pending');
    
    for (const file of pendingFiles) {
      try {
        const extracted = await processSingleInvoice(file);
        // Wait for user to confirm each one
        // This is handled by the preview modal
        break; // Process one at a time, showing preview
      } catch (error) {
        // Error already handled in processSingleInvoice
      }
    }
    
    setProcessing(false);
  };

  // Clear activity log
  const clearLog = () => {
    if (confirm('Clear all activity log entries?')) {
      setActivityLog([]);
      localStorage.removeItem('activityLog');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 p-6">
      <div className="max-w-7xl mx-auto">
        
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Invoice Processor</h1>
              <p className="text-gray-600 mt-1">Extract and upload invoices to Zoho Books</p>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              ⚙️ Settings
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Zoho Books Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Organization ID
                </label>
                <input
                  type="text"
                  value={config.organizationId}
                  onChange={(e) => setConfig({...config, organizationId: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  placeholder="Enter your Zoho Organization ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Access Token
                </label>
                <input
                  type="password"
                  value={config.accessToken}
                  onChange={(e) => setConfig({...config, accessToken: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  placeholder="Enter your Zoho Access Token"
                />
              </div>
              
              <div className="border-t pt-4 mt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Auto-Refresh Settings (Optional)</h3>
                <p className="text-xs text-gray-600 mb-3">
                  Enable automatic token refresh by providing your refresh token and client credentials. 
                  This prevents "token expired" errors.
                </p>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Refresh Token
                    </label>
                    <input
                      type="password"
                      value={config.refreshToken}
                      onChange={(e) => setConfig({...config, refreshToken: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                      placeholder="1000.xxx..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Client ID
                    </label>
                    <input
                      type="text"
                      value={config.clientId}
                      onChange={(e) => setConfig({...config, clientId: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                      placeholder="1000.ES86MGZHSXB975Y195X46VW7SBE3FF"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Client Secret
                    </label>
                    <input
                      type="password"
                      value={config.clientSecret}
                      onChange={(e) => setConfig({...config, clientSecret: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                      placeholder="7abf2fc01230a4b9a0c08f4837aef870f231973226"
                    />
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={saveConfig}
                  className="flex-1 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
                >
                  Save Settings
                </button>
                <button
                  onClick={fetchAccounts}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  disabled={!config.organizationId || !config.accessToken}
                >
                  Load GL Accounts
                </button>
              </div>
              
              {accounts.length > 0 && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    ✓ {accounts.length} GL accounts loaded from Zoho Books
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Upload Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Upload Invoices</h2>
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-emerald-500 transition">
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="fileInput"
              />
              <label htmlFor="fileInput" className="cursor-pointer">
                <div className="text-6xl mb-4">📄</div>
                <p className="text-lg font-medium text-gray-700">
                  Drop PDF invoices here or click to browse
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Supports multiple file upload
                </p>
              </label>
            </div>

            {/* File Queue */}
            {files.length > 0 && (
              <div className="mt-6">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold">Queue ({files.length})</h3>
                  <button
                    onClick={processAllFiles}
                    disabled={processing || files.every(f => f.status !== 'pending')}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:bg-gray-300"
                  >
                    {processing ? 'Processing...' : 'Process All'}
                  </button>
                </div>
                
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {files.map(file => (
                    <div
                      key={file.id}
                      className={`p-3 rounded-lg border ${
                        file.status === 'success' ? 'bg-green-50 border-green-200' :
                        file.status === 'error' ? 'bg-red-50 border-red-200' :
                        file.status === 'processing' ? 'bg-blue-50 border-blue-200' :
                        'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-medium text-sm truncate">{file.file.name}</p>
                          {file.error && (
                            <p className="text-xs text-red-600 mt-1">{file.error}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-1 rounded">
                            {file.status === 'success' && '✓'}
                            {file.status === 'error' && '✗'}
                            {file.status === 'processing' && '⏳'}
                            {file.status === 'pending' && '⋯'}
                          </span>
                          <button
                            onClick={() => setFiles(prev => prev.filter(f => f.id !== file.id))}
                            className="text-gray-400 hover:text-red-600 text-lg font-bold"
                            title="Remove from queue"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Activity Log */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Activity Log</h2>
              <button
                onClick={clearLog}
                className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded transition"
              >
                Clear
              </button>
            </div>
            
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {activityLog.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">No activity yet</p>
              ) : (
                activityLog.map(entry => (
                  <div
                    key={entry.id}
                    className={`p-3 rounded-lg text-sm ${
                      entry.type === 'success' ? 'bg-green-50 border-l-4 border-green-500' :
                      entry.type === 'error' ? 'bg-red-50 border-l-4 border-red-500' :
                      entry.type === 'warning' ? 'bg-yellow-50 border-l-4 border-yellow-500' :
                      'bg-blue-50 border-l-4 border-blue-500'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium">
                        {entry.type === 'success' && '✓ '}
                        {entry.type === 'error' && '✗ '}
                        {entry.type === 'warning' && '⚠ '}
                        {entry.type === 'info' && 'ℹ '}
                        {entry.message}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {entry.details && (
                      <pre className="text-xs text-gray-600 mt-2 overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Preview/Edit Modal */}
        {currentPreview && editMode && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold">Review & Edit Invoice Data</h2>
                  <button
                    onClick={() => { setCurrentPreview(null); setEditMode(false); }}
                    className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Vendor Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Vendor Name
                      </label>
                      <input
                        type="text"
                        value={currentPreview.extractedData.vendorName || ''}
                        onChange={(e) => updateExtractedData('vendorName', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Invoice Number
                      </label>
                      <input
                        type="text"
                        value={currentPreview.extractedData.invoiceNumber || ''}
                        onChange={(e) => updateExtractedData('invoiceNumber', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Invoice Date
                      </label>
                      <input
                        type="date"
                        value={currentPreview.extractedData.invoiceDate || ''}
                        onChange={(e) => updateExtractedData('invoiceDate', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Due Date
                      </label>
                      <input
                        type="date"
                        value={currentPreview.extractedData.dueDate || currentPreview.extractedData.invoiceDate || ''}
                        onChange={(e) => updateExtractedData('dueDate', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Currency
                      </label>
                      <input
                        type="text"
                        value={currentPreview.extractedData.currency || 'CAD'}
                        onChange={(e) => updateExtractedData('currency', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  </div>

                  {/* Reference Number */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Reference/PO Number
                    </label>
                    <input
                      type="text"
                      value={currentPreview.extractedData.referenceNumber || ''}
                      onChange={(e) => updateExtractedData('referenceNumber', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      placeholder="Optional"
                    />
                  </div>

                  {/* Line Items */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Line Items {accounts && accounts.length > 0 && `(${accounts.length} accounts loaded)`}
                    </label>
                    <div className="space-y-3">
                      {currentPreview.extractedData.lineItems?.map((item, index) => (
                        <div key={index} className="p-3 bg-gray-50 rounded-lg space-y-2">
                          <div className="grid grid-cols-4 gap-2">
                            <input
                              type="text"
                              value={item.description || ''}
                              onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                              className="col-span-2 px-2 py-1 border border-gray-300 rounded text-sm"
                              placeholder="Description"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={item.quantity || ''}
                              onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value))}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              placeholder="Qty"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={item.rate || ''}
                              onChange={(e) => updateLineItem(index, 'rate', parseFloat(e.target.value))}
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                              placeholder="Rate"
                            />
                          </div>
                          <div>
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="Search GL accounts..."
                                value={item.account_search || ''}
                                onChange={(e) => {
                                  updateLineItem(index, 'account_search', e.target.value);
                                }}
                                onFocus={() => updateLineItem(index, 'account_dropdown_open', true)}
                                className={`w-full px-2 py-1 border rounded text-sm ${
                                  !item.account_id ? 'border-red-300 bg-red-50' : 'border-gray-300'
                                }`}
                              />
                              {item.account_dropdown_open && (
                                <>
                                  <div 
                                    className="fixed inset-0 z-10"
                                    onClick={() => updateLineItem(index, 'account_dropdown_open', false)}
                                  />
                                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {(accounts || [])
                                      .filter(acc => {
                                        const search = (item.account_search || '').toLowerCase();
                                        return !search || 
                                          acc.account_name.toLowerCase().includes(search) ||
                                          acc.account_type.toLowerCase().includes(search);
                                      })
                                      .map(acc => (
                                        <div
                                          key={acc.account_id}
                                          onClick={() => {
                                            updateLineItem(index, 'account_id', acc.account_id);
                                            updateLineItem(index, 'account_search', acc.account_name);
                                            updateLineItem(index, 'account_dropdown_open', false);
                                            if (acc.account_id) {
                                              saveAccountMapping(item.description, acc.account_id);
                                            }
                                          }}
                                          className="px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm border-b last:border-b-0"
                                        >
                                          <div className="font-medium">{acc.account_name}</div>
                                          <div className="text-xs text-gray-500">{acc.account_type}</div>
                                        </div>
                                      ))
                                    }
                                    {(accounts || []).filter(acc => {
                                      const search = (item.account_search || '').toLowerCase();
                                      return !search || 
                                        acc.account_name.toLowerCase().includes(search) ||
                                        acc.account_type.toLowerCase().includes(search);
                                    }).length === 0 && (
                                      <div className="px-3 py-2 text-sm text-gray-500">
                                        No accounts match "{item.account_search}"
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Subtotal</label>
                      <p className="text-lg font-semibold">${currentPreview.extractedData.subtotal?.toFixed(2) || '0.00'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Tax</label>
                      <p className="text-lg font-semibold">${currentPreview.extractedData.tax?.toFixed(2) || '0.00'}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Total</label>
                      <p className="text-lg font-bold text-emerald-600">${currentPreview.extractedData.total?.toFixed(2) || '0.00'}</p>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Notes
                    </label>
                    <textarea
                      value={currentPreview.extractedData.notes || ''}
                      onChange={(e) => updateExtractedData('notes', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      rows="3"
                      placeholder="Optional notes..."
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => { setCurrentPreview(null); setEditMode(false); }}
                    className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmAndUpload}
                    disabled={processing}
                    className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:bg-gray-300"
                  >
                    {processing ? 'Uploading...' : 'Confirm & Upload'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);
root.render(React.createElement(InvoiceProcessor));
