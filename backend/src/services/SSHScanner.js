import { Client } from 'ssh2';
import winston from 'winston';
import crypto from 'crypto';

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

export class SSHScanner {
  constructor() {
    this.isRunning = false;
    this.encryptionKey = process.env.SSH_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(text) {
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedText) {
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Test SSH connection to a host
   */
  async testConnection(host, port, username, password) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('Connection timeout'));
      }, 10000);

      conn.on('ready', () => {
        clearTimeout(timeout);
        logger.info(`SSH connection test successful for ${host}:${port}`);
        conn.end();
        resolve(true);
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(`SSH connection test failed for ${host}:${port}:`, err.message);
        reject(new Error(`Connection failed: ${err.message}`));
      });

      try {
        conn.connect({
          host: host,
          port: port,
          username: username,
          password: password,
          readyTimeout: 10000,
          algorithms: {
            kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1'],
            cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
            hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
          }
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Get available interfaces from a network device via SSH
   */
  async getNetworkInterfaces(host, port, username, password) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('Connection timeout'));
      }, 15000);

      conn.on('ready', () => {
        logger.info(`Getting interfaces from ${host}:${port}`);
        
        conn.exec('show interface brief', (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            return reject(err);
          }

          let output = '';
          
          stream.on('close', (code, signal) => {
            clearTimeout(timeout);
            conn.end();
            
            if (code === 0) {
              try {
                const interfaces = this._parseInterfaces(output);
                resolve(interfaces);
              } catch (parseError) {
                reject(parseError);
              }
            } else {
              reject(new Error(`Command failed with exit code ${code}`));
            }
          });

          stream.on('data', (data) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data) => {
            logger.warn(`SSH stderr: ${data}`);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      conn.connect({
        host: host,
        port: port,
        username: username,
        password: password,
        readyTimeout: 15000
      });
    });
  }

  /**
   * Scan MAC address table via SSH
   */
  async scan(hosts, vlanId = null, timeout = 30) {
    if (this.isRunning) {
      throw new Error('SSH scan already in progress');
    }

    this.isRunning = true;
    logger.info(`Starting SSH MAC table scan for ${hosts.length} hosts${vlanId ? ` on VLAN ${vlanId}` : ''}`);

    try {
      const allDevices = [];
      
      for (const host of hosts) {
        try {
          const devices = await this._scanHost(host, vlanId, timeout);
          allDevices.push(...devices);
        } catch (error) {
          logger.error(`Failed to scan host ${host.ip}:`, error.message);
          // Continue with other hosts even if one fails
        }
      }

      logger.info(`SSH scan completed. Found ${allDevices.length} MAC entries`);
      return allDevices;
    } catch (error) {
      logger.error('SSH scan failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Scan a single host
   */
  async _scanHost(host, vlanId, timeout) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      const timer = setTimeout(() => {
        conn.end();
        reject(new Error(`SSH scan timed out for host ${host.ip}`));
      }, timeout * 1000);

      conn.on('ready', () => {
        logger.info(`Connected to ${host.ip}:${host.port}, scanning MAC table`);
        
        // Build command based on VLAN
        const command = vlanId 
          ? `show mac address-table vlan ${vlanId}`
          : 'show mac address-table';

        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }

          let output = '';
          let expectingMore = false;
          
          stream.on('close', (code, signal) => {
            clearTimeout(timer);
            conn.end();
            
            if (code === 0) {
              try {
                const devices = this._parseMacTable(output, host);
                resolve(devices);
              } catch (parseError) {
                reject(parseError);
              }
            } else {
              reject(new Error(`Command failed with exit code ${code} on ${host.ip}`));
            }
          });

          stream.on('data', (data) => {
            const chunk = data.toString();
            output += chunk;
            
            // Check if we need to send space/enter for --more--
            if (chunk.includes('--more--')) {
              expectingMore = true;
              stream.write(' '); // Send space to continue
            }
          });

          stream.stderr.on('data', (data) => {
            logger.warn(`SSH stderr from ${host.ip}: ${data}`);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timer);
        logger.error(`SSH connection error for ${host.ip}:`, err.message);
        reject(err);
      });

      try {
        const decryptedPassword = this.decrypt(host.password);
        conn.connect({
          host: host.ip,
          port: host.port,
          username: host.username,
          password: decryptedPassword,
          readyTimeout: timeout * 1000
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Parse MAC address table output
   */
  _parseMacTable(output, host) {
    const devices = [];
    const lines = output.split('\n');
    
    logger.debug(`Parsing MAC table output from ${host.ip}, ${lines.length} lines`);
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines, headers, and control characters
      if (!trimmedLine || 
          trimmedLine.includes('VlanId') || 
          trimmedLine.includes('Codes:') ||
          trimmedLine.includes('--more--') ||
          trimmedLine.startsWith('pv <vlan-id>')) {
        continue;
      }

      // Parse MAC table entry
      // Format: VlanId Mac Address Type Interface
      const parts = trimmedLine.split(/\s+/);
      
      if (parts.length >= 4) {
        const vlanId = parts[0];
        const macAddress = parts[1];
        const type = parts[2];
        const interfaceName = parts.slice(3).join(' '); // Interface might have spaces
        
        // Validate MAC address format
        if (this._isValidMAC(macAddress) && this._isValidVlan(vlanId)) {
          const device = {
            mac: macAddress.toLowerCase(),
            vlan_id: vlanId,
            interface: interfaceName,
            type: type,
            host_ip: host.ip,
            host_interface: host.interface,
            detected_at: new Date().toISOString()
          };
          
          devices.push(device);
          logger.debug(`Found device: ${macAddress} on ${interfaceName} (VLAN ${vlanId})`);
        }
      }
    }

    logger.info(`Parsed ${devices.length} MAC entries from ${host.ip}`);
    return devices;
  }

  /**
   * Parse network interfaces output
   */
  _parseInterfaces(output) {
    const interfaces = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip headers and empty lines
      if (!trimmedLine || trimmedLine.includes('Interface') || trimmedLine.includes('---')) {
        continue;
      }

      // Extract interface name (first column)
      const parts = trimmedLine.split(/\s+/);
      if (parts.length > 0 && parts[0]) {
        interfaces.push(parts[0]);
      }
    }

    return interfaces;
  }

  /**
   * Validate MAC address format
   */
  _isValidMAC(mac) {
    const macRegex = /^([0-9a-f]{2}[:-]){5}([0-9a-f]{2})$/i;
    return macRegex.test(mac);
  }

  /**
   * Validate VLAN ID
   */
  _isValidVlan(vlanId) {
    const vlan = parseInt(vlanId, 10);
    return !isNaN(vlan) && vlan >= 1 && vlan <= 4094;
  }

  /**
   * Check if SSH scanner is available
   */
  static async checkAvailability() {
    try {
      // Check if ssh2 module is available
      const { Client } = await import('ssh2');
      return true;
    } catch (error) {
      return false;
    }
  }
}