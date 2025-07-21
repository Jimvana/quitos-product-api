# Quit-OS Product API

Node.js API for the Quit-OS Product Database.

## Deployment to Kinsta

This API is designed to be deployed to Kinsta Application Hosting.

### Environment Variables Required:

- `DATABASE_URL` - PostgreSQL connection string (automatically set by Kinsta)
- `PORT` - Server port (automatically set by Kinsta)
- `WP_JWT_SECRET` - WordPress JWT secret for authentication
- `API_KEY` - API key for secure endpoints
- `WORDPRESS_URL` - Your WordPress site URL
- `CORS_ORIGINS` - Allowed origins for CORS

### Build Command:
```
npm install
```

### Start Command:
```
npm start
```
