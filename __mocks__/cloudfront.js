// Manual mock for cloudfront module to test CloudFront Functions
// This provides a test harness for KeyValueStore and origin manipulation

const mockKvsData = {};

const cf = {
    kvs: () => ({
        get: async (key) => {
            if (key in mockKvsData) return mockKvsData[key];
            throw new Error(`Key not found: ${key}`);
        }
    }),
    updateRequestOrigin: jest.fn(),
};

// Test utilities for setting up KVS data
cf._setMockData = (data) => Object.assign(mockKvsData, data);
cf._clearMockData = () => Object.keys(mockKvsData).forEach(k => delete mockKvsData[k]);

module.exports = cf;
