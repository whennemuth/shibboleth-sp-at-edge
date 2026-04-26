import { LambdaEdgeOriginRequestEvent } from '../OriginRequestEventType';
import { handler as authHandler } from '../FunctionSpOriginRequest';
import { getRoutingRule, RoutingCacheConfig } from './RoutingCache';
import { RoutingRule } from './types';
import { IContext } from '../../../context/IContext';
import * as contextJSON from '../../../context/context.json';

const context = contextJSON as IContext;

// Initialize routing config if enabled
const routingConfig: RoutingCacheConfig | null = context.ROUTING?.enabled
  ? {
      tableName: context.ROUTING.tableName || `${context.STACK_ID}-routing-table-${context.TAGS.Landscape}`,
      ttlSeconds: context.ROUTING.cacheTtlSeconds || 300,
      region: context.REGION,  // Pass the region from context (where DynamoDB table is deployed)
    }
  : null;

/**
 * Apply a routing rule to the request.
 * 
 * For redirects: Returns CloudFront response immediately (skips auth, no origin contact).
 * For origin routing: Modifies request.origin and returns null to continue to auth handler.
 * 
 * CRITICAL: customHeaders must be empty. The auth handler adds cloudfront-challenge 
 * and other headers to request.headers. Headers cannot exist in both places simultaneously
 * or CloudFront returns 502 "invalid origin configuration" error.
 */
function applyRoutingRule(
  request: any,
  rule: RoutingRule
): any {
  switch (rule.routingType) {
    case 'cluster':
    case 'static':
    case 'php':
      // Replace request.origin to route to a different ALB/origin.
      // Host header is NOT modified - WordPress multisite uses it for site selection.
      // CloudFront uses domainName for TLS connection (SNI); Host header is application-level.
      request.origin = {
        custom: {
          domainName: rule.targetOrigin,
          port: 443,
          protocol: 'https',
          path: '',
          sslProtocols: ['TLSv1.2'],
          readTimeout: 60,
          keepaliveTimeout: 5,
          customHeaders: {},  // Empty - auth handler adds challenge/app_authorization to request.headers
        },
      };
      console.log(`[Routing] Modified origin to ${rule.targetOrigin} (${rule.routingType})`);
      return null; // Continue to auth handler
      
    case 'redirect':
      // Return redirect response immediately (skip auth)
      console.log(`[Routing] Returning redirect ${rule.redirectStatus} → ${rule.redirectTarget}`);
      return {
        status: rule.redirectStatus,
        statusDescription: getRedirectDescription(rule.redirectStatus),
        headers: {
          location: [{ key: 'Location', value: rule.redirectTarget }],
        },
      };
      
    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = rule;
      console.error(`[Routing] Unknown routing type: ${JSON.stringify(rule)}`);
      return null;
  }
}

function getRedirectDescription(status: number): string {
  const descriptions: Record<number, string> = {
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
  };
  return descriptions[status] || 'Redirect';
}

/**
 * Routing handler wrapper.
 * If routing is enabled, checks for routing rules and applies them.
 * If no routing match or routing disabled, delegates to auth handler.
 * 
 * This wrapper pattern keeps auth handler (FunctionSpOriginRequest) unchanged.
 */
export const handler = async (event: LambdaEdgeOriginRequestEvent) => {
  console.log(`[Routing] Handler invoked for URI: ${event.Records[0].cf.request.uri}`);
  
  // If routing is disabled, pass through to auth handler immediately
  if (!routingConfig) {
    console.log('[Routing] Routing disabled, delegating to auth handler');
    return authHandler(event);
  }

  const { request } = event.Records[0].cf;
  const { uri } = request;

  // Check for routing rule
  const rule = await getRoutingRule(uri, routingConfig);
  
  if (!rule) {
    // No routing rule matched, proceed to auth handler with default origin
    console.log('[Routing] No rule matched, delegating to auth handler');
    return authHandler(event);
  }

  // Apply routing rule
  const redirectResponse = applyRoutingRule(request, rule);
  
  if (redirectResponse) {
    // Redirect: return response immediately, skip auth
    return redirectResponse;
  }

  // Origin routing: request.origin was modified, continue to auth
  console.log('[Routing] Origin modified, delegating to auth handler');
  return authHandler(event);
};
