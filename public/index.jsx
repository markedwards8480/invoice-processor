import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// Activity Log Component
function ActivityLog({ activities, onClear }) {
    return (
        <div className="activity-log">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3>Activity Log</h3>
                <button onClick={onClear} style={{ padding: '5px 10px', fontSize: '12px' }}>Clear</button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {activities.map((activity, index) => (
                    <div key={index} style={{
                        padding: '8px',
                        marginBottom: '5px',
                        backgroundColor: activity.type === 'error' ? '#fee' : activity.type === 'success' ? '#efe' : '#f5f5f5',
                        borderLeft: `3px solid ${activity.type === 'error' ? '#f44' : activity.type === 'success' ? '#4f4' : '#999'}`,
                        fontSize: '12px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{activity.type === 'error' ? '✗' : activity.type === 'success' ? '✓' : 'ℹ'} {activity.message}</span>
                            <span style={{ color: '#999', fontSize: '11px' }}>{activity.time}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Main App Component
function InvoiceProcessor() {
    const [config, setConfig] = useState({
        apiDomain: '',
        organizationId: '',
        accessToken: '',
        refreshToken: '',
        clientId: '',
        clientSecret: ''
    });
    const [showSettings, setShowSettings] = useState(false);
    const [activities, setActivities] = useState([]);
    const [glAccounts, setGlAccounts] = useState([]);
    const [accountMappings, setAccountMappings] = useState({});

    const addActivity = (message, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setActivities(prev => [{ message, type, time }, ...prev].slice(0, 50));
    };

    const clearActivities = () => {
        setActivities([]);
    };

    // Load configuration on mount
    useEffect(() => {
        loadConfig();
        loadMappings();
    }, []);

    const loadConfig = async () => {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            setConfig(data);
            
            // Only show error if config is actually empty
            if (!data.apiDomain && !data.organizationId && !data.accessToken) {
                addActivity('Configuration not set - please configure in Settings', 'error');
            } else {
                addActivity('Configuration loaded successfully', 'success');
            }
        } catch (error) {
            console.error('Error loading config:', error);
            addActivity('Failed to load configuration - please check Settings', 'error');
        }
    };

    const loadMappings = async () => {
        try {
            const response = await fetch('/api/mappings');
            if (response.ok) {
                const data = await response.json();
                setAccountMappings(data);
                addActivity(`Loaded ${Object.keys(data).length} account mappings`, 'success');
            }
        } catch (error) {
            console.error('Error loading mappings:', error);
        }
    };

    const saveConfig = async () => {
        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                addActivity('Configuration saved successfully', 'success');
                setShowSettings(false);
                loadGLAccounts();
            } else {
                addActivity('Failed to save configuration', 'error');
            }
        } catch (error) {
            addActivity('Error saving configuration: ' + error.message, 'error');
        }
    };

    const loadGLAccounts = async () => {
        try {
            addActivity('Loading GL accounts from Zoho...', 'info');
            const response = await fetch('/api/get-gl-accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            const data = await response.json();
            
            if (data.chartofaccounts) {
                setGlAccounts(data.chartofaccounts);
                addActivity(`Loaded ${data.chartofaccounts.length} GL accounts`, 'success');
            } else if (data.message) {
                addActivity('Zoho API: ' + data.message, 'error');
            }
        } catch (error) {
            addActivity('Error loading GL accounts: ' + error.message, 'error');
        }
    };

    const processInvoices = async (files) => {
        for (const file of files) {
            try {
                addActivity(`Processing ${file.name}...`, 'info');
                
                const formData = new FormData();
                formData.append('file', file);
                formData.append('glAccounts', JSON.stringify(glAccounts));
                formData.append('mappings', JSON.stringify(accountMappings));

                const response = await fetch('/api/process-invoice', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                
                if (result.content) {
                    addActivity(`✓ Processed ${file.name}`, 'success');
                    // Here you would display the extracted data to the user
                    console.log('Extracted data:', result);
                } else if (result.error) {
                    addActivity(`Error processing ${file.name}: ${result.error.message}`, 'error');
                }
            } catch (error) {
                addActivity(`Error processing ${file.name}: ${error.message}`, 'error');
            }
        }
    };

    const handleFileUpload = (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            processInvoices(files);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
        if (files.length > 0) {
            processInvoices(files);
        }
    };

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ margin: '0 0 5px 0' }}>Invoice Processor</h1>
                        <p style={{ margin: 0, color: '#666' }}>Extract and upload invoices to Zoho Books</p>
                    </div>
                    <button 
                        onClick={() => setShowSettings(!showSettings)}
                        style={{ 
                            padding: '10px 20px', 
                            backgroundColor: '#f0f0f0', 
                            border: 'none', 
                            borderRadius: '5px',
                            cursor: 'pointer'
                        }}
                    >
                        ⚙️ Settings
                    </button>
                </div>
            </div>

            {showSettings && (
                <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                    <h2>Zoho Books Configuration</h2>
                    <div style={{ display: 'grid', gap: '15px' }}>
                        <div>
                            <label>API Domain</label>
                            <input
                                type="text"
                                value={config.apiDomain}
                                onChange={(e) => setConfig({...config, apiDomain: e.target.value})}
                                placeholder="https://www.zohoapis.com"
                                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                            />
                            <small style={{ color: '#666' }}>US/Global: https://www.zohoapis.com | Europe: https://www.zohoapis.eu</small>
                        </div>
                        <div>
                            <label>Organization ID</label>
                            <input
                                type="text"
                                value={config.organizationId}
                                onChange={(e) => setConfig({...config, organizationId: e.target.value})}
                                placeholder="Enter your Zoho Organization ID"
                                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                            />
                        </div>
                        <div>
                            <label>Access Token</label>
                            <input
                                type="text"
                                value={config.accessToken}
                                onChange={(e) => setConfig({...config, accessToken: e.target.value})}
                                placeholder="Enter your Zoho Access Token"
                                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                            />
                        </div>
                        <div>
                            <label>Refresh Token</label>
                            <input
                                type="text"
                                value={config.refreshToken}
                                onChange={(e) => setConfig({...config, refreshToken: e.target.value})}
                                placeholder="1000.xxx..."
                                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                            />
                        </div>
                        <div>
                            <label>Client ID</label>
                            <input
                                type="text"
                                value={config.clientId}
                                onChange={(e) => setConfig({...config, clientId: e.target.value})}
                                placeholder="1000.XXXXXXXXXXXXX"
                                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                            />
                        </div>
                        <div>
                            <label>Client Secret</label>
                            <input
                                type="password"
                                value={config.clientSecret}
                                onChange={(e) => setConfig({...config, clientSecret: e.target.value})}
                                placeholder="Enter Client Secret"
                                style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                                onClick={saveConfig}
                                style={{ 
                                    padding: '10px 30px', 
                                    backgroundColor: '#4CAF50', 
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer'
                                }}
                            >
                                Save Settings
                            </button>
                            <button 
                                onClick={loadGLAccounts}
                                style={{ 
                                    padding: '10px 30px', 
                                    backgroundColor: '#2196F3', 
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer'
                                }}
                            >
                                Load GL Accounts
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                <div>
                    <div style={{ backgroundColor: 'white', padding: '10px 20px', borderBottom: '2px solid #4CAF50', marginBottom: '0' }}>
                        <h3 style={{ margin: '5px 0' }}>📤 Upload Invoices</h3>
                    </div>
                    <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '0 0 8px 8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        <div 
                            onDrop={handleDrop}
                            onDragOver={(e) => e.preventDefault()}
                            style={{
                                border: '2px dashed #ccc',
                                borderRadius: '8px',
                                padding: '60px 20px',
                                textAlign: 'center',
                                cursor: 'pointer'
                            }}
                            onClick={() => document.getElementById('fileInput').click()}
                        >
                            <div style={{ fontSize: '48px', marginBottom: '10px' }}>📄</div>
                            <p>Drop PDF invoices here or click to browse</p>
                            <p style={{ fontSize: '12px', color: '#999' }}>Supports multiple file upload</p>
                            <input
                                id="fileInput"
                                type="file"
                                multiple
                                accept=".pdf"
                                onChange={handleFileUpload}
                                style={{ display: 'none' }}
                            />
                        </div>
                    </div>
                </div>

                <div>
                    <div style={{ backgroundColor: 'white', padding: '10px 20px', borderBottom: '2px solid #2196F3', marginBottom: '0' }}>
                        <h3 style={{ margin: '5px 0' }}>📊 Transaction History (0)</h3>
                    </div>
                    <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '0 0 8px 8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '200px' }}>
                        <ActivityLog activities={activities} onClear={clearActivities} />
                    </div>
                </div>
            </div>
        </div>
    );
}

// Mount the app
const root = createRoot(document.getElementById('root'));
root.render(<InvoiceProcessor />);
