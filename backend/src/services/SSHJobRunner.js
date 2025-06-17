import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { getDatabase } from '../database/init.js';
import { SSHService } from './SSHService.js';
import { NotificationService } from './NotificationService.js';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

export class SSHJobRunner {
  constructor() {
    this.sshService = new SSHService();
    this.notificationService = new NotificationService();
  }

  /**
   * Execute an SSH job
   * @param {string} jobId - ID of the job to run
   * @returns {Promise<void>}
   */
  async runJob(jobId) {
    const db = getDatabase();
    
    // Get job details
    const jobStmt = db.prepare('SELECT * FROM jobs WHERE id = ? AND status = ? AND job_type = ?');
    const job = jobStmt.get(jobId, 'active', 'ssh');
    
    if (!job) {
      throw new Error('SSH job not found or inactive');
    }

    // Get SSH hosts for this job
    const hostsStmt = db.prepare('SELECT * FROM ssh_hosts WHERE job_id = ?');
    const hosts = hostsStmt.all(jobId);
    
    if (hosts.length === 0) {
      throw new Error('No SSH hosts configured for this job');
    }

    // Get job whitelist
    const whitelistStmt = db.prepare('SELECT mac_address FROM job_whitelist WHERE job_id = ?');
    const whitelist = new Set(whitelistStmt.all(jobId).map(row => row.mac_address));

    logger.info(`Starting SSH job: ${job.name} (${jobId}) with ${hosts.length} hosts`);

    // Create job run record
    const runId = uuidv4();
    const createRunStmt = db.prepare(`
      INSERT INTO job_runs (id, job_id, status, started_at)
      VALUES (?, ?, 'running', CURRENT_TIMESTAMP)
    `);
    createRunStmt.run(runId, jobId);

    // Update job status
    const updateJobStmt = db.prepare('UPDATE jobs SET status = ?, last_run = CURRENT_TIMESTAMP WHERE id = ?');
    updateJobStmt.run('running', jobId);

    const startTime = Date.now();
    let allDevices = [];
    let totalDevicesFound = 0;
    let errors = [];

    try {
      // Execute MAC address table collection on all hosts
      for (const host of hosts) {
        try {
          logger.info(`Collecting MAC table from ${host.hostname} (${host.ip_address})`);
          
          const devices = await this.sshService.getMacAddressTable(host, job.vlan_id);
          allDevices = allDevices.concat(devices);
          totalDevicesFound += devices.length;
          
          logger.info(`Found ${devices.length} devices on ${host.hostname}`);
        } catch (error) {
          logger.error(`Failed to collect from ${host.hostname}:`, error.message);
          errors.push(`${host.hostname}: ${error.message}`);
        }
      }

      // Process discovered devices
      const result = await this._processDevices(jobId, allDevices, whitelist, job);
      
      // Update job run with results
      const duration = Math.floor((Date.now() - startTime) / 1000);
      const updateRunStmt = db.prepare(`
        UPDATE job_runs 
        SET status = 'completed', finished_at = CURRENT_TIMESTAMP, duration = ?,
            devices_found = ?, new_devices = ?, warnings = ?, output = ?
        WHERE id = ?
      `);
      
      const output = errors.length > 0 ? `Errors: ${errors.join('; ')}` : 'Success';
      updateRunStmt.run(duration, result.devicesFound, result.newDevices, result.warnings, output, runId);

      // Update job status back to active
      const resetJobStmt = db.prepare('UPDATE jobs SET status = ? WHERE id = ?');
      resetJobStmt.run('active', jobId);

      logger.info(`SSH job completed: ${job.name} - Found ${result.devicesFound} devices, ${result.newDevices} new, ${result.warnings} warnings`);

    } catch (error) {
      logger.error(`SSH job failed: ${job.name} - ${error.message}`);
      
      // Update job run with error
      const updateRunStmt = db.prepare(`
        UPDATE job_runs 
        SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error_message = ?
        WHERE id = ?
      `);
      updateRunStmt.run(error.message, runId);

      // Update job status back to active
      const resetJobStmt = db.prepare('UPDATE jobs SET status = ? WHERE id = ?');
      resetJobStmt.run('active', jobId);

      throw error;
    }
  }

  /**
   * Process discovered devices and generate notifications
   * @private
   */
  async _processDevices(jobId, devices, whitelist, job) {
    const db = getDatabase();
    let newDevices = 0;
    let warnings = 0;

    // Get currently known devices for this job
    const knownDevicesStmt = db.prepare('SELECT * FROM known_devices WHERE job_id = ?');
    const knownDevices = new Map();
    
    for (const device of knownDevicesStmt.all(jobId)) {
      const key = `${device.mac_address}-${device.hostname}`;
      knownDevices.set(key, device);
    }

    // Process each discovered device
    for (const device of devices) {
      const deviceKey = `${device.mac}-${device.hostname}`;
      const isWhitelisted = whitelist.has(device.mac);
      const existingDevice = knownDevices.get(deviceKey);

      if (!existingDevice) {
        // New device discovered
        newDevices++;
        
        // Add to known devices
        const insertDeviceStmt = db.prepare(`
          INSERT INTO known_devices 
          (id, job_id, mac_address, interface_name, hostname, vendor, whitelisted, first_seen, last_seen, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
        `);
        insertDeviceStmt.run(uuidv4(), jobId, device.mac, device.interface_name, device.hostname, device.vendor, isWhitelisted ? 1 : 0);

        // Generate notification
        if (job.notifications_enabled) {
          if (isWhitelisted && job.notify_new_macs) {
            await this.notificationService.createNotification({
              job_id: jobId,
              job_name: job.name,
              type: 'information',
              message: `New authorized device discovered: ${device.mac} on ${device.hostname}`,
              mac_address: device.mac,
              hostname: device.hostname,
              interface_name: device.interface_name
            });
          } else if (!isWhitelisted && job.notify_unauthorized_macs) {
            warnings++;
            await this.notificationService.createNotification({
              job_id: jobId,
              job_name: job.name,
              type: 'warning',
              message: `Unauthorized device detected: ${device.mac} on ${device.hostname} interface ${device.interface_name}`,
              mac_address: device.mac,
              hostname: device.hostname,
              interface_name: device.interface_name
            });
          }
        }
      } else {
        // Existing device - check for interface changes
        if (existingDevice.interface_name !== device.interface_name && job.notifications_enabled && job.notify_ip_changes) {
          await this.notificationService.createNotification({
            job_id: jobId,
            job_name: job.name,
            type: 'information',
            message: `Device ${device.mac} moved from ${existingDevice.interface_name} to ${device.interface_name} on ${device.hostname}`,
            mac_address: device.mac,
            hostname: device.hostname,
            interface_name: device.interface_name
          });
        }

        // Update last seen and interface
        const updateDeviceStmt = db.prepare(`
          UPDATE known_devices 
          SET interface_name = ?, vendor = ?, last_seen = CURRENT_TIMESTAMP, status = 'active'
          WHERE job_id = ? AND mac_address = ? AND hostname = ?
        `);
        updateDeviceStmt.run(device.interface_name, device.vendor, jobId, device.mac, device.hostname);

        // Remove from knownDevices map to track which devices were not seen
        knownDevices.delete(deviceKey);
      }

      // Add to device history
      const insertHistoryStmt = db.prepare(`
        INSERT INTO device_history (id, job_id, mac_address, interface_name, hostname, vendor, detected_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      insertHistoryStmt.run(uuidv4(), jobId, device.mac, device.interface_name, device.hostname, device.vendor);
    }

    // Mark devices that were not seen as inactive
    for (const [key, device] of knownDevices) {
      const updateInactiveStmt = db.prepare(`
        UPDATE known_devices 
        SET status = 'inactive' 
        WHERE job_id = ? AND mac_address = ? AND hostname = ?
      `);
      updateInactiveStmt.run(jobId, device.mac_address, device.hostname);
    }

    // Apply retention policy
    await this._applyRetentionPolicy(jobId, job);

    return {
      devicesFound: devices.length,
      newDevices,
      warnings
    };
  }

  /**
   * Apply retention policy for inactive devices
   * @private
   */
  async _applyRetentionPolicy(jobId, job) {
    if (job.retention_policy === 'forever') {
      return; // Keep all devices
    }

    const db = getDatabase();

    if (job.retention_policy === 'remove') {
      // Remove inactive devices immediately
      const deleteStmt = db.prepare('DELETE FROM known_devices WHERE job_id = ? AND status = ?');
      deleteStmt.run(jobId, 'inactive');
    } else if (job.retention_policy === 'days') {
      // Remove devices inactive for more than retention_days
      const deleteStmt = db.prepare(`
        DELETE FROM known_devices 
        WHERE job_id = ? AND status = ? 
        AND datetime(last_seen) < datetime('now', '-' || ? || ' days')
      `);
      deleteStmt.run(jobId, 'inactive', job.retention_days);
    }
  }
}