// setup-database.js
// Script to set up the database schema

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Kinsta internal connections don't use SSL
const isKinstaInternal = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('.svc.cluster.local');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isKinstaInternal ? false : { rejectUnauthorized: false }
});

async function setupDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting database setup...\n');
    
    // First, enable extensions
    console.log('1️⃣ Enabling PostgreSQL extensions...');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log('   ✅ uuid-ossp enabled');
    
    await client.query('CREATE EXTENSION IF NOT EXISTS "postgis"');
    console.log('   ✅ postgis enabled');
    
    await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
    console.log('   ✅ pg_trgm enabled');
    
    // Read and execute schema
    console.log('\n2️⃣ Creating database schema...');
    const schemaPath = path.join(__dirname, 'postgresql-product-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = schema.split(';').filter(stmt => stmt.trim());
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (statement) {
        try {
          await client.query(statement);
          process.stdout.write('.');
        } catch (err) {
          if (err.message.includes('already exists')) {
            process.stdout.write('→');
          } else {
            console.error(`\n❌ Error in statement ${i + 1}:`, err.message);
            console.error('Statement:', statement.substring(0, 50) + '...');
          }
        }
      }
    }
    
    console.log('\n   ✅ Schema created successfully');
    
    // Verify tables were created
    console.log('\n3️⃣ Verifying database setup...');
    const tables = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    
    console.log(`   ✅ Created ${tables.rows.length} tables`);
    
    // Check materialized view
    const views = await client.query(`
      SELECT matviewname 
      FROM pg_matviews 
      WHERE schemaname = 'public'
    `);
    
    if (views.rows.length > 0) {
      console.log(`   ✅ Created ${views.rows.length} materialized view(s)`);
      
      // Refresh the materialized view
      console.log('\n4️⃣ Refreshing materialized view...');
      await client.query('REFRESH MATERIALIZED VIEW product_search_view');
      console.log('   ✅ Materialized view refreshed');
    }
    
    console.log('\n✅ Database setup completed successfully!');
    console.log('\nYou can now run: npm start');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run setup
setupDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
