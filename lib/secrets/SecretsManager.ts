import { SecretsManagerSecret } from "./Secret";
import { IContext } from "../../context/IContext";
import { CreateSecretCommandOutput, UpdateSecretCommandOutput, SecretsManagerClient, PutResourcePolicyCommand, TagResourceCommand, UpdateSecretCommand, Tag } from "@aws-sdk/client-secrets-manager";

type Parameters = {
  secretArn: string;
  accountId: string;
  region: string;
}

/**
 * Manages AWS Secrets Manager operations for Shibboleth SP configuration.
 * Handles creation, updating, and sharing of secrets across accounts.
 */
export class SecretsManager {
  private context: IContext;

  constructor(context: IContext) {
    this.context = context;
  }

  /**
   * Create or update the secrets for this stack in AWS Secrets Manager.
   * The secret name and field names are based on values from the context file.
   * 
   * NOTE: Since this module is not being called as part of the CDK app, it is independent of it.
   * The goal here is to make secrets that survive stack deletion.
   */
  async createOrUpdateSecrets(): Promise<string> {
    const { 
      STACK_ID, REGION,  
      ORIGIN: { stackId: ORIGIN_STACK_ID } = {}, 
      SHIBBOLETH: { entityId, idpCert, secret: { 
        jwtPrivateKeySecretFld, jwtPublicKeySecretFld, 
        samlCertSecretFld, samlPrivateKeySecretFld
    } } } = this.context;

    // Landscape can be overridden by env variable LANDSCAPE.
    let { TAGS: { Service, Function, Landscape, CostCenter, Ticket } } = this.context;

    const fldNames = {
      jwtPrivateKeySecretFld,
      jwtPublicKeySecretFld,
      samlCertSecretFld,
      samlPrivateKeySecretFld
    };

    const { SAML_CERT, SAML_PK, CLOUDFRONT_CHALLENGE } = process.env;

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
    const smSecret = new SecretsManagerSecret({ 
      secretName, description, fldNames, region: REGION, Tags: [
        { Key: 'Service', Value: Service },
        { Key: 'Function', Value: Function },
        { Key: 'Landscape', Value: Landscape },
        { Key: 'CostCenter', Value: CostCenter },
        { Key: 'Ticket', Value: Ticket }
      ] satisfies Tag[]
    });

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
  }

  /**
   * Validate the parameters for the tagSecretForCrossAccountAccess and attachSecretPolicyForAccount functions.
   */
  private validParms(args: {parms:string[], printUsage: () => void }): Parameters | undefined {
    const { parms, printUsage } = args;
    let { REGION: region } = this.context;

    if( ! parms || parms.length === 0 ) {
      console.log('No parameters provided. Required: secretArn=... accountId=...');
      printUsage();
      return undefined;
    }

    let accountId: string | undefined;
    let secretArn: string | undefined;

    console.log('Processing parameters:', parms);

    for(let i=0; i<parms.length; i++) {
      const parm = parms[i];
      console.log('Parsing parameter:', parm);
      if(`${parm}`.includes('=') ) {
        const [key, value] = parm.split('=').map(s => s.trim());
        switch(key.toUpperCase()) {
          case 'SECRETARN':
            secretArn = value;
            break;
          case 'ACCOUNTID':
            accountId = value;
            break;
          case 'REGION':
            region = value;
            break;
          default:
            console.log(`Unknown parameter key: ${key}, ignoring...`);
        }
      }
    }

    if( ! secretArn ) {
      console.log('No secretArn parameter provided, attempting to get from context...');
      const { SHIBBOLETH: { secret: { secretArn: contextSecretArn }}} = this.context;
      secretArn = contextSecretArn;
      if( ! secretArn ) {
        console.log('Missing required parameter: secretArn');
        printUsage();
        return undefined;
      }
    }
    if( ! accountId ) {
      console.log('Missing required parameter: accountId');
      printUsage();
      return undefined;
    }

    console.log(JSON.stringify({ secretArn, accountId, region }));
    return { secretArn, accountId, region };
  }

  /**
   * Tag a secret to indicate it is available for cross-account access.
   */
  async tagSecretForCrossAccountAccess(...parms:string[]): Promise<void> {
    const printUsage = () => {
      console.log(`Parameters (will use context.json defaults if not provided):
    secretArn=<secret-arn>           The ARN of the secret to tag
    region=<aws-region>              The AWS region where the secret exists
  `);
    }

    parms.push('accountId=n/a'); // Dummy to match validParms signature

    const validParmsResult = this.validParms({ parms, printUsage });
    if( validParmsResult === undefined ) {
      return;
    }

    const { secretArn, region } = validParmsResult;

    console.log(`Tagging secret ${secretArn} for cross-account access in region ${region}...`);

    const client = new SecretsManagerClient({ region });
    
    const command = new TagResourceCommand({
      SecretId: secretArn,
      Tags: [
        {
          Key: "CrossAccountAccess",
          Value: "true"
        }
      ]
    });

    try {
      await client.send(command);
      console.log(`Successfully tagged secret ${secretArn} with CrossAccountAccess=true for cross-account sharing`);
    } catch (error) {
      console.error(`Failed to tag secret ${secretArn}:`, error);
      throw error;
    }
  }

  /**
   * Update a secret to use the AWS managed KMS key for cross-account access.
   * This is required because the default service key doesn't support cross-account access.
   */
  async updateSecretKmsKey(...parms:string[]): Promise<void> {
    const printUsage = () => {
      console.log(`Parameters (will use context.json defaults if not provided):
    secretArn=<secret-arn>           The ARN of the secret to update
    region=<aws-region>              The AWS region where the secret exists
  `);
    }

    parms.push('accountId=n/a'); // Dummy to match validParms signature

    const validParmsResult = this.validParms({ parms, printUsage });
    if( validParmsResult === undefined ) {
      return;
    }

    const { secretArn, region } = validParmsResult;

    console.log(`Updating secret ${secretArn} to use AWS managed KMS key for cross-account access...`);

    const client = new SecretsManagerClient({ region });
    
    const command = new UpdateSecretCommand({
      SecretId: secretArn,
      KmsKeyId: 'aws/secretsmanager', // Use AWS managed key instead of default
      Description: 'Updated to use AWS managed KMS key for cross-account access'
    });

    try {
      const result = await client.send(command);
      console.log(`Successfully updated secret ${secretArn} to use AWS managed KMS key`);
      console.log(`Secret version: ${result.VersionId}`);
    } catch (error) {
      console.error(`Failed to update secret KMS key for ${secretArn}:`, error);
      throw error;
    }
  }

  /**
   * Attach a resource based policy to the secret to allow its use in another account.
   * 
   * After calling this function, the grantee account can test access with:
   * aws secretsmanager get-secret-value --secret-id <secretArn> --region <region>
   * 
   * Note: The secret must be tagged with CrossAccountAccess=true for the policy condition.
   */
  async attachSecretPolicyForAccount(...parms:string[]): Promise<void> {
    const printUsage = () => {
      console.log(`Usage: npm run share-secret accountId=<target-account-id> [secretArn=<secret-arn>] [region=<aws-region>]

  Required parameters:
    accountId=<target-account-id>    The AWS account ID to grant access to

  Optional parameters (will use context.json defaults if not provided):
    secretArn=<secret-arn>           The ARN of the secret to share
    region=<aws-region>              The AWS region where the secret exists

  Examples:
    npm run share-secret accountId=123456789012
    npm run share-secret accountId=123456789012 region=us-west-2
    npm run share-secret accountId=123456789012 secretArn=arn:aws:secretsmanager:us-east-1:987654321098:secret:my-secret-AbCdEf

  Note: The secret must be tagged with CrossAccountAccess=true for the policy to work.`);
    }

    const validParmsResult = this.validParms({ parms, printUsage });
    if( validParmsResult === undefined ) {
      return;
    }

    const { secretArn, accountId, region } = validParmsResult;

    // Ensure the secret uses the AWS managed KMS key for cross-account access
    await this.updateSecretKmsKey(...parms);

    // Ensure the secret is tagged for cross-account access (no problem if already tagged)
    await this.tagSecretForCrossAccountAccess(...parms);
    
    const client = new SecretsManagerClient({ region });
    
    // Create resource-based policy allowing the specified account to read the secret
    const resourcePolicy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: `CrossAccountAccess${accountId}`,
          Effect: "Allow",
          Principal: {
            AWS: `arn:aws:iam::${accountId}:root`
          },
          Action: [
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret"
          ],
          Resource: "*",
          Condition: {
            StringEquals: {
              "secretsmanager:ResourceTag/CrossAccountAccess": "true"
            }
          }
        }
      ]
    };

    const command = new PutResourcePolicyCommand({
      SecretId: secretArn,
      ResourcePolicy: JSON.stringify(resourcePolicy),
      BlockPublicPolicy: true
    });

    try {
      await client.send(command);
      console.log(`Successfully attached cross-account policy to secret ${secretArn} for account ${accountId}`);
    } catch (error) {
      console.error(`Failed to attach policy to secret ${secretArn}:`, error);
      throw error;
    }
  }
}

// Exported functions for external usage
export const createOrUpdateSecrets = async (): Promise<string> => {
  const contextJSON = require('../../context/context.json') as IContext;
  const manager = new SecretsManager(contextJSON);
  return manager.createOrUpdateSecrets();
};

export const tagSecretForCrossAccountAccess = async (...parms:string[]): Promise<void> => {
  const contextJSON = require('../../context/context.json') as IContext;
  const manager = new SecretsManager(contextJSON);
  return manager.tagSecretForCrossAccountAccess(...parms);
};

export const updateSecretKmsKey = async (...parms:string[]): Promise<void> => {
  const contextJSON = require('../../context/context.json') as IContext;
  const manager = new SecretsManager(contextJSON);
  return manager.updateSecretKmsKey(...parms);
};

export const attachSecretPolicyForAccount = async (...parms:string[]): Promise<void> => {
  const contextJSON = require('../../context/context.json') as IContext;
  const manager = new SecretsManager(contextJSON);
  return manager.attachSecretPolicyForAccount(...parms);
};

/**
 * Meant for debugging, NOT for npm script usage.
 */
if (require.main === module) {
  (async () => {
    // Dynamically require context
    const contextJSON = require('../../context/context.json') as IContext;
    const manager = new SecretsManager(contextJSON);
    
    // Modify this line to vary task
    const task:string = 'create';

    switch(task) {
      case 'create':
        await manager.createOrUpdateSecrets();
        break;
      case 'share':
        // Example parameters, modify as needed
        await manager.attachSecretPolicyForAccount(
          'accountId=770203350335', 
          // 'secretArn=SECRET_ARN', 
          'region=us-east-2'
        );
        break;
      case 'tag':
        await manager.tagSecretForCrossAccountAccess(
          // 'secretArn=SECRET_ARN',
          'region=us-east-2'
        );
        break;
      case 'kms':
        await manager.updateSecretKmsKey(
          // 'secretArn=SECRET_ARN',
          'region=us-east-2'
        );
        break;
    }
  })();
}