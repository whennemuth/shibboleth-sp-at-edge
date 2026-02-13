import { IConfig, IRequest, IResponse, SamlParms, handler as spHandler } from 'shibboleth-sp';
import { IContext, Shibboleth } from '../../context/IContext';
import * as contextJSON from '../../context/context.json';
import { instanceOf } from '../Util';
import { CLOUDFRONT_CHALLENGE_HEADER_NAME } from '../secrets/Secret';
import { VIEWER_DOMAIN_HEADER_NAME } from './FunctionSpViewerRequest';
import { LambdaEdgeOriginRequestEvent } from './OriginRequestEventType';
import { CachedKeys, checkCache } from './SecretsCache';

const context = contextJSON as IContext;
const { APP_LOGIN_HEADER, APP_LOGOUT_HEADER, SHIBBOLETH, ORIGIN: { appAuthorization = true } = {} } = context;
const { entityId, entryPoint, logoutUrl, idpCert } = SHIBBOLETH as Shibboleth;

const cachedKeys:CachedKeys = { 
  _timestamp: 0, /* One hour */ 
  samlCert: '', samlPrivateKey: '', jwtPrivateKey: '', jwtPublicKey: '', cloudfrontChallenge: ''
};

// Perform cold-start loading of global cache by fetching saml cert and private key.
checkCache(cachedKeys).then(() => {
  console.log('Cache initialized');
});

/**
 * This is the lambda@edge function for origin request traffic. It handles the full SAML Service Provider
 * operations including processing SAML assertions with potentially large POST bodies (up to 1 MB).
 * 
 * ARCHITECTURE OVERVIEW:
 * This Lambda works in tandem with the viewer request Lambda to provide both security and performance:
 * 
 * - Viewer Request Lambda: Runs on EVERY request (including cache hits)
 *   * Validates JWT tokens
 *   * Detects SAML flow requests
 *   * Marks requests that need auth processing to bypass cache
 *   * Allows authenticated requests to use cache
 * 
 * - Origin Request Lambda (THIS FUNCTION): Only runs when:
 *   * Cache miss occurs
 *   * Viewer request Lambda marked request as needing authentication (JWT invalid/missing)
 *   * Request is part of SAML flow (callbacks, logout, etc.)
 * 
 * RESPONSIBILITIES:
 * - Process SAML POST bodies (can be > 40 KB, which exceeds viewer request limit)
 * - Perform full JWT validation and refresh
 * - Handle SAML authentication flow with IdP
 * - Generate authentication tokens
 * - If APP_AUTHORIZATION is true, coordinate with application for authorization decisions
 * 
 * CACHING STRATEGY:
 * Unlike the previous approach, caching is NOT fully disabled. Instead:
 * - Authenticated requests with valid JWTs can be served from cache
 * - Only authentication-related requests bypass cache (via viewer request Lambda control)
 * - This provides better performance while maintaining security
 * 
 * BODY SIZE LIMIT:
 * This Lambda supports request/response bodies up to 1 MB (vs 40 KB for viewer request).
 * SAML assertions typically range from 20-100+ KB, making origin request the appropriate choice
 * for SAML processing despite it potentially being bypassed by cache for already-authenticated users.
 * 
 * @param event 
 * @returns 
 */
export const handler =  async (event:LambdaEdgeOriginRequestEvent) => {
  console.log(`EVENT: ${JSON.stringify(event, null, 2)}`);

  // "Poke" the cache in case of stale items and the need to refresh itself.
  await checkCache(cachedKeys);
  const { samlPrivateKey, samlCert, jwtPrivateKey, jwtPublicKey, cloudfrontChallenge } = cachedKeys;

  // Destructure most variables
  const { request, config } = event.Records[0].cf;
  const { uri, body, headers, method, querystring, clientIp } = request;

  // The viewer request lambda will have set this header from what it saw in the host header.
  const viewerDomain = headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()]?.[0]?.value;
  if( ! viewerDomain ) {
    console.warn(`
      WARNING!!! Viewer domain header ${VIEWER_DOMAIN_HEADER_NAME} not found in request headers.
      This will disrupt SAML operations for function URL origins that depend on knowing the viewer 
      domain when the origin request policy is set to ALL_VIEWER_EXCEPT_HOST_HEADER, and the viewer 
      host is swapped with the origin host by the time the origin request lambda runs. This is not a
      concern for ALB/S3 origins where the origin request policy is ALL_VIEWER, and the host header
      remains the viewer host.`);
  }

  // Get the host header as it is now.
  const originDomain = headers['host']?.[0]?.value;

  // We want the viewer domain if available, else the origin domain (see warning above).
  const domain = viewerDomain ? viewerDomain : originDomain;

  console.log(`Using ${JSON.stringify({ domain, appAuthorization }, null, 2)}`);

  // Build an sp request parameter from incoming request
  const spRequest = { uri, body, headers, method, querystring, clientIp, headerActivity: {
    added: {}, modified: {}, removed: {}
  }} as IRequest;

  // Build an sp config parameter from context, secrets, and other values
  const spConfig = {
    appAuthorization,
    appLoginHeader: APP_LOGIN_HEADER,
    appLogoutHeader: APP_LOGOUT_HEADER,
    domain,
    samlParms: { entityId, entryPoint, idpCert, logoutUrl, key: samlPrivateKey, cert: samlCert } as SamlParms,
    customHeaders: [
      { key: CLOUDFRONT_CHALLENGE_HEADER_NAME, value: cloudfrontChallenge }
    ],
    jwtPrivateKeyPEM: jwtPrivateKey,
    jwtPublicKeyPEM: jwtPublicKey
  } as IConfig

  // Call the sp handler.
  const retval:IRequest|IResponse = await spHandler(spRequest, spConfig);

  // Lambda@Edge functions return the original request if it is to be passed through to the origin.
  // The sp handler follows a similar logic - a return type or IReturn indicates the same thing.
  const passRequestThroughToOrigin = (): boolean => {
    return instanceOf<IRequest>(retval, "uri");
  }

  if(passRequestThroughToOrigin()) {
    // If the sp output a return value that indicates it added some headers, add them also to the event request object.
    const spRequest = retval as IRequest;
    const { headerActivity: { added }} = spRequest;
    Object.keys(added).forEach(key => {
      request.headers[key.toLowerCase()] = [{
        key, value: spRequest.headers[key.toLowerCase()][0].value
      }]    
    });

    // Returning the original request will cause a pass-through to the origin.
    return request;
  }
  else {
    // Returning something other than the original request will "bounce" the request back as specified in IResponse.
    return retval as IResponse;
  }
};



