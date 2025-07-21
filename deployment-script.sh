#!/bin/bash
# deploy-product-database.sh
# Automated deployment script for Quit-OS Product Database

set -e  # Exit on error

echo "🚀 Starting Quit-OS Product Database Deployment"

# Configuration
DB_NAME="quitos_products"
API_DIR="/app/product-api"
WP_PLUGIN_DIR="/Users/video/DevKinsta/public/quitos/wp-content/plugins/quitos-product-db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if command was successful
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1${NC}"
    else
        echo -e "${RED}✗ $1 failed${NC}"
        exit 1
    fi
}

# 1. Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

command -v psql >/dev/null 2>&1 || { echo -e "${RED}PostgreSQL client required but not installed.${NC}" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo -e "${RED}Node.js required but not installed.${NC}" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}npm required but not installed.${NC}" >&2; exit 1; }

check_status "Prerequisites check"

# 2. Database setup
echo -e "${YELLOW}Setting up PostgreSQL database...${NC}"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create .env file with your database credentials"
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Test database connection
psql $DATABASE_URL -c "SELECT version();" > /dev/null 2>&1
check_status "Database connection"

# Enable extensions
echo "Enabling required PostgreSQL extensions..."
psql $DATABASE_URL << EOF
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
EOF
check_status "PostgreSQL extensions"

# 3. Deploy database schema
echo -e "${YELLOW}Deploying database schema...${NC}"

if [ -f "schema.sql" ]; then
    psql $DATABASE_URL < schema.sql
    check_status "Database schema deployment"
else
    echo -e "${RED}Error: schema.sql not found${NC}"
    exit 1
fi

# 4. Create WordPress user mapping table
echo "Creating WordPress integration tables..."
psql $DATABASE_URL << EOF
CREATE TABLE IF NOT EXISTS wp_user_mapping (
    id SERIAL PRIMARY KEY,
    wp_user_id INTEGER NOT NULL UNIQUE,
    user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('consumer', 'manufacturer', 'retailer')),
    entity_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wp_mapping_type ON wp_user_mapping(user_type);
EOF
check_status "WordPress integration tables"

# 5. Set up API application
echo -e "${YELLOW}Setting up Node.js API...${NC}"

if [ ! -d "$API_DIR" ]; then
    mkdir -p "$API_DIR"
fi

cd "$API_DIR"

# Copy API files
cp /path/to/source/server.js .
cp /path/to/source/package.json .
cp /path/to/source/.env.example .env

# Install dependencies
npm install
check_status "API dependencies installation"

# 6. Deploy WordPress plugin
echo -e "${YELLOW}Deploying WordPress plugin...${NC}"

if [ ! -d "$WP_PLUGIN_DIR" ]; then
    mkdir -p "$WP_PLUGIN_DIR"
fi

# Copy plugin files
cp -r /path/to/source/wordpress-plugin/* "$WP_PLUGIN_DIR/"
check_status "WordPress plugin deployment"

# 7. Set up cron jobs
echo -e "${YELLOW}Setting up cron jobs...${NC}"

# Add cron job for refreshing materialized view
(crontab -l 2>/dev/null; echo "0 */6 * * * curl -X POST https://api.quit-os.com/api/admin/refresh-search-view -H 'Authorization: Bearer YOUR_ADMIN_TOKEN'") | crontab -
check_status "Cron jobs setup"

# 8. Run initial data setup
echo -e "${YELLOW}Running initial data setup...${NC}"

# Insert default categories (already in schema)
# Add any additional initial data here

# 9. Test API endpoints
echo -e "${YELLOW}Testing API endpoints...${NC}"

# Start API temporarily for testing
cd "$API_DIR"
npm start &
API_PID=$!
sleep 5

# Test health endpoint
curl -f http://localhost:3000/health > /dev/null 2>&1
check_status "API health check"

# Stop test API
kill $API_PID

# 10. Create backup
echo -e "${YELLOW}Creating initial backup...${NC}"

BACKUP_FILE="product_db_initial_$(date +%Y%m%d_%H%M%S).dump"
pg_dump $DATABASE_URL -Fc -f "$BACKUP_FILE"
check_status "Initial backup"

# 11. Generate deployment report
echo -e "${YELLOW}Generating deployment report...${NC}"

cat > deployment_report.txt << EOF
Quit-OS Product Database Deployment Report
Generated: $(date)

Database Information:
- PostgreSQL Version: $(psql $DATABASE_URL -t -c "SELECT version();" | head -1)
- Database Name: $DB_NAME
- Extensions: uuid-ossp, postgis, pg_trgm

API Information:
- Location: $API_DIR
- Node Version: $(node --version)
- NPM Version: $(npm --version)

WordPress Plugin:
- Location: $WP_PLUGIN_DIR
- Plugin Name: Quit-OS Product Database

Backup Information:
- Initial Backup: $BACKUP_FILE

Next Steps:
1. Configure Kinsta Application Hosting for the API
2. Set up SSL certificates
3. Configure WordPress plugin settings
4. Test manufacturer product upload
5. Test retailer inventory management
6. Test consumer search functionality

Security Checklist:
- [ ] Change default API keys
- [ ] Enable SSL on all endpoints
- [ ] Configure firewall rules
- [ ] Set up monitoring alerts
- [ ] Review user permissions

EOF

check_status "Deployment report generation"

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${YELLOW}Please review deployment_report.txt for next steps${NC}"

# 12. Display important information
echo -e "\n${YELLOW}Important Information:${NC}"
echo "1. API URL: https://api.quit-os.com"
echo "2. Database backup: $BACKUP_FILE"
echo "3. WordPress plugin location: $WP_PLUGIN_DIR"
echo "4. Remember to activate the WordPress plugin"
echo "5. Configure API environment variables in Kinsta dashboard"

# Optional: Start services
read -p "Do you want to start the API service now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$API_DIR"
    npm start
fi