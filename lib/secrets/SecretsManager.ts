import { SecretsManagerSecret } from "./Secret";
import * as contextJSON from '../../context/context.json';
import { IContext } from "../../context/IContext";

/**
 * Script to create or update the secrets for this stack in AWS Secrets Manager.
 * The secret name and field names are based on values from the context file.
 * 
 * NOTE: Since this module is not being called as part of the CDK app, it is independent of it.
 * The goal here is to make secrets that survive stack deletion.
 */
export const createOrUpdateSecrets = async () => {
  const context = contextJSON as IContext;

  const { STACK_ID, REGION, TAGS: { Landscape }, SHIBBOLETH: { entityId, idpCert, secret: { 
    cloudfrontChallengeSecretFld, 
    jwtPrivateKeySecretFld, jwtPublicKeySecretFld, 
    samlCertSecretFld, samlPrivateKeySecretFld
  } } } = context;

  const fldNames = {
    cloudfrontChallengeSecretFld,
    jwtPrivateKeySecretFld,
    jwtPublicKeySecretFld,
    samlCertSecretFld,
    samlPrivateKeySecretFld
  };

  const secretName = `bu-auth/${STACK_ID}/${Landscape}`;

  const description = `Stores shib key and cert pem content for ${entityId}`;
  const smSecret = new SecretsManagerSecret({ secretName, description, fldNames, region: REGION });

  const { SAML_CERT, SAML_PK, CLOUDFRONT_CHALLENGE } = process.env;

  if( ! CLOUDFRONT_CHALLENGE ) {
    throw new Error('CLOUDFRONT_CHALLENGE environment variable must be set');
  }

  if( ! SAML_PK ) {
    throw new Error('SAML_PK environment variable must be set');
  }

  smSecret
    .setCloudFrontChallenge(CLOUDFRONT_CHALLENGE)
    .setSamlCertSecret(SAML_CERT || idpCert)
    .setSamlPrivateKeySecret(SAML_PK);

  console.log(`Creating or updating secret: ${secretName}: ${await smSecret.getSecretValueJson() }`);

  await smSecret.save();
};