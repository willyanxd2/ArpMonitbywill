import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/init.js';

export class Job {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.type = data.type || 'arp-scan'; // 'arp-scan' or 'ssh-mac-table'
    this.network_interface = data.network_interface;
    this.subnet = data.subnet;
    this.execution_time = data.execution_time || 300;
    this.schedule = data.schedule || 'manual';
    this.notifications_enabled = data.notifications_enabled !== false;
    this.notify_new_macs = data.notify_new_macs !== false;
    this.notify_unauthorized_macs = data.notify_unauthorized_macs !== false;
    this.notify_ip_changes = data.notify_ip_changes !== false;
    this.retention_policy = data.retention_policy || 'days';
    this.retention_days = data.retention_days || 30;
    this.status = data.status || 'active';
    this.whitelist = data.whitelist || [];
    
    // SSH specific fields
    this.ssh_hosts = data.ssh_hosts || [];
    this.vlan_id = data.vlan_id;
  }

  async save() {
    const db = getDatabase();
    
    const jobData = {
      id: this.id,
      name: this.name,
      type: this.type,
      network_interface: this.network_interface,
      subnet: this.subnet,
      execution_time: this.execution_time,
      schedule: this.schedule,
      notifications_enabled: this.notifications_enabled ? 1 : 0,
      notify_new_macs: this.notify_new_macs ? 1 : 0,
      notify_unauthorized_macs: this.notify_unauthorized_macs ? 1 : 0,
      notify_ip_changes: this.notify_ip_changes ? 1 : 0,
      retention_policy: this.retention_policy,
      retention_days: this.retention_days,
      status: this.status,
      vlan_id: this.vlan_id
    };

    // Start transaction
    const transaction = db.transaction(() => {
      // Check if job exists
      const existingJob = db.prepare('SELECT id FROM jobs WHERE id = ?').get(this.id);
      
      if (existingJob) {
        // Update existing job - preserve ID
        const stmt = db.prepare(`
          UPDATE jobs SET 
          name = @name, type = @type, network_interface = @network_interface, 
          subnet = @subnet, execution_time = @execution_time, schedule = @schedule, 
          notifications_enabled = @notifications_enabled, notify_new_macs = @notify_new_macs, 
          notify_unauthorized_macs = @notify_unauthorized_macs, notify_ip_changes = @notify_ip_changes, 
          retention_policy = @retention_policy, retention_days = @retention_days, 
          status = @status, vlan_id = @vlan_id, updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `);
        stmt.run(jobData);
      } else {
        // Insert new job
        const stmt = db.prepare(`
          INSERT INTO jobs 
          (id, name, type, network_interface, subnet, execution_time, schedule, notifications_enabled, 
           notify_new_macs, notify_unauthorized_macs, notify_ip_changes, retention_policy, 
           retention_days, status, vlan_id)
          VALUES 
          (@id, @name, @type, @network_interface, @subnet, @execution_time, @schedule, @notifications_enabled,
           @notify_new_macs, @notify_unauthorized_macs, @notify_ip_changes, @retention_policy,
           @retention_days, @status, @vlan_id)
        `);
        stmt.run(jobData);
      }

      // Clear existing whitelist
      const clearWhitelist = db.prepare('DELETE FROM job_whitelist WHERE job_id = ?');
      clearWhitelist.run(this.id);

      // Insert new whitelist entries
      if (this.whitelist && this.whitelist.length > 0) {
        const insertWhitelist = db.prepare(`
          INSERT INTO job_whitelist (id, job_id, mac_address) 
          VALUES (?, ?, ?)
        `);
        
        for (const mac of this.whitelist) {
          insertWhitelist.run(uuidv4(), this.id, mac);
        }
      }

      // Handle SSH hosts for SSH type jobs
      if (this.type === 'ssh-mac-table') {
        // Clear existing SSH hosts
        const clearSshHosts = db.prepare('DELETE FROM job_ssh_hosts WHERE job_id = ?');
        clearSshHosts.run(this.id);

        // Insert new SSH hosts
        if (this.ssh_hosts && this.ssh_hosts.length > 0) {
          const insertSshHost = db.prepare(`
            INSERT INTO job_ssh_hosts (id, job_id, host_ip, username, password, port, interface_name) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          
          for (const host of this.ssh_hosts) {
            insertSshHost.run(
              uuidv4(), 
              this.id, 
              host.host_ip, 
              host.username, 
              host.password, // Will be encrypted in service layer
              host.port || 22,
              host.interface_name
            );
          }
        }
      }
    });

    transaction();
    return this;
  }

  static async findById(id) {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM jobs WHERE id = ?');
    const jobData = stmt.get(id);
    
    if (!jobData) return null;

    // Get whitelist
    const whitelistStmt = db.prepare('SELECT mac_address FROM job_whitelist WHERE job_id = ?');
    const whitelist = whitelistStmt.all(id).map(row => row.mac_address);

    // Get SSH hosts if SSH type job
    let ssh_hosts = [];
    if (jobData.type === 'ssh-mac-table') {
      const sshHostsStmt = db.prepare('SELECT * FROM job_ssh_hosts WHERE job_id = ?');
      ssh_hosts = sshHostsStmt.all(id);
    }

    return {
      ...jobData,
      notifications_enabled: Boolean(jobData.notifications_enabled),
      notify_new_macs: Boolean(jobData.notify_new_macs),
      notify_unauthorized_macs: Boolean(jobData.notify_unauthorized_macs),
      notify_ip_changes: Boolean(jobData.notify_ip_changes),
      whitelist,
      ssh_hosts
    };
  }

  static async findAll() {
    const db = getDatabase();
    const stmt = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');
    const jobs = stmt.all();

    // Get whitelist and SSH hosts for each job
    const whitelistStmt = db.prepare('SELECT mac_address FROM job_whitelist WHERE job_id = ?');
    const sshHostsStmt = db.prepare('SELECT * FROM job_ssh_hosts WHERE job_id = ?');
    
    return jobs.map(job => ({
      ...job,
      notifications_enabled: Boolean(job.notifications_enabled),
      notify_new_macs: Boolean(job.notify_new_macs),
      notify_unauthorized_macs: Boolean(job.notify_unauthorized_macs),
      notify_ip_changes: Boolean(job.notify_ip_changes),
      whitelist: whitelistStmt.all(job.id).map(row => row.mac_address),
      ssh_hosts: job.type === 'ssh-mac-table' ? sshHostsStmt.all(job.id) : []
    }));
  }

  static async delete(id) {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM jobs WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  static async updateStatus(id, status) {
    const db = getDatabase();
    const stmt = db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(status, id);
  }

  static async updateLastRun(id, timestamp = null) {
    const db = getDatabase();
    const stmt = db.prepare('UPDATE jobs SET last_run = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(timestamp || new Date().toISOString(), id);
  }

  static async getScheduledJobs() {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM jobs 
      WHERE status = 'active' 
      AND schedule != 'manual' 
      AND (next_run IS NULL OR next_run <= CURRENT_TIMESTAMP)
    `);
    return stmt.all();
  }
}