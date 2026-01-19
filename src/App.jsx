import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Area, AreaChart } from 'recharts';
import { Upload, Plane, TrendingUp, TrendingDown, Clock, DollarSign, Wrench, Fuel, Users, AlertTriangle, ChevronDown, ChevronUp, X, FileSpreadsheet, Calendar, Filter, Database, Trash2, Loader } from 'lucide-react';
import * as XLSX from 'xlsx';

// Color palette - Aviation inspired with dark theme
const colors = {
  primary: '#00D4AA',
  secondary: '#FF6B35',
  accent: '#4ECDC4',
  warning: '#FFE66D',
  danger: '#FF6B6B',
  purple: '#A78BFA',
  blue: '#60A5FA',
  emerald: '#34D399',
  amber: '#FBBF24',
  rose: '#FB7185',
  slate: '#94A3B8',
  categories: ['#00D4AA', '#FF6B35', '#4ECDC4', '#FFE66D', '#A78BFA', '#60A5FA', '#34D399', '#FB7185']
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_MAP = { 'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5, 'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11 };

// Parse month header like "Sep 2024" to { month: 8, year: 2024 }
const parseMonthHeader = (header) => {
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/(\w{3})\s+(\d{4})/);
  if (match) {
    const monthStr = match[1].toLowerCase();
    const year = parseInt(match[2]);
    const month = MONTH_MAP[monthStr];
    if (month !== undefined) {
      return { month, year, key: `${year}-${String(month).padStart(2, '0')}` };
    }
  }
  return null;
};

// Row labels to look for (flexible matching)
const ROW_PATTERNS = {
  flightHours: {
    private: /private\s*flight\s*hours/i,
    owner: /owner\s*flight\s*hours/i,
    charter: /charter\s*flight\s*hours/i,
    total: /total\s*aircraft\s*flight\s*hours/i
  },
  fixedServices: {
    crewSalaries: /total\s*flight\s*crew\s*salaries/i,
    training: /total\s*crew\s*training/i,
    hangar: /^hangar$/i,
    permits: /total\s*permits/i,
    insurance: /^insurance$/i,
    managementFee: /management\s*fee/i,
    crewBenefits: /flight\s*crew\s*benefits/i,
    total: /total\s*fixed\s*services/i
  },
  variableOps: {
    fuel: /total\s*fuel/i,
    coordination: /flight\s*coordination/i,
    landing: /landing\s*fees/i,
    terminalHandling: /terminal.*handling/i,
    navigationFees: /navigation\s*fees/i,
    crewExpenses: /total\s*crew\s*expenses/i,
    grooming: /aircraft\s*grooming/i,
    total: /total\s*variable\s*services\s*-\s*operations/i
  },
  variableMaint: {
    engineProgram: /^engines$/i,
    apuProgram: /^apu$/i,
    scheduledMaint: /total\s*scheduled\s*maintenance/i,
    unscheduledMaint: /total\s*unscheduled\s*maintenance/i,
    total: /total\s*variable\s*services\s*-\s*maintenance/i
  },
  revenue: {
    charter: /charter\s*revenue/i,
    owner: /owner.*revenue/i,
    total: /total\s*aircraft\s*revenue/i
  },
  totals: {
    beforeTaxes: /total\s*services\s*before\s*taxes/i
  }
};

// Parse Excel data from Skyservice format - returns data keyed by month
const parseExcelData = (workbook, filename) => {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // Parse month headers from row 0
  const headers = data[0] || [];
  const monthColumns = [];
  
  for (let i = 1; i < headers.length; i++) {
    const parsed = parseMonthHeader(headers[i]);
    if (parsed) {
      monthColumns.push({ index: i, ...parsed });
    }
  }
  
  if (monthColumns.length === 0) {
    console.error('Could not parse month headers:', headers);
    return null;
  }
  
  // Initialize result structure
  const result = [];
  
  // Initialize data for each month
  const monthData = {};
  monthColumns.forEach(mc => {
    monthData[mc.key] = {
      key: mc.key,
      month: mc.month,
      year: mc.year,
      label: `${MONTHS[mc.month]}'${String(mc.year).slice(2)}`,
      flightHours: {},
      fixedServices: {},
      variableOps: {},
      variableMaint: {},
      revenue: {},
      totals: {},
      sourceFile: filename
    };
  });
  
  // Parse each row
  data.forEach((row, rowIdx) => {
    const label = row[0]?.toString().trim();
    if (!label) return;
    
    // Check against all patterns
    for (const [category, patterns] of Object.entries(ROW_PATTERNS)) {
      for (const [field, pattern] of Object.entries(patterns)) {
        if (pattern.test(label)) {
          // Found a match - extract values for each month
          monthColumns.forEach(mc => {
            const value = parseFloat(row[mc.index]) || 0;
            monthData[mc.key][category][field] = value;
          });
        }
      }
    }
  });
  
  return Object.values(monthData);
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '$0';
  const absValue = Math.abs(value);
  if (absValue >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (absValue >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

const formatFullCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
};

// Custom tooltip for charts
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
      }}>
        <p style={{ color: '#fff', fontWeight: 600, marginBottom: '8px' }}>{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color, fontSize: '13px', margin: '4px 0' }}>
            {entry.name}: {typeof entry.value === 'number' && entry.name !== 'Hours' 
              ? formatFullCurrency(entry.value) 
              : entry.value?.toFixed(1)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// KPI Card Component
const KPICard = ({ title, value, subValue, icon: Icon, trend, trendValue, color = colors.primary }) => (
  <div className="kpi-card">
    <div className="kpi-header">
      <div className="kpi-icon" style={{ background: `${color}20`, color }}>
        <Icon size={20} />
      </div>
      {trend && (
        <div className={`kpi-trend ${trend === 'up' ? 'trend-up' : 'trend-down'}`}>
          {trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          <span>{trendValue}</span>
        </div>
      )}
    </div>
    <div className="kpi-value">{value}</div>
    <div className="kpi-title">{title}</div>
    {subValue && <div className="kpi-subvalue">{subValue}</div>}
  </div>
);

// Breakdown Card Component
const BreakdownCard = ({ title, total, items, color }) => {
  const [expanded, setExpanded] = useState(false);
  const displayItems = expanded ? items : items.slice(0, 5);
  
  return (
    <div className="breakdown-card">
      <h3>{title}</h3>
      <div className="breakdown-total">{formatFullCurrency(total)}</div>
      <div className="breakdown-items">
        {displayItems.map((item, idx) => (
          <div key={idx} className="breakdown-item">
            <div className="breakdown-item-header">
              <span className="breakdown-item-name">{item.name}</span>
              <span className="breakdown-item-value">{formatFullCurrency(item.value)}</span>
            </div>
            <div className="breakdown-bar-bg">
              <div 
                className="breakdown-bar" 
                style={{ 
                  width: `${Math.min((item.value / total) * 100, 100)}%`,
                  background: colors.categories[idx % colors.categories.length]
                }} 
              />
            </div>
            <div className="breakdown-percent">{((item.value / total) * 100).toFixed(1)}%</div>
          </div>
        ))}
      </div>
      {items.length > 5 && (
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? <><ChevronUp size={16} /> Show Less</> : <><ChevronDown size={16} /> Show {items.length - 5} More</>}
        </button>
      )}
    </div>
  );
};

// Main App Component
export default function App() {
  const [allMonthsData, setAllMonthsData] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [dateFilter, setDateFilter] = useState('trailing12');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dbStatus, setDbStatus] = useState('loading');

  // Load data from database on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/api/data');
        const result = await response.json();
        
        if (result.success && result.data && result.data.length > 0) {
          // Transform database rows to our format
          const transformed = result.data.map(row => ({
            key: row.month_key,
            month: row.month_num,
            year: row.year_num,
            label: row.label,
            flightHours: row.flight_hours || {},
            fixedServices: row.fixed_services || {},
            variableOps: row.variable_ops || {},
            variableMaint: row.variable_maint || {},
            revenue: row.revenue || {},
            totals: row.totals || {},
            sourceFile: row.source_file
          }));
          setAllMonthsData(transformed);
          setDbStatus('connected');
        } else {
          setDbStatus('empty');
        }
      } catch (err) {
        console.error('Error loading data:', err);
        setDbStatus('error');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadData();
  }, []);

  // Save data to database
  const saveToDatabase = async (months) => {
    setIsSaving(true);
    try {
      const response = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months })
      });
      const result = await response.json();
      if (result.success) {
        setDbStatus('connected');
      }
    } catch (err) {
      console.error('Error saving data:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Clear all data
  const clearAllData = async () => {
    if (!confirm('Are you sure you want to delete all data? This cannot be undone.')) {
      return;
    }
    
    try {
      await fetch('/api/data', { method: 'DELETE' });
      setAllMonthsData([]);
      setDbStatus('empty');
    } catch (err) {
      console.error('Error clearing data:', err);
    }
  };

  // Handle file upload
  const handleFiles = useCallback(async (files) => {
    const newMonths = [];
    
    for (const file of Array.from(files)) {
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            const parsed = parseExcelData(workbook, file.name);
            resolve(parsed);
          } catch (err) {
            console.error('Error parsing file:', err);
            resolve(null);
          }
        };
        reader.readAsArrayBuffer(file);
      });
      
      if (data) {
        newMonths.push(...data);
      }
    }
    
    if (newMonths.length > 0) {
      // Merge with existing data (newer data wins for same month)
      const merged = { ...Object.fromEntries(allMonthsData.map(m => [m.key, m])) };
      newMonths.forEach(m => {
        merged[m.key] = m;
      });
      
      const sortedData = Object.values(merged).sort((a, b) => a.key.localeCompare(b.key));
      setAllMonthsData(sortedData);
      
      // Save to database
      await saveToDatabase(sortedData);
    }
  }, [allMonthsData]);

  // Apply date filter
  const filteredData = useMemo(() => {
    if (allMonthsData.length === 0) return [];
    
    switch (dateFilter) {
      case 'trailing12': {
        return allMonthsData.slice(-12);
      }
      case 'fiscal2024': {
        return allMonthsData.filter(d => {
          if (d.year === 2024 && d.month >= 8) return true;
          if (d.year === 2025 && d.month <= 7) return true;
          return false;
        });
      }
      case 'fiscal2025': {
        return allMonthsData.filter(d => {
          if (d.year === 2025 && d.month >= 8) return true;
          if (d.year === 2026 && d.month <= 7) return true;
          return false;
        });
      }
      case 'calendar2024': {
        return allMonthsData.filter(d => d.year === 2024);
      }
      case 'calendar2025': {
        return allMonthsData.filter(d => d.year === 2025);
      }
      case 'all':
      default:
        return allMonthsData;
    }
  }, [allMonthsData, dateFilter]);

  // Calculate totals for filtered period
  const periodTotals = useMemo(() => {
    if (filteredData.length === 0) return null;
    
    const sum = (category, field) => {
      return filteredData.reduce((total, d) => total + (d[category]?.[field] || 0), 0);
    };
    
    const totalExpenses = sum('fixedServices', 'total') + 
                          sum('variableOps', 'total') + 
                          sum('variableMaint', 'total');
    const totalHours = sum('flightHours', 'total');
    const totalRevenue = sum('revenue', 'total');
    const totalFuel = sum('variableOps', 'fuel');
    const totalFixed = sum('fixedServices', 'total');
    const totalMaint = sum('variableMaint', 'total');
    
    return {
      expenses: totalExpenses,
      hours: totalHours,
      revenue: totalRevenue,
      fuel: totalFuel,
      fixed: totalFixed,
      maintenance: totalMaint,
      variableOps: sum('variableOps', 'total'),
      costPerHour: totalHours > 0 ? totalExpenses / totalHours : 0,
      fuelPerHour: totalHours > 0 ? totalFuel / totalHours : 0
    };
  }, [filteredData]);

  // Get breakdown items for each category
  const getBreakdownItems = useCallback((category) => {
    if (filteredData.length === 0) return [];
    
    const fieldLabels = {
      fixedServices: {
        crewSalaries: 'Crew Salaries',
        crewBenefits: 'Crew Benefits',
        training: 'Training',
        hangar: 'Hangar',
        permits: 'Permits & Subscriptions',
        insurance: 'Insurance',
        managementFee: 'Management Fee'
      },
      variableOps: {
        fuel: 'Fuel',
        coordination: 'Flight Coordination',
        landing: 'Landing Fees',
        terminalHandling: 'Terminal & Handling',
        navigationFees: 'Navigation Fees',
        crewExpenses: 'Crew Expenses',
        grooming: 'Aircraft Grooming'
      },
      variableMaint: {
        engineProgram: 'Engine Program',
        apuProgram: 'APU Program',
        scheduledMaint: 'Scheduled Maintenance',
        unscheduledMaint: 'Unscheduled Maintenance'
      }
    };
    
    const labels = fieldLabels[category] || {};
    const items = [];
    
    Object.entries(labels).forEach(([field, name]) => {
      const value = filteredData.reduce((sum, d) => sum + (d[category]?.[field] || 0), 0);
      if (value > 0) {
        items.push({ name, value });
      }
    });
    
    return items.sort((a, b) => b.value - a.value);
  }, [filteredData]);

  // Chart data
  const monthlyChartData = useMemo(() => {
    return filteredData.map(d => ({
      month: d.label,
      expenses: (d.fixedServices?.total || 0) + (d.variableOps?.total || 0) + (d.variableMaint?.total || 0),
      hours: d.flightHours?.total || 0,
      fixed: d.fixedServices?.total || 0,
      variable: d.variableOps?.total || 0,
      maintenance: d.variableMaint?.total || 0
    }));
  }, [filteredData]);

  const expenseDistribution = useMemo(() => {
    if (!periodTotals) return [];
    return [
      { name: 'Fixed Services', value: periodTotals.fixed, color: colors.primary },
      { name: 'Variable Operations', value: periodTotals.variableOps, color: colors.secondary },
      { name: 'Maintenance', value: periodTotals.maintenance, color: colors.accent }
    ].filter(d => d.value > 0);
  }, [periodTotals]);

  const costPerHourTrend = useMemo(() => {
    return filteredData.map(d => {
      const hours = d.flightHours?.total || 0;
      const expenses = (d.fixedServices?.total || 0) + (d.variableOps?.total || 0) + (d.variableMaint?.total || 0);
      return {
        month: d.label,
        costPerHour: hours > 0 ? expenses / hours : 0
      };
    });
  }, [filteredData]);

  // Drag and drop handlers
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => { setIsDragging(false); };
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); };

  // Get date range label
  const dateRangeLabel = useMemo(() => {
    if (filteredData.length === 0) return '';
    const first = filteredData[0];
    const last = filteredData[filteredData.length - 1];
    return `${MONTHS[first.month]} ${first.year} - ${MONTHS[last.month]} ${last.year} (${filteredData.length} mo)`;
  }, [filteredData]);

  // Loading state
  if (isLoading) {
    return (
      <div className="dashboard loading-screen">
        <Loader size={48} className="spinner" />
        <p>Loading data...</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <Plane size={24} color="#0F172A" />
          </div>
          <div>
            <h1>Aircraft Financial Dashboard</h1>
            <p className="header-subtitle">Skyservice Statement Analysis • C-GJXM</p>
          </div>
        </div>
        
        <div className="header-right">
          <div className="db-status">
            <Database size={14} />
            <span>{dbStatus === 'connected' ? `${allMonthsData.length} months saved` : dbStatus === 'empty' ? 'No data' : dbStatus}</span>
            {isSaving && <Loader size={14} className="spinner" />}
          </div>
          
          <label className="statement-chip add-more">
            <Upload size={14} />
            <span>Upload Files</span>
            <input type="file" accept=".xlsx,.xls" multiple onChange={(e) => handleFiles(e.target.files)} hidden />
          </label>
          
          {allMonthsData.length > 0 && (
            <button className="statement-chip danger" onClick={clearAllData}>
              <Trash2 size={14} />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </header>

      {/* Upload Zone (when no data) */}
      {allMonthsData.length === 0 && (
        <div 
          className={`upload-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="upload-icon">
            <Upload size={48} />
          </div>
          <h2>Upload Skyservice Statements</h2>
          <p>Drag and drop Excel files here, or click to browse</p>
          <p className="upload-note">Files will be saved to the database automatically</p>
          <label className="upload-btn">
            <span>Select Files</span>
            <input type="file" accept=".xlsx,.xls" multiple onChange={(e) => handleFiles(e.target.files)} hidden />
          </label>
        </div>
      )}

      {/* Dashboard Content */}
      {allMonthsData.length > 0 && periodTotals && (
        <>
          {/* Controls Row */}
          <div className="controls-row">
            <div className="tabs">
              {['overview', 'expenses', 'operations', 'maintenance'].map(tab => (
                <button
                  key={tab}
                  className={`tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            
            <div className="filter-section">
              <div className="date-range-selector">
                <Filter size={14} />
                <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                  <option value="trailing12">Trailing 12 Months</option>
                  <option value="all">All Data</option>
                  <option value="fiscal2025">Fiscal 2025-26 (Sep-Aug)</option>
                  <option value="fiscal2024">Fiscal 2024-25 (Sep-Aug)</option>
                  <option value="calendar2025">Calendar 2025</option>
                  <option value="calendar2024">Calendar 2024</option>
                </select>
              </div>
              <div className="period-label">
                <Calendar size={14} />
                <span>{dateRangeLabel}</span>
              </div>
            </div>
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* KPI Grid */}
              <div className="kpi-grid">
                <KPICard 
                  title="Total Expenses" 
                  value={formatCurrency(periodTotals.expenses)}
                  icon={DollarSign}
                  color={colors.secondary}
                />
                <KPICard 
                  title="Flight Hours" 
                  value={periodTotals.hours.toFixed(1)}
                  subValue="hours"
                  icon={Clock}
                  color={colors.blue}
                />
                <KPICard 
                  title="Cost Per Hour" 
                  value={formatCurrency(periodTotals.costPerHour)}
                  subValue="all-in cost"
                  icon={TrendingUp}
                  color={colors.purple}
                />
                <KPICard 
                  title="Fuel Per Hour" 
                  value={formatCurrency(periodTotals.fuelPerHour)}
                  subValue={`${formatCurrency(periodTotals.fuel)} total`}
                  icon={Fuel}
                  color={colors.amber}
                />
                <KPICard 
                  title="Fixed Costs" 
                  value={formatCurrency(periodTotals.fixed)}
                  subValue={`${((periodTotals.fixed / periodTotals.expenses) * 100).toFixed(0)}% of total`}
                  icon={Users}
                  color={colors.emerald}
                />
                <KPICard 
                  title="Maintenance" 
                  value={formatCurrency(periodTotals.maintenance)}
                  subValue={`${((periodTotals.maintenance / periodTotals.expenses) * 100).toFixed(0)}% of total`}
                  icon={Wrench}
                  color={colors.rose}
                />
              </div>

              {/* Charts Row */}
              <div className="charts-grid">
                <div className="chart-card full-width">
                  <h3><TrendingUp size={18} /> Monthly Expenses & Flight Hours</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={monthlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="month" stroke={colors.slate} fontSize={12} />
                      <YAxis yAxisId="left" stroke={colors.slate} fontSize={12} tickFormatter={formatCurrency} />
                      <YAxis yAxisId="right" orientation="right" stroke={colors.slate} fontSize={12} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="expenses" name="Expenses" fill={colors.primary} radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="hours" name="Hours" stroke={colors.secondary} strokeWidth={2} dot={{ fill: colors.secondary }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3><DollarSign size={18} /> Expense Distribution</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={expenseDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {expenseDistribution.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3><TrendingUp size={18} /> Cost Per Hour Trend</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={costPerHourTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="month" stroke={colors.slate} fontSize={12} />
                      <YAxis stroke={colors.slate} fontSize={12} tickFormatter={formatCurrency} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="costPerHour" name="Cost/Hour" stroke={colors.purple} fill={`${colors.purple}40`} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Breakdown Cards */}
              <div className="breakdown-grid">
                <BreakdownCard 
                  title="Fixed Services" 
                  total={periodTotals.fixed} 
                  items={getBreakdownItems('fixedServices')}
                  color={colors.primary}
                />
                <BreakdownCard 
                  title="Variable Operations" 
                  total={periodTotals.variableOps} 
                  items={getBreakdownItems('variableOps')}
                  color={colors.secondary}
                />
                <BreakdownCard 
                  title="Maintenance" 
                  total={periodTotals.maintenance} 
                  items={getBreakdownItems('variableMaint')}
                  color={colors.accent}
                />
              </div>
            </>
          )}

          {/* Expenses Tab */}
          {activeTab === 'expenses' && (
            <>
              <div className="charts-grid">
                <div className="chart-card full-width">
                  <h3><DollarSign size={18} /> Monthly Expense Breakdown</h3>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={monthlyChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="month" stroke={colors.slate} fontSize={12} />
                      <YAxis stroke={colors.slate} fontSize={12} tickFormatter={formatCurrency} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="fixed" name="Fixed Services" stackId="a" fill={colors.primary} />
                      <Bar dataKey="variable" name="Variable Ops" stackId="a" fill={colors.secondary} />
                      <Bar dataKey="maintenance" name="Maintenance" stackId="a" fill={colors.accent} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="breakdown-grid">
                <BreakdownCard 
                  title="Fixed Services" 
                  total={periodTotals.fixed} 
                  items={getBreakdownItems('fixedServices')}
                  color={colors.primary}
                />
                <BreakdownCard 
                  title="Variable Operations" 
                  total={periodTotals.variableOps} 
                  items={getBreakdownItems('variableOps')}
                  color={colors.secondary}
                />
                <BreakdownCard 
                  title="Maintenance" 
                  total={periodTotals.maintenance} 
                  items={getBreakdownItems('variableMaint')}
                  color={colors.accent}
                />
              </div>
            </>
          )}

          {/* Operations Tab */}
          {activeTab === 'operations' && (
            <>
              <div className="kpi-grid">
                <KPICard 
                  title="Total Flight Hours" 
                  value={periodTotals.hours.toFixed(1)}
                  icon={Clock}
                  color={colors.blue}
                />
                <KPICard 
                  title="Fuel Costs" 
                  value={formatCurrency(periodTotals.fuel)}
                  subValue={`${formatCurrency(periodTotals.fuelPerHour)}/hour`}
                  icon={Fuel}
                  color={colors.amber}
                />
                <KPICard 
                  title="Variable Ops Total" 
                  value={formatCurrency(periodTotals.variableOps)}
                  icon={DollarSign}
                  color={colors.secondary}
                />
              </div>

              <div className="charts-grid">
                <div className="chart-card full-width">
                  <h3><Fuel size={18} /> Fuel Costs vs Flight Hours</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={filteredData.map(d => ({
                      month: d.label,
                      fuel: d.variableOps?.fuel || 0,
                      hours: d.flightHours?.total || 0
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="month" stroke={colors.slate} fontSize={12} />
                      <YAxis yAxisId="left" stroke={colors.slate} fontSize={12} tickFormatter={formatCurrency} />
                      <YAxis yAxisId="right" orientation="right" stroke={colors.slate} fontSize={12} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar yAxisId="left" dataKey="fuel" name="Fuel Cost" fill={colors.amber} radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="hours" name="Hours" stroke={colors.blue} strokeWidth={2} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="breakdown-grid">
                <BreakdownCard 
                  title="Variable Operations" 
                  total={periodTotals.variableOps} 
                  items={getBreakdownItems('variableOps')}
                  color={colors.secondary}
                />
              </div>
            </>
          )}

          {/* Maintenance Tab */}
          {activeTab === 'maintenance' && (
            <>
              <div className="kpi-grid">
                <KPICard 
                  title="Total Maintenance" 
                  value={formatCurrency(periodTotals.maintenance)}
                  icon={Wrench}
                  color={colors.rose}
                />
                <KPICard 
                  title="Engine Program" 
                  value={formatCurrency(filteredData.reduce((sum, d) => sum + (d.variableMaint?.engineProgram || 0), 0))}
                  icon={AlertTriangle}
                  color={colors.amber}
                />
                <KPICard 
                  title="Scheduled Maintenance" 
                  value={formatCurrency(filteredData.reduce((sum, d) => sum + (d.variableMaint?.scheduledMaint || 0), 0))}
                  icon={Wrench}
                  color={colors.emerald}
                />
              </div>

              <div className="charts-grid">
                <div className="chart-card full-width">
                  <h3><Wrench size={18} /> Scheduled vs Unscheduled Maintenance</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={filteredData.map(d => ({
                      month: d.label,
                      scheduled: d.variableMaint?.scheduledMaint || 0,
                      unscheduled: d.variableMaint?.unscheduledMaint || 0
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="month" stroke={colors.slate} fontSize={12} />
                      <YAxis stroke={colors.slate} fontSize={12} tickFormatter={formatCurrency} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Line type="monotone" dataKey="scheduled" name="Scheduled" stroke={colors.emerald} strokeWidth={2} />
                      <Line type="monotone" dataKey="unscheduled" name="Unscheduled" stroke={colors.warning} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="breakdown-grid">
                <BreakdownCard 
                  title="Maintenance Breakdown" 
                  total={periodTotals.maintenance} 
                  items={getBreakdownItems('variableMaint')}
                  color={colors.accent}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
