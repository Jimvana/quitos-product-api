// PostgreSQL API Implementation for Quit-OS Product Database
// Using Node.js/Express with PostgreSQL

const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcrypt');
const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.WORDPRESS_URL || 'https://quit-os.com',
  credentials: true
}));

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // For Kinsta's SSL
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected:', res.rows[0].now);
  }
});

// Middleware for WordPress authentication
const authenticateWPUser = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    // Verify JWT token from WordPress
    const decoded = jwt.verify(token, process.env.WP_JWT_SECRET);
    
    // Get user type from WordPress integration
    const userResult = await pool.query(
      `SELECT user_type FROM wp_user_mapping WHERE wp_user_id = $1`,
      [decoded.user_id]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    req.user = {
      id: decoded.user_id,
      type: userResult.rows[0].user_type
    };
    
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Manufacturer endpoints
app.post('/api/products', authenticateWPUser, async (req, res) => {
  if (req.user.type !== 'manufacturer') {
    return res.status(403).json({ error: 'Only manufacturers can add products' });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get manufacturer ID
    const manufacturerResult = await client.query(
      'SELECT id FROM manufacturers WHERE wp_user_id = $1',
      [req.user.id]
    );
    
    if (manufacturerResult.rows.length === 0) {
      throw new Error('Manufacturer not found');
    }
    
    const manufacturerId = manufacturerResult.rows[0].id;
    
    // Insert product
    const {
      product_name,
      sku,
      category_id,
      description,
      nicotine_strength,
      volume_ml,
      flavor,
      ingredients,
      warnings,
      images,
      attributes
    } = req.body;
    
    const productResult = await client.query(
      `INSERT INTO products 
       (manufacturer_id, category_id, product_name, sku, description, 
        nicotine_strength, volume_ml, flavor, ingredients, warnings, 
        images, attributes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, uuid`,
      [
        manufacturerId,
        category_id,
        product_name,
        sku,
        description,
        nicotine_strength,
        volume_ml,
        flavor,
        ingredients || [],
        warnings || [],
        JSON.stringify(images || []),
        JSON.stringify(attributes || {})
      ]
    );
    
    // Log compliance event
    await client.query(
      `INSERT INTO compliance_log 
       (event_type, entity_type, entity_id, user_id, event_data, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        'product_created',
        'product',
        productResult.rows[0].id,
        req.user.id,
        JSON.stringify(req.body),
        req.ip,
        req.get('user-agent')
      ]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      product_id: productResult.rows[0].id,
      product_uuid: productResult.rows[0].uuid,
      message: 'Product created successfully'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Product creation error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  } finally {
    client.release();
  }
});

// Add batch for product
app.post('/api/products/:productId/batches', authenticateWPUser, async (req, res) => {
  const { productId } = req.params;
  const {
    batch_number,
    manufacture_date,
    expiry_date,
    quantity_produced,
    lab_test_results
  } = req.body;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Verify ownership
    const productResult = await client.query(
      `SELECT p.id, p.manufacturer_id 
       FROM products p 
       JOIN manufacturers m ON p.manufacturer_id = m.id 
       WHERE p.id = $1 AND m.wp_user_id = $2`,
      [productId, req.user.id]
    );
    
    if (productResult.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Insert batch
    const batchResult = await client.query(
      `INSERT INTO product_batches 
       (product_id, batch_number, manufacture_date, expiry_date, 
        quantity_produced, quantity_available, lab_test_results)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, uuid`,
      [
        productId,
        batch_number,
        manufacture_date,
        expiry_date,
        quantity_produced,
        quantity_produced, // Initially all available
        JSON.stringify(lab_test_results || {})
      ]
    );
    
    // Record movement
    await client.query(
      `INSERT INTO product_movements 
       (movement_type, product_id, batch_id, from_entity_type, from_entity_id,
        to_entity_type, to_entity_id, quantity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'manufacture',
        productId,
        batchResult.rows[0].id,
        'manufacturer',
        productResult.rows[0].manufacturer_id,
        'manufacturer',
        productResult.rows[0].manufacturer_id,
        quantity_produced
      ]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      batch_id: batchResult.rows[0].id,
      batch_uuid: batchResult.rows[0].uuid,
      message: 'Batch created successfully'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Batch creation error:', error);
    res.status(500).json({ error: 'Failed to create batch' });
  } finally {
    client.release();
  }
});

// Get manufacturer's products
app.get('/api/manufacturer/products', authenticateWPUser, async (req, res) => {
  if (req.user.type !== 'manufacturer') {
    return res.status(403).json({ error: 'Only manufacturers can access this endpoint' });
  }
  
  try {
    const result = await pool.query(
      `SELECT 
        p.*,
        c.name as category_name,
        COUNT(DISTINCT pb.id) as batch_count,
        SUM(pb.quantity_available) as total_available
       FROM products p
       JOIN manufacturers m ON p.manufacturer_id = m.id
       JOIN product_categories c ON p.category_id = c.id
       LEFT JOIN product_batches pb ON p.id = pb.product_id
       WHERE m.wp_user_id = $1
       GROUP BY p.id, c.name
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Retailer endpoints
app.get('/api/products/available', authenticateWPUser, async (req, res) => {
  if (req.user.type !== 'retailer') {
    return res.status(403).json({ error: 'Only retailers can access this endpoint' });
  }
  
  const { category, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  
  let query = `
    SELECT 
      p.id,
      p.uuid,
      p.product_name,
      p.sku,
      p.description,
      p.nicotine_strength,
      p.volume_ml,
      p.flavor,
      p.images,
      c.name as category_name,
      m.company_name as manufacturer_name,
      COUNT(DISTINCT pb.id) as available_batches,
      SUM(pb.quantity_available) as total_available
    FROM products p
    JOIN manufacturers m ON p.manufacturer_id = m.id
    JOIN product_categories c ON p.category_id = c.id
    LEFT JOIN product_batches pb ON p.id = pb.product_id 
      AND pb.quantity_available > 0 
      AND pb.expiry_date > CURRENT_DATE
    WHERE p.status = 'active'
  `;
  
  const params = [];
  let paramCount = 0;
  
  if (category) {
    params.push(category);
    query += ` AND c.slug = $${++paramCount}`;
  }
  
  if (search) {
    params.push(search);
    query += ` AND p.product_name ILIKE '%' || $${++paramCount} || '%'`;
  }
  
  query += ' GROUP BY p.id, p.uuid, p.product_name, p.sku, p.description, p.nicotine_strength, p.volume_ml, p.flavor, p.images, c.name, m.company_name';
  query += ' HAVING SUM(pb.quantity_available) > 0';
  query += ' ORDER BY p.product_name';
  
  params.push(parseInt(limit));
  params.push(parseInt(offset));
  query += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
  
  try {
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      products: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: result.rows.length
      }
    });
    
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Add product to retailer inventory
app.post('/api/inventory/add', authenticateWPUser, async (req, res) => {
  if (req.user.type !== 'retailer') {
    return res.status(403).json({ error: 'Only retailers can manage inventory' });
  }
  
  const {
    product_id,
    batch_id,
    quantity,
    price
  } = req.body;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get retailer ID
    const retailerResult = await client.query(
      'SELECT id FROM retailers WHERE wp_user_id = $1',
      [req.user.id]
    );
    
    if (retailerResult.rows.length === 0) {
      throw new Error('Retailer not found');
    }
    
    const retailerId = retailerResult.rows[0].id;
    
    // Check batch availability
    const batchResult = await client.query(
      'SELECT quantity_available FROM product_batches WHERE id = $1 AND product_id = $2',
      [batch_id, product_id]
    );
    
    if (batchResult.rows.length === 0 || batchResult.rows[0].quantity_available < quantity) {
      throw new Error('Insufficient batch quantity available');
    }
    
    // Update or insert inventory
    await client.query(
      `INSERT INTO retailer_inventory 
       (retailer_id, product_id, batch_id, quantity_in_stock, price)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (retailer_id, product_id, batch_id) 
       DO UPDATE SET 
         quantity_in_stock = retailer_inventory.quantity_in_stock + $4,
         price = $5,
         updated_at = CURRENT_TIMESTAMP`,
      [retailerId, product_id, batch_id, quantity, price]
    );
    
    // Update batch availability
    await client.query(
      'UPDATE product_batches SET quantity_available = quantity_available - $1 WHERE id = $2',
      [quantity, batch_id]
    );
    
    // Get manufacturer ID for movement record
    const manufacturerResult = await client.query(
      'SELECT manufacturer_id FROM products WHERE id = $1',
      [product_id]
    );
    
    // Record movement
    await client.query(
      `INSERT INTO product_movements 
       (movement_type, product_id, batch_id, from_entity_type, from_entity_id,
        to_entity_type, to_entity_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'ship_to_retailer',
        product_id,
        batch_id,
        'manufacturer',
        manufacturerResult.rows[0].manufacturer_id,
        'retailer',
        retailerId,
        quantity,
        price
      ]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Product added to inventory'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Inventory error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Consumer search endpoint with PostGIS
app.get('/api/search/products', async (req, res) => {
  const { q, lat, lng, radius = 10 } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Search query required' });
  }
  
  try {
    let query;
    let params = [q];
    
    if (lat && lng) {
      // Use PostGIS for location-based search
      query = `
        SELECT 
          p.id,
          p.uuid,
          p.product_name,
          p.description,
          p.nicotine_strength,
          p.flavor,
          p.images,
          r.id as retailer_id,
          r.store_name,
          r.address,
          ST_Y(r.location::geometry) as latitude,
          ST_X(r.location::geometry) as longitude,
          ST_Distance(r.location, ST_MakePoint($3, $2)::geography) / 1000 as distance_km,
          ri.price,
          ri.quantity_in_stock,
          pb.batch_number,
          pb.expiry_date
        FROM products p
        JOIN retailer_inventory ri ON p.id = ri.product_id
        JOIN retailers r ON ri.retailer_id = r.id
        JOIN product_batches pb ON ri.batch_id = pb.id
        WHERE ri.is_active = TRUE 
          AND ri.quantity_in_stock > 0
          AND pb.expiry_date > CURRENT_DATE
          AND r.verification_status = 'verified'
          AND p.product_name ILIKE '%' || $1 || '%'
          AND ST_DWithin(
            r.location,
            ST_MakePoint($3, $2)::geography,
            $4 * 1000
          )
        ORDER BY distance_km, ri.price
        LIMIT 50
      `;
      params.push(parseFloat(lat), parseFloat(lng), parseInt(radius));
    } else {
      // Regular search without location
      query = `
        SELECT 
          p.id,
          p.uuid,
          p.product_name,
          p.description,
          p.nicotine_strength,
          p.flavor,
          p.images,
          r.id as retailer_id,
          r.store_name,
          r.address,
          ST_Y(r.location::geometry) as latitude,
          ST_X(r.location::geometry) as longitude,
          ri.price,
          ri.quantity_in_stock,
          pb.batch_number,
          pb.expiry_date
        FROM products p
        JOIN retailer_inventory ri ON p.id = ri.product_id
        JOIN retailers r ON ri.retailer_id = r.id
        JOIN product_batches pb ON ri.batch_id = pb.id
        WHERE ri.is_active = TRUE 
          AND ri.quantity_in_stock > 0
          AND pb.expiry_date > CURRENT_DATE
          AND r.verification_status = 'verified'
          AND p.product_name ILIKE '%' || $1 || '%'
        ORDER BY ri.price
        LIMIT 50
      `;
    }
    
    const result = await pool.query(query, params);
    
    // Group by product
    const products = result.rows.reduce((acc, row) => {
      const productKey = row.id;
      
      if (!acc[productKey]) {
        acc[productKey] = {
          id: row.id,
          uuid: row.uuid,
          product_name: row.product_name,
          description: row.description,
          nicotine_strength: row.nicotine_strength,
          flavor: row.flavor,
          images: row.images,
          retailers: []
        };
      }
      
      acc[productKey].retailers.push({
        retailer_id: row.retailer_id,
        store_name: row.store_name,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        distance_km: row.distance_km,
        price: row.price,
        in_stock: row.quantity_in_stock > 0,
        batch_info: {
          batch_number: row.batch_number,
          expiry_date: row.expiry_date
        }
      });
      
      return acc;
    }, {});
    
    res.json({
      success: true,
      products: Object.values(products)
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Enhanced search using materialized view
app.get('/api/search/v2/products', async (req, res) => {
  const { q, category, min_rating, max_price } = req.query;
  
  try {
    let query = `
      SELECT *
      FROM product_search_view
      WHERE search_vector @@ plainto_tsquery('english', $1)
    `;
    
    const params = [q || ''];
    let paramCount = 1;
    
    if (category) {
      params.push(category);
      query += ` AND category_slug = $${++paramCount}`;
    }
    
    if (min_rating) {
      params.push(parseFloat(min_rating));
      query += ` AND average_rating >= $${++paramCount}`;
    }
    
    query += ' ORDER BY ts_rank(search_vector, plainto_tsquery(\'english\', $1)) DESC';
    query += ' LIMIT 50';
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      products: result.rows
    });
    
  } catch (error) {
    console.error('Search v2 error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Batch traceability endpoint
app.get('/api/trace/batch/:batchNumber', async (req, res) => {
  const { batchNumber } = req.params;
  
  try {
    // Get batch details
    const batchResult = await pool.query(
      `SELECT 
        pb.*,
        p.product_name,
        p.sku,
        m.company_name as manufacturer_name
       FROM product_batches pb
       JOIN products p ON pb.product_id = p.id
       JOIN manufacturers m ON p.manufacturer_id = m.id
       WHERE pb.batch_number = $1`,
      [batchNumber]
    );
    
    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    
    const batch = batchResult.rows[0];
    
    // Get movement history using stored function
    const historyResult = await pool.query(
      'SELECT * FROM get_batch_history($1::uuid)',
      [batch.uuid]
    );
    
    res.json({
      success: true,
      batch: {
        ...batch,
        lab_test_results: batch.lab_test_results
      },
      movement_history: historyResult.rows
    });
    
  } catch (error) {
    console.error('Trace error:', error);
    res.status(500).json({ error: 'Failed to trace batch' });
  }
});

// Consumer purchase endpoint
app.post('/api/purchase', async (req, res) => {
  const {
    retailer_id,
    items, // Array of {product_id, batch_id, quantity, unit_price}
    wp_user_id,
    payment_method,
    pos_transaction_id
  } = req.body;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Calculate total
    const total_amount = items.reduce((sum, item) => 
      sum + (item.quantity * item.unit_price), 0
    );
    
    // Create purchase record
    const purchaseResult = await client.query(
      `INSERT INTO consumer_purchases 
       (wp_user_id, retailer_id, total_amount, payment_method, 
        pos_transaction_id, order_metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, uuid`,
      [
        wp_user_id,
        retailer_id,
        total_amount,
        payment_method,
        pos_transaction_id,
        JSON.stringify({ items }),
        req.ip,
        req.get('user-agent')
      ]
    );
    
    const purchaseId = purchaseResult.rows[0].id;
    
    // Process each item
    for (const item of items) {
      // Insert purchase item
      await client.query(
        `INSERT INTO purchase_items 
         (purchase_id, product_id, batch_id, quantity, unit_price, total_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          purchaseId,
          item.product_id,
          item.batch_id,
          item.quantity,
          item.unit_price,
          item.quantity * item.unit_price
        ]
      );
      
      // Update inventory
      await client.query(
        `UPDATE retailer_inventory 
         SET quantity_in_stock = quantity_in_stock - $1,
             last_sold = CURRENT_TIMESTAMP
         WHERE retailer_id = $2 AND product_id = $3 AND batch_id = $4`,
        [item.quantity, retailer_id, item.product_id, item.batch_id]
      );
      
      // Record movement
      await client.query(
        `INSERT INTO product_movements 
         (movement_type, product_id, batch_id, from_entity_type, from_entity_id,
          to_entity_type, to_entity_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          'sale_to_consumer',
          item.product_id,
          item.batch_id,
          'retailer',
          retailer_id,
          'consumer',
          wp_user_id || 0,
          item.quantity,
          item.unit_price
        ]
      );
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      purchase_id: purchaseId,
      purchase_uuid: purchaseResult.rows[0].uuid,
      message: 'Purchase completed successfully'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Purchase error:', error);
    res.status(500).json({ error: 'Failed to process purchase' });
  } finally {
    client.release();
  }
});

// Analytics endpoints
app.get('/api/analytics/sales', authenticateWPUser, async (req, res) => {
  const { start_date, end_date, group_by = 'day' } = req.query;
  
  let dateFormat;
  switch (group_by) {
    case 'hour': dateFormat = 'YYYY-MM-DD HH24:00:00'; break;
    case 'day': dateFormat = 'YYYY-MM-DD'; break;
    case 'week': dateFormat = 'IYYY-IW'; break;
    case 'month': dateFormat = 'YYYY-MM'; break;
    default: dateFormat = 'YYYY-MM-DD';
  }
  
  try {
    const query = `
      SELECT 
        TO_CHAR(cp.purchase_date, $3) as period,
        COUNT(DISTINCT cp.id) as transaction_count,
        SUM(cp.total_amount) as total_revenue,
        COUNT(DISTINCT cp.wp_user_id) as unique_customers,
        AVG(cp.total_amount) as average_order_value
      FROM consumer_purchases cp
      WHERE cp.purchase_date BETWEEN $1 AND $2
      ${req.user.type === 'retailer' ? 'AND cp.retailer_id = (SELECT id FROM retailers WHERE wp_user_id = $4)' : ''}
      GROUP BY period
      ORDER BY period
    `;
    
    const params = [start_date, end_date, dateFormat];
    if (req.user.type === 'retailer') {
      params.push(req.user.id);
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      analytics: result.rows
    });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Refresh materialized view (should be called periodically)
app.post('/api/admin/refresh-search-view', authenticateWPUser, async (req, res) => {
  // Add admin check here
  try {
    await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY product_search_view');
    res.json({ success: true, message: 'Search view refreshed' });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh search view' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Product API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});