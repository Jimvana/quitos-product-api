# Kinsta PostgreSQL 17 Setup Guide for Quit-OS Product Database

## 1. Initial Database Configuration

### Connect to Your Kinsta PostgreSQL Database

```bash
# Connection details from Kinsta dashboard
psql postgresql://username:password@host:port/database?sslmode=require

# Or using individual parameters
psql -h your-db-host.kinsta.cloud -p 5432 -U your-username -d your-database
```

### Enable Required Extensions

```sql
-- Run these commands first
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

## 2. Environment Variables Setup

### For Your Node.js API (Create .env file)

```env
# Database
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require

# WordPress Integration
WORDPRESS_URL=https://quit-os.com
WP_JWT_SECRET=your-wordpress-jwt-secret

# API Settings
PORT=3000
NODE_ENV=production

# Security
API_KEY=generate-a-secure-api-key
CORS_ORIGINS=https://quit-os.com,https://vapeos.quit-os.com
```

### For WordPress Plugin

Add to `wp-config.php`:

```php
// Product Database API
define('QUITOS_API_URL', 'https://api.quit-os.com');
define('QUITOS_API_KEY', 'your-secure-api-key');
define('QUITOS_JWT_SECRET', 'your-wordpress-jwt-secret');
```

## 3. Deploy API to Kinsta Application Hosting

### Package.json for Node.js API

```json
{
  "name": "quitos-product-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "migrate": "node migrations/run.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "jsonwebtoken": "^9.0.2",
    "cors": "^2.8.5",
    "bcrypt": "^5.1.1",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### Buildpack Configuration (buildpacks.json)

```json
{
  "buildpacks": [
    {
      "url": "heroku/nodejs"
    }
  ]
}
```

## 4. WordPress User Sync Table

Create this additional table for WordPress integration:

```sql
-- WordPress user mapping
CREATE TABLE wp_user_mapping (
    id SERIAL PRIMARY KEY,
    wp_user_id INTEGER NOT NULL UNIQUE,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('consumer', 'manufacturer', 'retailer')),
    entity_id INTEGER, -- References manufacturers.id or retailers.id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wp_mapping_type ON wp_user_mapping(user_type);
```

## 5. Database Migration Script

Create `migrations/001_initial_setup.js`:

```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('Starting migration...');
    
    // Read and execute schema SQL
    const fs = require('fs');
    const schema = fs.readFileSync('./schema.sql', 'utf8');
    
    await client.query(schema);
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
```

## 6. Performance Optimization

### PostgreSQL Configuration (Request from Kinsta support)

```sql
-- Optimized settings for product database
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET min_wal_size = '1GB';
ALTER SYSTEM SET max_wal_size = '4GB';
```

### Create Indexes for Performance

```sql
-- Additional performance indexes
CREATE INDEX idx_products_manufacturer_status ON products(manufacturer_id, status);
CREATE INDEX idx_inventory_retailer_active ON retailer_inventory(retailer_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_batches_product_available ON product_batches(product_id, quantity_available) WHERE quantity_available > 0;
CREATE INDEX idx_movements_recent ON product_movements(created_at DESC);
```

## 7. Backup Strategy

### Automated Backup Script

```bash
#!/bin/bash
# backup-product-db.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/product-db"
DB_URL="your-connection-string"

# Create backup
pg_dump $DB_URL -Fc -f "$BACKUP_DIR/product_db_$DATE.dump"

# Keep only last 30 days of backups
find $BACKUP_DIR -name "*.dump" -mtime +30 -delete

# Upload to S3 (optional)
aws s3 cp "$BACKUP_DIR/product_db_$DATE.dump" s3://your-backup-bucket/
```

## 8. Monitoring Setup

### Create monitoring views

```sql
-- Database health metrics
CREATE VIEW db_health_metrics AS
SELECT 
    (SELECT count(*) FROM pg_stat_activity) as active_connections,
    (SELECT count(*) FROM products WHERE status = 'active') as active_products,
    (SELECT count(*) FROM retailers WHERE verification_status = 'verified') as verified_retailers,
    (SELECT count(*) FROM manufacturers WHERE verification_status = 'verified') as verified_manufacturers,
    (SELECT sum(quantity_available) FROM product_batches WHERE expiry_date > CURRENT_DATE) as total_available_inventory,
    (SELECT count(*) FROM consumer_purchases WHERE purchase_date > CURRENT_DATE - INTERVAL '24 hours') as purchases_last_24h;

-- Slow query log
CREATE VIEW slow_queries AS
SELECT 
    query,
    mean_exec_time,
    calls,
    total_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100 -- milliseconds
ORDER BY mean_exec_time DESC
LIMIT 20;
```

## 9. Security Implementation

### Row Level Security (RLS) for Multi-tenancy

```sql
-- Enable RLS on sensitive tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE retailer_inventory ENABLE ROW LEVEL SECURITY;

-- Policy for manufacturers to only see their products
CREATE POLICY manufacturer_products ON products
    FOR ALL
    TO authenticated_user
    USING (manufacturer_id IN (
        SELECT id FROM manufacturers 
        WHERE wp_user_id = current_setting('app.current_user_id')::INTEGER
    ));

-- Policy for retailers to only see their inventory
CREATE POLICY retailer_inventory_policy ON retailer_inventory
    FOR ALL
    TO authenticated_user
    USING (retailer_id IN (
        SELECT id FROM retailers 
        WHERE wp_user_id = current_setting('app.current_user_id')::INTEGER
    ));
```

## 10. Testing the Setup

### Quick connectivity test

```javascript
// test-connection.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', result.rows[0].now);
    
    const extensions = await pool.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname IN ('uuid-ossp', 'postgis', 'pg_trgm')
    `);
    console.log('✅ Required extensions:', extensions.rows);
    
    await pool.end();
  } catch (error) {
    console.error('❌ Connection failed:', error);
  }
}

test();
```

## 11. Deployment Checklist

- [ ] PostgreSQL 17 database created on Kinsta
- [ ] Required extensions enabled
- [ ] Schema deployed
- [ ] API application created on Kinsta
- [ ] Environment variables configured
- [ ] WordPress plugin installed
- [ ] SSL certificates configured
- [ ] Backup strategy implemented
- [ ] Monitoring alerts set up
- [ ] Initial data migrated
- [ ] Performance baseline established

## 12. Maintenance Tasks

### Weekly
- Refresh materialized views
- Check slow query log
- Review error logs

### Monthly
- Analyze table statistics
- Review and optimize indexes
- Check backup integrity
- Review security logs

### Quarterly
- Performance tuning review
- Security audit
- Capacity planning

## Support Contacts

- **Kinsta Support**: For database and hosting issues
- **PostgreSQL Docs**: https://www.postgresql.org/docs/17/
- **PostGIS Docs**: https://postgis.net/documentation/