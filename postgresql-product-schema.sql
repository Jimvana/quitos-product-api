-- PostgreSQL 17 Schema for Quit-OS Product Database
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- Manufacturers table
CREATE TABLE manufacturers (
    id SERIAL PRIMARY KEY,
    wp_user_id INTEGER NOT NULL UNIQUE,
    company_name VARCHAR(255) NOT NULL,
    license_number VARCHAR(100),
    address TEXT,
    contact_email VARCHAR(255),
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'suspended')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_manufacturers_status ON manufacturers(verification_status);
CREATE INDEX idx_manufacturers_metadata ON manufacturers USING GIN(metadata);

-- Product categories with hierarchical structure
CREATE TABLE product_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
    attributes_schema JSONB DEFAULT '{}', -- Define required attributes per category
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default categories
INSERT INTO product_categories (name, slug, attributes_schema) VALUES
('E-Cigarettes/Vapes', 'vapes', '{"required": ["battery_capacity", "coil_resistance"]}'),
('Nicotine Pouches', 'pouches', '{"required": ["pouch_count", "pouch_weight"]}'),
('Lozenges', 'lozenges', '{"required": ["lozenge_count"]}'),
('Gum', 'gum', '{"required": ["pieces_per_pack"]}'),
('Patches', 'patches', '{"required": ["patch_size", "duration_hours"]}');

-- Products master table with JSONB for flexible attributes
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    manufacturer_id INTEGER NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
    category_id INTEGER NOT NULL REFERENCES product_categories(id),
    product_name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    description TEXT,
    nicotine_strength DECIMAL(5,2),
    volume_ml DECIMAL(10,2),
    flavor VARCHAR(100),
    ingredients TEXT[],  -- PostgreSQL array type
    warnings TEXT[],     -- PostgreSQL array type
    images JSONB DEFAULT '[]',  -- Array of {url, alt_text, is_primary}
    attributes JSONB DEFAULT '{}',  -- Category-specific attributes
    compliance_info JSONB DEFAULT '{}',  -- Regulatory compliance data
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'discontinued')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_sku_per_manufacturer UNIQUE(manufacturer_id, sku)
);

-- Advanced indexes for search
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_search ON products USING GIN(to_tsvector('english', product_name || ' ' || COALESCE(description, '') || ' ' || COALESCE(flavor, '')));
CREATE INDEX idx_products_attributes ON products USING GIN(attributes);
CREATE INDEX idx_products_nicotine ON products(nicotine_strength) WHERE nicotine_strength IS NOT NULL;

-- Batch tracking with enhanced traceability
CREATE TABLE product_batches (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    batch_number VARCHAR(100) NOT NULL,
    manufacture_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    quantity_produced INTEGER NOT NULL CHECK (quantity_produced > 0),
    quantity_available INTEGER NOT NULL CHECK (quantity_available >= 0),
    lab_test_results JSONB DEFAULT '{}',
    qr_code_data JSONB DEFAULT '{}',  -- For QR code generation
    blockchain_hash VARCHAR(64),  -- For future blockchain integration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_batch_per_product UNIQUE(product_id, batch_number),
    CONSTRAINT valid_dates CHECK (expiry_date > manufacture_date)
);

CREATE INDEX idx_batches_expiry ON product_batches(expiry_date);
CREATE INDEX idx_batches_available ON product_batches(quantity_available) WHERE quantity_available > 0;

-- Retailers with PostGIS location data
CREATE TABLE retailers (
    id SERIAL PRIMARY KEY,
    wp_user_id INTEGER NOT NULL UNIQUE,
    store_name VARCHAR(255) NOT NULL,
    license_number VARCHAR(100),
    address TEXT,
    location GEOGRAPHY(POINT, 4326),  -- PostGIS point type
    phone VARCHAR(20),
    email VARCHAR(255),
    business_hours JSONB DEFAULT '{}',  -- {monday: {open: "09:00", close: "17:00"}, ...}
    verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'suspended')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_retailers_location ON retailers USING GIST(location);
CREATE INDEX idx_retailers_status ON retailers(verification_status);

-- Retailer inventory with optimized tracking
CREATE TABLE retailer_inventory (
    id SERIAL PRIMARY KEY,
    retailer_id INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    batch_id INTEGER NOT NULL REFERENCES product_batches(id) ON DELETE RESTRICT,
    quantity_in_stock INTEGER NOT NULL DEFAULT 0 CHECK (quantity_in_stock >= 0),
    quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    price DECIMAL(10,2) NOT NULL CHECK (price > 0),
    discount_price DECIMAL(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    display_priority INTEGER DEFAULT 0,
    last_restocked TIMESTAMP WITH TIME ZONE,
    last_sold TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_retailer_product_batch UNIQUE(retailer_id, product_id, batch_id),
    CONSTRAINT valid_reserved CHECK (quantity_reserved <= quantity_in_stock)
);

CREATE INDEX idx_inventory_active ON retailer_inventory(is_active, product_id) WHERE is_active = TRUE;
CREATE INDEX idx_inventory_stock ON retailer_inventory(quantity_in_stock) WHERE quantity_in_stock > 0;
CREATE INDEX idx_inventory_updated ON retailer_inventory(updated_at);

-- Enhanced transaction tracking
CREATE TABLE product_movements (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN (
        'manufacture', 'ship_to_retailer', 'sale_to_consumer', 
        'return', 'disposal', 'recall', 'transfer'
    )),
    product_id INTEGER NOT NULL REFERENCES products(id),
    batch_id INTEGER NOT NULL REFERENCES product_batches(id),
    from_entity_type VARCHAR(20) NOT NULL CHECK (from_entity_type IN ('manufacturer', 'retailer', 'consumer')),
    from_entity_id INTEGER NOT NULL,
    to_entity_type VARCHAR(20) NOT NULL CHECK (to_entity_type IN ('manufacturer', 'retailer', 'consumer')),
    to_entity_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2),
    total_value DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    transaction_metadata JSONB DEFAULT '{}',  -- Additional transaction data
    verified_by INTEGER,  -- User who verified the transaction
    verified_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_movements_batch ON product_movements(batch_id, created_at);
CREATE INDEX idx_movements_entity ON product_movements(from_entity_type, from_entity_id, created_at);
CREATE INDEX idx_movements_type ON product_movements(movement_type, created_at);

-- Consumer purchases with enhanced tracking
CREATE TABLE consumer_purchases (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT uuid_generate_v4() UNIQUE,
    wp_user_id INTEGER,  -- Nullable for anonymous purchases
    retailer_id INTEGER NOT NULL REFERENCES retailers(id),
    order_metadata JSONB DEFAULT '{}',  -- Full order details
    purchase_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    pos_transaction_id VARCHAR(100),
    payment_method VARCHAR(50),
    total_amount DECIMAL(10,2) NOT NULL,
    ip_address INET,
    user_agent TEXT
);

CREATE INDEX idx_purchases_user ON consumer_purchases(wp_user_id, purchase_date) WHERE wp_user_id IS NOT NULL;
CREATE INDEX idx_purchases_retailer ON consumer_purchases(retailer_id, purchase_date);

-- Purchase items (normalized for better tracking)
CREATE TABLE purchase_items (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES consumer_purchases(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    batch_id INTEGER NOT NULL REFERENCES product_batches(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    discount_applied DECIMAL(10,2) DEFAULT 0
);

CREATE INDEX idx_purchase_items_batch ON purchase_items(batch_id);

-- Product reviews and ratings
CREATE TABLE product_reviews (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    wp_user_id INTEGER NOT NULL,
    purchase_id INTEGER REFERENCES consumer_purchases(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title VARCHAR(255),
    review TEXT,
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reviews_product ON product_reviews(product_id, rating);
CREATE INDEX idx_reviews_user ON product_reviews(wp_user_id);

-- Compliance and audit log
CREATE TABLE compliance_log (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(30) NOT NULL,
    entity_id INTEGER NOT NULL,
    user_id INTEGER,
    event_data JSONB NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_compliance_event ON compliance_log(event_type, created_at);
CREATE INDEX idx_compliance_entity ON compliance_log(entity_type, entity_id, created_at);

-- Create materialized view for product search (refresh periodically)
CREATE MATERIALIZED VIEW product_search_view AS
SELECT 
    p.id,
    p.uuid,
    p.product_name,
    p.sku,
    p.description,
    p.nicotine_strength,
    p.flavor,
    p.images,
    p.status,
    c.name as category_name,
    c.slug as category_slug,
    m.company_name as manufacturer_name,
    COUNT(DISTINCT r.id) as retailer_count,
    AVG(pr.rating) as average_rating,
    COUNT(DISTINCT pr.id) as review_count,
    to_tsvector('english', 
        p.product_name || ' ' || 
        COALESCE(p.description, '') || ' ' || 
        COALESCE(p.flavor, '') || ' ' ||
        m.company_name || ' ' ||
        c.name
    ) as search_vector
FROM products p
JOIN manufacturers m ON p.manufacturer_id = m.id
JOIN product_categories c ON p.category_id = c.id
LEFT JOIN retailer_inventory ri ON p.id = ri.product_id AND ri.is_active = TRUE
LEFT JOIN retailers r ON ri.retailer_id = r.id AND r.verification_status = 'verified'
LEFT JOIN product_reviews pr ON p.id = pr.product_id
WHERE p.status = 'active'
GROUP BY p.id, p.uuid, p.product_name, p.sku, p.description, 
         p.nicotine_strength, p.flavor, p.images, p.status,
         c.name, c.slug, m.company_name;

CREATE INDEX idx_search_view_vector ON product_search_view USING GIN(search_vector);
CREATE INDEX idx_search_view_category ON product_search_view(category_slug);
CREATE UNIQUE INDEX idx_search_view_id ON product_search_view(id);

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers
CREATE TRIGGER update_manufacturers_updated_at BEFORE UPDATE ON manufacturers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_retailers_updated_at BEFORE UPDATE ON retailers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON retailer_inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function for proximity search
CREATE OR REPLACE FUNCTION find_nearby_retailers(
    user_lat DOUBLE PRECISION,
    user_lon DOUBLE PRECISION,
    radius_km INTEGER DEFAULT 10
)
RETURNS TABLE (
    retailer_id INTEGER,
    store_name VARCHAR,
    distance_km DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.store_name,
        ST_Distance(r.location::geography, ST_MakePoint(user_lon, user_lat)::geography) / 1000 as distance_km
    FROM retailers r
    WHERE r.verification_status = 'verified'
        AND ST_DWithin(
            r.location::geography,
            ST_MakePoint(user_lon, user_lat)::geography,
            radius_km * 1000
        )
    ORDER BY distance_km;
END;
$$ LANGUAGE plpgsql;

-- Function for batch traceability
CREATE OR REPLACE FUNCTION get_batch_history(batch_uuid UUID)
RETURNS TABLE (
    movement_date TIMESTAMP WITH TIME ZONE,
    movement_type VARCHAR,
    from_entity VARCHAR,
    to_entity VARCHAR,
    quantity INTEGER,
    notes TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pm.created_at,
        pm.movement_type,
        CASE 
            WHEN pm.from_entity_type = 'manufacturer' THEN m1.company_name
            WHEN pm.from_entity_type = 'retailer' THEN r1.store_name
            ELSE 'Consumer #' || pm.from_entity_id
        END as from_entity,
        CASE 
            WHEN pm.to_entity_type = 'manufacturer' THEN m2.company_name
            WHEN pm.to_entity_type = 'retailer' THEN r2.store_name
            ELSE 'Consumer #' || pm.to_entity_id
        END as to_entity,
        pm.quantity,
        pm.notes
    FROM product_movements pm
    JOIN product_batches pb ON pm.batch_id = pb.id
    LEFT JOIN manufacturers m1 ON pm.from_entity_type = 'manufacturer' AND pm.from_entity_id = m1.id
    LEFT JOIN retailers r1 ON pm.from_entity_type = 'retailer' AND pm.from_entity_id = r1.id
    LEFT JOIN manufacturers m2 ON pm.to_entity_type = 'manufacturer' AND pm.to_entity_id = m2.id
    LEFT JOIN retailers r2 ON pm.to_entity_type = 'retailer' AND pm.to_entity_id = r2.id
    WHERE pb.uuid = batch_uuid
    ORDER BY pm.created_at;
END;
$$ LANGUAGE plpgsql;