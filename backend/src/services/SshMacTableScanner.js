import { Client } from 'ssh2';
import winston from 'winston';
import { EncryptionService } from './EncryptionService.js';

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

export class SshMacTableScanner {
  constructor() {
    this.isRunning = false;
  }

  async scan(sshHosts, vlanId, timeout = 30) {
    if (this.isRunning) {
      throw new Error('SSH MAC table scan already in progress');
    }

    this.isRunning = true;
    logger.info(`Starting SSH MAC table scan for ${sshHosts.length} hosts, VLAN: ${vlanId || 'all'}`);

    try {
      const allDevices = [];
      
      for (const host of sshHosts) {
        try {
          const devices = await this._scanHost(host, vlanId, timeout);
          allDevices.push(...devices);
        } catch (error) {
          logger.error(`Failed to scan host ${host.host_ip}:`, error.message);
          // Continue with other hosts even if one fails
        }
      }

      logger.info(`SSH MAC table scan completed. Found ${allDevices.length} devices across all hosts`);
      return allDevices;
    } catch (error) {
      logger.error('SSH MAC table scan failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async _scanHost(host, vlanId, timeout) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const devices = [];
      let output = '';

      const timer = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH connection to ${host.host_ip} timed out`));
      }, timeout * 1000);

      conn.on('ready', () => {
        logger.debug(`SSH connection established to ${host.host_ip}`);
        
        // Build command based on VLAN
        const command = vlanId 
          ? `show mac address-table vlan ${vlanId}`
          : 'show mac address-table';

        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            return reject(new Error(`Failed to execute command on ${host.host_ip}: ${err.message}`));
          }

          stream.on('close', (code, signal) => {
            clearTimeout(timer);
            conn.end();
            
            if (code !== 0) {
              return reject(new Error(`Command failed on ${host.host_ip} with exit code ${code}`));
            }

            try {
              const parsedDevices = this._parseOutput(output, host);
              resolve(parsedDevices);
            } catch (error) {
              reject(new Error(`Failed to parse output from ${host.host_ip}: ${error.message}`));
            }
          });

          stream.on('data', (data) => {
            const chunk = data.toString();
            output += chunk;
            
            // Handle --more-- prompt by sending space or enter
            if (chunk.includes('--more--')) {
              stream.write(' '); // Send space to continue
            }
          });

          stream.stderr.on('data', (data) => {
            logger.warn(`SSH stderr from ${host.host_ip}: ${data.toString()}`);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`SSH connection error to ${host.host_ip}: ${err.message}`));
      });

      // Decrypt password before connecting
      const decryptedPassword = EncryptionService.decrypt(host.password);
      
      conn.connect({
        host: host.host_ip,
        port: host.port || 22,
        username: host.username,
        password: decryptedPassword,
        readyTimeout: timeout * 1000
      });
    });
  }

  _parseOutput(output, host) {
    const devices = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip header lines, empty lines, and lines with codes/descriptions
      if (!trimmedLine || 
          trimmedLine.includes('VlanId') || 
          trimmedLine.includes('Mac Address') || 
          trimmedLine.includes('Type') ||
          trimmedLine.includes('Interface') ||
          trimmedLine.includes('Codes:') ||
          trimmedLine.includes('pv <vlan-id>') ||
          trimmedLine.includes('--more--') ||
          trimmedLine.startsWith('Codes:')) {
        continue;
      }

      // Parse MAC table entry
      // Format: VlanId    Mac Address         Type        Interface
      // Example: 200      00:09:0f:09:00:12   dynamic     port-channel4
      const parts = trimmedLine.split(/\s+/);
      
      if (parts.length >= 4) {
        const vlanId = parts[0];
        const macAddress = parts[1];
        const type = parts[2];
        const interfaceName = parts.slice(3).join(' '); // Interface might have spaces

        // Validate MAC address format
        if (this._isValidMAC(macAddress)) {
          const device = {
            mac: macAddress.toLowerCase(),
            vlan_id: vlanId,
            type: type,
            interface_name: interfaceName,
            host_ip: host.host_ip,
            detected_at: new Date().toISOString()
          };

          devices.push(device);
        } else {
          logger.debug(`Invalid MAC address format: ${macAddress} in line: ${trimmedLine}`);
        }
      }
    }

    logger.info(`Parsed ${devices.length} devices from host ${host.host_ip}`);
    return devices;
  }

  _isValidMAC(mac) {
    // MAC address formats: 00:11:22:33:44:55, 00-11-22-33-44-55, 0011.2233.4455
    const macRegex = /^([0-9a-f]{2}[:-]){5}([0-9a-f]{2})$|^([0-9a-f]{4}\.){2}([0-9a-f]{4})$/i;
    return macRegex.test(mac);
  }

  static async testConnection(host) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error('Connection test timed out'));
      }, 10000); // 10 second timeout for test

      conn.on('ready', () => {
        clearTimeout(timer);
        conn.end();
        resolve({ success: true, message: 'Connection successful' });
      });

      conn.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, message: err.message });
      });

      // Decrypt password before connecting
      const decryptedPassword = EncryptionService.decrypt(host.password);
      
      conn.connect({
        host: host.host_ip,
        port: host.port || 22,
        username: host.username,
        password: decryptedPassword,
        readyTimeout: 10000
      });
    });
  }
}