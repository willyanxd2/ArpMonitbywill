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

export class SSHService {
  constructor() {
    this.connections = new Map();
  }

  /**
   * Test SSH connection to a host
   * @param {Object} hostConfig - Host configuration
   * @returns {Promise<boolean>} Connection success status
   */
  async testConnection(hostConfig) {
    const { ip_address, port, username, password } = hostConfig;
    
    logger.info(`Testing SSH connection to ${ip_address}:${port}`);
    
    return new Promise((resolve) => {
      const conn = new Client();
      let resolved = false;
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          conn.end();
          logger.warn(`SSH connection timeout to ${ip_address}:${port}`);
          resolve(false);
        }
      }, 10000); // 10 second timeout

      conn.on('ready', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          logger.info(`SSH connection successful to ${ip_address}:${port}`);
          conn.end();
          resolve(true);
        }
      });

      conn.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          logger.error(`SSH connection failed to ${ip_address}:${port}:`, err.message);
          resolve(false);
        }
      });

      try {
        const decryptedPassword = EncryptionService.decrypt(password);
        conn.connect({
          host: ip_address,
          port: port || 22,
          username: username,
          password: decryptedPassword,
          readyTimeout: 10000
        });
      } catch (error) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          logger.error(`SSH connection setup failed to ${ip_address}:${port}:`, error.message);
          resolve(false);
        }
      }
    });
  }

  /**
   * Execute command on SSH host
   * @param {Object} hostConfig - Host configuration
   * @param {string} command - Command to execute
   * @returns {Promise<Object>} Command result
   */
  async executeCommand(hostConfig, command) {
    const { ip_address, port, username, password, hostname } = hostConfig;
    
    logger.info(`Executing SSH command on ${hostname} (${ip_address}): ${command}`);
    
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let resolved = false;
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          conn.end();
          reject(new Error(`Command execution timeout on ${hostname}`));
        }
      }, 30000); // 30 second timeout

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              conn.end();
              reject(err);
            }
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('close', (code, signal) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              conn.end();
              
              logger.info(`Command completed on ${hostname} with code ${code}`);
              resolve({
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code,
                signal
              });
            }
          });

          stream.on('data', (data) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          // Handle --more-- prompts by sending space or enter
          if (command.includes('show mac address-table')) {
            const sendMore = () => {
              if (stdout.includes('--more--')) {
                stream.write(' '); // Send space to continue
                setTimeout(sendMore, 500); // Check again after 500ms
              }
            };
            setTimeout(sendMore, 1000); // Start checking after 1 second
          }
        });
      });

      conn.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          logger.error(`SSH connection error on ${hostname}:`, err.message);
          reject(err);
        }
      });

      try {
        const decryptedPassword = EncryptionService.decrypt(password);
        conn.connect({
          host: ip_address,
          port: port || 22,
          username: username,
          password: decryptedPassword,
          readyTimeout: 10000
        });
      } catch (error) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(error);
        }
      }
    });
  }

  /**
   * Execute MAC address table command and parse results
   * @param {Object} hostConfig - Host configuration
   * @param {string} vlanId - VLAN ID to query
   * @returns {Promise<Array>} Array of discovered devices
   */
  async getMacAddressTable(hostConfig, vlanId) {
    const command = vlanId 
      ? `show mac address-table vlan ${vlanId}`
      : 'show mac address-table';
    
    try {
      const result = await this.executeCommand(hostConfig, command);
      return this.parseMacAddressTable(result.stdout, hostConfig.hostname);
    } catch (error) {
      logger.error(`Failed to get MAC address table from ${hostConfig.hostname}:`, error.message);
      throw error;
    }
  }

  /**
   * Parse MAC address table output
   * @param {string} output - Command output
   * @param {string} hostname - Hostname where command was executed
   * @returns {Array} Array of discovered devices
   */
  parseMacAddressTable(output, hostname) {
    const devices = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Skip header lines and empty lines
      if (line.includes('VlanId') || 
          line.includes('Codes:') || 
          line.includes('---') ||
          line.includes('--more--') ||
          line.trim() === '') {
        continue;
      }

      // Parse MAC address table entry
      // Format: VlanId    Mac Address         Type        Interface
      const parts = line.trim().split(/\s+/);
      
      if (parts.length >= 4) {
        const vlanId = parts[0];
        const macAddress = parts[1];
        const type = parts[2];
        const interfaceName = parts.slice(3).join(' '); // Interface might have spaces

        // Validate MAC address format
        if (this.isValidMAC(macAddress)) {
          devices.push({
            mac: macAddress.toLowerCase(),
            vlan_id: vlanId,
            interface_name: interfaceName,
            hostname: hostname,
            type: type,
            detected_at: new Date().toISOString()
          });
        }
      }
    }

    logger.info(`Parsed ${devices.length} devices from MAC table on ${hostname}`);
    return devices;
  }

  /**
   * Validate MAC address format
   * @param {string} mac - MAC address to validate
   * @returns {boolean} True if valid MAC address
   */
  isValidMAC(mac) {
    const macRegex = /^([0-9a-f]{2}[:-]){5}([0-9a-f]{2})$/i;
    return macRegex.test(mac);
  }

  /**
   * Close all SSH connections
   */
  closeAllConnections() {
    for (const [key, conn] of this.connections) {
      try {
        conn.end();
      } catch (error) {
        logger.warn(`Error closing SSH connection ${key}:`, error.message);
      }
    }
    this.connections.clear();
  }
}