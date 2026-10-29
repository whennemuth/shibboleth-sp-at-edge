import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IContext } from '../context/IContext';
import type { EdgeContext } from './lambda/EdgeContext';

/**
 * Picks the fields the edge lambdas need at runtime out of the consumer's IContext, and fails
 * synth with a clear message rather than deploying edge code that would fail at sign-in.
 */
export const toEdgeContext = (context: IContext): EdgeContext => {
  const { APP_LOGIN_HEADER, APP_LOGOUT_HEADER, SHIBBOLETH, ORIGIN } = context;
  const { entityId, entryPoint, logoutUrl, idpCert, secret } = SHIBBOLETH || ({} as typeof SHIBBOLETH);
  const {
    secretArn, refreshInterval, samlPrivateKeySecretFld, samlCertSecretFld,
    jwtPrivateKeySecretFld, jwtPublicKeySecretFld
  } = secret || ({} as typeof secret);

  const required = {
    APP_LOGIN_HEADER, APP_LOGOUT_HEADER, entityId, entryPoint, logoutUrl, idpCert,
    secretArn, refreshInterval, samlPrivateKeySecretFld, samlCertSecretFld,
    jwtPrivateKeySecretFld, jwtPublicKeySecretFld
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Cannot build the Lambda@Edge context: missing required context field(s): ${missing.join(', ')}.`
    );
  }

  return {
    APP_LOGIN_HEADER: APP_LOGIN_HEADER!,
    APP_LOGOUT_HEADER: APP_LOGOUT_HEADER!,
    appAuthorization: ORIGIN?.appAuthorization ?? true,
    SHIBBOLETH: {
      entityId: entityId!, entryPoint: entryPoint!, logoutUrl: logoutUrl!, idpCert: idpCert!,
      secret: {
        secretArn: secretArn!, refreshInterval: refreshInterval!,
        samlPrivateKeySecretFld: samlPrivateKeySecretFld!, samlCertSecretFld: samlCertSecretFld!,
        jwtPrivateKeySecretFld: jwtPrivateKeySecretFld!, jwtPublicKeySecretFld: jwtPublicKeySecretFld!
      }
    }
  };
};

/**
 * Stages one prebuilt edge bundle plus a synth-time edge-context.json alongside it, in a fresh
 * temp directory, for use as a Code.fromAsset(...) source. Keeps each Lambda@Edge function's
 * deployment package down to just its own bundle (viewer triggers have a 1 MB package limit).
 *
 * @param buildDir Override for where the prebuilt bundle lives - defaults to the real build/
 * folder relative to this file; parameterized so tests can point it at a fixture directory.
 */
export const stageEdgeFunctionAsset = (context: IContext, bundleFileName: string, buildDir?: string): string => {
  const isInstalled = __dirname.includes('node_modules');
  const resolvedBuildDir = buildDir ?? path.resolve(__dirname, isInstalled ? '../../../build' : '../build');
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shib-edge-'));
  fs.copyFileSync(path.join(resolvedBuildDir, bundleFileName), path.join(stagingDir, bundleFileName));
  fs.writeFileSync(path.join(stagingDir, 'edge-context.json'), JSON.stringify(toEdgeContext(context)));
  return stagingDir;
};
