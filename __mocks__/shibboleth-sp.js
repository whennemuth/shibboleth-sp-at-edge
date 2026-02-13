// Manual mock for shibboleth-sp to avoid ESM import issues in Jest
module.exports = {
  AUTH_PATHS: {
    LOGIN: '/login',
    LOGOUT: '/logout',
    ASSERT: '/assert',
    METADATA: '/metadata',
    FAVICON: '/favicon.ico'
  },
  handler: jest.fn(),
  JwtTools: jest.fn().mockImplementation(() => ({
    isValidStructure: jest.fn(),
    isExpired: jest.fn(),
    getCookieName: jest.fn().mockReturnValue('auth-token'),
    getTokenName: jest.fn().mockReturnValue('token')
  })),
  SamlTools: jest.fn(),
  Keys: jest.fn().mockImplementation(() => ({
    privateKeyPEM: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----',
    publicKeyPEM: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----',
    certificatePEM: '-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAKZ\n-----END CERTIFICATE-----',
    certificate: 'mock-certificate',
    privateKey: 'mock-private-key'
  })),
  // Type exports for TypeScript
  IConfig: {},
  IRequest: {},
  IResponse: {},
  SamlParms: {}
};

