import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Network, Clock, Shield, AlertTriangle, Server, Wifi } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import toast from 'react-hot-toast';

interface JobFormData {
  name: string;
  job_type: 'arp-scan' | 'ssh';
  // ARP scan fields
  network_interface: string;
  subnet: string;
  execution_time: number;
  // SSH fields
  vlan_id: string;
  ssh_hosts: SSHHost[];
  // Common fields
  schedule: string;
  notifications_enabled: boolean;
  notify_new_macs: boolean;
  notify_unauthorized_macs: boolean;
  notify_ip_changes: boolean;
  retention_policy: string;
  retention_days: number;
  whitelist: string[];
}

interface SSHHost {
  id?: string;
  hostname: string;
  ip_address: string;
  port: number;
  username: string;
  password: string;
  connection_status?: string;
}

function CreateJob() {
  const navigate = useNavigate();
  const { networkInterfaces } = useApp();
  
  const [formData, setFormData] = useState<JobFormData>({
    name: '',
    job_type: 'arp-scan',
    network_interface: '',
    subnet: '',
    execution_time: 300,
    vlan_id: '',
    ssh_hosts: [],
    schedule: 'manual',
    notifications_enabled: true,
    notify_new_macs: true,
    notify_unauthorized_macs: true,
    notify_ip_changes: true,
    retention_policy: 'days',
    retention_days: 30,
    whitelist: []
  });

  const [newWhitelistMac, setNewWhitelistMac] = useState('');
  const [newSSHHost, setNewSSHHost] = useState<SSHHost>({
    hostname: '',
    ip_address: '',
    port: 22,
    username: '',
    password: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);

  const scheduleOptions = [
    { value: 'manual', label: 'Manual execution only' },
    { value: '1h', label: 'Every hour' },
    { value: '6h', label: 'Every 6 hours' },
    { value: '12h', label: 'Every 12 hours' },
    { value: '24h', label: 'Every 24 hours' },
    { value: '7d', label: 'Every week' }
  ];

  const retentionOptions = [
    { value: 'forever', label: 'Keep forever' },
    { value: 'days', label: 'Keep for specified days' },
    { value: 'remove', label: 'Remove immediately' }
  ];

  const handleInputChange = (field: keyof JobFormData, value: any) => {
    console.log(`[CreateJob] Updating field ${field} with value:`, value);
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleJobTypeChange = (jobType: 'arp-scan' | 'ssh') => {
    console.log(`[CreateJob] Changing job type to: ${jobType}`);
    setFormData(prev => ({
      ...prev,
      job_type: jobType,
      // Reset type-specific fields
      network_interface: jobType === 'arp-scan' ? prev.network_interface : '',
      subnet: jobType === 'arp-scan' ? prev.subnet : '',
      execution_time: jobType === 'arp-scan' ? prev.execution_time : 300,
      vlan_id: jobType === 'ssh' ? prev.vlan_id : '',
      ssh_hosts: jobType === 'ssh' ? prev.ssh_hosts : []
    }));
  };

  const handleAddWhitelistMac = () => {
    if (newWhitelistMac && !formData.whitelist.includes(newWhitelistMac)) {
      setFormData(prev => ({
        ...prev,
        whitelist: [...prev.whitelist, newWhitelistMac]
      }));
      setNewWhitelistMac('');
    }
  };

  const handleRemoveWhitelistMac = (mac: string) => {
    setFormData(prev => ({
      ...prev,
      whitelist: prev.whitelist.filter(m => m !== mac)
    }));
  };

  const handleSSHHostChange = (field: keyof SSHHost, value: any) => {
    setNewSSHHost(prev => ({ ...prev, [field]: value }));
  };

  const handleAddSSHHost = () => {
    if (newSSHHost.hostname && newSSHHost.ip_address && newSSHHost.username && newSSHHost.password) {
      const hostWithId = { ...newSSHHost, id: Date.now().toString() };
      setFormData(prev => ({
        ...prev,
        ssh_hosts: [...prev.ssh_hosts, hostWithId]
      }));
      setNewSSHHost({
        hostname: '',
        ip_address: '',
        port: 22,
        username: '',
        password: ''
      });
      console.log(`[CreateJob] Added SSH host: ${hostWithId.hostname}`);
    }
  };

  const handleRemoveSSHHost = (hostId: string) => {
    setFormData(prev => ({
      ...prev,
      ssh_hosts: prev.ssh_hosts.filter(h => h.id !== hostId)
    }));
  };

  const testSSHConnection = async (host: SSHHost) => {
    if (!host.hostname || !host.ip_address || !host.username || !host.password) {
      toast.error('Please fill in all SSH host details before testing');
      return;
    }

    setTestingConnection(host.id || 'new');
    console.log(`[CreateJob] Testing SSH connection to ${host.hostname} (${host.ip_address})`);

    try {
      // For new hosts, we'll test directly with the provided credentials
      const testData = {
        hostname: host.hostname,
        ip_address: host.ip_address,
        port: host.port,
        username: host.username,
        password: host.password
      };

      const response = await api.post('/jobs/test-connection', testData);
      
      if (response.data.success) {
        toast.success(`Connection to ${host.hostname} successful!`);
      } else {
        toast.error(`Connection to ${host.hostname} failed`);
      }
    } catch (error: any) {
      console.error(`[CreateJob] SSH test failed for ${host.hostname}:`, error);
      toast.error(`Connection test failed: ${error.response?.data?.message || error.message}`);
    } finally {
      setTestingConnection(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('[CreateJob] Submitting form with data:', formData);
    
    if (!formData.name.trim()) {
      toast.error('Job name is required');
      return;
    }

    // Validate based on job type
    if (formData.job_type === 'arp-scan') {
      if (!formData.network_interface) {
        toast.error('Network interface is required for ARP scan jobs');
        return;
      }
      
      if (!formData.subnet.trim()) {
        toast.error('Subnet is required for ARP scan jobs');
        return;
      }
    } else if (formData.job_type === 'ssh') {
      if (formData.ssh_hosts.length === 0) {
        toast.error('At least one SSH host is required for SSH jobs');
        return;
      }

      // Validate all SSH hosts
      for (const host of formData.ssh_hosts) {
        if (!host.hostname || !host.ip_address || !host.username || !host.password) {
          toast.error(`Please complete all fields for SSH host: ${host.hostname || 'Unnamed'}`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    
    try {
      console.log('[CreateJob] Sending API request...');
      await api.post('/jobs', formData);
      toast.success('Job created successfully');
      navigate('/jobs');
    } catch (error: any) {
      console.error('[CreateJob] API error:', error);
      toast.error(error.response?.data?.message || 'Failed to create job');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/jobs')}
          className="p-2 rounded-lg bg-dark-800 hover:bg-dark-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Create New Job</h1>
          <p className="text-dark-400">Set up a new network monitoring job</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Job Type Selection */}
        <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
          <div className="flex items-center space-x-3 mb-6">
            <Server className="w-5 h-5 text-neon-cyan" />
            <h2 className="text-lg font-semibold text-white">Job Type</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                formData.job_type === 'arp-scan'
                  ? 'border-neon-cyan bg-neon-cyan/10'
                  : 'border-dark-600 hover:border-dark-500'
              }`}
              onClick={() => handleJobTypeChange('arp-scan')}
            >
              <div className="flex items-center space-x-3">
                <Wifi className="w-6 h-6 text-neon-cyan" />
                <div>
                  <h3 className="font-semibold text-white">ARP Scan</h3>
                  <p className="text-sm text-dark-400">Network scanning using ARP protocol</p>
                </div>
              </div>
            </div>
            
            <div
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                formData.job_type === 'ssh'
                  ? 'border-neon-cyan bg-neon-cyan/10'
                  : 'border-dark-600 hover:border-dark-500'
              }`}
              onClick={() => handleJobTypeChange('ssh')}
            >
              <div className="flex items-center space-x-3">
                <Server className="w-6 h-6 text-neon-purple" />
                <div>
                  <h3 className="font-semibold text-white">SSH</h3>
                  <p className="text-sm text-dark-400">Remote device monitoring via SSH</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Basic Information */}
        <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
          <div className="flex items-center space-x-3 mb-6">
            <Network className="w-5 h-5 text-neon-cyan" />
            <h2 className="text-lg font-semibold text-white">Basic Information</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-white mb-2">
                Job Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                placeholder="My Network Monitor"
                required
              />
            </div>

            {formData.job_type === 'arp-scan' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Network Interface *
                  </label>
                  <select
                    value={formData.network_interface}
                    onChange={(e) => handleInputChange('network_interface', e.target.value)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
                    required
                  >
                    <option value="">Select interface</option>
                    {networkInterfaces.map((iface) => (
                      <option key={iface} value={iface}>{iface}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Subnet *
                  </label>
                  <input
                    type="text"
                    value={formData.subnet}
                    onChange={(e) => handleInputChange('subnet', e.target.value)}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="192.168.1.0/24"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Execution Time (seconds)
                  </label>
                  <input
                    type="number"
                    value={formData.execution_time}
                    onChange={(e) => handleInputChange('execution_time', parseInt(e.target.value))}
                    className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
                    min="60"
                    max="3600"
                  />
                </div>
              </>
            )}

            {formData.job_type === 'ssh' && (
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  VLAN ID (optional)
                </label>
                <input
                  type="text"
                  value={formData.vlan_id}
                  onChange={(e) => handleInputChange('vlan_id', e.target.value)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                  placeholder="200"
                />
              </div>
            )}
          </div>
        </div>

        {/* SSH Hosts Configuration */}
        {formData.job_type === 'ssh' && (
          <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
            <div className="flex items-center space-x-3 mb-6">
              <Server className="w-5 h-5 text-neon-purple" />
              <h2 className="text-lg font-semibold text-white">SSH Hosts</h2>
            </div>
            
            {/* Add New SSH Host */}
            <div className="bg-dark-800 rounded-lg p-4 mb-4">
              <h3 className="text-md font-medium text-white mb-4">Add SSH Host</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Hostname *</label>
                  <input
                    type="text"
                    value={newSSHHost.hostname}
                    onChange={(e) => handleSSHHostChange('hostname', e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="switch01"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-white mb-2">IP Address *</label>
                  <input
                    type="text"
                    value={newSSHHost.ip_address}
                    onChange={(e) => handleSSHHostChange('ip_address', e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="192.168.1.100"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Port</label>
                  <input
                    type="number"
                    value={newSSHHost.port}
                    onChange={(e) => handleSSHHostChange('port', parseInt(e.target.value))}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
                    min="1"
                    max="65535"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Username *</label>
                  <input
                    type="text"
                    value={newSSHHost.username}
                    onChange={(e) => handleSSHHostChange('username', e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="admin"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Password *</label>
                  <input
                    type="password"
                    value={newSSHHost.password}
                    onChange={(e) => handleSSHHostChange('password', e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="••••••••"
                  />
                </div>
                
                <div className="flex items-end space-x-2">
                  <button
                    type="button"
                    onClick={() => testSSHConnection(newSSHHost)}
                    disabled={testingConnection === 'new' || !newSSHHost.hostname || !newSSHHost.ip_address || !newSSHHost.username || !newSSHHost.password}
                    className="px-3 py-2 bg-neon-orange/10 border border-neon-orange/20 rounded-lg hover:bg-neon-orange/20 transition-colors text-neon-orange text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testingConnection === 'new' ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddSSHHost}
                    className="px-3 py-2 bg-neon-cyan text-dark-950 rounded-lg hover:bg-neon-cyan/90 transition-colors text-sm font-medium"
                  >
                    Add Host
                  </button>
                </div>
              </div>
            </div>

            {/* Existing SSH Hosts */}
            {formData.ssh_hosts.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-md font-medium text-white">Configured Hosts ({formData.ssh_hosts.length})</h3>
                {formData.ssh_hosts.map((host) => (
                  <div key={host.id} className="flex items-center justify-between bg-dark-800 px-4 py-3 rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="font-medium text-white">{host.hostname}</p>
                        <p className="text-sm text-dark-400">{host.ip_address}:{host.port} • {host.username}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => testSSHConnection(host)}
                        disabled={testingConnection === host.id}
                        className="px-3 py-1 bg-neon-orange/10 border border-neon-orange/20 rounded hover:bg-neon-orange/20 transition-colors text-neon-orange text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {testingConnection === host.id ? 'Testing...' : 'Test'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveSSHHost(host.id!)}
                        className="text-neon-orange hover:text-neon-orange/80 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Scheduling */}
        <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
          <div className="flex items-center space-x-3 mb-6">
            <Clock className="w-5 h-5 text-neon-purple" />
            <h2 className="text-lg font-semibold text-white">Scheduling</h2>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Schedule
            </label>
            <select
              value={formData.schedule}
              onChange={(e) => handleInputChange('schedule', e.target.value)}
              className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
            >
              {scheduleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
          <div className="flex items-center space-x-3 mb-6">
            <Shield className="w-5 h-5 text-neon-green" />
            <h2 className="text-lg font-semibold text-white">Notifications</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="notifications_enabled"
                checked={formData.notifications_enabled}
                onChange={(e) => handleInputChange('notifications_enabled', e.target.checked)}
                className="w-4 h-4 text-neon-cyan bg-dark-800 border-dark-600 rounded focus:ring-neon-cyan"
              />
              <label htmlFor="notifications_enabled" className="ml-2 text-white">
                Enable notifications
              </label>
            </div>
            
            {formData.notifications_enabled && (
              <div className="ml-6 space-y-3">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="notify_new_macs"
                    checked={formData.notify_new_macs}
                    onChange={(e) => handleInputChange('notify_new_macs', e.target.checked)}
                    className="w-4 h-4 text-neon-cyan bg-dark-800 border-dark-600 rounded focus:ring-neon-cyan"
                  />
                  <label htmlFor="notify_new_macs" className="ml-2 text-dark-300">
                    Notify when new MACs are discovered
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="notify_unauthorized_macs"
                    checked={formData.notify_unauthorized_macs}
                    onChange={(e) => handleInputChange('notify_unauthorized_macs', e.target.checked)}
                    className="w-4 h-4 text-neon-cyan bg-dark-800 border-dark-600 rounded focus:ring-neon-cyan"
                  />
                  <label htmlFor="notify_unauthorized_macs" className="ml-2 text-dark-300">
                    Notify when unauthorized MACs are detected
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="notify_ip_changes"
                    checked={formData.notify_ip_changes}
                    onChange={(e) => handleInputChange('notify_ip_changes', e.target.checked)}
                    className="w-4 h-4 text-neon-cyan bg-dark-800 border-dark-600 rounded focus:ring-neon-cyan"
                  />
                  <label htmlFor="notify_ip_changes" className="ml-2 text-dark-300">
                    {formData.job_type === 'ssh' 
                      ? 'Notify when MAC addresses change interface'
                      : 'Notify when MAC addresses change IP'
                    }
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MAC Whitelist */}
        <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
          <div className="flex items-center space-x-3 mb-6">
            <Shield className="w-5 h-5 text-neon-orange" />
            <h2 className="text-lg font-semibold text-white">MAC Whitelist</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex space-x-2">
              <input
                type="text"
                value={newWhitelistMac}
                onChange={(e) => setNewWhitelistMac(e.target.value)}
                className="flex-1 px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                placeholder="Enter MAC address (e.g., 00:11:22:33:44:55)"
              />
              <button
                type="button"
                onClick={handleAddWhitelistMac}
                className="px-4 py-2 bg-neon-cyan text-dark-950 rounded-lg hover:bg-neon-cyan/90 transition-colors"
              >
                Add
              </button>
            </div>
            
            {formData.whitelist.length > 0 && (
              <div className="space-y-2">
                {formData.whitelist.map((mac, index) => (
                  <div key={index} className="flex items-center justify-between bg-dark-800 px-3 py-2 rounded-lg">
                    <span className="text-white font-mono">{mac}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveWhitelistMac(mac)}
                      className="text-neon-orange hover:text-neon-orange/80 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Retention Policy */}
        <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
          <div className="flex items-center space-x-3 mb-6">
            <AlertTriangle className="w-5 h-5 text-neon-orange" />
            <h2 className="text-lg font-semibold text-white">Retention Policy</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                MAC Retention Policy
              </label>
              <select
                value={formData.retention_policy}
                onChange={(e) => handleInputChange('retention_policy', e.target.value)}
                className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
              >
                {retentionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            
            {formData.retention_policy === 'days' && (
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Retention Days
                </label>
                <input
                  type="number"
                  value={formData.retention_days}
                  onChange={(e) => handleInputChange('retention_days', parseInt(e.target.value))}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
                  min="1"
                  max="365"
                />
              </div>
            )}
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-end space-x-4">
          <button
            type="button"
            onClick={() => navigate('/jobs')}
            className="px-6 py-3 bg-dark-800 border border-dark-600 rounded-lg text-white hover:bg-dark-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-neon-cyan text-dark-950 rounded-lg hover:bg-neon-cyan/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreateJob;