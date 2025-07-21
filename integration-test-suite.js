// test/integration-tests.js
// Integration test suite for Quit-OS Product Database

const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test data
const testManufacturer = {
  wp_user_id: 1001,
  company_name: 'Test Vape Co',
  license_number: 'TEST-001',
  contact_email: 'test@testvapeco.com'
};

const testProduct = {
  product_name: 'Test Vape Product',
  sku: 'TEST-VAPE-001',
  category_id: 1,
  nicotine_strength: 5.0,
  volume_ml: 10.0,
  flavor: 'Test Flavor',
  ingredients: ['Propylene Glycol', 'Vegetable Glycerin', 'Nicotine'],
  warnings: ['Keep away from children', 'Nicotine is addictive']
};

const testBatch = {
  batch_number: 'BATCH-TEST-001',
  manufacture_date: '2024-01-01',
  expiry_date: '2025-01-01',
  quantity_produced: 1000,
  lab_test_results: {
    nicotine_content: 5.0,
    purity: 99.9,
    tested_date: '2024-01-01'
  }
};

// Helper function to get auth token
async function getAuthToken(userId, userType) {
  // In real implementation, this would call your WordPress JWT endpoint
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { user_id: userId, type: userType },
    process.env.WP_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Test suite
class IntegrationTests {
  constructor() {
    this.results = [];
  }

  async runAllTests() {
    console.log('🧪 Starting Integration Tests...\n');
    
    try {
      await this.testDatabaseConnection();
      await this.testAPIHealth();
      await this.testManufacturerFlow();
      await this.testRetailerFlow();
      await this.testConsumerSearch();
      await this.testBatchTraceability();
      await this.testLocationSearch();
      
      this.printResults();
    } catch (error) {
      console.error('Test suite failed:', error);
    } finally {
      await pool.end();
    }
  }

  async testDatabaseConnection() {
    const testName = 'Database Connection';
    try {
      const result = await pool.query('SELECT NOW()');
      this.addResult(testName, true, `Connected at ${result.rows[0].now}`);
      
      // Check extensions
      const extensions = await pool.query(`
        SELECT extname FROM pg_extension 
        WHERE extname IN ('uuid-ossp', 'postgis', 'pg_trgm')
      `);
      
      if (extensions.rows.length === 3) {
        this.addResult('Required Extensions', true, 'All extensions installed');
      } else {
        throw new Error('Missing required extensions');
      }
    } catch (error) {
      this.addResult(testName, false, error.message);
    }
  }

  async testAPIHealth() {
    const testName = 'API Health Check';
    try {
      const response = await axios.get(`${API_BASE_URL}/health`);
      if (response.data.status === 'healthy') {
        this.addResult(testName, true, 'API is healthy');
      } else {
        throw new Error('API unhealthy');
      }
    } catch (error) {
      this.addResult(testName, false, error.message);
    }
  }

  async testManufacturerFlow() {
    const testName = 'Manufacturer Product Flow';
    try {
      // 1. Create manufacturer
      await pool.query(
        `INSERT INTO manufacturers (wp_user_id, company_name, license_number, contact_email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wp_user_id) DO NOTHING`,
        [testManufacturer.wp_user_id, testManufacturer.company_name, 
         testManufacturer.license_number, testManufacturer.contact_email]
      );
      
      // 2. Create auth token
      const token = await getAuthToken(testManufacturer.wp_user_id, 'manufacturer');
      
      // 3. Create product
      const productResponse = await axios.post(
        `${API_BASE_URL}/api/products`,
        testProduct,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      if (!productResponse.data.success) {
        throw new Error('Failed to create product');
      }
      
      const productId = productResponse.data.product_id;
      
      // 4. Add batch
      const batchResponse = await axios.post(
        `${API_BASE_URL}/api/products/${productId}/batches`,
        testBatch,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      if (batchResponse.data.success) {
        this.addResult(testName, true, `Product ${productId} with batch created`);
      } else {
        throw new Error('Failed to create batch');
      }
      
    } catch (error) {
      this.addResult(testName, false, error.message);
    }
  }

  async testRetailerFlow() {
    const testName = 'Retailer Inventory Flow';
    try {
      // 1. Create retailer
      const retailerResult = await pool.query(
        `INSERT INTO retailers (wp_user_id, store_name, license_number, address, location)
         VALUES ($1, $2, $3, $4, ST_MakePoint($5, $6))
         ON CONFLICT (wp_user_id) DO NOTHING
         RETURNING id`,
        [2001, 'Test Vape Shop', 'RETAIL-001', '123 Test St', -0.1278, 51.5074]
      );
      
      // 2. Get available products
      const token = await getAuthToken(2001, 'retailer');
      const productsResponse = await axios.get(
        `${API_BASE_URL}/api/products/available`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      if (productsResponse.data.products.length > 0) {
        this.addResult(testName, true, 'Retailer can view available products');
      } else {
        this.addResult(testName, true, 'No products available yet');
      }
      
    } catch (error) {
      this.addResult(testName, false, error.message);
    }
  }

  async testConsumerSearch() {
    const testName = 'Consumer Product Search';
    try {
      const searchResponse = await axios.get(
        `${API_BASE_URL}/api/search/products?q=vape`
      );
      
      if (searchResponse.data.success) {
        this.addResult(testName, true, 
          `Found ${Object.keys(searchResponse.data.products).length} products`);
      } else {
        throw new Error('Search failed');
      }
    } catch (error) {
      this.addResult(testName, false, error.message);
    }
  }

  async testBatchTraceability() {
    const testName = 'Batch Traceability';
    try {
      // Get a batch from database
      const batchResult = await pool.query(
        'SELECT batch_number FROM product_batches LIMIT 1'
      );
      
      if (batchResult.rows.length > 0) {
        const batchNumber = batchResult.rows[0].batch_number;
        const traceResponse = await axios.get(
          `${API_BASE_URL}/api/trace/batch/${batchNumber}`
        );
        
        if (traceResponse.data.success) {
          this.addResult(testName, true, 
            `Traced batch with ${traceResponse.data.movement_history.length} movements`);
        } else {
          throw new Error('Trace failed');
        }
      } else {
        this.addResult(testName, true, 'No batches to trace yet');
      }
    } catch (error) {
      this.addResult(testName, false, error.message);
    }
  }

  async testLocationSearch() {
    const testName = 'Location-based Search';
    try {
      const searchResponse = await axios.get(
        `${API_BASE_URL}/api/search/products?q=vape&lat=51.5074&lng=-0.1278&radius=10`
      );
      
      if (searchResponse.data.success) {
        this.addResult(testName, true, 'Location search working');
      } else {
        throw new Error('Location search failed');
      }
    } catch (error) {
      this.addResult(testName, false, error.message);
    }
  }

  addResult(testName, passed, message) {
    this.results.push({
      test: testName,
      passed,
      message,
      timestamp: new Date().toISOString()
    });
  }

  printResults() {
    console.log('\n📊 Test Results:\n');
    
    let passed = 0;
    let failed = 0;
    
    this.results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      const status = result.passed ? 'PASSED' : 'FAILED';
      console.log(`${icon} ${result.test}: ${status}`);
      console.log(`   ${result.message}\n`);
      
      if (result.passed) passed++;
      else failed++;
    });
    
    console.log('━'.repeat(50));
    console.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('━'.repeat(50));
    
    // Generate report file
    const fs = require('fs');
    const report = {
      testRun: new Date().toISOString(),
      summary: { total: this.results.length, passed, failed },
      results: this.results
    };
    
    fs.writeFileSync('test-report.json', JSON.stringify(report, null, 2));
    console.log('\n📄 Detailed report saved to test-report.json');
  }
}

// Performance test
async function performanceTest() {
  console.log('\n⚡ Running Performance Tests...\n');
  
  const searches = [];
  const startTime = Date.now();
  
  // Run 100 concurrent searches
  for (let i = 0; i < 100; i++) {
    searches.push(
      axios.get(`${API_BASE_URL}/api/search/products?q=test`)
        .catch(err => ({ error: err.message }))
    );
  }
  
  const results = await Promise.all(searches);
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  const successful = results.filter(r => !r.error).length;
  console.log(`Completed ${successful}/100 searches in ${duration}ms`);
  console.log(`Average response time: ${duration/100}ms per request`);
}

// Run tests
async function main() {
  const tests = new IntegrationTests();
  await tests.runAllTests();
  
  // Optional performance test
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  readline.question('\nRun performance tests? (y/n) ', async (answer) => {
    if (answer.toLowerCase() === 'y') {
      await performanceTest();
    }
    readline.close();
    process.exit(0);
  });
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { IntegrationTests };