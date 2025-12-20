import { CreateSecretCommand, GetSecretValueCommand, GetSecretValueCommandOutput, SecretsManagerClient, UpdateSecretCommand } from "@aws-sdk/client-secrets-manager";
import { SecretsManagerSecret } from "./Secret";

const mockClient = (scenario: 'exists' | 'notExists') => {
  return {
    send: async (command: any) => {
      if(command instanceof CreateSecretCommand) {
        return { SecretString: JSON.stringify({ crud: 'create' })} as any;
      }
      if(command instanceof UpdateSecretCommand) {
        return { SecretString: JSON.stringify({ crud: 'update' })} as any;
      }
      if(command instanceof GetSecretValueCommand) {
        if(scenario !== 'notExists') {
          return { $metadata: { }, SecretString: JSON.stringify({ foo: 'bar' })} satisfies GetSecretValueCommandOutput;
        }
      }
      return { secretString: undefined } as any;
    }
  } as SecretsManagerClient;
}

const fldNames = {
  "samlPrivateKeySecretFld": "wp-sp-key",
  "samlCertSecretFld": "wp-sp-cert",
  "jwtPrivateKeySecretFld": "wp-jwt-prikey",
  "jwtPublicKeySecretFld": "wp-jwt-pubkey"
} 

const loadAllValues = (secret: SecretsManagerSecret) => {
  return secret.setCloudFrontChallenge('myCloudFrontChallenge')
    .setJwtPrivateKeySecret('myJwtPrivateKey')
    .setJwtPublicKeySecret('myJwtPublicKey')
    .setSamlCertSecret('mySamlCert')
    .setSamlPrivateKeySecret('mySamlPrivateKey');
}

describe('SecretsManagerSecret', () => {
  it('should create a secret', async () => {
    const scrtMgrSecret = loadAllValues(new SecretsManagerSecret({ 
      secretName: 'my/shibboleth/secret', fldNames, client: mockClient('notExists') 
    }));
    const attemptedCrud = await scrtMgrSecret.save();
    expect(attemptedCrud).toHaveProperty('SecretString');
    const secretString = JSON.parse((attemptedCrud as any).SecretString);
    expect(secretString).toHaveProperty('crud', 'create');
  });

  it('should update a secret', async () => {
    const scrtMgrSecret = loadAllValues(new SecretsManagerSecret({ 
      secretName: 'my/shibboleth/secret', fldNames, client: mockClient('exists') 
    }));
    const attemptedCrud = await scrtMgrSecret.save();
    expect(attemptedCrud).toHaveProperty('SecretString');
    const secretString = JSON.parse((attemptedCrud as any).SecretString);
    expect(secretString).toHaveProperty('crud', 'update');
  });

  it('should read a secret', async () => {
    const scrtMgrSecret = new SecretsManagerSecret({ 
      secretName: 'my/shibboleth/secret', fldNames, client: mockClient('exists') 
    });
    const secretValue = await scrtMgrSecret.read();
    expect(secretValue).toHaveProperty('foo', 'bar');
  });

  it('should check if a secret exists', async () => {
    let scrtMgrSecret = new SecretsManagerSecret({ 
      secretName: 'my/shibboleth/secret', fldNames, client: mockClient('exists') 
    });
    const exists = await scrtMgrSecret.exists();
    expect(exists).toBe(true);

    scrtMgrSecret = new SecretsManagerSecret({ 
      secretName: 'my/shibboleth/secret', fldNames, client: mockClient('notExists') 
    });
    const notExists = ! await scrtMgrSecret.exists();
    expect(notExists).toBe(true);
  });

  it('Should generate new JWT key pair if creating a new secret and jwt keys are missing', async () => {
    let scrtMgrSecret = new SecretsManagerSecret({ 
      secretName: 'my/shibboleth/secret', fldNames, client: mockClient('notExists') 
    }).setCloudFrontChallenge('myCloudFrontChallenge')
      .setSamlCertSecret('mySamlCert')
      .setSamlPrivateKeySecret('mySamlPrivateKey');

    const secret = JSON.parse(await scrtMgrSecret.getSecretValueJson());
    expect(secret).toHaveProperty(fldNames.jwtPrivateKeySecretFld);
    expect(secret).toHaveProperty(fldNames.jwtPublicKeySecretFld);

    expect((secret[fldNames.jwtPrivateKeySecretFld] ?? '').length).toBeGreaterThan(0);
    expect((secret[fldNames.jwtPublicKeySecretFld] ?? '').length).toBeGreaterThan(0);

  });
});