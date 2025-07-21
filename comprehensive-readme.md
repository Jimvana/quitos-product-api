# Quit-OS Central Product Database

A comprehensive product tracking system for nicotine replacement products with full supply chain traceability from manufacturer to consumer.

## 🎯 Overview

The Quit-OS Product Database provides:
- **Manufacturers**: Upload and manage products with batch tracking
- **Retailers**: Browse products, manage inventory, track sales
- **Consumers**: Search products by location, verify authenticity
- **Compliance**: Full chain-of-custody tracking for regulatory requirements

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   WordPress Site                     │
│              (quit-os.com / vapeos)                 │
│  ┌─────────────────┐    ┌──────────────────────┐   │
│  │  Plugin (PHP)   │    │   User Interface     │   │
│  └────────┬────────┘    └──────────────────────┘   │
└───────────┼─────────────────────────────────────────┘
            │ JWT Auth
            ▼
┌─────────────────────────────────────────────────────┐
│              Product API (Node.js)                   │
│         Hosted on Kinsta Application                 │
│  ┌─────────────────┐    ┌──────────────────────┐   │
│  │   REST API      │    │   Business Logic     │   │
│  └────────┬────────┘    └──────────────────────┘   │
└───────────┼─────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────┐
│           PostgreSQL 17 Database                     │
│         Hosted on Kinsta Database                    │
│  ┌─────────────────┐    ┌──────────────────────┐   │
│  │  Product Data   │    │   PostGIS Location   │   │
│  │  Batch Tracking │    │   Full-text Search   │   │
│  └─────────────────┘    └──────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## 📋 Prerequisites

- PostgreSQL 17 database on Kinsta
- Node.js 18+ for API
- WordPress 6.0+ installation
- SSL certificates for all endpoints

## 🚀 Quick Start

### 1. Database Setup

```bash
# Connect to your Kinsta PostgreSQL database
psql $DATABASE_URL

# Run the schema
\i postgresql-product-schema.sql

# Verify extensions
SELECT extname FROM pg_extension;
```

### 2. API Deployment

```bash
# Clone the repository
git clone https://github.com/your-org/quitos-product-api
cd quitos-product-api

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Install dependencies
npm install

# Run migrations
npm run migrate

# Start the API
npm start
```

### 3. WordPress Plugin Installation

```bash
# Navigate to your WordPress plugins directory
cd /Users/video/DevKinsta/public/quitos/wp-content/plugins

# Copy the plugin
cp -r /path/to/quitos-product-db .

# Activate in WordPress admin
```

### 4. Configuration

Add to `wp-config.php`:
```php
define('QUITOS_API_URL', 'https://api.quit-os.com');
define('QUITOS_JWT_SECRET', 'your-secret-key');
```

## 📚 API Documentation

### Authentication

All authenticated endpoints require a JWT token:
```javascript
headers: {
  'Authorization': 'Bearer YOUR_JWT_TOKEN'
}
```

### Key Endpoints

#### Products
- `POST /api/products` - Create product (manufacturers)
- `GET /api/products/available` - List available products (retailers)
- `GET /api/search/products` - Search products (public)

#### Batches
- `POST /api/products/:id/batches` - Add batch
- `GET /api/trace/batch/:batchNumber` - Trace batch history

#### Inventory
- `POST /api/inventory/add` - Add to retailer inventory
- `GET /api/inventory` - View current inventory

See full API documentation at `/docs` when running the API.

## 🔧 Development

### Local Development Setup

```bash
# Start PostgreSQL locally
docker run -d \
  --name quitos-postgres \
  -e POSTGRES_PASSWORD=localpass \
  -e POSTGRES_DB=quitos_products \
  -p 5432:5432 \
  postgis/postgis:17-3.4

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Running Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Performance tests
npm run test:performance
```

## 📊 Database Schema

### Core Tables
- `manufacturers` - Verified manufacturers
- `products` - Product catalog with flexible attributes
- `product_batches` - Batch tracking with expiry dates
- `retailers` - Verified retail locations
- `retailer_inventory` - Current stock levels
- `product_movements` - Full transaction history
- `consumer_purchases` - Purchase records for traceability

### Key Features
- **PostGIS** for location-based searches
- **JSONB** for flexible product attributes
- **Full-text search** for product discovery
- **UUID** identifiers for external references
- **Row-level security** for multi-tenancy

## 🔒 Security

### API Security
- JWT authentication
- Rate limiting (100 requests/hour per IP)
- CORS configuration for approved domains
- Input validation and sanitization

### Database Security
- Row-level security policies
- Encrypted connections (SSL required)
- Regular automated backups
- Audit logging for compliance

## 📈 Performance Optimization

### Database
- Materialized views for search
- Optimized indexes for common queries
- Partitioning for large tables (future)
- Connection pooling

### API
- Response caching
- Query optimization
- Pagination on all list endpoints
- Async processing for heavy operations

## 🚨 Monitoring

### Health Checks
- `/health` - API health status
- Database connection monitoring
- Queue processing status

### Metrics
- Response times
- Error rates
- Database performance
- Search query performance

## 🔄 Maintenance

### Daily
- Monitor error logs
- Check backup completion

### Weekly
- Refresh materialized views
- Review slow query log

### Monthly
- Update dependencies
- Security patches
- Performance review

## 🆘 Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Check connection string
psql $DATABASE_URL -c "SELECT 1"

# Verify SSL mode
export PGSSLMODE=require
```

**API Not Starting**
```bash
# Check port availability
lsof -i :3000

# Verify environment variables
node -e "console.log(process.env.DATABASE_URL)"
```

**Search Not Working**
```sql
-- Refresh materialized view
REFRESH MATERIALIZED VIEW CONCURRENTLY product_search_view;

-- Check indexes
\di+ *search*
```

## 📞 Support

- **Technical Issues**: Create an issue in the repository
- **Kinsta Support**: For hosting-related issues
- **Security**: security@quit-os.com

## 🗺️ Roadmap

### Phase 1 (Current)
- ✅ Core product database
- ✅ Manufacturer uploads
- ✅ Retailer inventory
- ✅ Consumer search

### Phase 2 (Q2 2024)
- [ ] POS system integration
- [ ] Mobile app API
- [ ] Advanced analytics
- [ ] Blockchain integration

### Phase 3 (Q3 2024)
- [ ] AI-powered recommendations
- [ ] Predictive inventory
- [ ] International expansion
- [ ] Multi-language support

## 📄 License

Proprietary - Quit-OS © 2024

---

Built with ❤️ for a smoke-free future