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
        routingType: 'redirect',
        redirectStatus: 301,
        redirectTarget: 'https://www.bu.edu/new-page',
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
        routingType: 'redirect',
        redirectStatus: 302,
        redirectTarget: 'https://www.bu.edu/temporary',
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
  });

  describe('when routing rule is a cluster routing', () => {
    it('should modify origin and delegate to auth handler', async () => {
      const clusterRule: RoutingRule = {
        path: '/admissions',
        routingType: 'cluster',
        targetOrigin: 'wp-alpha-alb-123.us-east-2.elb.amazonaws.com',
      };
      mockGetRoutingRule.mockResolvedValue(clusterRule);
      const event = createMockEvent('/admissions');
      
      await handler(event);
      
      expect(mockGetRoutingRule).toHaveBeenCalledWith('/admissions', expect.any(Object));
      expect(event.Records[0].cf.request.origin.custom.domainName).toBe(
        'wp-alpha-alb-123.us-east-2.elb.amazonaws.com'
      );
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('when routing rule is static S3 routing', () => {
    it('should modify origin and delegate to auth handler', async () => {
      const staticRule: RoutingRule = {
        path: '/assets',
        routingType: 'static',
        targetOrigin: 'bu-static-assets.s3.amazonaws.com',
      };
      mockGetRoutingRule.mockResolvedValue(staticRule);
      const event = createMockEvent('/assets/logo.png');
      
      await handler(event);
      
      expect(event.Records[0].cf.request.origin.custom.domainName).toBe(
        'bu-static-assets.s3.amazonaws.com'
      );
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });

  describe('when routing rule is PHP app routing', () => {
    it('should modify origin and delegate to auth handler', async () => {
      const phpRule: RoutingRule = {
        path: '/phpbin',
        routingType: 'php',
        targetOrigin: 'phpbin-alb-456.us-east-2.elb.amazonaws.com',
      };
      mockGetRoutingRule.mockResolvedValue(phpRule);
      const event = createMockEvent('/phpbin/app');
      
      await handler(event);
      
      expect(event.Records[0].cf.request.origin.custom.domainName).toBe(
        'phpbin-alb-456.us-east-2.elb.amazonaws.com'
      );
      expect(mockAuthHandler).toHaveBeenCalledWith(event);
    });
  });
});
