import React, { useState, useRef } from 'react';
import { Upload, FileText, Send, Loader2, CheckCircle2, AlertCircle, Edit2, Trash2, Settings } from 'lucide-react';

// Set your Railway backend URL here after deployment
const API_URL = window.location.origin.includes('localhost') 
  ? 'http://localhost:3000' 
  : window.location.origin;

export default function InvoiceProcessor() {
  const [invoices, setInvoices] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    organizationId: '',
    accessToken: '',
    apiDomain: 'https://www.zohoapis.com'
  });
  const fileInputRef = useRef(null);

  const extractInvoiceData = async (file) => {
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const response = await fetch(`${API_URL}/api/claude/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base64Data })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to extract invoice data');
    }

    return await response.json();
  };

  const uploadToZohoBooks = async (invoiceData) => {
    if (!settings.organizationId || !settings.accessToken) {
      throw new Error('Please configure Zoho Books settings first');
    }

    // First, get or create vendor
    const vendorResponse = await fetch(`${API_URL}/api/zoho/vendor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        vendorName: invoiceData.vendorName,
        organizationId: settings.organizationId,
        accessToken: settings.accessToken,
        apiDomain: settings.apiDomain
      })
    });

    if (!vendorResponse.ok) {
      const error = await vendorResponse.json();
      throw new Error(error.error || 'Failed to get/create vendor');
    }

    const { vendorId } = await vendorResponse.json();

    // Prepare bill data
    const billData = {
      vendor_id: vendorId,
      bill_number: invoiceData.invoiceNumber || undefined,
      reference_number: invoiceData.referenceNumber || undefined,
      date: invoiceData.invoiceDate || new Date().toISOString().split('T')[0],
      due_date: invoiceData.dueDate || undefined,
      currency_code: invoiceData.currency || 'USD',
      notes: invoiceData.notes || undefined,
      line_items: invoiceData.lineItems.map(item => ({
        description: item.description,
        rate: item.rate,
        quantity: item.quantity
      }))
    };

    // Create the bill
    const billResponse = await fetch(`${API_URL}/api/zoho/bill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        billData,
        organizationId: settings.organizationId,
        accessToken: settings.accessToken,
        apiDomain: settings.apiDomain
      })
    });

    if (!billResponse.ok) {
      const error = await billResponse.json();
      throw new Error(error.error || 'Failed to create bill');
    }

    return await billResponse.json();
  };

  const handleFiles = async (files) => {
    setProcessing(true);
    const newInvoices = [];

    for (const file of files) {
      if (file.type === 'application/pdf') {
        try {
          const extractedData = await extractInvoiceData(file);
          newInvoices.push({
            id: Date.now() + Math.random(),
            fileName: file.name,
            status: 'extracted',
            data: extractedData,
            uploaded: false
          });
        } catch (error) {
          newInvoices.push({
            id: Date.now() + Math.random(),
            fileName: file.name,
            status: 'error',
            error: error.message
          });
        }
      }
    }

    setInvoices([...invoices, ...newInvoices]);
    setProcessing(false);
  };

  const uploadSingleInvoice = async (invoiceId) => {
    const invoice = invoices.find(inv => inv.id === invoiceId);
    if (!invoice || invoice.status !== 'extracted') return;

    setInvoices(invoices.map(inv => 
      inv.id === invoiceId ? { ...inv, uploading: true } : inv
    ));

    try {
      const result = await uploadToZohoBooks(invoice.data);
      setInvoices(invoices.map(inv => 
        inv.id === invoiceId 
          ? { 
              ...inv, 
              uploaded: true, 
              uploading: false,
              zohoResponse: result,
              status: 'uploaded'
            } 
          : inv
      ));
    } catch (error) {
      setInvoices(invoices.map(inv => 
        inv.id === invoiceId 
          ? { 
              ...inv, 
              uploading: false,
              uploadError: error.message 
            } 
          : inv
      ));
    }
  };

  const uploadAllInvoices = async () => {
    const extractedInvoices = invoices.filter(
      inv => inv.status === 'extracted' && !inv.uploaded
    );

    for (const invoice of extractedInvoices) {
      await uploadSingleInvoice(invoice.id);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const updateInvoiceField = (invoiceId, field, value) => {
    setInvoices(invoices.map(inv => {
      if (inv.id === invoiceId) {
        return {
          ...inv,
          data: { ...inv.data, [field]: value }
        };
      }
      return inv;
    }));
  };

  const updateLineItem = (invoiceId, itemIndex, field, value) => {
    setInvoices(invoices.map(inv => {
      if (inv.id === invoiceId) {
        const newLineItems = [...inv.data.lineItems];
        newLineItems[itemIndex] = {
          ...newLineItems[itemIndex],
          [field]: field === 'description' ? value : parseFloat(value) || 0
        };
        return {
          ...inv,
          data: { ...inv.data, lineItems: newLineItems }
        };
      }
      return inv;
    }));
  };

  const deleteInvoice = (invoiceId) => {
    setInvoices(invoices.filter(inv => inv.id !== invoiceId));
  };

  const saveSettings = () => {
    localStorage.setItem('zohoSettings', JSON.stringify(settings));
    setShowSettings(false);
  };

  // Load settings on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('zohoSettings');
    if (saved) {
      setSettings(JSON.parse(saved));
    }
  }, []);

  const isConfigured = settings.organizationId && settings.accessToken;
  const canUpload = invoices.some(inv => inv.status === 'extracted' && !inv.uploaded);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      {/* Header */}
      <header className="border-b border-emerald-200 bg-white/80 backdrop-blur-sm shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-8 h-8 text-emerald-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Invoice to Zoho Books</h1>
                <p className="text-emerald-700 text-sm mt-1">AI-powered supplier invoice processing</p>
              </div>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors"
            >
              <Settings className="w-5 h-5" />
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8 border border-emerald-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Zoho Books Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 font-medium mb-2">Organization ID</label>
                <input
                  type="text"
                  value={settings.organizationId}
                  onChange={(e) => setSettings({ ...settings, organizationId: e.target.value })}
                  placeholder="Your Zoho Books Organization ID"
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Find this in Zoho Books → Settings → Organization Profile
                </p>
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-2">Access Token</label>
                <input
                  type="password"
                  value={settings.accessToken}
                  onChange={(e) => setSettings({ ...settings, accessToken: e.target.value })}
                  placeholder="Your Zoho OAuth Access Token"
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Generate this in Zoho API Console → Self Client
                </p>
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-2">API Domain</label>
                <select
                  value={settings.apiDomain}
                  onChange={(e) => setSettings({ ...settings, apiDomain: e.target.value })}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                >
                  <option value="https://www.zohoapis.com">.com (US)</option>
                  <option value="https://www.zohoapis.eu">.eu (Europe)</option>
                  <option value="https://www.zohoapis.in">.in (India)</option>
                  <option value="https://www.zohoapis.com.au">.com.au (Australia)</option>
                  <option value="https://www.zohoapis.jp">.jp (Japan)</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={saveSettings}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  Save Settings
                </button>
                <button
                  onClick={() => setShowSettings(false)}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Warning if not configured */}
        {!isConfigured && !showSettings && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <p className="text-amber-800">
                Please configure your Zoho Books settings to enable direct upload functionality.
              </p>
            </div>
          </div>
        )}

        {/* Upload Area */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all ${
            dragActive 
              ? 'border-emerald-500 bg-emerald-50 scale-[1.02]' 
              : 'border-emerald-300 bg-white hover:border-emerald-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf"
            onChange={handleFileInput}
            className="hidden"
          />
          
          <Upload className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Upload Supplier Invoice PDFs</h2>
          <p className="text-gray-600 mb-6">Drag and drop or click to select files</p>
          
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg font-medium transition-all transform hover:scale-105 active:scale-95 shadow-md"
          >
            {processing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </span>
            ) : (
              'Select Files'
            )}
          </button>
        </div>

        {/* Upload All Button */}
        {canUpload && isConfigured && (
          <div className="mt-8 flex justify-end">
            <button
              onClick={uploadAllInvoices}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105 shadow-md"
            >
              <Send className="w-5 h-5" />
              Upload All to Zoho Books
            </button>
          </div>
        )}

        {/* Invoices List */}
        <div className="mt-8 space-y-6">
          {invoices.map((invoice) => (
            <div key={invoice.id} className="bg-white rounded-xl shadow-md p-6 border border-emerald-100">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3 flex-1">
                  {invoice.status === 'uploaded' ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
                  ) : invoice.status === 'error' ? (
                    <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
                  ) : (
                    <FileText className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <h3 className="text-gray-900 font-semibold text-lg">{invoice.fileName}</h3>
                    {invoice.status === 'error' && (
                      <p className="text-red-500 text-sm mt-1">{invoice.error}</p>
                    )}
                    {invoice.uploadError && (
                      <p className="text-red-500 text-sm mt-1">Upload failed: {invoice.uploadError}</p>
                    )}
                    {invoice.uploaded && (
                      <p className="text-green-600 text-sm mt-1">✓ Successfully uploaded to Zoho Books</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {invoice.status === 'extracted' && !invoice.uploaded && isConfigured && (
                    <button
                      onClick={() => uploadSingleInvoice(invoice.id)}
                      disabled={invoice.uploading}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      {invoice.uploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Upload
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => deleteInvoice(invoice.id)}
                    className="text-red-500 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {invoice.status === 'extracted' && (
                <div className="space-y-6 mt-6">
                  {/* Basic Info Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">Vendor Name</label>
                      <input
                        type="text"
                        value={invoice.data.vendorName || ''}
                        onChange={(e) => updateInvoiceField(invoice.id, 'vendorName', e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">Invoice Number</label>
                      <input
                        type="text"
                        value={invoice.data.invoiceNumber || ''}
                        onChange={(e) => updateInvoiceField(invoice.id, 'invoiceNumber', e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">Reference/PO Number</label>
                      <input
                        type="text"
                        value={invoice.data.referenceNumber || ''}
                        onChange={(e) => updateInvoiceField(invoice.id, 'referenceNumber', e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">Invoice Date</label>
                      <input
                        type="date"
                        value={invoice.data.invoiceDate || ''}
                        onChange={(e) => updateInvoiceField(invoice.id, 'invoiceDate', e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">Due Date</label>
                      <input
                        type="date"
                        value={invoice.data.dueDate || ''}
                        onChange={(e) => updateInvoiceField(invoice.id, 'dueDate', e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">Currency</label>
                      <input
                        type="text"
                        value={invoice.data.currency || 'USD'}
                        onChange={(e) => updateInvoiceField(invoice.id, 'currency', e.target.value)}
                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>
                  </div>

                  {/* Line Items */}
                  <div>
                    <h4 className="text-gray-900 font-semibold mb-3 flex items-center gap-2">
                      <Edit2 className="w-4 h-4" />
                      Line Items
                    </h4>
                    <div className="space-y-3">
                      {invoice.data.lineItems?.map((item, index) => (
                        <div key={index} className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-emerald-50 p-4 rounded-lg border border-emerald-100">
                          <div className="md:col-span-2">
                            <label className="block text-gray-700 text-xs font-medium mb-1">Description</label>
                            <input
                              type="text"
                              value={item.description || ''}
                              onChange={(e) => updateLineItem(invoice.id, index, 'description', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-gray-700 text-xs font-medium mb-1">Quantity</label>
                            <input
                              type="number"
                              value={item.quantity || 0}
                              onChange={(e) => updateLineItem(invoice.id, index, 'quantity', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-gray-700 text-xs font-medium mb-1">Rate</label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.rate || 0}
                              onChange={(e) => updateLineItem(invoice.id, index, 'rate', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-gray-700 text-xs font-medium mb-1">Amount</label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.amount || 0}
                              onChange={(e) => updateLineItem(invoice.id, index, 'amount', e.target.value)}
                              className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-gray-900 text-sm focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  {invoice.data.notes && (
                    <div>
                      <label className="block text-gray-700 text-sm font-medium mb-2">Notes</label>
                      <textarea
                        value={invoice.data.notes}
                        onChange={(e) => updateInvoiceField(invoice.id, 'notes', e.target.value)}
                        rows={2}
                        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>
                  )}

                  {/* Totals */}
                  <div className="flex justify-end">
                    <div className="bg-emerald-50 rounded-lg p-4 min-w-[300px] border border-emerald-200">
                      <div className="flex justify-between text-gray-700 mb-2">
                        <span>Subtotal:</span>
                        <span className="font-medium">{invoice.data.currency} {invoice.data.subtotal?.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-gray-700 mb-2">
                        <span>Tax:</span>
                        <span className="font-medium">{invoice.data.currency} {invoice.data.tax?.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-gray-900 font-semibold text-lg pt-2 border-t border-emerald-300">
                        <span>Total:</span>
                        <span>{invoice.data.currency} {invoice.data.total?.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {invoices.length === 0 && !processing && (
          <div className="text-center py-16">
            <FileText className="w-16 h-16 mx-auto text-emerald-300 mb-4" />
            <p className="text-gray-600">No invoices uploaded yet. Drop some PDFs above to get started!</p>
          </div>
        )}
      </main>
    </div>
  );
}
