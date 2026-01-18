const { useState, useEffect } = React;

function InvoiceProcessor() {
  const [config, setConfig] = useState({
    apiDomain: 'https://www.zohoapis.com',
    organizationId: '',
    accessToken: '',
    refreshToken: '',
    clientId: '',
    clientSecret: '',
    workdriveEnabled: false,
    workdriveTeamId: '',
    workdriveWorkspaceId: '',
    workdriveNewInvoicesFolderId: '',
    workdriveProcessedFolderId: '',
    workdriveFailedFolderId: '',
    workdriveCheckInterval: 5
  });
  
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [currentPreview, setCurrentPreview] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accountMappings, setAccountMappings] = useState({});
  const [activeTab, setActiveTab] = useState('upload');
  const [transactions, setTransactions] = useState([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [transactionLimit, setTransactionLimit] = useState(50);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const [batchToUpload, setBatchToUpload] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [isConnected, setIsConnected] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  
  // Vendor confirmation state
  const [vendorConfirmation, setVendorConfirmation] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [vendorFormData, setVendorFormData] = useState({
    vendorName: '',
    email: '',
    phone: '',
    currency: 'CAD',
    street: '',
    city: '',
    state: '',
    zip: '',
    country: ''
  });
  
  // Transaction history filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  // Load config from server
  useEffect(() => {
    const loadServerData = async () => {
      try {
        // Load config from environment variables via server
        const configRes = await fetch('/api/config');
        if (configRes.ok) {
          const serverConfig = await configRes.json();
          setConfig(serverConfig);
          // Check if connected (has access token)
          setIsConnected(!!serverConfig.accessToken);
        }
        
        const mappingsRes = await fetch('/api/gl-mappings/get');
        if (mappingsRes.ok) {
          const data = await mappingsRes.json();
          setAccountMappings(data.mappings || {});
        }
        
        const accountsRes = await fetch('/api/accounts/cached');
        if (accountsRes.ok) {
          const cache = await accountsRes.json();
          if (cache.accounts && cache.accounts.length > 0) {
            setAccounts(cache.accounts.map(acc => ({
              account_id: acc.account_id,
              account_name: acc.account_name,
              account_type: 'expense'
            })));
          }
        }
        
        const savedLog = localStorage.getItem('activityLog');
        if (savedLog) {
          setActivityLog(JSON.parse(savedLog));
        }

        loadTransactionHistory();
        
        // Start WorkDrive polling if enabled
        checkPendingImports();
      } catch (error) {
        console.error('Error loading server data:', error);
        addToLog('error', 'Failed to load configuration from server');
      }
    };
    
    loadServerData();
    
    // Poll for WorkDrive imports every 30 seconds
    const workdrivePolling = setInterval(() => {
      checkPendingImports();
    }, 30000);
    
    return () => clearInterval(workdrivePolling);
  }, []);
  
  // Check for pending WorkDrive imports
  const checkPendingImports = async () => {
    try {
      const response = await fetch('/api/workdrive/pending');
      if (response.ok) {
        const data = await response.json();
        const pendingFiles = data.files || [];
        
        if (pendingFiles.length > 0) {
          addToLog('info', `📥 ${pendingFiles.length} new invoice(s) from WorkDrive`);
          
          // Convert to file objects and add to queue
          const newFiles = pendingFiles.map(pf => ({
            id: Date.now() + Math.random(),
            file: {
              name: pf.file_name,
              type: 'application/pdf',
              size: 0
            },
            base64Data: pf.file_data,
            workdriveFileId: pf.workdrive_file_id,
            workdriveImportId: pf.id,
            status: 'pending',
            extractedData: null,
            error: null,
            isDuplicate: false
          }));
          
          setFiles(prev => [...prev, ...newFiles]);
          
          // Mark as fetched
          await fetch('/api/workdrive/mark-fetched', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds: pendingFiles.map(pf => pf.id) })
          });
        }
      }
    } catch (error) {
      console.error('Error checking pending imports:', error);
    }
  };

  // Load transaction history with filters
  const loadTransactionHistory = async (resetOffset = false) => {
    try {
      const offset = resetOffset ? 0 : transactionOffset;
      
      const params = new URLSearchParams({
        limit: transactionLimit,
        offset: offset
      });
      
      if (searchTerm) params.append('search', searchTerm);
      if (statusFilter) params.append('status', statusFilter);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (minAmount) params.append('minAmount', minAmount);
      if (maxAmount) params.append('maxAmount', maxAmount);
      
      const response = await fetch(`/api/transactions/history?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (resetOffset) {
          setTransactions(data.transactions || []);
          setTransactionOffset(0);
        } else {
          setTransactions(prev => [...prev, ...(data.transactions || [])]);
        }
        setTransactionTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Error loading transaction history:', error);
    }
  };
  
  // Search/filter transactions
  const searchTransactions = () => {
    loadTransactionHistory(true);
  };
  
  // Load more transactions
  const loadMoreTransactions = () => {
    setTransactionOffset(prev => prev + transactionLimit);
  };
  
  // Trigger load more when offset changes
  useEffect(() => {
    if (transactionOffset > 0) {
      loadTransactionHistory(false);
    }
  }, [transactionOffset]);
  
  // Export transactions to CSV
  const exportToCSV = () => {
    const headers = ['Date', 'Time', 'Vendor', 'Invoice #', 'Invoice Date', 'Amount', 'Currency', 'Status', 'Zoho Bill ID', 'Error'];
    const rows = transactions.map(txn => [
      new Date(txn.processed_at).toLocaleDateString(),
      new Date(txn.processed_at).toLocaleTimeString(),
      txn.vendor_name,
      txn.invoice_number,
      txn.invoice_date || '',
      txn.total_amount,
      txn.currency,
      txn.status,
      txn.zoho_bill_id || '',
      txn.error_message || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    addToLog('success', `Exported ${transactions.length} transactions to CSV`);
  };
  
  // Clear filters
  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
    setTransactionOffset(0);
    // Reload without filters
    setTimeout(() => loadTransactionHistory(true), 100);
  };

  // Check for duplicates
  const checkDuplicate = (invoiceData) => {
    const duplicate = transactions.find(txn => 
      txn.vendor_name.toLowerCase() === invoiceData.vendorName.toLowerCase() &&
      txn.invoice_number === invoiceData.invoiceNumber &&
      Math.abs(parseFloat(txn.total_amount) - parseFloat(invoiceData.total)) < 0.01
    );
    return duplicate;
  };

  // Save transaction to ledger
  const saveTransaction = async (invoiceData, status, zohoBillId = null, errorMessage = null, fileName = '') => {
    try {
      await fetch('/api/transactions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorName: invoiceData.vendorName,
          invoiceNumber: invoiceData.invoiceNumber,
          invoiceDate: invoiceData.invoiceDate,
          totalAmount: invoiceData.total,
          currency: invoiceData.currency || 'CAD',
          status: status,
          zohoBillId: zohoBillId,
          extractedData: invoiceData,
          errorMessage: errorMessage,
          fileName: fileName
        })
      });
      
      loadTransactionHistory();
    } catch (error) {
      console.error('Error saving transaction:', error);
    }
  };

  // Fetch Chart of Accounts from Zoho Books (using server-side credentials)
  const fetchAccounts = async () => {
    try {
      setLoadingAccounts(true);
      addToLog('info', 'Fetching chart of accounts from Zoho Books...');
      
      // Call the server endpoint - it will use environment variables
      const response = await fetch('/api/zoho/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})  // Server will use env vars
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch accounts: ${errorText}`);
      }

      const data = await response.json();
      const loadedAccounts = data.accounts || [];
      setAccounts(loadedAccounts);
      
      // Cache accounts in database
      await fetch('/api/accounts/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: loadedAccounts })
      });
      
      addToLog('success', `✓ Loaded ${loadedAccounts.length} accounts from Zoho Books`);
      
    } catch (error) {
      addToLog('error', `Failed to load accounts: ${error.message}`);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // Vendor confirmation handlers
  const handleCreateVendorAndUpload = async () => {
    if (!pendingUpload || !vendorConfirmation) return;
    
    try {
      addToLog('info', `Creating new vendor: ${vendorFormData.vendorName}...`);
      
      const createResponse = await fetch('/api/zoho/vendor/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorName: vendorFormData.vendorName,
          email: vendorFormData.email || null,
          phone: vendorFormData.phone || null,
          currency: vendorFormData.currency || 'CAD',
          address: {
            street: vendorFormData.street || null,
            city: vendorFormData.city || null,
            state: vendorFormData.state || null,
            zip: vendorFormData.zip || null,
            country: vendorFormData.country || null
          }
        })
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Failed to create vendor: ${errorText}`);
      }

      const createResult = await createResponse.json();
      addToLog('success', `✓ Created new vendor: ${createResult.vendorName}`);
      
      // Update the pending upload's vendor name in case it was edited
      const updatedUpload = {
        ...pendingUpload,
        extractedData: {
          ...pendingUpload.extractedData,
          vendorName: vendorFormData.vendorName
        }
      };
      
      // Now upload with the confirmed vendor ID
      const result = await uploadToZoho(updatedUpload, createResult.vendorId);
      
      if (!result.pending) {
        // Success - update file status
        setFiles(prev => prev.map(f => 
          f.file.name === pendingUpload.file.name
            ? { ...f, status: 'uploaded' }
            : f
        ));
      }
    } catch (error) {
      console.error('Error creating vendor:', error);
      addToLog('error', `Failed to create vendor: ${error.message}`);
      
      setFiles(prev => prev.map(f => 
        f.file.name === pendingUpload.file.name
          ? { ...f, status: 'failed', error: error.message }
          : f
      ));
    } finally {
      setVendorConfirmation(null);
      setPendingUpload(null);
      setVendorFormData({
        vendorName: '',
        email: '',
        phone: '',
        currency: 'CAD',
        street: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      });
    }
  };

  const handleCancelVendorCreation = () => {
    if (pendingUpload) {
      addToLog('info', `Cancelled upload for invoice - vendor not created`);
      setFiles(prev => prev.map(f => 
        f.file.name === pendingUpload.file.name
          ? { ...f, status: 'pending_vendor', error: 'Vendor creation cancelled' }
          : f
      ));
    }
    setVendorConfirmation(null);
    setPendingUpload(null);
    setVendorFormData({
      vendorName: '',
      email: '',
      phone: '',
      currency: 'CAD',
      street: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    });
  };

  const handleUpdateVendorName = (newName) => {
    setVendorFormData(prev => ({ ...prev, vendorName: newName }));
  };

  const handleVendorFormChange = (field, value) => {
    setVendorFormData(prev => ({ ...prev, [field]: value }));
  };

  // Auto-suggest account based on line item description and vendor
  const suggestAccount = (description, vendorName = '') => {
    const desc = description.toLowerCase();
    const vendor = vendorName.toLowerCase();
    
    // PRIORITY 1: Check vendor-specific mappings first (most accurate)
    if (vendor) {
      const vendorKey = `${vendor}::${desc}`;
      if (accountMappings[vendorKey]) {
        return accountMappings[vendorKey];
      }
      
      // Check if any vendor-specific partial matches exist
      for (const [key, accountId] of Object.entries(accountMappings)) {
        if (key.startsWith(vendor + '::') && desc.includes(key.split('::')[1])) {
          return accountId;
        }
      }
    }
    
    // PRIORITY 2: Check general keyword mappings (learned from any vendor)
    for (const [keyword, accountId] of Object.entries(accountMappings)) {
      if (!keyword.includes('::') && desc.includes(keyword.toLowerCase())) {
        return accountId;
      }
    }
    
    // PRIORITY 3: Hardcoded keyword matching (fallback) - ordered by specificity
    const keywords = {
      // Software & Subscriptions (most specific first)
      'software': ['software', 'saas', 'subscription', 'license', 'cloud', 'app'],
      'web hosting': ['hosting', 'domain', 'server'],
      'office supplies': ['office supplies', 'supplies', 'stationery', 'paper'],
      'advertising': ['advertising', 'marketing', 'ads', 'promotion'],
      'professional fees': ['consulting', 'consultant', 'professional services'],
      'shipping': ['shipping', 'freight', 'delivery', 'courier'],
      'insurance': ['insurance', 'coverage'],
      'rent': ['rent', 'lease'],
      'utilities': ['utilities', 'electric', 'gas', 'water', 'internet'],
      'telephone': ['telephone', 'phone', 'mobile', 'cell'],
      'bank charges': ['bank charge', 'bank fee', 'transaction fee', 'wire fee'],
      'credit card': ['credit card', 'cc fee', 'payment processing', 'merchant'],
      'meals': ['meal', 'lunch', 'dinner', 'restaurant', 'food'],
      'travel': ['travel', 'airfare', 'hotel', 'lodging'],
      'dues': ['dues', 'membership', 'association'],
      'repairs': ['repair', 'maintenance', 'fix'],
      'cleaning': ['cleaning', 'janitorial'],
      // Generic categories last
      'fee': ['service charge', 'processing fee'],  // More specific than just "fee"
      'minimum': ['minimum charge', 'minimum order']
    };
    
    // Try matching from most specific to least specific
    for (const [category, terms] of Object.entries(keywords)) {
      if (terms.some(term => desc.includes(term))) {
        const account = accounts.find(a => 
          a.account_name.toLowerCase().includes(category) ||
          terms.some(t => a.account_name.toLowerCase().includes(t))
        );
        if (account) return account.account_id;
      }
    }
    
    // PRIORITY 4: Default to first expense account
    const expenseAccount = accounts.find(a => 
      a.account_type === 'expense' || 
      a.account_name.toLowerCase().includes('expense')
    );
    
    return expenseAccount?.account_id || '';
  };

  // Save account mapping for future use (vendor-aware)
  const saveAccountMapping = async (description, accountId, vendorName = '') => {
    const desc = description.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    const vendor = vendorName.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    
    // Save vendor-specific mapping (highest priority)
    if (vendor && desc) {
      const vendorKey = `${vendor}::${desc}`;
      
      setAccountMappings(prev => ({ ...prev, [vendorKey]: accountId }));
      
      try {
        await fetch('/api/gl-mappings/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: vendorKey, accountId })
        });
      } catch (error) {
        console.error('Failed to save vendor-specific mapping:', error);
      }
    }
    
    // Also save general keyword mapping (lower priority fallback)
    const keywords = desc.split(' ').filter(word => word.length > 3);
    if (keywords.length > 0) {
      const keyword = keywords[0];
      
      setAccountMappings(prev => ({ ...prev, [keyword]: accountId }));
      
      try {
        await fetch('/api/gl-mappings/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, accountId })
        });
      } catch (error) {
        console.error('Failed to save general mapping:', error);
      }
    }
  };

  // Add entry to activity log
  const addToLog = (type, message, details = null) => {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    };
    
    const newLog = [entry, ...activityLog].slice(0, 100);
    setActivityLog(newLog);
    localStorage.setItem('activityLog', JSON.stringify(newLog));
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    const newFiles = selectedFiles.map(file => ({
      id: Date.now() + Math.random(),
      file,
      status: 'pending',
      extractedData: null,
      error: null,
      isDuplicate: false
    }));
    
    setFiles([...files, ...newFiles]);
    addToLog('info', `${selectedFiles.length} file(s) added to queue`);
  };

  // Extract data from PDF
  const extractInvoiceData = async (fileObj) => {
    // If file already has base64Data (from WorkDrive), use it directly
    if (fileObj.base64Data) {
      try {
        const response = await fetch('/api/claude/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Data: fileObj.base64Data })
        });

        if (!response.ok) {
          throw new Error('Failed to extract invoice data');
        }

        const data = await response.json();
        return data;
      } catch (error) {
        throw error;
      }
    }
    
    // Otherwise, read from file upload
    const file = fileObj.file;
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const base64Data = event.target.result.split(',')[1];
          
          // Store fileData for attachment
          fileObj.fileData = base64Data;
          
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
      addToLog('info', `Extracting data from ${fileObj.file.name}...`);
      const extractedData = await extractInvoiceData(fileObj);
      
      // Check for duplicate
      const duplicate = checkDuplicate(extractedData);
      
      if (extractedData.lineItems && accounts.length > 0) {
        extractedData.lineItems = extractedData.lineItems.map(item => {
          const suggestedAccountId = item.account_id || suggestAccount(item.description, extractedData.vendorName);
          const suggestedAccount = accounts.find(a => a.account_id === suggestedAccountId);
          
          return {
            ...item,
            account_id: suggestedAccountId,
            account_search: suggestedAccount?.account_name || '',
            account_dropdown_open: false
          };
        });
      }
      
      const updatedFile = {
        ...fileObj,
        extractedData,
        status: 'extracted',
        isDuplicate: !!duplicate,
        duplicateInfo: duplicate
      };
      
      setFiles(prev => prev.map(f => f.id === fileObj.id ? updatedFile : f));
      
      if (duplicate) {
        addToLog('warning', `⚠️ Possible duplicate: ${fileObj.file.name} matches invoice uploaded on ${new Date(duplicate.processed_at).toLocaleDateString()}`);
      } else {
        addToLog('success', `Data extracted from ${fileObj.file.name}`);
      }
      
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
  const uploadToZoho = async (fileObj, confirmedVendorId = null) => {
    if (!fileObj.extractedData) {
      throw new Error('No data extracted');
    }

    const data = fileObj.extractedData;
    
    try {
      let vendorId = confirmedVendorId;
      
      // If no confirmed vendor ID, search for the vendor first
      if (!vendorId) {
        addToLog('info', `Searching for vendor: ${data.vendorName}...`);
        
        const searchResponse = await fetch('/api/zoho/vendor/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vendorName: data.vendorName
          })
        });

        if (!searchResponse.ok) {
          const errorText = await searchResponse.text();
          throw new Error(`Failed to search for vendor: ${errorText}`);
        }

        const searchResult = await searchResponse.json();
        
        if (searchResult.found) {
          // Vendor found - use it
          vendorId = searchResult.vendorId;
          addToLog('success', `✓ Found existing vendor: ${searchResult.vendorName}`);
        } else {
          // Vendor not found - ask user for confirmation
          addToLog('warning', `⚠ Vendor "${data.vendorName}" not found in Zoho Books`);
          
          // Pre-populate vendor form with extracted data
          setVendorFormData({
            vendorName: data.vendorName || '',
            email: data.vendorEmail || '',
            phone: data.vendorPhone || '',
            currency: data.currency || 'CAD',
            street: data.vendorAddress?.street || '',
            city: data.vendorAddress?.city || '',
            state: data.vendorAddress?.state || '',
            zip: data.vendorAddress?.zip || '',
            country: data.vendorAddress?.country || ''
          });
          
          // Store pending upload and show confirmation dialog
          setPendingUpload(fileObj);
          setVendorConfirmation({
            invoiceNumber: data.invoiceNumber,
            action: 'create_new'
          });
          
          return { pending: true, message: 'Waiting for vendor confirmation' };
        }
      }
      
      addToLog('info', `Creating bill ${data.invoiceNumber}...`);
      
      const billData = {
        vendor_id: vendorId,
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

      // Add tax if present (manual adjustment approach for Canadian taxes)
      if (data.tax && data.tax > 0) {
        billData.adjustment = data.tax;
        billData.adjustment_description = `Sales Tax (${data.taxType || 'GST/HST/PST/QST'})`;
      }

      const billResponse = await fetch('/api/zoho/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billData
        })
      });

      if (!billResponse.ok) {
        const errorText = await billResponse.text();
        throw new Error(`Failed to create bill: ${errorText}`);
      }

      const billResult = await billResponse.json();
      const billId = billResult.bill?.bill_id;
      
      addToLog('success', `✓ Invoice ${data.invoiceNumber} uploaded successfully! Amount: $${data.total?.toFixed(2) || '0.00'} ${data.currency || 'CAD'}`);

      // ATTACH PDF TO BILL
      if (billId && (fileObj.fileData || fileObj.base64Data)) {
        try {
          addToLog('info', `📎 Attaching PDF to bill...`);
          
          const attachResponse = await fetch('/api/zoho/attach-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              billId: billId,
              fileName: fileObj.file?.name || 'invoice.pdf',
              fileData: fileObj.fileData || fileObj.base64Data
            })
          });

          if (attachResponse.ok) {
            addToLog('success', `✓ PDF attached to bill in Zoho Books`);
          } else {
            const errorText = await attachResponse.text();
            addToLog('warning', `⚠ Bill created but PDF attachment failed: ${errorText}`);
          }
        } catch (attachError) {
          console.error('Attachment error:', attachError);
          addToLog('warning', `⚠ Bill created but PDF attachment failed: ${attachError.message}`);
        }
      }

      // AUTOMATIC LEARNING: Save GL code mappings for successful uploads
      if (data.lineItems && data.lineItems.length > 0) {
        for (const item of data.lineItems) {
          if (item.account_id && item.description) {
            await saveAccountMapping(item.description, item.account_id, data.vendorName);
          }
        }
        addToLog('info', `Learned ${data.lineItems.length} GL code mapping(s) from ${data.vendorName}`);
      }

      await saveTransaction(data, 'success', billResult.bill?.bill_id, null, fileObj.file.name);

      return billResult;
      
    } catch (error) {
      addToLog('error', `✗ Failed to upload ${data.invoiceNumber}: ${error.message}`);
      await saveTransaction(data, 'error', null, error.message, fileObj.file.name);
      throw error;
    }
  };

  // Save changes without uploading
  const saveChanges = () => {
    if (!currentPreview) return;
    
    setFiles(prev => prev.map(f => 
      f.id === currentPreview.id ? currentPreview : f
    ));
    
    addToLog('success', `Changes saved for ${currentPreview.extractedData.invoiceNumber}`);
    setCurrentPreview(null);
    setEditMode(false);
  };

  // Process current preview (single invoice)
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
      setCurrentPreview(null);
      setEditMode(false);
    }
  };

  // Toggle file selection (only for extracted files)
  const toggleFileSelection = (fileId) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // Select/deselect all extracted files
  const toggleSelectAll = () => {
    const extractedFiles = files.filter(f => f.status === 'extracted');
    if (selectedFiles.size === extractedFiles.length && extractedFiles.length > 0) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(extractedFiles.map(f => f.id)));
    }
  };

  // Show batch confirmation modal for selected files
  const showBatchConfirmation = () => {
    const selectedExtractedFiles = files.filter(f => 
      f.status === 'extracted' && selectedFiles.has(f.id)
    );
    
    if (selectedExtractedFiles.length === 0) {
      addToLog('warning', 'No invoices selected for upload. Please check the boxes next to the invoices you want to upload.');
      return;
    }
    
    setBatchToUpload(selectedExtractedFiles);
    setShowBatchConfirm(true);
  };

  // Upload batch after confirmation
  const uploadBatch = async () => {
    setShowBatchConfirm(false);
    setProcessing(true);
    
    for (const file of batchToUpload) {
      try {
        await uploadToZoho(file);
        setFiles(prev => prev.map(f => 
          f.id === file.id ? { ...f, status: 'success' } : f
        ));
        
        // Move WorkDrive file to Processed folder if applicable
        if (file.workdriveFileId && config.workdriveProcessedFolderId) {
          try {
            const moveResponse = await fetch('/api/workdrive/move-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workdriveFileId: file.workdriveFileId,
                targetFolder: config.workdriveProcessedFolderId
              })
            });
            
            if (moveResponse.ok) {
              addToLog('success', `📁 Moved ${file.file.name} to Processed folder`);
            } else {
              const errorText = await moveResponse.text();
              addToLog('warning', `⚠ Upload succeeded but file move failed: ${errorText}`);
            }
          } catch (moveError) {
            console.error('Error moving file:', moveError);
            addToLog('warning', `⚠ Upload succeeded but file move failed: ${moveError.message}`);
          }
        }
      } catch (error) {
        setFiles(prev => prev.map(f => 
          f.id === file.id ? { ...f, status: 'error', error: error.message } : f
        ));
        
        // Move WorkDrive file to Failed folder if applicable
        if (file.workdriveFileId && config.workdriveFailedFolderId) {
          try {
            const moveResponse = await fetch('/api/workdrive/move-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workdriveFileId: file.workdriveFileId,
                targetFolder: config.workdriveFailedFolderId
              })
            });
            
            if (moveResponse.ok) {
              addToLog('warning', `📁 Moved ${file.file.name} to Failed folder`);
            } else {
              const errorText = await moveResponse.text();
              addToLog('error', `⚠ File move to Failed folder failed: ${errorText}`);
            }
          } catch (moveError) {
            console.error('Error moving file:', moveError);
            addToLog('error', `⚠ File move to Failed folder failed: ${moveError.message}`);
          }
        }
      }
    }
    
    setProcessing(false);
    setBatchToUpload([]);
    setSelectedFiles(new Set()); // Clear selections after upload
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
    
    const filesToProcess = files.filter(f => f.status === 'pending');
    
    if (filesToProcess.length === 0) {
      addToLog('warning', 'No pending files to process');
      setProcessing(false);
      return;
    }
    
    for (const file of filesToProcess) {
      try {
        await processSingleInvoice(file);
      } catch (error) {
        // Error already handled
      }
    }
    
    setProcessing(false);
    addToLog('success', `Processed ${filesToProcess.length} invoice(s). Review and select which ones to upload.`);
  };

  // Clear activity log
  const clearLog = () => {
    if (confirm('Clear all activity log entries?')) {
      setActivityLog([]);
      localStorage.removeItem('activityLog');
    }
  };

  const selectedCount = selectedFiles.size;

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

        {/* Settings Panel - Simplified for server-side credentials */}
        {showSettings && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Settings</h2>
            <div className="space-y-4">
              
              {/* Connection Status */}
              <div className={`p-4 rounded-lg border ${isConnected ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-2xl`}>{isConnected ? '✅' : '⚠️'}</span>
                  <div>
                    <p className={`font-medium ${isConnected ? 'text-green-800' : 'text-yellow-800'}`}>
                      {isConnected ? 'Connected to Zoho Books' : 'Not Connected'}
                    </p>
                    <p className="text-sm text-gray-600">
                      {isConnected 
                        ? 'Credentials are configured on the server.' 
                        : 'Please configure ZOHO_ACCESS_TOKEN and other credentials in Railway environment variables.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* GL Accounts Section */}
              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">📊 GL Accounts</h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={fetchAccounts}
                    disabled={loadingAccounts}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-blue-300"
                  >
                    {loadingAccounts ? '⏳ Loading...' : '🔄 Load GL Accounts'}
                  </button>
                  {accounts.length > 0 && (
                    <span className="text-green-600 font-medium">
                      ✓ {accounts.length} accounts loaded
                    </span>
                  )}
                </div>
                {accounts.length === 0 && (
                  <p className="text-sm text-gray-500 mt-2">
                    Click "Load GL Accounts" to fetch your chart of accounts from Zoho Books. 
                    This is required for assigning GL codes to line items.
                  </p>
                )}
              </div>
              
              {/* WorkDrive Status */}
              {config.workdriveEnabled && (
                <div className="border-t pt-4 mt-4">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">
                      📁 <strong>WorkDrive Auto-Import is enabled</strong> - PDFs dropped in the configured folder will automatically appear in the queue.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('upload')}
              className={`flex-1 px-6 py-4 font-medium transition ${
                activeTab === 'upload'
                  ? 'border-b-2 border-emerald-600 text-emerald-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📄 Upload Invoices
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 px-6 py-4 font-medium transition ${
                activeTab === 'history'
                  ? 'border-b-2 border-emerald-600 text-emerald-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📊 Transaction History ({transactionTotal})
            </button>
          </div>
        </div>

        {activeTab === 'upload' ? (
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
                    <h3 className="font-medium">Queue ({files.length})</h3>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600 flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selectedFiles.size === files.filter(f => f.status === 'extracted').length && files.filter(f => f.status === 'extracted').length > 0}
                          onChange={toggleSelectAll}
                          className="rounded"
                        />
                        Select all ready
                      </label>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={processAllFiles}
                      disabled={processing || files.filter(f => f.status === 'pending').length === 0}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {processing ? 'Processing...' : 'Process All'}
                    </button>
                    <button
                      onClick={showBatchConfirmation}
                      disabled={processing || selectedCount === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Upload Selected ({selectedCount})
                    </button>
                  </div>
                  
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {files.map(fileObj => (
                      <div key={fileObj.id} className={`p-3 border rounded-lg flex items-center justify-between ${
                        fileObj.isDuplicate ? 'border-yellow-400 bg-yellow-50' : 
                        fileObj.status === 'success' ? 'border-green-400 bg-green-50' :
                        fileObj.status === 'error' ? 'border-red-400 bg-red-50' :
                        'border-gray-200'
                      }`}>
                        <div className="flex items-center gap-3">
                          {fileObj.status === 'extracted' && (
                            <input
                              type="checkbox"
                              checked={selectedFiles.has(fileObj.id)}
                              onChange={() => toggleFileSelection(fileObj.id)}
                              className="rounded"
                            />
                          )}
                          <div>
                            <p className="font-medium text-sm">{fileObj.file.name}</p>
                            {fileObj.extractedData && (
                              <p className="text-xs text-gray-500">
                                {fileObj.extractedData.vendorName} | Invoice #{fileObj.extractedData.invoiceNumber} | ${fileObj.extractedData.total?.toFixed(2) || '0.00'}
                              </p>
                            )}
                            {fileObj.isDuplicate && (
                              <p className="text-xs text-yellow-700">
                                ⚠️ Possible duplicate - uploaded {new Date(fileObj.duplicateInfo?.processed_at).toLocaleDateString()}
                              </p>
                            )}
                            {fileObj.error && (
                              <p className="text-xs text-red-600">{fileObj.error}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {fileObj.status === 'pending' && (
                            <span className="text-gray-500 text-sm">Pending</span>
                          )}
                          {fileObj.status === 'extracting' && (
                            <span className="text-blue-500 text-sm">Extracting...</span>
                          )}
                          {fileObj.status === 'extracted' && (
                            <>
                              <span className="text-emerald-500 text-sm">🎯 Ready</span>
                              <button
                                onClick={() => { setCurrentPreview(fileObj); setEditMode(true); }}
                                className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200"
                              >
                                Review
                              </button>
                            </>
                          )}
                          {fileObj.status === 'success' && (
                            <span className="text-green-600 text-sm">✓ Uploaded</span>
                          )}
                          {fileObj.status === 'pending_vendor' && (
                            <span className="text-yellow-600 text-sm">⚠ Vendor needed</span>
                          )}
                          {fileObj.status === 'error' && (
                            <span className="text-red-500 text-sm">✗ Failed</span>
                          )}
                          <button
                            onClick={() => setFiles(files.filter(f => f.id !== fileObj.id))}
                            className="text-gray-400 hover:text-red-500"
                          >
                            ×
                          </button>
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
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              </div>
              
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {activityLog.map(entry => (
                  <div 
                    key={entry.id} 
                    className={`p-3 rounded-lg border-l-4 ${
                      entry.type === 'success' ? 'bg-green-50 border-green-500' :
                      entry.type === 'error' ? 'bg-red-50 border-red-500' :
                      entry.type === 'warning' ? 'bg-yellow-50 border-yellow-500' :
                      'bg-blue-50 border-blue-500'
                    }`}
                  >
                    <p className="text-sm">{entry.message}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                ))}
                {activityLog.length === 0 && (
                  <p className="text-gray-500 text-center py-8">No activity yet</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Transaction History Tab */
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Transaction History</h2>
              <button
                onClick={exportToCSV}
                disabled={transactions.length === 0}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:bg-gray-300"
              >
                📥 Export CSV
              </button>
            </div>
            
            {/* Filters */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
              <input
                type="text"
                placeholder="Search vendor/invoice..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">All Status</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
              </select>
              <input
                type="date"
                placeholder="From date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <input
                type="date"
                placeholder="To date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <button
                onClick={searchTransactions}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                🔍 Search
              </button>
              <button
                onClick={clearFilters}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"
              >
                Clear
              </button>
            </div>
            
            {/* Transaction Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Vendor</th>
                    <th className="px-4 py-3 text-left">Invoice #</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-left">Zoho Bill ID</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(txn => (
                    <tr key={txn.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {new Date(txn.processed_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-medium">{txn.vendor_name}</td>
                      <td className="px-4 py-3">{txn.invoice_number}</td>
                      <td className="px-4 py-3 text-right">
                        ${parseFloat(txn.total_amount).toFixed(2)} {txn.currency}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${
                          txn.status === 'success' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {txn.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {txn.zoho_bill_id || '-'}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                        No transactions found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            {/* Load More */}
            {transactions.length < transactionTotal && (
              <div className="mt-4 text-center">
                <button
                  onClick={loadMoreTransactions}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Load More ({transactions.length} of {transactionTotal})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Batch Confirmation Modal */}
        {showBatchConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
              <h3 className="text-xl font-semibold mb-4">Confirm Batch Upload</h3>
              <p className="text-gray-600 mb-4">
                You are about to upload {batchToUpload.length} invoice(s) to Zoho Books:
              </p>
              <div className="max-h-60 overflow-y-auto mb-4 border rounded-lg">
                {batchToUpload.map(file => (
                  <div key={file.id} className="p-3 border-b last:border-b-0">
                    <p className="font-medium">{file.extractedData?.vendorName}</p>
                    <p className="text-sm text-gray-500">
                      Invoice #{file.extractedData?.invoiceNumber} - ${file.extractedData?.total?.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowBatchConfirm(false)}
                  className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={uploadBatch}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                >
                  Upload All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preview/Edit Modal */}
        {currentPreview && editMode && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold">Review & Edit Invoice Data</h3>
                  <button
                    onClick={() => { setCurrentPreview(null); setEditMode(false); }}
                    className="text-gray-500 hover:text-gray-700 text-2xl"
                  >
                    ×
                  </button>
                </div>

                {currentPreview.isDuplicate && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-yellow-800 text-sm">
                      ⚠️ <strong>Possible Duplicate:</strong> This invoice may have already been uploaded on {new Date(currentPreview.duplicateInfo?.processed_at).toLocaleDateString()}.
                    </p>
                  </div>
                )}

                <div className="space-y-4">
                  {/* Basic Info */}
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
                        value={currentPreview.extractedData.dueDate || ''}
                        onChange={(e) => updateExtractedData('dueDate', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Currency
                      </label>
                      <select
                        value={currentPreview.extractedData.currency || 'CAD'}
                        onChange={(e) => updateExtractedData('currency', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="CAD">CAD</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </div>

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
                      Line Items
                    </label>
                    <div className="space-y-3">
                      {(currentPreview.extractedData.lineItems || []).map((item, index) => (
                        <div key={index} className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                          <div className="grid grid-cols-3 gap-2 mb-2">
                            <input
                              type="text"
                              value={item.description || ''}
                              onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                              placeholder="Description"
                              className="col-span-1 px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                            <input
                              type="number"
                              value={item.quantity || ''}
                              onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                              placeholder="Qty"
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                            <input
                              type="number"
                              step="0.01"
                              value={item.rate || ''}
                              onChange={(e) => updateLineItem(index, 'rate', parseFloat(e.target.value) || 0)}
                              placeholder="Rate"
                              className="px-2 py-1 border border-gray-300 rounded text-sm"
                            />
                          </div>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search GL accounts..."
                              value={item.account_search || ''}
                              onChange={(e) => {
                                updateLineItem(index, 'account_search', e.target.value);
                                // Keep dropdown open while typing
                                if (!item.account_dropdown_open) {
                                  updateLineItem(index, 'account_dropdown_open', true);
                                }
                              }}
                              onFocus={() => updateLineItem(index, 'account_dropdown_open', true)}
                              onClick={() => updateLineItem(index, 'account_dropdown_open', true)}
                              className={`w-full px-2 py-1 border rounded text-sm cursor-pointer ${
                                !item.account_id ? 'border-red-300 bg-red-50' : 'border-gray-300'
                              }`}
                            />
                            {item.account_dropdown_open && (
                              <>
                                <div 
                                  className="fixed inset-0 z-40"
                                  onClick={() => updateLineItem(index, 'account_dropdown_open', false)}
                                />
                                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-60 overflow-y-auto">
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
                                            saveAccountMapping(item.description, acc.account_id, currentPreview.extractedData.vendorName);
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

                  {/* Tax Section */}
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Sales Tax (GST/HST/PST/QST)
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Total Tax Amount</label>
                        <input
                          type="number"
                          step="0.01"
                          value={currentPreview.extractedData.tax || 0}
                          onChange={(e) => updateExtractedData('tax', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">Tax Type</label>
                        <select
                          value={currentPreview.extractedData.taxType || 'none'}
                          onChange={(e) => updateExtractedData('taxType', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          <option value="none">No Tax</option>
                          <option value="gst">GST (5%)</option>
                          <option value="hst">HST (13-15%)</option>
                          <option value="gst_pst">GST + PST</option>
                          <option value="gst_qst">GST + QST</option>
                        </select>
                      </div>
                    </div>
                    {currentPreview.extractedData.taxDetails && (
                      <div className="mt-2 text-xs text-gray-600">
                        {currentPreview.extractedData.taxDetails.gst > 0 && <div>GST: ${currentPreview.extractedData.taxDetails.gst.toFixed(2)}</div>}
                        {currentPreview.extractedData.taxDetails.hst > 0 && <div>HST: ${currentPreview.extractedData.taxDetails.hst.toFixed(2)}</div>}
                        {currentPreview.extractedData.taxDetails.pst > 0 && <div>PST: ${currentPreview.extractedData.taxDetails.pst.toFixed(2)}</div>}
                        {currentPreview.extractedData.taxDetails.qst > 0 && <div>QST: ${currentPreview.extractedData.taxDetails.qst.toFixed(2)}</div>}
                      </div>
                    )}
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
                    onClick={saveChanges}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    Save Changes
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

        {/* Vendor Confirmation Modal */}
        {vendorConfirmation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-2xl">⚠️</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Create New Vendor</h3>
                    <p className="text-sm text-gray-500">Invoice #{vendorConfirmation.invoiceNumber}</p>
                  </div>
                </div>

                <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700">
                    💡 This vendor was not found in Zoho Books. Review the details below and click "Create Vendor & Upload" to add them.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Company Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={vendorFormData.vendorName}
                      onChange={(e) => handleVendorFormChange('vendorName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      placeholder="Enter company name"
                    />
                  </div>

                  {/* Email and Phone */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={vendorFormData.email}
                        onChange={(e) => handleVendorFormChange('email', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        placeholder="vendor@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone
                      </label>
                      <input
                        type="text"
                        value={vendorFormData.phone}
                        onChange={(e) => handleVendorFormChange('phone', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        placeholder="+1 555-555-5555"
                      />
                    </div>
                  </div>

                  {/* Currency */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Currency
                    </label>
                    <select
                      value={vendorFormData.currency}
                      onChange={(e) => handleVendorFormChange('currency', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    >
                      <option value="CAD">CAD - Canadian Dollar</option>
                      <option value="USD">USD - US Dollar</option>
                    </select>
                  </div>

                  {/* Address Section */}
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Address (Optional)</h4>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Street Address</label>
                        <input
                          type="text"
                          value={vendorFormData.street}
                          onChange={(e) => handleVendorFormChange('street', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                          placeholder="123 Main St"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">City</label>
                          <input
                            type="text"
                            value={vendorFormData.city}
                            onChange={(e) => handleVendorFormChange('city', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            placeholder="City"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">State/Province</label>
                          <input
                            type="text"
                            value={vendorFormData.state}
                            onChange={(e) => handleVendorFormChange('state', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            placeholder="State/Province"
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Postal/ZIP Code</label>
                          <input
                            type="text"
                            value={vendorFormData.zip}
                            onChange={(e) => handleVendorFormChange('zip', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            placeholder="A1A 1A1"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Country</label>
                          <input
                            type="text"
                            value={vendorFormData.country}
                            onChange={(e) => handleVendorFormChange('country', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            placeholder="Canada"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleCancelVendorCreation}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateVendorAndUpload}
                    disabled={!vendorFormData.vendorName.trim()}
                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    Create Vendor & Upload
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
