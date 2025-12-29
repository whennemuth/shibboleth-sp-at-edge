import { SecretsManagerSecret } from "./Secret";
import * as contextJSON from '../../context/context.json';
import { IContext } from "../../context/IContext";
import { CreateSecretCommandOutput, UpdateSecretCommandOutput } from "@aws-sdk/client-secrets-manager";

/**
 * Script to create or update the secrets for this stack in AWS Secrets Manager.
 * The secret name and field names are based on values from the context file.
 * 
 * NOTE: Since this module is not being called as part of the CDK app, it is independent of it.
 * The goal here is to make secrets that survive stack deletion.
 */
export const createOrUpdateSecrets = async (): Promise<string> => {
  const context = contextJSON as IContext;

  const { STACK_ID, ORIGIN: { stackId: ORIGIN_STACK_ID } = {}, REGION, SHIBBOLETH: { entityId, idpCert, secret: { 
    jwtPrivateKeySecretFld, jwtPublicKeySecretFld, 
    samlCertSecretFld, samlPrivateKeySecretFld
  } } } = context;

  // Landscape can be overridden by env variable LANDSCAPE.
  let { TAGS: { Landscape } } = context;

  const fldNames = {
    jwtPrivateKeySecretFld,
    jwtPublicKeySecretFld,
    samlCertSecretFld,
    samlPrivateKeySecretFld
  };

  const { SAML_CERT, SAML_PK, CLOUDFRONT_CHALLENGE, LANDSCAPE } = process.env;

  if( ! CLOUDFRONT_CHALLENGE ) {
    throw new Error('CLOUDFRONT_CHALLENGE environment variable must be set');
  }

  if( ! SAML_PK ) {
    throw new Error('SAML_PK environment variable must be set');
  }

  const args = process.argv.slice(1);
  let secretNameOverride = '';
  args.forEach((arg) => {
    const [key, value] = arg.split('=');
    if( key.trim().toUpperCase() === 'LANDSCAPE' ) {
      console.log(`Overriding Landscape tag from ${Landscape} from context to ${value} from argument`);
      Landscape = value;
    }
    if( key.trim().toUpperCase() === 'SECRET_NAME' ) {
      console.log(`Overriding entire secret name to ${value} from argument`);
      secretNameOverride = value;
    }
  });

  const secretName = secretNameOverride || ( ORIGIN_STACK_ID ? 
    `${STACK_ID}/${ORIGIN_STACK_ID}/${Landscape}` : 
    `${STACK_ID}/${Landscape}`);

  const description = `Stores shib key and cert pem content for ${entityId}`;
  const smSecret = new SecretsManagerSecret({ secretName, description, fldNames, region: REGION });

  smSecret
    .setCloudFrontChallenge(CLOUDFRONT_CHALLENGE)
    .setSamlCertSecret(SAML_CERT || idpCert)
    .setSamlPrivateKeySecret(SAML_PK);

  console.log(`Creating or updating secret: ${secretName}: ${await smSecret.getSecretValueJson() }`);

  // Check if secret exists before saving to determine operation type
  const secretExists = await smSecret.exists();
  const result:CreateSecretCommandOutput|UpdateSecretCommandOutput = await smSecret.save();

  // Now we know what operation was performed
  const operation = secretExists ? 'UPDATED' : 'CREATED';
  console.log(`${operation} secret: ${result.ARN || result.Name}`);
  console.log(`Secret ARN: ${result.ARN}`);

  if( ! result.ARN ) {
    throw new Error('Secret ARN not returned after create or update operation');
  }
  
  return result.ARN;
};