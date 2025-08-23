import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function migrateAnalytics() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔗 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!');

    // Read and execute analytics migration
    console.log('📊 Running analytics migration...');
    const migrationSQL = fs.readFileSync(path.join(__dirname, '../db/migration-analytics.sql'), 'utf8');
    await client.query(migrationSQL);
    console.log('✅ Analytics tables created successfully!');

    // Verify tables were created
    console.log('🔍 Verifying analytics tables...');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('visitor_analytics', 'page_views', 'user_events', 'performance_metrics')
      ORDER BY table_name;
    `);
    
    const createdTables = tablesResult.rows.map(row => row.table_name);
    console.log('📋 Created tables:', createdTables);
    
    if (createdTables.length === 4) {
      console.log('🎉 Analytics migration completed successfully!');
      console.log('');
      console.log('📊 Analytics tables ready:');
      console.log('   • visitor_analytics - Main session tracking');
      console.log('   • page_views - Page view events');
      console.log('   • user_events - User interaction events');
      console.log('   • performance_metrics - Performance tracking');
      console.log('');
      console.log('🚀 You can now start tracking visitor analytics!');
    } else {
      throw new Error(`Expected 4 tables, but only ${createdTables.length} were created.`);
    }
    
  } catch (error) {
    console.error('❌ Analytics migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrateAnalytics();