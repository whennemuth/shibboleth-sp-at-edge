/**
 * Tests for the CloudFront Function routing logic
 * 
 * These tests verify the longest-prefix-match algorithm, KVS value parsing,
 * and routing rule application for redirects and origin selection.
 */

import * as fs from 'fs';
import * as path from 'path';

// Mock the CloudFront module before importing function code
jest.mock('cloudfront');
const cf = require('cloudfront');

describe('CloudFront Routing Function', () => {
  let handler: (event: any) => Promise<any>;
  let applyRule: (request: any, value: string) => any;

  beforeAll(() => {
    // Load and evaluate the CloudFront Function source
    const functionPath = path.join(__dirname, 'routing-function.js');
    const functionCode = fs.readFileSync(functionPath, 'utf8');
    
    // Create a module context to evaluate the function
    const moduleContext = { cf, console };
    const evalContext = `
      ${functionCode}
      return { handler, applyRule };
    `;
    const createModule = new Function('cf', 'console', evalContext);
    const module = createModule(cf, console);
    
    handler = module.handler;
    applyRule = module.applyRule;
  });

  beforeEach(() => {
    cf._clearMockData();
    jest.clearAllMocks();
  });

  describe('Longest-prefix-match routing', () => {
    it('should match exact path on first lookup', async () => {
      cf._setMockData({
        '/admissions': 'R:301:https://www.bu.edu/admissions-new'
      });

      const event = {
        request: {
          uri: '/admissions',
          headers: { host: { value: 'www.bu.edu' } }
        }
      };

      const result = await handler(event);
      
      expect(result.statusCode).toBe(301);
      expect(result.headers.location.value).toBe('https://www.bu.edu/admissions-new');
    });

    it('should match 2-segment prefix when full path not found', async () => {
      cf._setMockData({
        '/cas/biology': 'C:wp-alpha-alb.us-east-2.elb.amazonaws.com'
      });

      const event = {
        request: {
          uri: '/cas/biology/faculty/smith',
          headers: { host: { value: 'www.bu.edu' } }
        }
      };

      const result = await handler(event);
      
      expect(cf.updateRequestOrigin).toHaveBeenCalledWith({
        domainName: 'wp-alpha-alb.us-east-2.elb.amazonaws.com',
        port: 443,
        protocol: 'https',
        sslProtocols: ['TLSv1.2']
      });
      expect(result.uri).toBe('/cas/biology/faculty/smith');
    });

    it('should match 1-segment prefix when 2-segment not found', async () => {
      cf._setMockData({
        '/cas': 'C:wp-beta-alb.us-east-2.elb.amazonaws.com'
      });

      const event = {
        request: {
          uri: '/cas/unknown/deep/path',
          headers: { host: { value: 'www.bu.edu' } }
        }
      };

      const result = await handler(event);
      
      expect(cf.updateRequestOrigin).toHaveBeenCalledWith({
        domainName: 'wp-beta-alb.us-east-2.elb.amazonaws.com',
        port: 443,
        protocol: 'https',
        sslProtocols: ['TLSv1.2']
      });
    });

    it('should fall through to default origin when no KVS match', async () => {
      // No KVS entries

      const event = {
        request: {
          uri: '/nonexistent/path',
          headers: { host: { value: 'www.bu.edu' } }
        }
      };

      const result = await handler(event);
      
      expect(result.uri).toBe('/nonexistent/path');
      expect(cf.updateRequestOrigin).not.toHaveBeenCalled();
    });
  });

  describe('Path normalization', () => {
    it('should lowercase the path', async () => {
      cf._setMockData({
        '/admissions': 'R:301:https://www.bu.edu/new'
      });

      const event = {
        request: {
          uri: '/ADMISSIONS',
          headers: { host: { value: 'www.bu.edu' } }
        }
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(301);
    });

    it('should remove trailing slashes', async () => {
      cf._setMockData({
        '/admissions': 'R:301:https://www.bu.edu/new'
      });

      const event = {
        request: {
          uri: '/admissions/',
          headers: { host: { value: 'www.bu.edu' } }
        }
      };

      const result = await handler(event);
      expect(result.statusCode).toBe(301);
    });

    it('should handle root path', async () => {
      cf._setMockData({
        '/': 'C:wp-home.us-east-2.elb.amazonaws.com'
      });

      const event = {
        request: {
          uri: '/',
          headers: { host: { value: 'www.bu.edu' } }
        }
      };

      const result = await handler(event);
      expect(cf.updateRequestOrigin).toHaveBeenCalled();
    });
  });

  describe('Redirect rules (R:)', () => {
    it('should return 301 redirect', async () => {
      const request = { uri: '/test' };
      const result = applyRule(request, 'R:301:https://example.com/new');

      expect(result.statusCode).toBe(301);
      expect(result.statusDescription).toBe('Moved Permanently');
      expect(result.headers.location.value).toBe('https://example.com/new');
    });

    it('should return 302 redirect', async () => {
      const request = { uri: '/test' };
      const result = applyRule(request, 'R:302:https://example.com/temp');

      expect(result.statusCode).toBe(302);
      expect(result.statusDescription).toBe('Found');
      expect(result.headers.location.value).toBe('https://example.com/temp');
    });
  });

  describe('Cluster routing (C:)', () => {
    it('should call updateRequestOrigin with ALB domain', () => {
      const request = { uri: '/test' };
      const result = applyRule(request, 'C:wp-alpha-alb-123.us-east-2.elb.amazonaws.com');

      expect(cf.updateRequestOrigin).toHaveBeenCalledWith({
        domainName: 'wp-alpha-alb-123.us-east-2.elb.amazonaws.com',
        port: 443,
        protocol: 'https',
        sslProtocols: ['TLSv1.2']
      });
      expect(result).toBe(request);
    });
  });

  describe('Static S3 routing (S:)', () => {
    it('should call updateRequestOrigin with S3 domain', () => {
      const request = { uri: '/test' };
      const result = applyRule(request, 'S:bu-static-content.s3.amazonaws.com');

      expect(cf.updateRequestOrigin).toHaveBeenCalledWith({
        domainName: 'bu-static-content.s3.amazonaws.com'
      });
      expect(result).toBe(request);
    });
  });

  describe('PHP app routing (P:)', () => {
    it('should call updateRequestOrigin with PHP ALB domain', () => {
      const request = { uri: '/test' };
      const result = applyRule(request, 'P:phpbin-alb.us-east-2.elb.amazonaws.com');

      expect(cf.updateRequestOrigin).toHaveBeenCalledWith({
        domainName: 'phpbin-alb.us-east-2.elb.amazonaws.com'
      });
      expect(result).toBe(request);
    });
  });

  describe('Malformed values', () => {
    it('should pass through when value has no colon', () => {
      const request = { uri: '/test' };
      const result = applyRule(request, 'INVALID');

      expect(result).toBe(request);
      expect(cf.updateRequestOrigin).not.toHaveBeenCalled();
    });

    it('should pass through when type is unknown', () => {
      const request = { uri: '/test' };
      const result = applyRule(request, 'X:unknown-type');

      expect(result).toBe(request);
      expect(cf.updateRequestOrigin).not.toHaveBeenCalled();
    });
  });
});
