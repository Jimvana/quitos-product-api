#!/bin/bash
DATABASE_URL="postgres://chickadee:yK9-zT1-jR0_uJ9-wO4=@europe-west1-001.proxy.kinsta.app:30063/coastal-scarlet-otter"

echo "Creating extensions..."
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS \"pg_trgm\";"

echo "Running schema..."
psql $DATABASE_URL -f postgresql-product-schema.sql

echo "Done!"
