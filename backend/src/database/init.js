import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', '..', 'database', 'arp_monitoring.db');
const DB_DIR = dirname(DB_PATH);

// Ensure database directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

let db;

export function getDatabase() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export async function initializeDatabase() {
  const database = getDatabase();
  
  // Create tables
  const createTables = `
    -- Jobs table
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'arp-scan', -- 'arp-scan' or 'ssh-mac-table'
      network_interface TEXT,
      subnet TEXT,
      execution_time INTEGER DEFAULT 300,
      schedule TEXT DEFAULT 'manual',
      notifications_enabled BOOLEAN DEFAULT 1,
      notify_new_macs BOOLEAN DEFAULT 1,
      notify_unauthorized_macs BOOLEAN DEFAULT 1,
      notify_ip_changes BOOLEAN DEFAULT 1,
      retention_policy TEXT DEFAULT 'days',
      retention_days INTEGER DEFAULT 30,
      status TEXT DEFAULT 'active',
      vlan_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_run DATETIME,
      next_run DATETIME
    );

    -- Job SSH hosts table (for SSH type jobs)
    CREATE TABLE IF NOT EXISTS job_ssh_hosts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      host_ip TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL, -- Encrypted
      port INTEGER DEFAULT 22,
      interface_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );

    -- Job whitelist table
    CREATE TABLE IF NOT EXISTS job_whitelist (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
      UNIQUE(job_id, mac_address)
    );

    -- Job runs table
    CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      devices_found INTEGER DEFAULT 0,
      new_devices INTEGER DEFAULT 0,
      warnings INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      duration INTEGER,
      output TEXT,
      error_message TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );

    -- Known devices table (one per job)
    CREATE TABLE IF NOT EXISTS known_devices (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      ip_address TEXT,
      vendor TEXT,
      host_ip TEXT, -- For SSH jobs, which host detected this MAC
      interface_name TEXT, -- Interface where MAC was detected
      whitelisted BOOLEAN DEFAULT 0,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
      UNIQUE(job_id, mac_address, host_ip)
    );

    -- Notifications table
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'information', 'warning'
      message TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      ip_address TEXT,
      host_ip TEXT, -- For SSH jobs
      interface_name TEXT, -- For SSH jobs
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read BOOLEAN DEFAULT 0,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );

    -- Device history table for tracking changes
    CREATE TABLE IF NOT EXISTS device_history (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      ip_address TEXT,
      vendor TEXT,
      host_ip TEXT, -- For SSH jobs
      interface_name TEXT, -- For SSH jobs
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );

    -- Indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
    CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(next_run);
    CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_known_devices_job_id ON known_devices(job_id);
    CREATE INDEX IF NOT EXISTS idx_known_devices_mac ON known_devices(mac_address);
    CREATE INDEX IF NOT EXISTS idx_known_devices_host ON known_devices(host_ip);
    CREATE INDEX IF NOT EXISTS idx_notifications_job_id ON notifications(job_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
    CREATE INDEX IF NOT EXISTS idx_device_history_job_id ON device_history(job_id);
    CREATE INDEX IF NOT EXISTS idx_device_history_mac ON device_history(mac_address);
    CREATE INDEX IF NOT EXISTS idx_ssh_hosts_job_id ON job_ssh_hosts(job_id);

    -- Triggers for updating timestamps
    CREATE TRIGGER IF NOT EXISTS update_jobs_timestamp 
      AFTER UPDATE ON jobs
      BEGIN
        UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;

    -- Add new columns to existing tables if they don't exist
    PRAGMA table_info(jobs);
  `;

  try {
    database.exec(createTables);
    
    // Add new columns to existing jobs table if they don't exist
    try {
      database.exec('ALTER TABLE jobs ADD COLUMN type TEXT DEFAULT "arp-scan"');
    } catch (e) {
      // Column already exists
    }
    
    try {
      database.exec('ALTER TABLE jobs ADD COLUMN vlan_id INTEGER');
    } catch (e) {
      // Column already exists
    }

    // Add new columns to known_devices table if they don't exist
    try {
      database.exec('ALTER TABLE known_devices ADD COLUMN host_ip TEXT');
    } catch (e) {
      // Column already exists
    }
    
    try {
      database.exec('ALTER TABLE known_devices ADD COLUMN interface_name TEXT');
    } catch (e) {
      // Column already exists
    }

    // Add new columns to notifications table if they don't exist
    try {
      database.exec('ALTER TABLE notifications ADD COLUMN host_ip TEXT');
    } catch (e) {
      // Column already exists
    }
    
    try {
      database.exec('ALTER TABLE notifications ADD COLUMN interface_name TEXT');
    } catch (e) {
      // Column already exists
    }

    // Add new columns to device_history table if they don't exist
    try {
      database.exec('ALTER TABLE device_history ADD COLUMN host_ip TEXT');
    } catch (e) {
      // Column already exists
    }
    
    try {
      database.exec('ALTER TABLE device_history ADD COLUMN interface_name TEXT');
    } catch (e) {
      // Column already exists
    }

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}