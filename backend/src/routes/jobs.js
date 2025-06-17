import express from 'express';
import { Job } from '../models/Job.js';
import { JobRunner } from '../services/JobRunner.js';
import { getDatabase } from '../database/init.js';
import { NetworkService } from '../services/NetworkService.js';
import { SSHService } from '../services/SSHService.js';
import { EncryptionService } from '../services/EncryptionService.js';

const router = express.Router();
const jobRunner = new JobRunner();
const sshService = new SSHService();

// Get all jobs
router.get('/', async (req, res) => {
  try {
    const jobs = await Job.findAll();
    res.json(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ message: 'Failed to fetch jobs' });
  }
});

// Get job by ID
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }
    res.json(job);
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ message: 'Failed to fetch job' });
  }
});

// Create new job
router.post('/', async (req, res) => {
  try {
    const { name, job_type } = req.body;
    
    if (!name) {
      return res.status(400).json({ message: 'Job name is required' });
    }

    if (!job_type) {
      return res.status(400).json({ message: 'Job type is required' });
    }

    // Validate based on job type
    if (job_type === 'arp-scan') {
      const { network_interface, subnet } = req.body;
      
      if (!network_interface || !subnet) {
        return res.status(400).json({ message: 'Network interface and subnet are required for ARP scan jobs' });
      }

      // Validate interface and subnet compatibility
      const isValid = await NetworkService.validateInterfaceSubnet(network_interface, subnet);
      if (!isValid) {
        return res.status(400).json({ 
          message: 'Network interface does not have an IP address in the specified subnet' 
        });
      }
    } else if (job_type === 'ssh') {
      const { ssh_hosts } = req.body;
      
      if (!ssh_hosts || ssh_hosts.length === 0) {
        return res.status(400).json({ message: 'At least one SSH host is required for SSH jobs' });
      }

      // Validate SSH hosts
      for (const host of ssh_hosts) {
        if (!host.hostname || !host.ip_address || !host.username || !host.password) {
          return res.status(400).json({ 
            message: 'Hostname, IP address, username, and password are required for all SSH hosts' 
          });
        }
      }
    }

    const job = new Job(req.body);
    await job.save();
    
    res.status(201).json({ message: 'Job created successfully', id: job.id });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ message: 'Failed to create job' });
  }
});

// Update job
router.put('/:id', async (req, res) => {
  try {
    const existingJob = await Job.findById(req.params.id);
    if (!existingJob) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // Validate based on job type (job type cannot be changed)
    const jobType = existingJob.job_type;
    
    if (jobType === 'arp-scan') {
      const { network_interface, subnet } = req.body;
      if (network_interface && subnet) {
        const isValid = await NetworkService.validateInterfaceSubnet(network_interface, subnet);
        if (!isValid) {
          return res.status(400).json({ 
            message: 'Network interface does not have an IP address in the specified subnet' 
          });
        }
      }
    } else if (jobType === 'ssh') {
      const { ssh_hosts } = req.body;
      if (ssh_hosts && ssh_hosts.length > 0) {
        // Validate SSH hosts
        for (const host of ssh_hosts) {
          if (!host.hostname || !host.ip_address || !host.username || !host.password) {
            return res.status(400).json({ 
              message: 'Hostname, IP address, username, and password are required for all SSH hosts' 
            });
          }
        }
      }
    }

    const job = new Job({ ...existingJob, ...req.body, id: req.params.id, job_type: jobType });
    await job.save();

    // Update whitelist status for known devices
    await updateDeviceWhitelistStatus(req.params.id, job.whitelist);
    
    res.json({ message: 'Job updated successfully' });
  } catch (error) {
    console.error('Error updating job:', error);
    res.status(500).json({ message: 'Failed to update job' });
  }
});

// Delete job
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Job.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Job not found' });
    }
    
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    console.error('Error deleting job:', error);
    res.status(500).json({ message: 'Failed to delete job' });
  }
});

// Run job manually
router.post('/:id/run', async (req, res) => {
  try {
    if (jobRunner.isJobRunning(req.params.id)) {
      return res.status(409).json({ message: 'Job is already running' });
    }

    // Start job asynchronously
    jobRunner.runJob(req.params.id).catch(error => {
      console.error(`Job ${req.params.id} failed:`, error);
    });
    
    res.json({ message: 'Job started successfully' });
  } catch (error) {
    console.error('Error starting job:', error);
    res.status(500).json({ message: 'Failed to start job' });
  }
});

// Test SSH connection
router.post('/:id/test-ssh', async (req, res) => {
  try {
    const { hostId } = req.body;
    
    if (!hostId) {
      return res.status(400).json({ message: 'Host ID is required' });
    }

    const db = getDatabase();
    const hostStmt = db.prepare('SELECT * FROM ssh_hosts WHERE id = ? AND job_id = ?');
    const host = hostStmt.get(hostId, req.params.id);
    
    if (!host) {
      return res.status(404).json({ message: 'SSH host not found' });
    }

    const success = await sshService.testConnection(host);
    
    // Update connection status
    const updateStmt = db.prepare('UPDATE ssh_hosts SET connection_status = ?, last_tested = CURRENT_TIMESTAMP WHERE id = ?');
    updateStmt.run(success ? 'connected' : 'failed', hostId);
    
    res.json({ 
      success, 
      message: success ? 'Connection successful' : 'Connection failed',
      hostname: host.hostname,
      ip_address: host.ip_address
    });
  } catch (error) {
    console.error('Error testing SSH connection:', error);
    res.status(500).json({ message: 'Failed to test SSH connection' });
  }
});

// Execute SSH command (for console feature)
router.post('/:id/ssh-command', async (req, res) => {
  try {
    const { hostId, command } = req.body;
    
    if (!hostId || !command) {
      return res.status(400).json({ message: 'Host ID and command are required' });
    }

    const db = getDatabase();
    const hostStmt = db.prepare('SELECT * FROM ssh_hosts WHERE id = ? AND job_id = ?');
    const host = hostStmt.get(hostId, req.params.id);
    
    if (!host) {
      return res.status(404).json({ message: 'SSH host not found' });
    }

    const result = await sshService.executeCommand(host, command);
    
    // Save command to console sessions
    const sessionStmt = db.prepare(`
      INSERT INTO ssh_console_sessions (id, job_id, host_id, command, output, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const sessionId = require('uuid').v4();
    sessionStmt.run(
      sessionId, 
      req.params.id, 
      hostId, 
      command, 
      result.stdout || result.stderr, 
      result.code === 0 ? 'success' : 'failed'
    );
    
    res.json({
      success: result.code === 0,
      output: result.stdout,
      error: result.stderr,
      code: result.code,
      sessionId
    });
  } catch (error) {
    console.error('Error executing SSH command:', error);
    res.status(500).json({ message: 'Failed to execute SSH command', error: error.message });
  }
});

// Get SSH console sessions
router.get('/:id/console-sessions', async (req, res) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT s.*, h.hostname, h.ip_address 
      FROM ssh_console_sessions s
      JOIN ssh_hosts h ON s.host_id = h.id
      WHERE s.job_id = ? 
      ORDER BY s.executed_at DESC 
      LIMIT 50
    `);
    
    const sessions = stmt.all(req.params.id);
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching console sessions:', error);
    res.status(500).json({ message: 'Failed to fetch console sessions' });
  }
});

// Get job runs
router.get('/:id/runs', async (req, res) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM job_runs 
      WHERE job_id = ? 
      ORDER BY started_at DESC 
      LIMIT 50
    `);
    
    const runs = stmt.all(req.params.id);
    res.json(runs);
  } catch (error) {
    console.error('Error fetching job runs:', error);
    res.status(500).json({ message: 'Failed to fetch job runs' });
  }
});

// Get known devices for job
router.get('/:id/devices', async (req, res) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT * FROM known_devices 
      WHERE job_id = ? 
      ORDER BY last_seen DESC
    `);
    
    const devices = stmt.all(req.params.id);
    res.json(devices);
  } catch (error) {
    console.error('Error fetching known devices:', error);
    res.status(500).json({ message: 'Failed to fetch known devices' });
  }
});

// Remove known device
router.delete('/:id/devices/:deviceId', async (req, res) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare('DELETE FROM known_devices WHERE id = ? AND job_id = ?');
    const result = stmt.run(req.params.deviceId, req.params.id);
    
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Device not found' });
    }
    
    res.json({ message: 'Device removed successfully' });
  } catch (error) {
    console.error('Error removing device:', error);
    res.status(500).json({ message: 'Failed to remove device' });
  }
});

// Helper function to update device whitelist status
async function updateDeviceWhitelistStatus(jobId, whitelist) {
  const db = getDatabase();
  
  // Update all devices to not whitelisted first
  const resetStmt = db.prepare('UPDATE known_devices SET whitelisted = 0 WHERE job_id = ?');
  resetStmt.run(jobId);
  
  // Update whitelisted devices
  if (whitelist && whitelist.length > 0) {
    const updateStmt = db.prepare('UPDATE known_devices SET whitelisted = 1 WHERE job_id = ? AND mac_address = ?');
    for (const mac of whitelist) {
      updateStmt.run(jobId, mac);
    }
  }
}

export default router;