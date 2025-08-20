import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration optimized for serverless environments
const dbConfig = process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Serverless-optimized pool settings
  max: 5, // Reduced max connections for serverless
  min: 0, // No minimum connections
  idleTimeoutMillis: 10000, // Close idle connections faster (10s)
  connectionTimeoutMillis: 5000, // Increased timeout for initial connection
  acquireTimeoutMillis: 5000, // Timeout for acquiring connection from pool
  // Additional serverless optimizations
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: true, // Allow process to exit when no connections
} : {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'portfolio',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Serverless-optimized pool settings
  max: 5, // Reduced max connections for serverless
  min: 0, // No minimum connections
  idleTimeoutMillis: 10000, // Close idle connections faster (10s)
  connectionTimeoutMillis: 5000, // Increased timeout for initial connection
  acquireTimeoutMillis: 5000, // Timeout for acquiring connection from pool
  // Additional serverless optimizations
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  allowExitOnIdle: true, // Allow process to exit when no connections
};

// Create connection pool
const pool = new Pool(dbConfig);

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Helper function to check if connection is healthy
const isConnectionHealthy = async (client) => {
  try {
    await client.query('SELECT 1');
    return true;
  } catch (error) {
    return false;
  }
};

// Helper function to execute queries with retry mechanism
const query = async (text, params, retryCount = 0) => {
  const maxRetries = 2;
  const start = Date.now();
  
  try {
    // For serverless environments, test the connection first on cold starts
    if (retryCount === 0) {
      const testClient = await pool.connect();
      try {
        const isHealthy = await isConnectionHealthy(testClient);
        if (!isHealthy) {
          console.log('🔄 Unhealthy connection detected, retrying...');
          testClient.release(true); // Force removal of bad connection
          return await query(text, params, 1);
        }
        testClient.release();
      } catch (testError) {
        testClient.release(true); // Force removal of bad connection
        console.log('🔄 Connection test failed, retrying...');
        return await query(text, params, 1);
      }
    }
    
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('📊 Executed query', { 
      text: text, 
      params: params?params:null,
      duration, 
      rows: res.rowCount 
    });
    return res;
  } catch (error) {
    const duration = Date.now() - start;
    console.error('❌ Query error:', { 
      error: error.message, 
      duration, 
      retryCount,
      code: error.code 
    });
    
    // Retry on connection-related errors
    const shouldRetry = retryCount < maxRetries && (
      error.message.includes('Connection terminated') ||
      error.message.includes('connection timeout') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ETIMEDOUT') ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ECONNREFUSED' ||
      error.code === '57P01' // PostgreSQL admin shutdown
    );
    
    if (shouldRetry) {
      console.log(`🔄 Retrying query (attempt ${retryCount + 1}/${maxRetries})...`);
      // Add exponential backoff delay
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      return await query(text, params, retryCount + 1);
    }
    
    throw error;
  }
};

// Helper function to get a client from the pool
const getClient = async () => {
  return await pool.connect();
};

// Helper function for transactions with connection validation
const transaction = async (callback, retryCount = 0) => {
  const maxRetries = 2;
  let client;
  
  try {
    client = await pool.connect();
    
    // Test connection health before starting transaction
    const isHealthy = await isConnectionHealthy(client);
    if (!isHealthy && retryCount < maxRetries) {
      console.log('🔄 Unhealthy transaction connection, retrying...');
      client.release(true); // Force removal of bad connection
      return await transaction(callback, retryCount + 1);
    }
    
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('❌ Rollback error:', rollbackError.message);
      }
    }
    
    // Retry on connection-related errors
    const shouldRetry = retryCount < maxRetries && (
      error.message.includes('Connection terminated') ||
      error.message.includes('connection timeout') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ETIMEDOUT') ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ECONNREFUSED' ||
      error.code === '57P01'
    );
    
    if (shouldRetry) {
      console.log(`🔄 Retrying transaction (attempt ${retryCount + 1}/${maxRetries})...`);
      if (client) client.release(true); // Force removal of bad connection
      // Add exponential backoff delay
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      return await transaction(callback, retryCount + 1);
    }
    
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Test connection function with retry
const testConnection = async (retryCount = 0) => {
  const maxRetries = 3;
  try {
    const result = await query('SELECT NOW() as current_time');
    console.log('🔗 Database connection test successful:', result.rows[0].current_time);
    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', error.message);
    
    if (retryCount < maxRetries) {
      console.log(`🔄 Retrying connection test (attempt ${retryCount + 1}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      return await testConnection(retryCount + 1);
    }
    
    return false;
  }
};

export {
  pool,
  query,
  getClient,
  transaction,
  testConnection
};