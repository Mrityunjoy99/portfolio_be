import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function setupDatabase() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log('Connecting to PostgreSQL...');
    await client.connect();
    console.log('Connected successfully!');

    // Read and execute schema
    console.log('Setting up database schema...');
    const schemaSQL = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    await client.query(schemaSQL);
    console.log('Schema created successfully!');

    // Read and execute seed data
    console.log('Seeding database...');
    const seedSQL = fs.readFileSync(path.join(__dirname, '../db/seed.sql'), 'utf8');
    await client.query(seedSQL);
    console.log('Database seeded successfully!');

    console.log('Database setup completed!');
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupDatabase();