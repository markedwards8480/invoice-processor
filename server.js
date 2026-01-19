import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database table
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS monthly_data (
        id SERIAL PRIMARY KEY,
        month_key VARCHAR(10) UNIQUE NOT NULL,
        month_num INTEGER NOT NULL,
        year_num INTEGER NOT NULL,
        label VARCHAR(20),
        flight_hours JSONB,
        fixed_services JSONB,
        variable_ops JSONB,
        variable_maint JSONB,
        revenue JSONB,
        totals JSONB,
        source_file VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err.message);
  }
}

// API: Get all monthly data
app.get('/api/data', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM monthly_data ORDER BY month_key ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error fetching data:', err);
    res.json({ success: false, error: err.message, data: [] });
  }
});

// API: Save monthly data (upsert)
app.post('/api/data', async (req, res) => {
  try {
    const { months } = req.body;
    
    if (!months || !Array.isArray(months)) {
      return res.status(400).json({ success: false, error: 'Invalid data format' });
    }

    let savedCount = 0;
    
    for (const month of months) {
      await pool.query(`
        INSERT INTO monthly_data (
          month_key, month_num, year_num, label,
          flight_hours, fixed_services, variable_ops, 
          variable_maint, revenue, totals, source_file
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (month_key) 
        DO UPDATE SET
          flight_hours = EXCLUDED.flight_hours,
          fixed_services = EXCLUDED.fixed_services,
          variable_ops = EXCLUDED.variable_ops,
          variable_maint = EXCLUDED.variable_maint,
          revenue = EXCLUDED.revenue,
          totals = EXCLUDED.totals,
          source_file = EXCLUDED.source_file,
          updated_at = NOW()
      `, [
        month.key,
        month.month,
        month.year,
        month.label,
        JSON.stringify(month.flightHours || {}),
        JSON.stringify(month.fixedServices || {}),
        JSON.stringify(month.variableOps || {}),
        JSON.stringify(month.variableMaint || {}),
        JSON.stringify(month.revenue || {}),
        JSON.stringify(month.totals || {}),
        month.sourceFile || 'unknown'
      ]);
      savedCount++;
    }

    res.json({ success: true, savedCount });
  } catch (err) {
    console.error('Error saving data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Delete all data
app.delete('/api/data', async (req, res) => {
  try {
    await pool.query('DELETE FROM monthly_data');
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
