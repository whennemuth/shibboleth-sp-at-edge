import { GetSecretValueCommand, GetSecretValueCommandOutput, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import * as context from '../../context/context.json';
import { Secret } from '../../context/IContext';
import { CLOUDFRONT_CHALLENGE_HEADER_NAME } from "../secrets/Secret";

const { secretArn, refreshInterval, samlCertSecretFld, samlPrivateKeySecretFld, jwtPublicKeySecretFld, jwtPrivateKeySecretFld } = context.SHIBBOLETH.secret as Secret;
const refreshIntervalInt = parseInt(refreshInterval)

export type CachedKeys = {
  _timestamp: number;
  samlCert: string;
  samlPrivateKey: string;
  jwtPrivateKey: string;
  jwtPublicKey: string;
  cloudfrontChallenge: string;
}

export type SecretsConfig = {
  secretArn:string;
  refreshInterval:string;
  samlCertSecretFld:string;
  samlPrivateKeySecretFld:string;
  jwtPublicKeySecretFld:string;
  jwtPrivateKeySecretFld:string;
  cloudfrontChallengeSecretFld:string;
}

/**
 * The cache is refreshable if any of the keys in it are empty, or the timestamp indicates it's time to refresh.
 * @param cache 
 * @returns 
 */
export const requiresRefreshFromSecretsManager = (cache:CachedKeys, refreshInterval:number, now:number) => {

  const { _timestamp, jwtPrivateKey, jwtPublicKey, samlCert, samlPrivateKey } = cache;

  const cacheIsEmptyOrInvalid = ():boolean => {
    return samlCert.length === 0 ||
    samlPrivateKey.length === 0 ||
    jwtPublicKey.length === 0 ||
    jwtPrivateKey.length === 0 || 
    ( now - _timestamp > refreshInterval );
  }

  return cacheIsEmptyOrInvalid();
}

/**
* Obtain the shibboleth & jwt certs/keys from secrets manager and populate the supplied cache object with them.
* @returns 
*/
export async function checkCache(cache:CachedKeys, config?:SecretsConfig): Promise<void> {
  // If a cache configuration is not supplied, get it from the context instead.
  const _config = config || {
    refreshInterval: refreshIntervalInt, 
    secretArn, 
    jwtPrivateKeySecretFld, 
    jwtPublicKeySecretFld, 
    samlCertSecretFld, 
    samlPrivateKeySecretFld, 
    cloudfrontChallengeSecretFld: CLOUDFRONT_CHALLENGE_HEADER_NAME
  };
  
  const now = Date.now();
  if (requiresRefreshFromSecretsManager(cache, refreshIntervalInt, now)) {
    try {
      const { 
        secretArn, 
        samlCertSecretFld, 
        samlPrivateKeySecretFld, 
        jwtPrivateKeySecretFld, 
        jwtPublicKeySecretFld, 
        cloudfrontChallengeSecretFld 
      } = _config;
      const command = new GetSecretValueCommand({ SecretId: secretArn });
      const region = secretArn.split(':')[3];
      const secretsClient = new SecretsManagerClient({ region });
      const response:GetSecretValueCommandOutput = await secretsClient.send(command);
      if( ! response.SecretString) {
        throw new Error('Empty/missing cert!');
      }
      const fieldset = JSON.parse(response.SecretString);
      cache.samlCert = fieldset[samlCertSecretFld];
      cache.samlPrivateKey = fieldset[samlPrivateKeySecretFld];
      cache.jwtPublicKey = fieldset[jwtPublicKeySecretFld];
      cache.jwtPrivateKey = fieldset[jwtPrivateKeySecretFld];
      cache.cloudfrontChallenge = fieldset[cloudfrontChallengeSecretFld];
      cache._timestamp = now;
      console.log(`Retrieved shib cert from secrets manager in ${Date.now() - now} milliseconds`);
    } catch (e) {
      console.error(`Cannot get cert from secrets manager, error: ${e}`);
    }
  }
  else {
    console.log('Using cache: certs & keys found in cache and before their stale date');
  }
}
