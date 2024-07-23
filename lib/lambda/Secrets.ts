import { GetSecretValueCommand, GetSecretValueCommandOutput, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import * as context from '../../context/context.json';
import { Secret } from '../../context/IContext';

const { _secretArn, _refreshInterval, samlCertSecretFld, samlPrivateKeySecretFld, jwtPublicKeySecretFld, jwtPrivateKeySecretFld, cloudfrontChallengeSecretFld } = context.SHIBBOLETH.secret as Secret;
const refreshInterval = parseInt(_refreshInterval)

export type CachedKeys = {
  _timestamp: number;
  samlCert: string;
  samlPrivateKey: string;
  jwtPrivateKey: string;
  jwtPublicKey: string;
  cloudfrontChallenge: string;
}

export type SecretsConfig = {
  _secretArn:string;
  _refreshInterval:string;
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
    refreshInterval, 
    _secretArn, 
    jwtPrivateKeySecretFld, 
    jwtPublicKeySecretFld, 
    samlCertSecretFld, 
    samlPrivateKeySecretFld, 
    cloudfrontChallengeSecretFld
  };
  
  const now = Date.now();
  if (requiresRefreshFromSecretsManager(cache, refreshInterval, now)) {
    try {
      const { 
        _secretArn, 
        samlCertSecretFld, 
        samlPrivateKeySecretFld, 
        jwtPrivateKeySecretFld, 
        jwtPublicKeySecretFld, 
        cloudfrontChallengeSecretFld 
      } = _config;
      const command = new GetSecretValueCommand({ SecretId: _secretArn });
      const region = _secretArn.split(':')[3];
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
