import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Network, Clock, Shield, AlertTriangle, Wifi, Server, TestTube, Eye, EyeOff } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import toast from 'react-hot-toast';

interface SSHHost {
  ip_address: string;
  port: number;
  username: string;
  password: string;
  interface: string;
}

interface JobFormData {
  name: string;
  job_type: 'arp-scan' | 'ssh-scan';
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
  vlan_id: number | null;
  ssh_hosts: SSHHost[];
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
    schedule: 'manual',
    notifications_enabled: true,
    notify_new_macs: true,
    notify_unauthorized_macs: true,
    notify_ip_changes: true,
    retention_policy: 'days',
    retention_days: 30,
    whitelist: [],
    vlan_id: null,
    ssh_hosts: []
  });

  const [newWhitelistMac, setNewWhitelistMac] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPasswords, setShowPasswords] = useState<{[key: number]: boolean}>({});
  const [testingConnections, setTestingConnections] = useState<{[key: number]: boolean}>({});
  const [connectionResults, setConnectionResults] = useState<{[key: number]: {success: boolean, message: string}}>({});
  const [loadingInterfaces, setLoadingInterfaces] = useState<{[key: number]: boolean}>({});
  const [availableInterfaces, setAvailableInterfaces] = useState<{[key: number]: string[]}>({});

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

  const handleJobTypeChange = (jobType: 'arp-scan' | 'ssh-scan') => {
    console.log(`[CreateJob] Changing job type to: ${jobType}`);
    setFormData(prev => ({
      ...prev,
      job_type: jobType,
      // Reset type-specific fields
      network_interface: jobType === 'arp-scan' ? prev.network_interface : '',
      subnet: jobType === 'arp-scan' ? prev.subnet : '',
      execution_time: jobType === 'arp-scan' ? prev.execution_time : 300,
      vlan_id: jobType === 'ssh-scan' ? prev.vlan_id : null,
      ssh_hosts: jobType === 'ssh-scan' ? prev.ssh_hosts : []
    }));
  };

  const handleAddWhitelistMac = () => {
    if (newWhitelistMac && !formData.whitelist.includes(newWhitelistMac)) {
      console.log(`[CreateJob] Adding MAC to whitelist: ${newWhitelistMac}`);
      setFormData(prev => ({
        ...prev,
        whitelist: [...prev.whitelist, newWhitelistMac]
      }));
      setNewWhitelistMac('');
    }
  };

  const handleRemoveWhitelistMac = (mac: string) => {
    console.log(`[CreateJob] Removing MAC from whitelist: ${mac}`);
    setFormData(prev => ({
      ...prev,
      whitelist: prev.whitelist.filter(m => m !== mac)
    }));
  };

  const handleAddSSHHost = () => {
    console.log('[CreateJob] Adding new SSH host');
    setFormData(prev => ({
      ...prev,
      ssh_hosts: [...prev.ssh_hosts, {
        ip_address: '',
        port: 22,
        username: '',
        password: '',
        interface: ''
      }]
    }));
  };

  const handleRemoveSSHHost = (index: number) => {
    console.log(`[CreateJob] Removing SSH host at index: ${index}`);
    setFormData(prev => ({
      ...prev,
      ssh_hosts: prev.ssh_hosts.filter((_, i) => i !== index)
    }));
    
    // Clean up related state
    setShowPasswords(prev => {
      const newState = { ...prev };
      delete newState[index];
      return newState;
    });
    setConnectionResults(prev => {
      const newState = { ...prev };
      delete newState[index];
      return newState;
    });
    setAvailableInterfaces(prev => {
      const newState = { ...prev };
      delete newState[index];
      return newState;
    });
  };

  const handleSSHHostChange = (index: number, field: keyof SSHHost, value: any) => {
    console.log(`[CreateJob] Updating SSH host ${index} field ${field} with value:`, value);
    setFormData(prev => ({
      ...prev,
      ssh_hosts: prev.ssh_hosts.map((host, i) => 
        i === index ? { ...host, [field]: value } : host
      )
    }));
  };

  const testSSHConnection = async (index: number) => {
    const host = formData.ssh_hosts[index];
    if (!host.ip_address || !host.username || !host.password) {
      toast.error('Please fill in IP address, username, and password');
      return;
    }

    console.log(`[CreateJob] Testing SSH connection for host ${index}: ${host.ip_address}:${host.port}`);
    setTestingConnections(prev => ({ ...prev, [index]: true }));
    setConnectionResults(prev => {
      const newState = { ...prev };
      delete newState[index];
      return newState;
    });

    try {
      const response = await api.post('/jobs/test/test-ssh', {
        ip_address: host.ip_address,
        port: host.port,
        username: host.username,
        password: host.password
      });

      console.log(`[CreateJob] SSH connection test successful for host ${index}`);
      setConnectionResults(prev => ({
        ...prev,
        [index]: { success: true, message: 'Connection successful!' }
      }));
      toast.success(`SSH connection to ${host.ip_address} successful!`);
    } catch (error: any) {
      console.error(`[CreateJob] SSH connection test failed for host ${index}:`, error);
      const message = error.response?.data?.message || 'Connection failed';
      setConnectionResults(prev => ({
        ...prev,
        [index]: { success: false, message }
      }));
      toast.error(`SSH connection failed: ${message}`);
    } finally {
      setTestingConnections(prev => ({ ...prev, [index]: false }));
    }
  };

  const loadSSHInterfaces = async (index: number) => {
    const host = formData.ssh_hosts[index];
    if (!host.ip_address || !host.username || !host.password) {
      toast.error('Please fill in IP address, username, and password first');
      return;
    }

    console.log(`[CreateJob] Loading interfaces for SSH host ${index}: ${host.ip_address}:${host.port}`);
    setLoadingInterfaces(prev => ({ ...prev, [index]: true }));

    try {
      const response = await api.post('/jobs/test/ssh-interfaces', {
        ip_address: host.ip_address,
        port: host.port,
        username: host.username,
        password: host.password
      });

      console.log(`[CreateJob] Loaded ${response.data.interfaces.length} interfaces for host ${index}`);
      setAvailableInterfaces(prev => ({
        ...prev,
        [index]: response.data.interfaces
      }));
      toast.success(`Loaded ${response.data.interfaces.length} interfaces`);
    } catch (error: any) {
      console.error(`[CreateJob] Failed to load interfaces for host ${index}:`, error);
      const message = error.response?.data?.message || 'Failed to load interfaces';
      toast.error(`Failed to load interfaces: ${message}`);
    } finally {
      setLoadingInterfaces(prev => ({ ...prev, [index]: false }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('[CreateJob] Submitting job with data:', formData);
    
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
    } else if (formData.job_type === 'ssh-scan') {
      if (formData.ssh_hosts.length === 0) {
        toast.error('At least one SSH host is required for SSH scan jobs');
        return;
      }

      for (let i = 0; i < formData.ssh_hosts.length; i++) {
        const host = formData.ssh_hosts[i];
        if (!host.ip_address || !host.username || !host.password) {
          toast.error(`SSH host ${i + 1}: IP address, username, and password are required`);
          return;
        }
      }
    }

    setIsSubmitting(true);
    
    try {
      console.log('[CreateJob] Sending API request to create job');
      await api.post('/jobs', formData);
      console.log('[CreateJob] Job created successfully');
      toast.success('Job created successfully');
      navigate('/jobs');
    } catch (error: any) {
      console.error('[CreateJob] Failed to create job:', error);
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
                  <p className="text-sm text-dark-400">Scan network using ARP protocol</p>
                </div>
              </div>
            </div>
            
            <div
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                formData.job_type === 'ssh-scan'
                  ? 'border-neon-cyan bg-neon-cyan/10'
                  : 'border-dark-600 hover:border-dark-500'
              }`}
              onClick={() => handleJobTypeChange('ssh-scan')}
            >
              <div className="flex items-center space-x-3">
                <Server className="w-6 h-6 text-neon-purple" />
                <div>
                  <h3 className="font-semibold text-white">SSH Scan</h3>
                  <p className="text-sm text-dark-400">Scan MAC table via SSH</p>
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

            {formData.job_type === 'ssh-scan' && (
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
        {formData.job_type === 'ssh-scan' && (
          <div className="bg-dark-900 rounded-xl p-6 border border-dark-700">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Server className="w-5 h-5 text-neon-purple" />
                <h2 className="text-lg font-semibold text-white">SSH Hosts</h2>
              </div>
              <button
                type="button"
                onClick={handleAddSSHHost}
                className="px-4 py-2 bg-neon-cyan text-dark-950 rounded-lg hover:bg-neon-cyan/90 transition-colors"
              >
                Add Host
              </button>
            </div>
            
            {formData.ssh_hosts.length === 0 ? (
              <div className="text-center py-8 text-dark-400">
                <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No SSH hosts configured. Click "Add Host" to get started.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {formData.ssh_hosts.map((host, index) => (
                  <div key={index} className="bg-dark-800 rounded-lg p-4 border border-dark-600">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium text-white">SSH Host {index + 1}</h3>
                      <button
                        type="button"
                        onClick={() => handleRemoveSSHHost(index)}
                        className="text-neon-orange hover:text-neon-orange/80 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          IP Address *
                        </label>
                        <input
                          type="text"
                          value={host.ip_address}
                          onChange={(e) => handleSSHHostChange(index, 'ip_address', e.target.value)}
                          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                          placeholder="192.168.1.1"
                          required
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Port
                        </label>
                        <input
                          type="number"
                          value={host.port}
                          onChange={(e) => handleSSHHostChange(index, 'port', parseInt(e.target.value))}
                          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
                          min="1"
                          max="65535"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Username *
                        </label>
                        <input
                          type="text"
                          value={host.username}
                          onChange={(e) => handleSSHHostChange(index, 'username', e.target.value)}
                          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                          placeholder="admin"
                          required
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Password *
                        </label>
                        <div className="relative">
                          <input
                            type={showPasswords[index] ? 'text' : 'password'}
                            value={host.password}
                            onChange={(e) => handleSSHHostChange(index, 'password', e.target.value)}
                            className="w-full px-3 py-2 pr-10 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white placeholder-dark-400"
                            placeholder="••••••••"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPasswords(prev => ({ ...prev, [index]: !prev[index] }))}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-dark-400 hover:text-white"
                          >
                            {showPasswords[index] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Interface
                        </label>
                        <div className="flex space-x-2">
                          <select
                            value={host.interface}
                            onChange={(e) => handleSSHHostChange(index, 'interface', e.target.value)}
                            className="flex-1 px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg focus:border-neon-cyan focus:outline-none text-white"
                          >
                            <option value="">Select interface</option>
                            {availableInterfaces[index]?.map((iface) => (
                              <option key={iface} value={iface}>{iface}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => loadSSHInterfaces(index)}
                            disabled={loadingInterfaces[index]}
                            className="px-3 py-2 bg-neon-purple/10 border border-neon-purple/20 rounded-lg hover:bg-neon-purple/20 transition-colors text-neon-purple disabled:opacity-50"
                          >
                            {loadingInterfaces[index] ? '...' : 'Load'}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between mt-4">
                      <button
                        type="button"
                        onClick={() => testSSHConnection(index)}
                        disabled={testingConnections[index]}
                        className="flex items-center space-x-2 px-4 py-2 bg-neon-green/10 border border-neon-green/20 rounded-lg hover:bg-neon-green/20 transition-colors text-neon-green disabled:opacity-50"
                      >
                        <TestTube className="w-4 h-4" />
                        <span>{testingConnections[index] ? 'Testing...' : 'Test Connection'}</span>
                      </button>
                      
                      {connectionResults[index] && (
                        <div className={`text-sm ${connectionResults[index].success ? 'text-neon-green' : 'text-neon-orange'}`}>
                          {connectionResults[index].message}
                        </div>
                      )}
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
                    Notify when MAC addresses change {formData.job_type === 'arp-scan' ? 'IP' : 'location'}
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