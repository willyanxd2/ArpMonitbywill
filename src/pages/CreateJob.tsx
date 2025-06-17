import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Network, Clock, Shield, AlertTriangle, Wifi, Server } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import toast from 'react-hot-toast';

interface SshHost {
  host_ip: string;
  username: string;
  password: string;
  port: number;
  interface_name: string;
}

interface JobFormData {
  name: string;
  type: 'arp-scan' | 'ssh-mac-table';
  network_interface: string;
  subnet: string;
  execution_time: number;
  schedule: string;
  notifications_enabled: boolean;
  notify_new_macs: boolean;
  notify_unauthorized_macs: boolean;
  notify_ip_changes: boolean;
  retention_policy: string;
  retention_days: number;
  whitelist: string[];
  ssh_hosts: SshHost[];
  vlan_id: number | null;
}

function CreateJob() {
  const navigate = useNavigate();
  const { networkInterfaces } = useApp();
  
  const [formData, setFormData] = useState<JobFormData>({
    name: '',
    type: 'arp-scan',
    network_interface: '',
    subnet: '',
    execution_time: 300,
    schedule: 'manual',
    notifications_enabled: true,
    notify_new_macs: true,
    notify_unauthorized_macs: true,
    notify_ip_changes: true,
    retention_policy: 'days',
    retention_days: 30,
    whitelist: [],
    ssh_hosts: [],
    vlan_id: null
  });

  const [newWhitelistMac, setNewWhitelistMac] = useState('');
  const [newSshHost, setNewSshHost] = useState<SshHost>({
    host_ip: '',
    username: '',
    password: '',
    port: 22,
    interface_name: ''
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
    setFormData(prev => ({ ...prev, [field]: value }));
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

  const handleAddSshHost = () => {
    if (newSshHost.host_ip && newSshHost.username && newSshHost.password) {
      setFormData(prev => ({
        ...prev,
        ssh_hosts: [...prev.ssh_hosts, { ...newSshHost }]
      }));
      setNewSshHost({
        host_ip: '',
        username: '',
        password: '',
        port: 22,
        interface_name: ''
      });
    }
  };

  const handleRemoveSshHost = (index: number) => {
    setFormData(prev => ({
      ...prev,
      ssh_hosts: prev.ssh_hosts.filter((_, i) => i !== index)
    }));
  };

  const handleTestSshConnection = async (host: SshHost, index: number) => {
    setTestingConnection(`${index}`);
    try {
      const response = await api.post('/jobs/test/test-ssh', host);
      if (response.data.success) {
        toast.success('SSH connection successful!');
      } else {
        toast.error(`SSH connection failed: ${response.data.message}`);
      }
    } catch (error: any) {
      toast.error(`SSH connection failed: ${error.response?.data?.message || error.message}`);
    } finally {
      setTestingConnection(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('Job name is required');
      return;
    }

    if (formData.type === 'arp-scan') {
      if (!formData.network_interface) {
        toast.error('Network interface is required for ARP scan jobs');
        return;
      }
      
      if (!formData.subnet.trim()) {
        toast.error('Subnet is required for ARP scan jobs');
        return;
      }
    } else if (formData.type === 'ssh-mac-table') {
      if (formData.ssh_hosts.length === 0) {
        toast.error('At least one SSH host is required for SSH MAC table jobs');
        return;
      }
    }

    setIsSubmitting(true);
    
    try {
      await api.post('/jobs', formData);
      toast.success('Job created successfully');
      navigate('/jobs');
    } catch (error: any) {
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
                formData.type === 'arp-scan'
                  ? 'border-neon-cyan bg-neon-cyan/10'
                  : 'border-dark-600 hover:border-dark-500'
              }`}
              onClick={() => handleInputChange('type', 'arp-scan')}
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
                formData.type === 'ssh-mac-table'
                  ? 'border-neon-cyan bg-neon-cyan/10'
                  : 'border-dark-600 hover:border-dark-500'
              }`}
              onClick={() => handleInputChange('type', 'ssh-mac-table')}
            >
              <div className="flex items-center space-x-3">
                <Server className="w-6 h-6 text-neon-purple" />
                <div>
                  <h3 className="font-semibold text-white">SSH MAC Table</h3>
                  <p className="text-sm text-dark-400">Switch MAC table via SSH</p>
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
            <div>
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

            {formData.type === 'arp-scan' && (
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

            {formData.type === 'ssh-mac-table' && (
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  VLAN ID (optional)
                </label>
                <input
                  type="number"
                  value={formData.vlan_id || ''}
                  onChange={(e) => handleInputChange('vlan_id', e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                  placeholder="200"
                  min="1"
                  max="4094"
                />
              </div>
            )}
          </div>
        </div>

        {/* SSH Hosts Configuration */}
        {formData.type === 'ssh-mac-table' && (
          <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
            <div className="flex items-center space-x-3 mb-6">
              <Server className="w-5 h-5 text-neon-purple" />
              <h2 className="text-lg font-semibold text-white">SSH Hosts</h2>
            </div>
            
            {/* Add SSH Host Form */}
            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Host IP *</label>
                  <input
                    type="text"
                    value={newSshHost.host_ip}
                    onChange={(e) => setNewSshHost(prev => ({ ...prev, host_ip: e.target.value }))}
                    className="w-full px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="192.168.1.1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Username *</label>
                  <input
                    type="text"
                    value={newSshHost.username}
                    onChange={(e) => setNewSshHost(prev => ({ ...prev, username: e.target.value }))}
                    className="w-full px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="admin"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Password *</label>
                  <input
                    type="password"
                    value={newSshHost.password}
                    onChange={(e) => setNewSshHost(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Port</label>
                  <input
                    type="number"
                    value={newSshHost.port}
                    onChange={(e) => setNewSshHost(prev => ({ ...prev, port: parseInt(e.target.value) }))}
                    className="w-full px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
                    min="1"
                    max="65535"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">Interface Name</label>
                  <input
                    type="text"
                    value={newSshHost.interface_name}
                    onChange={(e) => setNewSshHost(prev => ({ ...prev, interface_name: e.target.value }))}
                    className="w-full px-4 py-2 bg-dark-800 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                    placeholder="eth0"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleAddSshHost}
                    className="w-full px-4 py-2 bg-neon-cyan text-dark-950 rounded-lg hover:bg-neon-cyan/90 transition-colors"
                  >
                    Add Host
                  </button>
                </div>
              </div>
            </div>

            {/* SSH Hosts List */}
            {formData.ssh_hosts.length > 0 && (
              <div className="space-y-3">
                {formData.ssh_hosts.map((host, index) => (
                  <div key={index} className="bg-dark-800 rounded-lg p-4 border border-dark-600">
                    <div className="flex items-center justify-between">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1">
                        <div>
                          <span className="text-sm text-dark-400">Host:</span>
                          <p className="text-white font-mono">{host.host_ip}:{host.port}</p>
                        </div>
                        <div>
                          <span className="text-sm text-dark-400">Username:</span>
                          <p className="text-white">{host.username}</p>
                        </div>
                        <div>
                          <span className="text-sm text-dark-400">Password:</span>
                          <p className="text-white font-mono">{'*'.repeat(8)}</p>
                        </div>
                        <div>
                          <span className="text-sm text-dark-400">Interface:</span>
                          <p className="text-white">{host.interface_name || 'N/A'}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          type="button"
                          onClick={() => handleTestSshConnection(host, index)}
                          disabled={testingConnection === `${index}`}
                          className="px-3 py-1 bg-neon-green/10 border border-neon-green/20 rounded text-neon-green text-sm hover:bg-neon-green/20 transition-colors disabled:opacity-50"
                        >
                          {testingConnection === `${index}` ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveSshHost(index)}
                          className="px-3 py-1 bg-neon-orange/10 border border-neon-orange/20 rounded text-neon-orange text-sm hover:bg-neon-orange/20 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
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
                
                {formData.type === 'arp-scan' && (
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="notify_ip_changes"
                      checked={formData.notify_ip_changes}
                      onChange={(e) => handleInputChange('notify_ip_changes', e.target.checked)}
                      className="w-4 h-4 text-neon-cyan bg-dark-800 border-dark-600 rounded focus:ring-neon-cyan"
                    />
                    <label htmlFor="notify_ip_changes" className="ml-2 text-dark-300">
                      Notify when MAC addresses change IP
                    </label>
                  </div>
                )}
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