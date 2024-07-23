import { jest } from '@jest/globals';
import { IConfig, IRequest, IResponse } from 'shibboleth-sp';
import { handler } from './FunctionSpOrigin';
import { CachedKeys } from './Secrets';
import { CloudFrontRequest, LambdaEdgeOriginRequestEvent } from './OriginRequestEventType';
import { instanceOf } from '../Util';

enum SP_RETVAL_TYPE { response='wants_an_IResponse_back', request='wants_a_request_back' }

/**
 * ---------------------------------------------------------------------------
 *                             CREATE MOCKS 
 * (beware: must define at global scope - no outer function, if blocks, etc.)
 * ---------------------------------------------------------------------------
 */

/**
 * Mock the behavior of Secrets.ts (getting secrets from secret manager).
 */
jest.mock('./Secrets', () => {
  const originalModule = jest.requireActual('./Secrets');
  if(process.env?.unmocked === 'true') {
    return originalModule;
  }
  return {
    __esModule: true,
    originalModule,
    checkCache: async (cache:CachedKeys): Promise<void> => {
      cache.samlCert = 'dummy_cert';
      cache.samlPrivateKey = 'dummy_pk';
      cache.jwtPublicKey = 'dummy_pub_jwt_key';
      cache.jwtPrivateKey = 'dummy_pvt_jwt_key';
      cache.cloudfrontChallenge = 'dummy_cf_challenge';
    }
  };
});

const apples = [ { key: 'apples', value: 'macintosh' } ];
const oranges = [ { key: 'oranges', value: 'navel' } ];
const pears = [ { key: 'pears', value: 'bosc' } ];
jest.mock('shibboleth-sp', () => {
  return {
    __esModule: true,
    handler: async (request:IRequest, config:IConfig) => {
      const { querystring } = request;
      switch(querystring) {
        case SP_RETVAL_TYPE.request:
          return { 
            uri:'I/am/a/request', 
            method: 'GET',
            querystring,
            body: { data: '' },
            headers: { apples, oranges, pears},
            headerActivity: { added: { apples, oranges, pears}, modified: {}, removed: {}} } as IRequest;
        case SP_RETVAL_TYPE.response: default:
          return {} as IResponse;
      }
    }
  }
});


/**
 * Returns a lambda event mock with only the essential fields present.
 * @returns 
 */
const getEssentialEvent = (querystring:string) => {
  const data = 'some random string';
  return {
    Records: [
      {
        cf: {
          config: { 
            distributionDomainName: 'wp1.warhen.work'
          },
          request: {
            body: { 
              data: `${btoa(data)}`
            },
            headers: {
              host: [ { key: 'Host', value: 'wp3ewvmnwp5nkbh3ip4qulkwyu0qoglu.lambda-url.us-east-1.on.aws' } ],
              origin: [ { key: 'origin', value: 'https://localhost/me/at/my/laptop' } ],
              TEST_SCENARIO: [] as any,
              cookie: [] as any
            },
            method: 'GET',
            origin: {
              domainName: 'wp3ewvmnwp5nkbh3ip4qulkwyu0qoglu.lambda-url.us-east-1.on.aws',                  
            },
            querystring,
            uri: '/path/to/app'
          }
        }
      }
    ]
  }; 
}

/**
 * Test all endpoints of authentication flow for the sp.
 * Also assert that the flow changes where necessary when the app is configured to "decide" authentication requirement. 
 */
describe('FunctionSpOrigin.handler', () => {

  it('Should return the expected response type if the sp handler returns the request', async () => {
    const event = getEssentialEvent(SP_RETVAL_TYPE.request);
    let originalRequest = event.Records[0].cf.request;

    // Verify that the incoming request has 4 headers
    expect(Object.entries(originalRequest.headers).length).toEqual(4);

    // Invoke the event handler
    const retval = await handler(event as unknown as LambdaEdgeOriginRequestEvent);

    // Verify that the returned object is the original request, plus 3 more headers.
    expect(instanceOf<IRequest>(retval, "uri")).toBeTruthy();
    const modifiedRequest = retval as CloudFrontRequest;
    expect(Object.entries(modifiedRequest.headers).length).toEqual(7);

    // Verify that the returned CloudFrontRequest carries the expected additional headers.
    expect(modifiedRequest).toMatchObject(originalRequest);
    expect(modifiedRequest.headers.apples).toEqual(apples);
    expect(modifiedRequest.headers.oranges).toEqual(oranges);
    expect(modifiedRequest.headers.pears).toEqual(pears);
    
  });

  it('Should return the expected response type if the sp handler returns an IResponse', async () => {
    const event = getEssentialEvent(SP_RETVAL_TYPE.response);

    // The sp will blanket require every request to be authenticated.
    let retval = await handler(event as unknown as LambdaEdgeOriginRequestEvent);

    expect(instanceOf<IRequest>(retval, "uri")).toBeFalsy();
  });
});
