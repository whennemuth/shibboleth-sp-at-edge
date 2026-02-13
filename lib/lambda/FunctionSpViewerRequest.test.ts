import { jest } from '@jest/globals';

// Mock shibboleth-sp BEFORE any imports that use it
jest.mock('shibboleth-sp');

// Mock the origin request handler with a factory function
jest.mock('./FunctionSpOriginRequest', () => ({
  handler: jest.fn()
}));

import { handler, VIEWER_DOMAIN_HEADER_NAME } from './FunctionSpViewerRequest';
import { AUTH_PATHS } from 'shibboleth-sp';
import * as FunctionSpOriginRequest from './FunctionSpOriginRequest';

// Get a reference to the mocked handler
const mockOriginRequestHandler = FunctionSpOriginRequest.handler as jest.MockedFunction<typeof FunctionSpOriginRequest.handler>;

/**
 * Helper to create a mock CloudFront viewer request event
 */
const createMockEvent = (options: {
  uri?: string,
  querystring?: string,
  headers?: Record<string, Array<{ key: string, value: string }>>,
  host?: string
} = {}) => {
  const {
    uri = '/some/path',
    querystring = '',
    headers = {},
    host = 'example.com'
  } = options;

  const defaultHeaders: Record<string, Array<{ key: string, value: string }>> = {
    host: [{ key: 'Host', value: host }],
    ...headers
  };

  return {
    Records: [{
      cf: {
        request: {
          uri,
          querystring,
          headers: defaultHeaders
        }
      }
    }]
  };
};

describe('FunctionSpViewerRequest.handler', () => {

  beforeEach(() => {
    mockOriginRequestHandler.mockReset();
  });

  describe('Viewer domain header preservation', () => {
    it('should always add viewer domain header from host', async () => {
      const event = createMockEvent({ 
        host: 'myapp.example.com',
        uri: '/some/path'
      });
      
      mockOriginRequestHandler.mockResolvedValue({ uri: '/some/path', headers: {} } as any);
      
      await handler(event);
      
      const request = event.Records[0].cf.request;
      expect(request.headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()]).toBeDefined();
      expect(request.headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()][0].value).toBe('myapp.example.com');
    });

    it('should preserve viewer domain for function URL compatibility', async () => {
      const event = createMockEvent({ 
        host: 'viewer.cloudfront.net',
        uri: '/app/resource'
      });
      
      mockOriginRequestHandler.mockResolvedValue({ uri: '/app/resource', headers: {} } as any);
      
      await handler(event);
      
      const request = event.Records[0].cf.request;
      expect(request.headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()][0].value).toBe('viewer.cloudfront.net');
    });
  });

  describe('SAML ASSERT request handling', () => {
    it('should bypass cache for AUTH_PATHS.ASSERT uri', async () => {
      const event = createMockEvent({ 
        uri: AUTH_PATHS.ASSERT,
        host: 'example.com'
      });
      
      const result = await handler(event);
      
      // Should add cache-control header to bypass cache
      expect(result.headers['cache-control']).toBeDefined();
      expect(result.headers['cache-control'][0].value).toContain('no-cache');
      expect(result.headers['cache-control'][0].value).toContain('no-store');
      
      // Should NOT call origin request handler (returns early)
      expect(mockOriginRequestHandler).not.toHaveBeenCalled();
    });

    it('should return modified request for ASSERT with cache bypass headers', async () => {
      const event = createMockEvent({ 
        uri: AUTH_PATHS.ASSERT,
        host: 'test.example.com'
      });
      
      const result = await handler(event);
      
      // Should return the request object
      expect(result).toHaveProperty('uri', AUTH_PATHS.ASSERT);
      expect(result).toHaveProperty('headers');
      expect(result.headers['cache-control'][0].key).toBe('Cache-Control');
    });

    it('should still add viewer domain header even for ASSERT requests', async () => {
      const event = createMockEvent({ 
        uri: AUTH_PATHS.ASSERT,
        host: 'saml.example.com'
      });
      
      const result = await handler(event);
      
      expect(result.headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()]).toBeDefined();
      expect(result.headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()][0].value).toBe('saml.example.com');
    });
  });

  describe('Delegation to origin request handler', () => {
    it('should delegate non-ASSERT requests to origin request handler', async () => {
      const event = createMockEvent({ 
        uri: '/app/page',
        host: 'example.com'
      });
      
      mockOriginRequestHandler.mockResolvedValue({ 
        uri: '/app/page', 
        headers: { 'authenticated': [{ key: 'authenticated', value: 'true' }] }
      } as any);
      
      const result = await handler(event);
      
      // Should have called origin request handler
      expect(mockOriginRequestHandler).toHaveBeenCalledTimes(1);
      expect(mockOriginRequestHandler).toHaveBeenCalledWith(event);
      
      // Should return what origin handler returned
      expect(result.headers.authenticated).toBeDefined();
    });

    it('should delegate AUTH_PATHS.LOGIN to origin request handler', async () => {
      const event = createMockEvent({ 
        uri: AUTH_PATHS.LOGIN,
        host: 'example.com'
      });
      
      mockOriginRequestHandler.mockResolvedValue({ 
        status: '302',
        statusDescription: 'Found',
        headers: { location: [{ key: 'Location', value: 'https://idp.example.com/sso' }] }
      } as any);
      
      const result = await handler(event);
      
      expect(mockOriginRequestHandler).toHaveBeenCalledWith(event);
      expect(result.status).toBe('302');
    });

    it('should delegate AUTH_PATHS.LOGOUT to origin request handler', async () => {
      const event = createMockEvent({ 
        uri: AUTH_PATHS.LOGOUT,
        host: 'example.com'
      });
      
      mockOriginRequestHandler.mockResolvedValue({ 
        status: '302',
        statusDescription: 'Found',
        headers: { location: [{ key: 'Location', value: 'https://example.com/logout?target=idp' }] }
      } as any);
      
      const result = await handler(event);
      
      expect(mockOriginRequestHandler).toHaveBeenCalledWith(event);
      expect(result.status).toBe('302');
    });

    it('should delegate normal application paths to origin request handler', async () => {
      const event = createMockEvent({ 
        uri: '/content/article/123',
        querystring: 'page=1',
        host: 'example.com'
      });
      
      mockOriginRequestHandler.mockResolvedValue({ 
        uri: '/content/article/123',
        querystring: 'page=1',
        headers: {}
      } as any);
      
      await handler(event);
      
      expect(mockOriginRequestHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('Error handling', () => {
    it('should return error response on exception', async () => {
      const badEvent = { Records: [{ cf: {} }] }; // Missing request
      
      const result = await handler(badEvent);
      
      expect(result).toHaveProperty('status', 500);
      expect(result).toHaveProperty('statusDescription', 'Internal Server Error');
      expect(result).toHaveProperty('body');
      expect(result.body).toContain('error');
    });

    it('should handle origin request handler throwing error', async () => {
      const event = createMockEvent({ 
        uri: '/app/page',
        host: 'example.com'
      });
      
      mockOriginRequestHandler.mockRejectedValue(new Error('Handler error'));
      
      const result = await handler(event);
      
      expect(result.status).toBe(500);
      expect(result.body).toContain('Handler error');
    });

    it('should include error message in response body', async () => {
      const event = createMockEvent({ 
        uri: '/app/page',
        host: 'example.com'
      });
      
      mockOriginRequestHandler.mockRejectedValue(new Error('SAML configuration error'));
      
      const result = await handler(event);
      
      expect(result.body).toContain('SAML configuration error');
      expect(result.headers['content-type']).toBeDefined();
      expect(result.headers['content-type'][0].value).toBe('text/plain');
    });
  });

  describe('Event structure compatibility', () => {
    it('should handle viewer request event structure', async () => {
      const event = {
        Records: [{
          cf: {
            request: {
              uri: '/test',
              querystring: '',
              headers: {
                host: [{ key: 'Host', value: 'test.com' }]
              }
            }
          }
        }]
      };
      
      mockOriginRequestHandler.mockResolvedValue({ uri: '/test', headers: {} } as any);
      
      await handler(event);
      
      // Should successfully process event
      expect(mockOriginRequestHandler).toHaveBeenCalledWith(event);
    });

    it('should pass through entire event object to origin handler', async () => {
      const event = createMockEvent({ 
        uri: '/api/data',
        querystring: 'filter=active',
        host: 'api.example.com',
        headers: {
          'content-type': [{ key: 'Content-Type', value: 'application/json' }]
        }
      });
      
      mockOriginRequestHandler.mockResolvedValue({ uri: '/api/data', headers: {} } as any);
      
      await handler(event);
      
      // Verify entire event structure was passed
      const calledWith = mockOriginRequestHandler.mock.calls[0][0] as any;
      expect(calledWith.Records[0].cf.request.uri).toBe('/api/data');
      expect(calledWith.Records[0].cf.request.querystring).toBe('filter=active');
      expect(calledWith.Records[0].cf.request.headers['content-type']).toBeDefined();
    });
  });
});
