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
    -- Jobs table (updated to support both ARP and SSH job types)
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      job_type TEXT NOT NULL DEFAULT 'arp-scan', -- 'arp-scan' or 'ssh'
      network_interface TEXT, -- Only for ARP jobs
      subnet TEXT, -- Only for ARP jobs
      execution_time INTEGER DEFAULT 300, -- Only for ARP jobs
      vlan_id TEXT, -- Only for SSH jobs
      schedule TEXT DEFAULT 'manual',
      notifications_enabled BOOLEAN DEFAULT 1,
      notify_new_macs BOOLEAN DEFAULT 1,
      notify_unauthorized_macs BOOLEAN DEFAULT 1,
      notify_ip_changes BOOLEAN DEFAULT 1,
      retention_policy TEXT DEFAULT 'days',
      retention_days INTEGER DEFAULT 30,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_run DATETIME,
      next_run DATETIME
    );

    -- SSH hosts table (for SSH job types)
    CREATE TABLE IF NOT EXISTS ssh_hosts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      password TEXT NOT NULL, -- Encrypted
      connection_status TEXT DEFAULT 'unknown', -- 'connected', 'failed', 'unknown'
      last_tested DATETIME,
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

    -- Known devices table (updated to support SSH job data)
    CREATE TABLE IF NOT EXISTS known_devices (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      ip_address TEXT, -- Only for ARP jobs
      interface_name TEXT, -- For SSH jobs (switch interface)
      hostname TEXT, -- For SSH jobs (which host detected it)
      vendor TEXT,
      whitelisted BOOLEAN DEFAULT 0,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
      UNIQUE(job_id, mac_address, hostname)
    );

    -- Notifications table
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'information', 'warning'
      message TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      ip_address TEXT, -- May be null for SSH jobs
      hostname TEXT, -- For SSH jobs
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
      interface_name TEXT,
      hostname TEXT,
      vendor TEXT,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );

    -- SSH console sessions table (for console feature)
    CREATE TABLE IF NOT EXISTS ssh_console_sessions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      command TEXT NOT NULL,
      output TEXT,
      status TEXT DEFAULT 'pending', -- 'pending', 'success', 'failed'
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
      FOREIGN KEY (host_id) REFERENCES ssh_hosts (id) ON DELETE CASCADE
    );

    -- Indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);
    CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(next_run);
    CREATE INDEX IF NOT EXISTS idx_ssh_hosts_job_id ON ssh_hosts(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_known_devices_job_id ON known_devices(job_id);
    CREATE INDEX IF NOT EXISTS idx_known_devices_mac ON known_devices(mac_address);
    CREATE INDEX IF NOT EXISTS idx_known_devices_hostname ON known_devices(hostname);
    CREATE INDEX IF NOT EXISTS idx_notifications_job_id ON notifications(job_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
    CREATE INDEX IF NOT EXISTS idx_device_history_job_id ON device_history(job_id);
    CREATE INDEX IF NOT EXISTS idx_device_history_mac ON device_history(mac_address);
    CREATE INDEX IF NOT EXISTS idx_ssh_console_job_id ON ssh_console_sessions(job_id);

    -- Triggers for updating timestamps
    CREATE TRIGGER IF NOT EXISTS update_jobs_timestamp 
      AFTER UPDATE ON jobs
      BEGIN
        UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;

    -- Add job_type column if it doesn't exist (migration)
    PRAGMA table_info(jobs);
  `;

  try {
    database.exec(createTables);
    
    // Check if job_type column exists, if not add it
    const tableInfo = database.prepare("PRAGMA table_info(jobs)").all();
    const hasJobType = tableInfo.some(column => column.name === 'job_type');
    
    if (!hasJobType) {
      database.exec("ALTER TABLE jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'arp-scan'");
      console.log('Added job_type column to jobs table');
    }

    // Check if vlan_id column exists, if not add it
    const hasVlanId = tableInfo.some(column => column.name === 'vlan_id');
    
    if (!hasVlanId) {
      database.exec("ALTER TABLE jobs ADD COLUMN vlan_id TEXT");
      console.log('Added vlan_id column to jobs table');
    }

    // Check if new columns exist in known_devices table
    const deviceTableInfo = database.prepare("PRAGMA table_info(known_devices)").all();
    const hasInterfaceName = deviceTableInfo.some(column => column.name === 'interface_name');
    const hasHostname = deviceTableInfo.some(column => column.name === 'hostname');
    
    if (!hasInterfaceName) {
      database.exec("ALTER TABLE known_devices ADD COLUMN interface_name TEXT");
      console.log('Added interface_name column to known_devices table');
    }
    
    if (!hasHostname) {
      database.exec("ALTER TABLE known_devices ADD COLUMN hostname TEXT");
      console.log('Added hostname column to known_devices table');
    }

    // Check if new columns exist in notifications table
    const notificationTableInfo = database.prepare("PRAGMA table_info(notifications)").all();
    const hasNotificationHostname = notificationTableInfo.some(column => column.name === 'hostname');
    const hasNotificationInterface = notificationTableInfo.some(column => column.name === 'interface_name');
    
    if (!hasNotificationHostname) {
      database.exec("ALTER TABLE notifications ADD COLUMN hostname TEXT");
      console.log('Added hostname column to notifications table');
    }
    
    if (!hasNotificationInterface) {
      database.exec("ALTER TABLE notifications ADD COLUMN interface_name TEXT");
      console.log('Added interface_name column to notifications table');
    }

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}