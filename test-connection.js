// test-connection.js
// Simple script to test database connection

const { Pool } = require('pg');
require('dotenv').config();

console.log('Testing connection to Kinsta PostgreSQL database...\n');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Kinsta
  }
});

async function testConnection() {
  try {
    // Test basic connection
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully!');
    console.log('   Current time from database:', result.rows[0].now);
    
    // Check PostgreSQL version
    const versionResult = await pool.query('SELECT version()');
    console.log('\n📊 Database version:');
    console.log('  ', versionResult.rows[0].version.split(',')[0]);
    
    // Check installed extensions
    const extensions = await pool.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname IN ('uuid-ossp', 'postgis', 'pg_trgm')
      ORDER BY extname
    `);
    
    console.log('\n🔧 Required extensions:');
    if (extensions.rows.length === 0) {
      console.log('   ⚠️  No required extensions found - they need to be installed');
    } else {
      extensions.rows.forEach(ext => {
        console.log(`   ✅ ${ext.extname} (v${ext.extversion})`);
      });
    }
    
    // Check if any tables exist
    const tables = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY tablename
      LIMIT 10
    `);
    
    console.log('\n📋 Existing tables:');
    if (tables.rows.length === 0) {
      console.log('   ℹ️  No tables found - database schema needs to be created');
    } else {
      tables.rows.forEach(table => {
        console.log(`   - ${table.tablename}`);
      });
      if (tables.rowCount > 10) {
        console.log(`   ... and ${tables.rowCount - 10} more`);
      }
    }
    
    console.log('\n✅ Connection test completed successfully!');
    
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('\nFull error:', error);
  } finally {
    await pool.end();
  }
}

testConnection();
