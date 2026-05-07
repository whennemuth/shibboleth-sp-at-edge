import { LambdaEdgeOriginRequestEvent } from '../OriginRequestEventType';
import { RoutingRule } from './types';

// Mock dependencies
jest.mock('../FunctionSpOriginRequest', () => ({
  handler: jest.fn().mockResolvedValue({ uri: '/test', headers: {} }),
}));

jest.mock('./RoutingCache', () => ({
  getRoutingRule: jest.fn(),
}));

jest.mock('../../../context/context.json', () => ({
  ROUTING: {
    enabled: true,
    tableName: 'test-routing-table',
    cacheTtlSeconds: 300,
  },
  STACK_ID: 'test-stack',
  TAGS: {
    Landscape: 'test',
  },
}));

import { handler } from './routing-handler';
import { handler as authHandler } from '../FunctionSpOriginRequest';
import { getRoutingRule } from './RoutingCache';

const mockAuthHandler = authHandler as jest.MockedFunction<typeof authHandler>;
const mockGetRoutingRule = getRoutingRule as jest.MockedFunction<typeof getRoutingRule>;

describe('routing-handler', () => {
  const createMockEvent = (uri: string = '/test', origin?: any): LambdaEdgeOriginRequestEvent => ({
    Records: [
      {
        cf: {
          request: {
            uri,
            headers: {},
            method: 'GET',
            querystring: '',
            clientIp: '192.168.1.1',
            origin: origin || {
              custom: {
                domainName: 'default-origin.example.com',
                port: 443,
                protocol: 'https',
                path: '',
                sslProtocols: ['TLSv1.2'],
                readTimeout: 60,
                keepaliveTimeout: 5,
                customHeaders: {},
              },
            },
          },
          config: {
            distributionDomainName: 'test.cloudfront.net',
            distributionId: 'TEST123',
            eventType: 'origin-request',
            requestId: 'test-request-id',
          },
        },
      },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when no routing rule matches', () => {
    it('should delegate to auth handler', async () => {
      mockGetRoutingRule.mockResolvedValue(null);
      const event = createMockEvent('/admissions');
      
      await handler(event);
      
      expect(mockGetRoutingRule).toHaveBeenCalledWith('/admissions', expect.any(Object));
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('when routing rule is a redirect', () => {
    it('should return redirect response without calling auth handler', async () => {
      const redirectRule: RoutingRule = {
        path: '/old-page',
        action: 'redirect',
        redirectStatus: 301,
        target: 'https://www.bu.edu/new-page',
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/old-page');
      
      const result = await handler(event);
      
      expect(mockGetRoutingRule).toHaveBeenCalledWith('/old-page', expect.any(Object));
      expect(mockAuthHandler).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          location: [{ key: 'Location', value: 'https://www.bu.edu/new-page' }],
        },
      });
    });

    it('should handle 302 redirect', async () => {
      const redirectRule: RoutingRule = {
        path: '/temp-redirect',
        action: 'redirect',
        redirectStatus: 302,
        target: 'https://www.bu.edu/temporary',
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/temp-redirect');
      
      const result = await handler(event);
      
      expect(result).toEqual({
        status: 302,
        statusDescription: 'Found',
        headers: {
          location: [{ key: 'Location', value: 'https://www.bu.edu/temporary' }],
        },
      });
    });

    it('should preserve query string when preserveQuery is true', async () => {
      const redirectRule: RoutingRule = {
        path: '/old-page',
        action: 'redirect',
        redirectStatus: 301,
        target: 'https://www.bu.edu/new-page',
        preserveQuery: true,
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/old-page');
      event.Records[0].cf.request.querystring = 'foo=1&bar=2';
      
      const result = await handler(event);
      
      expect(result).toEqual({
        status: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          location: [{ key: 'Location', value: 'https://www.bu.edu/new-page?foo=1&bar=2' }],
        },
      });
    });

    it('should not preserve query string when preserveQuery is false', async () => {
      const redirectRule: RoutingRule = {
        path: '/old-page',
        action: 'redirect',
        redirectStatus: 301,
        target: 'https://www.bu.edu/new-page',
        preserveQuery: false,
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/old-page');
      event.Records[0].cf.request.querystring = 'foo=1&bar=2';
      
      const result = await handler(event);
      
      expect(result).toEqual({
        status: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          location: [{ key: 'Location', value: 'https://www.bu.edu/new-page' }],
        },
      });
    });

    it('should not preserve query string when preserveQuery is omitted', async () => {
      const redirectRule: RoutingRule = {
        path: '/old-page',
        action: 'redirect',
        redirectStatus: 301,
        target: 'https://www.bu.edu/new-page',
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/old-page');
      event.Records[0].cf.request.querystring = 'foo=1&bar=2';
      
      const result = await handler(event);
      
      expect(result).toEqual({
        status: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          location: [{ key: 'Location', value: 'https://www.bu.edu/new-page' }],
        },
      });
    });
  });

  describe('when routing rule is an origin routing', () => {
    it('should modify origin and delegate to auth handler', async () => {
      const originRule: RoutingRule = {
        path: '/admissions',
        action: 'origin',
        target: 'wp-alpha-alb-123.us-east-2.elb.amazonaws.com',
      };
      mockGetRoutingRule.mockResolvedValue(originRule);
      const event = createMockEvent('/admissions');
      
      await handler(event);
      
      expect(mockGetRoutingRule).toHaveBeenCalledWith('/admissions', expect.any(Object));
      expect(event.Records[0].cf.request.origin.custom.domainName).toBe(
        'wp-alpha-alb-123.us-east-2.elb.amazonaws.com'
      );
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });

    it('should modify origin for S3 target', async () => {
      const originRule: RoutingRule = {
        path: '/assets',
        action: 'origin',
        target: 'bu-static-assets.s3.amazonaws.com',
      };
      mockGetRoutingRule.mockResolvedValue(originRule);
      const event = createMockEvent('/assets/logo.png');
      
      await handler(event);
      
      expect(event.Records[0].cf.request.origin.custom.domainName).toBe(
        'bu-static-assets.s3.amazonaws.com'
      );
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('exact-match rules', () => {
    it('should match exact path for exact-match rule', async () => {
      const exactRule: RoutingRule = {
        path: '/studentlink',
        action: 'redirect',
        matchType: 'exact',
        redirectStatus: 301,
        target: 'https://www.bu.edu/link',
      };
      mockGetRoutingRule.mockResolvedValue(exactRule);
      const event = createMockEvent('/studentlink');
      
      const result = await handler(event);
      
      expect(mockGetRoutingRule).toHaveBeenCalledWith('/studentlink', expect.any(Object));
      expect(result).toEqual({
        status: 301,
        statusDescription: 'Moved Permanently',
        headers: {
          location: [{ key: 'Location', value: 'https://www.bu.edu/link' }],
        },
      });
    });

    it('should not match sub-path for exact-match rule', async () => {
      // Mock returns null for /studentlink/foo (exact-match rule filtered by cache)
      mockGetRoutingRule.mockResolvedValue(null);
      const event = createMockEvent('/studentlink/foo');
      
      await handler(event);
      
      expect(mockGetRoutingRule).toHaveBeenCalledWith('/studentlink/foo', expect.any(Object));
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('disabled rules', () => {
    it('should fall through when rule is disabled', async () => {
      // Disabled rules are filtered by cache layer, so getRoutingRule returns null
      mockGetRoutingRule.mockResolvedValue(null);
      const event = createMockEvent('/disabled-path');
      
      await handler(event);
      
      expect(mockGetRoutingRule).toHaveBeenCalledWith('/disabled-path', expect.any(Object));
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('rewriteHostHeader', () => {
    it('should rewrite Host header when rewriteHostHeader is true', async () => {
      const originRule: RoutingRule = {
        path: '/static-test',
        action: 'origin',
        target: 'static-sites-prod-public.s3-website-us-east-1.amazonaws.com',
        rewriteHostHeader: true,
      };
      mockGetRoutingRule.mockResolvedValue(originRule);
      const event = createMockEvent('/static-test');
      event.Records[0].cf.request.headers.host = [{ key: 'Host', value: 'www.bu.edu' }];
      
      await handler(event);
      
      expect(event.Records[0].cf.request.headers.host[0].value).toBe(
        'static-sites-prod-public.s3-website-us-east-1.amazonaws.com'
      );
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });

    it('should preserve original Host header when rewriteHostHeader is false or omitted', async () => {
      const originRule: RoutingRule = {
        path: '/admissions',
        action: 'origin',
        target: 'wp-cluster-alb.example.com',
        // rewriteHostHeader omitted (defaults to false)
      };
      mockGetRoutingRule.mockResolvedValue(originRule);
      const event = createMockEvent('/admissions');
      event.Records[0].cf.request.headers.host = [{ key: 'Host', value: 'www.bu.edu' }];
      
      await handler(event);
      
      expect(event.Records[0].cf.request.headers.host[0].value).toBe('www.bu.edu');
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('originPath', () => {
    it('should set origin path when originPath is provided', async () => {
      const originRule: RoutingRule = {
        path: '/people-test',
        action: 'origin',
        target: 'ist-web-static-sites-prod.bu.edu',
        originPath: '/_domains/people.bu.edu',
      };
      mockGetRoutingRule.mockResolvedValue(originRule);
      const event = createMockEvent('/people-test');
      
      await handler(event);
      
      expect(event.Records[0].cf.request.origin.custom.path).toBe('/_domains/people.bu.edu');
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });

    it('should set origin path to empty string when originPath is omitted', async () => {
      const originRule: RoutingRule = {
        path: '/admissions',
        action: 'origin',
        target: 'wp-cluster-alb.example.com',
        // originPath omitted
      };
      mockGetRoutingRule.mockResolvedValue(originRule);
      const event = createMockEvent('/admissions');
      
      await handler(event);
      
      expect(event.Records[0].cf.request.origin.custom.path).toBe('');
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('preservePath', () => {
    it('should append request URI when preservePath is true', async () => {
      const redirectRule: RoutingRule = {
        path: '/parking',
        action: 'redirect',
        redirectStatus: 302,
        target: 'https://www.bu.edu/parking-and-transportation',
        preservePath: true,
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/parking/permits/staff');
      
      const result = await handler(event);
      
      expect(result).toEqual({
        status: 302,
        statusDescription: 'Found',
        headers: {
          location: [{ 
            key: 'Location', 
            value: 'https://www.bu.edu/parking-and-transportation/parking/permits/staff' 
          }],
        },
      });
    });

    it('should not append request URI when preservePath is false or omitted', async () => {
      const redirectRule: RoutingRule = {
        path: '/agganis',
        action: 'redirect',
        redirectStatus: 302,
        target: 'https://www.agganisarena.com',
        // preservePath omitted (defaults to false)
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/agganis/some/path');
      
      const result = await handler(event);
      
      expect(result).toEqual({
        status: 302,
        statusDescription: 'Found',
        headers: {
          location: [{ key: 'Location', value: 'https://www.agganisarena.com' }],
        },
      });
    });

    it('should append both path and query string when both preservePath and preserveQuery are true', async () => {
      const redirectRule: RoutingRule = {
        path: '/foo',
        action: 'redirect',
        redirectStatus: 302,
        target: 'https://example.com/new',
        preservePath: true,
        preserveQuery: true,
      };
      mockGetRoutingRule.mockResolvedValue(redirectRule);
      const event = createMockEvent('/foo/bar');
      event.Records[0].cf.request.querystring = 'a=1&b=2';
      
      const result = await handler(event);
      
      expect(result).toEqual({
        status: 302,
        statusDescription: 'Found',
        headers: {
          location: [{ key: 'Location', value: 'https://example.com/new/foo/bar?a=1&b=2' }],
        },
      });
    });
  });
});
