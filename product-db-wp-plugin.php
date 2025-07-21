<?php
/**
 * Plugin Name: Quit-OS Product Database
 * Description: Central product database for nicotine replacement products
 * Version: 1.0.0
 */

// Main plugin class
class QuitOS_Product_Database {
    
    private $api_base_url;
    
    public function __construct() {
        $this->api_base_url = get_option('quitos_api_url', 'https://api.quit-os.com');
        
        add_action('init', array($this, 'init'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_scripts'));
        add_action('rest_api_init', array($this, 'register_endpoints'));
        add_shortcode('product_upload', array($this, 'render_product_upload'));
        add_shortcode('retailer_inventory', array($this, 'render_retailer_inventory'));
        add_shortcode('product_search', array($this, 'render_product_search'));
    }
    
    public function init() {
        // Add custom user roles
        $this->setup_user_roles();
        
        // Add user type field
        add_action('show_user_profile', array($this, 'add_user_type_field'));
        add_action('edit_user_profile', array($this, 'add_user_type_field'));
        add_action('personal_options_update', array($this, 'save_user_type_field'));
        add_action('edit_user_profile_update', array($this, 'save_user_type_field'));
    }
    
    private function setup_user_roles() {
        // Manufacturer role
        add_role('manufacturer', 'Manufacturer', array(
            'read' => true,
            'upload_files' => true,
            'edit_posts' => false,
            'publish_posts' => false
        ));
        
        // Retailer role
        add_role('retailer', 'Retailer', array(
            'read' => true,
            'upload_files' => true,
            'edit_posts' => false,
            'publish_posts' => false
        ));
    }
    
    public function add_user_type_field($user) {
        $user_type = get_user_meta($user->ID, 'user_type', true);
        ?>
        <h3>Product Database Access</h3>
        <table class="form-table">
            <tr>
                <th><label for="user_type">User Type</label></th>
                <td>
                    <select name="user_type" id="user_type">
                        <option value="consumer" <?php selected($user_type, 'consumer'); ?>>Consumer</option>
                        <option value="manufacturer" <?php selected($user_type, 'manufacturer'); ?>>Manufacturer</option>
                        <option value="retailer" <?php selected($user_type, 'retailer'); ?>>Retailer</option>
                    </select>
                </td>
            </tr>
            <?php if ($user_type === 'manufacturer' || $user_type === 'retailer'): ?>
            <tr>
                <th><label for="company_name">Company Name</label></th>
                <td>
                    <input type="text" name="company_name" id="company_name" 
                           value="<?php echo esc_attr(get_user_meta($user->ID, 'company_name', true)); ?>" 
                           class="regular-text" />
                </td>
            </tr>
            <tr>
                <th><label for="license_number">License Number</label></th>
                <td>
                    <input type="text" name="license_number" id="license_number" 
                           value="<?php echo esc_attr(get_user_meta($user->ID, 'license_number', true)); ?>" 
                           class="regular-text" />
                </td>
            </tr>
            <?php endif; ?>
        </table>
        <?php
    }
    
    public function save_user_type_field($user_id) {
        if (!current_user_can('edit_user', $user_id)) {
            return false;
        }
        
        update_user_meta($user_id, 'user_type', $_POST['user_type']);
        update_user_meta($user_id, 'company_name', $_POST['company_name']);
        update_user_meta($user_id, 'license_number', $_POST['license_number']);
        
        // Sync with product database
        $this->sync_user_with_product_db($user_id);
    }
    
    private function sync_user_with_product_db($user_id) {
        $user_type = get_user_meta($user_id, 'user_type', true);
        $company_name = get_user_meta($user_id, 'company_name', true);
        $license_number = get_user_meta($user_id, 'license_number', true);
        
        if ($user_type === 'manufacturer' || $user_type === 'retailer') {
            $endpoint = $user_type === 'manufacturer' ? '/api/manufacturers' : '/api/retailers';
            
            $response = wp_remote_post($this->api_base_url . $endpoint, array(
                'headers' => array(
                    'Content-Type' => 'application/json',
                    'Authorization' => 'Bearer ' . $this->get_api_token()
                ),
                'body' => json_encode(array(
                    'wp_user_id' => $user_id,
                    'company_name' => $company_name,
                    'license_number' => $license_number,
                    'contact_email' => get_userdata($user_id)->user_email
                ))
            ));
        }
    }
    
    // Generate JWT token for API authentication
    private function get_api_token() {
        $user_id = get_current_user_id();
        
        $payload = array(
            'user_id' => $user_id,
            'exp' => time() + 3600 // 1 hour expiration
        );
        
        return $this->generate_jwt($payload, get_option('quitos_jwt_secret'));
    }
    
    private function generate_jwt($payload, $secret) {
        $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
        $payload = json_encode($payload);
        
        $base64Header = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
        $base64Payload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($payload));
        
        $signature = hash_hmac('sha256', $base64Header . "." . $base64Payload, $secret, true);
        $base64Signature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
        
        return $base64Header . "." . $base64Payload . "." . $base64Signature;
    }
    
    // Manufacturer product upload interface
    public function render_product_upload() {
        if (!is_user_logged_in() || get_user_meta(get_current_user_id(), 'user_type', true) !== 'manufacturer') {
            return '<div class="alert alert-warning">Only verified manufacturers can upload products.</div>';
        }
        
        ob_start();
        ?>
        <div id="product-upload-form">
            <h3>Add New Product</h3>
            <form id="quitos-product-form">
                <div class="form-group">
                    <label>Product Name *</label>
                    <input type="text" name="product_name" required class="form-control">
                </div>
                
                <div class="form-group">
                    <label>SKU *</label>
                    <input type="text" name="sku" required class="form-control">
                </div>
                
                <div class="form-group">
                    <label>Category *</label>
                    <select name="category_id" required class="form-control">
                        <option value="">Select Category</option>
                        <option value="1">E-Cigarettes/Vapes</option>
                        <option value="2">Nicotine Pouches</option>
                        <option value="3">Lozenges</option>
                        <option value="4">Gum</option>
                        <option value="5">Patches</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Nicotine Strength (mg)</label>
                    <input type="number" name="nicotine_strength" step="0.1" class="form-control">
                </div>
                
                <div class="form-group">
                    <label>Volume (ml)</label>
                    <input type="number" name="volume_ml" step="0.1" class="form-control">
                </div>
                
                <div class="form-group">
                    <label>Flavor</label>
                    <input type="text" name="flavor" class="form-control">
                </div>
                
                <div class="form-group">
                    <label>Description</label>
                    <textarea name="description" rows="4" class="form-control"></textarea>
                </div>
                
                <div class="form-group">
                    <label>Ingredients *</label>
                    <textarea name="ingredients" rows="3" required class="form-control"></textarea>
                </div>
                
                <div class="form-group">
                    <label>Warnings *</label>
                    <textarea name="warnings" rows="3" required class="form-control"></textarea>
                </div>
                
                <div class="form-group">
                    <label>Product Images</label>
                    <input type="file" name="product_images" multiple accept="image/*" class="form-control">
                    <div id="image-preview"></div>
                </div>
                
                <button type="submit" class="btn btn-primary">Add Product</button>
            </form>
            
            <hr>
            
            <h3>My Products</h3>
            <div id="manufacturer-products-list">
                <!-- Products will be loaded here -->
            </div>
        </div>
        
        <script>
        jQuery(document).ready(function($) {
            // Load manufacturer products
            loadManufacturerProducts();
            
            // Handle form submission
            $('#quitos-product-form').on('submit', function(e) {
                e.preventDefault();
                
                const formData = new FormData(this);
                const productData = {};
                
                // Convert FormData to object
                for (let [key, value] of formData.entries()) {
                    if (key !== 'product_images') {
                        productData[key] = value;
                    }
                }
                
                // Handle image uploads
                const imageFiles = formData.getAll('product_images');
                if (imageFiles.length > 0) {
                    uploadImages(imageFiles).then(urls => {
                        productData.image_urls = urls;
                        submitProduct(productData);
                    });
                } else {
                    submitProduct(productData);
                }
            });
            
            function uploadImages(files) {
                // Upload to WordPress media library
                const promises = Array.from(files).map(file => {
                    const data = new FormData();
                    data.append('action', 'upload-attachment');
                    data.append('file', file);
                    data.append('_wpnonce', '<?php echo wp_create_nonce('media-form'); ?>');
                    
                    return $.ajax({
                        url: '<?php echo admin_url('admin-ajax.php'); ?>',
                        type: 'POST',
                        data: data,
                        processData: false,
                        contentType: false
                    }).then(response => response.data.url);
                });
                
                return Promise.all(promises);
            }
            
            function submitProduct(productData) {
                $.ajax({
                    url: '<?php echo home_url('/wp-json/quitos/v1/products'); ?>',
                    method: 'POST',
                    headers: {
                        'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>'
                    },
                    data: JSON.stringify(productData),
                    contentType: 'application/json',
                    success: function(response) {
                        alert('Product added successfully!');
                        $('#quitos-product-form')[0].reset();
                        loadManufacturerProducts();
                    },
                    error: function(xhr) {
                        alert('Error: ' + xhr.responseJSON.message);
                    }
                });
            }
            
            function loadManufacturerProducts() {
                $.ajax({
                    url: '<?php echo home_url('/wp-json/quitos/v1/manufacturer/products'); ?>',
                    headers: {
                        'X-WP-Nonce': '<?php echo wp_create_nonce('wp_rest'); ?>'
                    },
                    success: function(products) {
                        let html = '<div class="products-grid">';
                        products.forEach(product => {
                            html += `
                                <div class="product-card">
                                    <h4>${product.product_name}</h4>
                                    <p>SKU: ${product.sku}</p>
                                    <p>Status: ${product.status}</p>
                                    <button class="btn btn-sm btn-secondary" 
                                            onclick="addBatch(${product.id})">
                                        Add Batch
                                    </button>
                                </div>
                            `;
                        });
                        html += '</div>';
                        $('#manufacturer-products-list').html(html);
                    }
                });
            }
        });
        
        function addBatch(productId) {
            // Open batch creation modal
            // Implementation depends on your UI framework
        }
        </script>
        <?php
        return ob_get_clean();
    }
    
    // Consumer search interface
    public function render_product_search() {
        ob_start();
        ?>
        <div id="product-search">
            <div class="search-bar">
                <input type="text" id="search-input" placeholder="Search for products..." />
                <button id="search-btn">Search</button>
                <button id="use-location">Use My Location</button>
            </div>
            
            <div id="search-filters">
                <select id="category-filter">
                    <option value="">All Categories</option>
                    <option value="vapes">E-Cigarettes/Vapes</option>
                    <option value="pouches">Nicotine Pouches</option>
                    <option value="lozenges">Lozenges</option>
                    <option value="gum">Gum</option>
                    <option value="patches">Patches</option>
                </select>
                
                <input type="range" id="radius-filter" min="1" max="50" value="10" />
                <span id="radius-value">10 km</span>
            </div>
            
            <div id="search-results"></div>
            
            <div id="product-map" style="height: 400px; display: none;"></div>
        </div>
        
        <script>
        jQuery(document).ready(function($) {
            let userLocation = null;
            let map = null;
            
            $('#search-btn').on('click', performSearch);
            $('#search-input').on('keypress', function(e) {
                if (e.which === 13) performSearch();
            });
            
            $('#use-location').on('click', function() {
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(function(position) {
                        userLocation = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        };
                        $('#use-location').text('Location Set ✓');
                        performSearch();
                    });
                }
            });
            
            $('#radius-filter').on('input', function() {
                $('#radius-value').text($(this).val() + ' km');
            });
            
            function performSearch() {
                const query = $('#search-input').val();
                if (!query) return;
                
                const params = {
                    q: query,
                    category: $('#category-filter').val(),
                    radius: $('#radius-filter').val()
                };
                
                if (userLocation) {
                    params.location = userLocation;
                }
                
                $.ajax({
                    url: '<?php echo home_url('/wp-json/quitos/v1/search'); ?>',
                    data: params,
                    success: function(response) {
                        displayResults(response.products);
                        if (userLocation && response.products.length > 0) {
                            displayMap(response.products);
                        }
                    }
                });
            }
            
            function displayResults(products) {
                let html = '';
                
                products.forEach(product => {
                    html += `
                        <div class="product-result">
                            <div class="product-info">
                                <h3>${product.product_name}</h3>
                                <p>${product.description || ''}</p>
                                <p>Nicotine: ${product.nicotine_strength}mg | Flavor: ${product.flavor}</p>
                            </div>
                            <div class="retailer-list">
                                <h4>Available at:</h4>
                    `;
                    
                    product.retailers.forEach(retailer => {
                        html += `
                            <div class="retailer-item">
                                <strong>${retailer.store_name}</strong>
                                <p>${retailer.address}</p>
                                <p class="price">$${retailer.price}</p>
                                <p class="stock-status">${retailer.in_stock ? 'In Stock' : 'Out of Stock'}</p>
                                <button class="trace-btn" 
                                        onclick="traceBatch('${retailer.batch_info.batch_number}')">
                                    Trace Product
                                </button>
                            </div>
                        `;
                    });
                    
                    html += '</div></div>';
                });
                
                $('#search-results').html(html);
            }
            
            function displayMap(products) {
                $('#product-map').show();
                
                if (!map) {
                    map = L.map('product-map').setView([userLocation.lat, userLocation.lng], 13);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                }
                
                // Clear existing markers
                map.eachLayer(layer => {
                    if (layer instanceof L.Marker) {
                        map.removeLayer(layer);
                    }
                });
                
                // Add user location
                L.marker([userLocation.lat, userLocation.lng], {
                    icon: L.icon({
                        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
                        iconSize: [25, 41]
                    })
                }).addTo(map).bindPopup('Your Location');
                
                // Add retailer markers
                const addedLocations = new Set();
                
                products.forEach(product => {
                    product.retailers.forEach(retailer => {
                        const key = `${retailer.latitude},${retailer.longitude}`;
                        if (!addedLocations.has(key)) {
                            addedLocations.add(key);
                            
                            L.marker([retailer.latitude, retailer.longitude])
                                .addTo(map)
                                .bindPopup(`
                                    <strong>${retailer.store_name}</strong><br>
                                    ${retailer.address}<br>
                                    <a href="https://maps.google.com/?q=${retailer.latitude},${retailer.longitude}" 
                                       target="_blank">Get Directions</a>
                                `);
                        }
                    });
                });
            }
        });
        
        function traceBatch(batchNumber) {
            window.open('<?php echo home_url('/trace?batch='); ?>' + batchNumber, '_blank');
        }
        </script>
        <?php
        return ob_get_clean();
    }
    
    // REST API endpoints
    public function register_endpoints() {
        // Product submission endpoint
        register_rest_route('quitos/v1', '/products', array(
            'methods' => 'POST',
            'callback' => array($this, 'handle_product_submission'),
            'permission_callback' => array($this, 'check_manufacturer_permission')
        ));
        
        // Search endpoint
        register_rest_route('quitos/v1', '/search', array(
            'methods' => 'GET',
            'callback' => array($this, 'handle_search'),
            'permission_callback' => '__return_true'
        ));
        
        // Manufacturer products
        register_rest_route('quitos/v1', '/manufacturer/products', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_manufacturer_products'),
            'permission_callback' => array($this, 'check_manufacturer_permission')
        ));
    }
    
    public function handle_product_submission($request) {
        $params = $request->get_json_params();
        
        // Forward to product API
        $response = wp_remote_post($this->api_base_url . '/api/products', array(
            'headers' => array(
                'Content-Type' => 'application/json',
                'Authorization' => 'Bearer ' . $this->get_api_token()
            ),
            'body' => json_encode($params)
        ));
        
        if (is_wp_error($response)) {
            return new WP_Error('api_error', 'Failed to create product', array('status' => 500));
        }
        
        $body = wp_remote_retrieve_body($response);
        return json_decode($body, true);
    }
    
    public function handle_search($request) {
        $params = array(
            'q' => $request->get_param('q'),
            'location' => $request->get_param('location'),
            'radius' => $request->get_param('radius') ?: 10
        );
        
        $query_string = http_build_query($params);
        
        $response = wp_remote_get($this->api_base_url . '/api/search/products?' . $query_string);
        
        if (is_wp_error($response)) {
            return new WP_Error('api_error', 'Search failed', array('status' => 500));
        }
        
        $body = wp_remote_retrieve_body($response);
        return json_decode($body, true);
    }
    
    public function get_manufacturer_products($request) {
        $response = wp_remote_get($this->api_base_url . '/api/manufacturer/products', array(
            'headers' => array(
                'Authorization' => 'Bearer ' . $this->get_api_token()
            )
        ));
        
        if (is_wp_error($response)) {
            return new WP_Error('api_error', 'Failed to fetch products', array('status' => 500));
        }
        
        $body = wp_remote_retrieve_body($response);
        return json_decode($body, true);
    }
    
    public function check_manufacturer_permission() {
        return is_user_logged_in() && 
               get_user_meta(get_current_user_id(), 'user_type', true) === 'manufacturer';
    }
    
    public function enqueue_scripts() {
        if (is_page(['products', 'search', 'inventory'])) {
            wp_enqueue_script(
                'quitos-product-db',
                plugin_dir_url(__FILE__) . 'assets/product-db.js',
                array('jquery'),
                '1.0.0',
                true
            );
            
            wp_enqueue_style(
                'quitos-product-db',
                plugin_dir_url(__FILE__) . 'assets/product-db.css',
                array(),
                '1.0.0'
            );
            
            // Enqueue Leaflet for maps
            wp_enqueue_script('leaflet', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
            wp_enqueue_style('leaflet', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
        }
    }
}

// Initialize plugin
new QuitOS_Product_Database();