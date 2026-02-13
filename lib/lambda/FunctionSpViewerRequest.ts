import { AUTH_PATHS } from 'shibboleth-sp';
import { handler as originRequestHandler } from './FunctionSpOriginRequest';

export const VIEWER_DOMAIN_HEADER_NAME = 'VIEWER_DOMAIN';

/**
 * This is the lambda@edge function for viewer request traffic. It runs on EVERY request, including those
 * that might be served from cache.
 * 
 * ARCHITECTURE:
 * The shibboleth-sp handler already contains all the logic for:
 * - JWT validation (checks cookies, verifies signature, checks expiration)
 * - SAML flow detection (AUTH_PATHS.LOGIN, AUTH_PATHS.ASSERT, AUTH_PATHS.LOGOUT, etc.)
 * - Authentication determination (decides if request needs auth or can pass through)
 * - Cookie parsing and token extraction
 * 
 * SPLIT LAMBDA STRATEGY:
 * - Viewer Request (THIS FUNCTION): Reuses origin request handler logic for ALL requests EXCEPT ASSERT
 * - Origin Request: Handles ONLY AUTH_PATHS.ASSERT which contains large SAML POST bodies (20-100+ KB)
 *   that exceed the 40 KB viewer request body limit
 * 
 * CACHING:
 * - Requests with valid JWTs pass through and may hit cache
 * - Requests needing authentication are handled by spHandler (redirects, etc.)
 * - Only SAML assertion callbacks bypass cache to origin request Lambda
 * 
 * FUNCTION URL COMPATIBILITY:
 * For function URL origins with ALL_VIEWER_EXCEPT_HOST_HEADER policy, we preserve the viewer domain
 * in a custom header so the origin request Lambda can build proper IDP redirects.
 * 
 * @param event CloudFront viewer request event
 * @returns Modified request to pass through, or response to return directly
 */
export const handler = async (event: any) => {
  try {
    console.log(JSON.stringify(event, null, 2));

    const { request, request: { headers = {}, uri = '' } = {} } = event.Records[0].cf;
    const viewerDomain = headers['host']?.[0]?.value;

    /**
     * Preserve viewer domain for function URL origins.
     * When origin request policy is ALL_VIEWER_EXCEPT_HOST_HEADER, the Host header gets replaced
     * with the origin host. The origin request Lambda needs the viewer domain to construct
     * proper redirect URLs back to the IDP.
     */
    request.headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()] = [
      { key: VIEWER_DOMAIN_HEADER_NAME, value: viewerDomain }
    ];

    /**
     * SAML assertion callbacks contain large POST bodies (SAML XML assertions, often 20-100+ KB).
     * These exceed the 40 KB body limit for viewer request Lambdas, so we bypass cache and let
     * the origin request Lambda handle them (which supports up to 1 MB bodies).
     */
    if (uri === AUTH_PATHS.ASSERT) {
      console.log('SAML assertion request detected - bypassing cache for origin request handler');
      
      // Force cache bypass so origin request Lambda processes this
      request.headers['cache-control'] = [{
        key: 'Cache-Control',
        value: 'no-cache, no-store, must-revalidate, private'
      }];
      
      return request;
    }

    /**
     * For all other requests, reuse the origin request handler logic.
     * The event object of this handler is similar enough to the origin request event that we can pass it through with minimal adjustments.
     * This avoids code duplication - the origin handler already knows how to:
     * - Build spConfig from context
     * - Call spHandler with proper configuration
     * - Handle all authentication flows
     */
    return await originRequestHandler(event);
  }
  catch (error: any) {
    console.error('Viewer request lambda error:', error);
    return {
      status: 500,
      statusDescription: 'Internal Server Error',
      body: `Viewer request lambda error: ${error.message}`,
      headers: {
        'content-type': [{ key: 'Content-Type', value: 'text/plain' }]
      }
    };
  }
};