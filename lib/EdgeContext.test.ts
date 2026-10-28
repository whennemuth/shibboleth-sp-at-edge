import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IContext } from '../context/IContext';
import { toEdgeContext, stageEdgeFunctionAsset } from './EdgeContext';

const getValidContext = (): IContext => ({
  STACK_ID: 'test-stack',
  ACCOUNT: '123456789012',
  REGION: 'us-east-1',
  APP_LOGIN_HEADER: 'test-login',
  APP_LOGOUT_HEADER: 'test-logout',
  ORIGIN: {
    originType: 'alb' as any,
    httpsPort: 443,
    appAuthorization: false
  },
  SHIBBOLETH: {
    entityId: 'test-entity',
    idpCert: 'test-cert',
    entryPoint: 'test-entry',
    logoutUrl: 'test-logout-url',
    secret: {
      secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-aBcDeF',
      refreshInterval: '3600000',
      samlPrivateKeySecretFld: 'saml-pk',
      samlCertSecretFld: 'saml-cert',
      jwtPrivateKeySecretFld: 'jwt-pk',
      jwtPublicKeySecretFld: 'jwt-pub'
    }
  },
  TAGS: { Service: 'test', Function: 'test', Landscape: 'test' }
});

describe('toEdgeContext', () => {

  it('picks only the fields the edge lambdas need, including ORIGIN.appAuthorization', () => {
    const edgeContext = toEdgeContext(getValidContext());
    expect(edgeContext).toEqual({
      APP_LOGIN_HEADER: 'test-login',
      APP_LOGOUT_HEADER: 'test-logout',
      appAuthorization: false,
      SHIBBOLETH: {
        entityId: 'test-entity',
        entryPoint: 'test-entry',
        logoutUrl: 'test-logout-url',
        idpCert: 'test-cert',
        secret: {
          secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-aBcDeF',
          refreshInterval: '3600000',
          samlPrivateKeySecretFld: 'saml-pk',
          samlCertSecretFld: 'saml-cert',
          jwtPrivateKeySecretFld: 'jwt-pk',
          jwtPublicKeySecretFld: 'jwt-pub'
        }
      }
    });
  });

  it('defaults appAuthorization to true when ORIGIN is absent', () => {
    const context = getValidContext();
    delete context.ORIGIN;
    expect(toEdgeContext(context).appAuthorization).toBe(true);
  });

  it('throws a clear error naming each missing required field', () => {
    const context = getValidContext();
    delete (context as any).APP_LOGIN_HEADER;
    context.SHIBBOLETH.entityId = '';
    context.SHIBBOLETH.secret.secretArn = undefined as any;

    expect(() => toEdgeContext(context)).toThrow(/APP_LOGIN_HEADER/);
    expect(() => toEdgeContext(context)).toThrow(/entityId/);
    expect(() => toEdgeContext(context)).toThrow(/secretArn/);
  });
});

describe('stageEdgeFunctionAsset', () => {

  it('copies the named bundle and writes a matching edge-context.json alongside it', () => {
    const fixtureBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shib-edge-fixture-'));
    const bundleContents = '// dummy bundle contents';
    fs.writeFileSync(path.join(fixtureBuildDir, 'edge-viewer-request.js'), bundleContents);

    const context = getValidContext();
    const stagingDir = stageEdgeFunctionAsset(context, 'edge-viewer-request.js', fixtureBuildDir);

    expect(fs.readFileSync(path.join(stagingDir, 'edge-viewer-request.js'), 'utf8')).toBe(bundleContents);

    const edgeContextJson = JSON.parse(fs.readFileSync(path.join(stagingDir, 'edge-context.json'), 'utf8'));
    expect(edgeContextJson).toEqual(toEdgeContext(context));

    fs.rmSync(fixtureBuildDir, { recursive: true, force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  });

  it('propagates toEdgeContext\'s validation error instead of staging an incomplete context', () => {
    const fixtureBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shib-edge-fixture-'));
    fs.writeFileSync(path.join(fixtureBuildDir, 'edge-origin-request.js'), '// dummy');

    const context = getValidContext();
    context.SHIBBOLETH.secret.secretArn = '';

    expect(() => stageEdgeFunctionAsset(context, 'edge-origin-request.js', fixtureBuildDir)).toThrow(/secretArn/);

    fs.rmSync(fixtureBuildDir, { recursive: true, force: true });
  });
});
