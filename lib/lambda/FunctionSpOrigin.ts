import { IConfig, IRequest, IResponse, SamlParms, handler as spHandler } from 'shibboleth-sp';
import { IContext, Shibboleth } from '../../context/IContext';
import * as contextJSON from '../../context/context.json';
import { ParameterTester, instanceOf } from '../Util';
import { LambdaEdgeOriginRequestEvent } from './OriginRequestEventType';
import { CachedKeys, checkCache } from './Secrets';

const context = contextJSON as IContext;
const { APP_LOGIN_HEADER, APP_LOGOUT_HEADER, CLOUDFRONT_CHALLENGE_HEADER, SHIBBOLETH } = context;
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
 * This is the lambda@edge function for origin request traffic. It will perform all saml SP operations for ensuring
 * that the user bears JWT proof of saml authentication, else it drives the authentication flow with the IDP.
 * If the APP_AUTHORIZATION environment/context variable is set to true, it will relinquish the "decision" to make the
 * redirect to the IDP for authentication to the app (but will handle all other parts of the SP/IDP process).
 * 
 * NOTE: It would have been preferable to have designated this function for viewer requests so that it could 
 * intercept EVERY request instead of potentially being bypassed in favor of cached content. However, the content
 * of this function exceeds the 1MB limit for viewer requests. Origin request lambdas can be up to 50MB, and so
 * must be used, and caching for the origin is disabled altogether to ensure EVERY request goes through this function.
 * @param event 
 * @returns 
 */
export const handler =  async (event:LambdaEdgeOriginRequestEvent) => {
  console.log(`EVENT: ${JSON.stringify(event, null, 2)}`);

  // "Poke" the cache in case of stale items and the need to refresh itself.
  await checkCache(cachedKeys);
  const { samlPrivateKey, samlCert, jwtPrivateKey, jwtPublicKey, cloudfrontChallenge } = cachedKeys;

  // Destructure most variables
  const { noneBlank } = ParameterTester;
  const { DNS, ORIGIN } = context;
  const { certificateARN, hostedZone } = DNS ?? {};
  const { subdomain, appAuthorization } = ORIGIN ?? {};
  const { request, config } = event.Records[0].cf;
  const { uri, body, headers, method, querystring, clientIp, origin } = request;

  // Set the cloudfront domain value
  let cloudfrontDomain = config.distributionDomainName;
  if(noneBlank(certificateARN, hostedZone, subdomain)) {
    cloudfrontDomain = subdomain!;
  }
  else if(noneBlank(certificateARN, hostedZone)) {
    cloudfrontDomain = `testing123.${hostedZone}`;
  }

  // Build an sp request parameter from incoming request
  const spRequest = { uri, body, headers, method, querystring, clientIp, headerActivity: {
    added: {}, modified: {}, removed: {}
  }} as IRequest;

  // Build an sp config parameter from context, secrets, and other values
  const spConfig = {
    appAuthorization,
    appLoginHeader: APP_LOGIN_HEADER,
    appLogoutHeader: APP_LOGOUT_HEADER,
    domain: cloudfrontDomain,
    samlParms: { entityId, entryPoint, idpCert, logoutUrl, key: samlPrivateKey, cert: samlCert } as SamlParms,
    customHeaders: [
      { key: CLOUDFRONT_CHALLENGE_HEADER, value: cloudfrontChallenge }
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



