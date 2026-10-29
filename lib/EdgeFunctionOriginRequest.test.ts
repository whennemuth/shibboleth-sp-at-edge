import { getEdgeFunctionSecretsManagerPolicy } from './EdgeFunctionOriginRequest';

describe('getEdgeFunctionSecretsManagerPolicy', () => {

  it('only grants GetSecretValue, not ListSecrets', () => {
    const policy = getEdgeFunctionSecretsManagerPolicy(
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-aBcDeF'
    ).toJSON();
    // CDK's PolicyStatement.toJSON() collapses a single-action array to a bare string.
    expect(policy.Action).toEqual('secretsmanager:GetSecretValue');
  });

  it('uses a full ARN (with the Secrets Manager random suffix) as-is', () => {
    const secretArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test-aBcDeF';
    const policy = getEdgeFunctionSecretsManagerPolicy(secretArn).toJSON();
    expect(policy.Resource).toEqual(secretArn);
  });

  it('appends a wildcard suffix to a partial ARN missing the random suffix', () => {
    const secretArn = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';
    const policy = getEdgeFunctionSecretsManagerPolicy(secretArn).toJSON();
    expect(policy.Resource).toEqual(`${secretArn}-??????`);
  });
});
