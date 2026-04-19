const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(bodyParser.json());

const balances = new Map();
const errorInjection = { enabled: false, errorType: null, probability: 0 };
const latencySimulation = { enabled: false, delayMs: 0 };
const requestLog = [];

function initializeBalances() {
  balances.set('emp-1:loc-1', { balance: 20, lastUpdated: new Date().toISOString() });
  balances.set('emp-1:loc-2', { balance: 15, lastUpdated: new Date().toISOString() });
  balances.set('emp-2:loc-1', { balance: 18, lastUpdated: new Date().toISOString() });
  balances.set('emp-3:loc-3', { balance: 25, lastUpdated: new Date().toISOString() });
  console.log('Mock HCM: Initialized balances for 4 employee-location pairs');
}

function shouldInjectError() {
  if (!errorInjection.enabled) return false;
  return Math.random() < errorInjection.probability;
}

function applyLatency(res, callback) {
  if (latencySimulation.enabled && latencySimulation.delayMs > 0) {
    setTimeout(callback, latencySimulation.delayMs);
  } else {
    callback();
  }
}

initializeBalances();

app.get('/api/balance/:employeeId/:locationId', (req, res) => {
  const { employeeId, locationId } = req.params;
  const key = `${employeeId}:${locationId}`;
  
  console.log(`Mock HCM: GET balance for ${key}`);
  requestLog.push({ method: 'GET', path: `/api/balance/${key}`, timestamp: new Date().toISOString() });
  
  applyLatency(res, () => {
    if (shouldInjectError()) {
      console.log(`Mock HCM: Injecting ${errorInjection.errorType} error`);
      if (errorInjection.errorType === 'timeout') {
        return res.status(504).json({ error: 'GATEWAY_TIMEOUT', message: 'HCM service timeout' });
      } else if (errorInjection.errorType === 'unavailable') {
        return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'HCM service unavailable' });
      }
    }

    const balanceData = balances.get(key);
    
    if (!balanceData) {
      return res.status(400).json({
        error: 'INVALID_DIMENSION',
        message: 'Employee not assigned to location'
      });
    }
    
    res.json({
      employeeId,
      locationId,
      balance: balanceData.balance,
      currency: 'days',
      lastUpdated: balanceData.lastUpdated
    });
  });
});

app.post('/api/balance/:employeeId/:locationId', (req, res) => {
  const { employeeId, locationId } = req.params;
  const { deduct, reason, requestId } = req.body;
  const key = `${employeeId}:${locationId}`;
  
  console.log(`Mock HCM: POST deduct ${deduct} days for ${key}, reason: ${reason}`);
  requestLog.push({ method: 'POST', path: `/api/balance/${key}`, deduct, timestamp: new Date().toISOString() });
  
  applyLatency(res, () => {
    if (shouldInjectError()) {
      console.log(`Mock HCM: Injecting ${errorInjection.errorType} error`);
      if (errorInjection.errorType === 'timeout') {
        return res.status(504).json({ error: 'GATEWAY_TIMEOUT', message: 'HCM service timeout' });
      } else if (errorInjection.errorType === 'unavailable') {
        return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'HCM service unavailable' });
      } else if (errorInjection.errorType === 'conflict') {
        return res.status(409).json({ error: 'CONFLICT', message: 'Balance was modified by another request' });
      }
    }

    const balanceData = balances.get(key);
    
    if (!balanceData) {
      return res.status(400).json({
        error: 'INVALID_DIMENSION',
        message: 'Employee not assigned to location'
      });
    }
    
    if (balanceData.balance < deduct) {
      return res.status(400).json({
        error: 'INSUFFICIENT_BALANCE',
        message: `Only ${balanceData.balance} days available, ${deduct} requested`
      });
    }
    
    const previousBalance = balanceData.balance;
    balanceData.balance -= deduct;
    balanceData.lastUpdated = new Date().toISOString();
    
    res.json({
      employeeId,
      locationId,
      previousBalance,
      newBalance: balanceData.balance,
      deducted: deduct,
      confirmationId: uuidv4()
    });
  });
});

app.post('/api/batch/balances', (req, res) => {
  console.log('Mock HCM: Batch sync requested');
  
  const allBalances = [];
  for (const [key, data] of balances.entries()) {
    const [employeeId, locationId] = key.split(':');
    allBalances.push({
      employeeId,
      locationId,
      balance: data.balance,
      lastUpdated: data.lastUpdated
    });
  }
  
  res.json({
    balances: allBalances,
    timestamp: new Date().toISOString(),
    count: allBalances.length
  });
});

app.post('/api/admin/grant-bonus', (req, res) => {
  const { employeeId, locationId, amount, reason } = req.body;
  const key = `${employeeId}:${locationId}`;
  
  console.log(`Mock HCM: Granting ${amount} days bonus to ${key}, reason: ${reason}`);
  
  const balanceData = balances.get(key);
  
  if (!balanceData) {
    return res.status(400).json({
      error: 'INVALID_DIMENSION',
      message: 'Employee not assigned to location'
    });
  }
  
  balanceData.balance += amount;
  balanceData.lastUpdated = new Date().toISOString();
  
  res.json({
    employeeId,
    locationId,
    newBalance: balanceData.balance,
    granted: amount,
    reason
  });
});

app.post('/api/test/error-injection', (req, res) => {
  const { enabled, errorType, probability } = req.body;
  
  if (enabled === undefined) {
    return res.status(400).json({ error: 'Missing enabled parameter' });
  }
  
  errorInjection.enabled = enabled;
  if (enabled) {
    errorInjection.errorType = errorType || 'unavailable';
    errorInjection.probability = probability || 0.5;
  }
  
  console.log(`Mock HCM: Error injection ${enabled ? 'enabled' : 'disabled'}`, errorInjection);
  res.json({ errorInjection, message: 'Error injection configured' });
});

app.post('/api/test/latency-simulation', (req, res) => {
  const { enabled, delayMs } = req.body;
  
  if (enabled === undefined) {
    return res.status(400).json({ error: 'Missing enabled parameter' });
  }
  
  latencySimulation.enabled = enabled;
  if (enabled) {
    latencySimulation.delayMs = delayMs || 1000;
  }
  
  console.log(`Mock HCM: Latency simulation ${enabled ? 'enabled' : 'disabled'}`, latencySimulation);
  res.json({ latencySimulation, message: 'Latency simulation configured' });
});

app.post('/api/test/set-balance', (req, res) => {
  const { employeeId, locationId, balance } = req.body;
  const key = `${employeeId}:${locationId}`;
  
  if (!employeeId || !locationId || balance === undefined) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  const balanceData = balances.get(key) || {};
  balanceData.balance = balance;
  balanceData.lastUpdated = new Date().toISOString();
  balances.set(key, balanceData);
  
  console.log(`Mock HCM: Set balance for ${key} to ${balance}`);
  res.json({ key, balance, message: 'Balance updated' });
});

app.get('/api/test/request-log', (req, res) => {
  res.json({ requests: requestLog, count: requestLog.length });
});

app.post('/api/test/reset', (req, res) => {
  balances.clear();
  errorInjection.enabled = false;
  latencySimulation.enabled = false;
  requestLog.length = 0;
  initializeBalances();
  
  console.log('Mock HCM: Reset to initial state');
  res.json({ message: 'Mock HCM reset to initial state' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mock-hcm', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Mock HCM Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
