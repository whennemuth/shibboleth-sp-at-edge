import { CreateSecretCommand, CreateSecretCommandOutput, GetSecretValueCommand, GetSecretValueCommandOutput, SecretsManagerClient, Tag, UpdateSecretCommand, UpdateSecretCommandOutput } from "@aws-sdk/client-secrets-manager";
import { SecretFieldNames } from "../../context/IContext";
import { Keys } from 'shibboleth-sp';
import { Key, KeyConfig } from "./Key";

export const CLOUDFRONT_CHALLENGE_HEADER_NAME = 'cloudfront-challenge';

export type SecretsManagerSecretParms = {
  secretName: string,
  fldNames: SecretFieldNames,
  client?: SecretsManagerClient,
  region?: string,
  description?: string,
  Tags?: Tag[]
}

/**
 * Class representing a secret in AWS Secrets Manager that holds Shibboleth and JWT keys/certificates.
 * Provides crud operations for the secret, and transformation of keys maintaining PEM formatting.
 */
export class SecretsManagerSecret {

  private kvPairs: Record<string, string> = {};
  private lookupResult: string | undefined;

  constructor( private parms: SecretsManagerSecretParms) {
    const { client, region:_region } = this.parms;
    if( ! client ) {
      const { REGION, AWS_REGION } = process.env;
      if( ! REGION && ! AWS_REGION && ! _region ) {
        throw new Error('Region must be specified in either REGION or AWS_REGION environment variable');
      }
      const region = _region! || AWS_REGION || REGION!;
      this.parms.client = new SecretsManagerClient({ region });
    }
  }

  public setCloudFrontChallenge = (cloudFrontChallenge: string): SecretsManagerSecret => {
    return this.setValue(CLOUDFRONT_CHALLENGE_HEADER_NAME, cloudFrontChallenge);
  }

  public setJwtPrivateKeySecret = (jwtPrivateKey: string): SecretsManagerSecret => {
    return this.setValue(
      this.parms.fldNames.jwtPrivateKeySecretFld, 
      { key: jwtPrivateKey, isPublic: false, type: 'rsa' }
    );
  }

  public setJwtPublicKeySecret = (jwtPublicKey: string): SecretsManagerSecret => {
    return this.setValue(
      this.parms.fldNames.jwtPublicKeySecretFld, 
      { key: jwtPublicKey, isPublic: true, type: 'rsa' }
    );
  }

  public setSamlCertSecret = (samlCertSecret: string): SecretsManagerSecret => {
    return this.setValue(this.parms.fldNames.samlCertSecretFld, {
      key: samlCertSecret, isPublic: true, type: 'certificate'
    });
  }

  public setSamlPrivateKeySecret = (samlPrivateKeySecret: string): SecretsManagerSecret => {
    return this.setValue(this.parms.fldNames.samlPrivateKeySecretFld, {
      key: samlPrivateKeySecret, isPublic: false, type: 'rsa'
    });
  }

  /**
   * Sets a secret key and value to an instance of this class. 
   * @param key The key for the secret.
   * @param value The value of the secret, either as a string or a KeyConfig object.
   * @returns The SecretsManagerSecret instance for chaining.
   */
  public setValue = (key: string, value: string | KeyConfig): SecretsManagerSecret => {
    const { kvPairs } = this;
    if (typeof value === 'string') {
      kvPairs[key] = value;
    } 
    else {
      kvPairs[key] = new Key(value as KeyConfig).toPemFormatted();
    }
    return this;
  }

  /**
   * Create the secret in secrets manager.
   * @returns A promise resolving to the result of the create operation.
   */
  private create = async (): Promise<CreateSecretCommandOutput> => {
    const {
      getSecretValueJson,
      parms: { 
        secretName:Name, description:Description, Tags=[],
        client = { send: () => { throw new Error('Client not initialized'); } } 
      } 
    } = this;
    console.log(`Creating secret ${Name}...`);
    const command = new CreateSecretCommand({ 
      Name, Description, SecretString: await getSecretValueJson(), Tags
    });
    return await client.send(command);
  }

  /**
   * Update the secret in secrets manager.
   * @returns A promise resolving to the result of the update operation.
   */
  private update = async (): Promise<UpdateSecretCommandOutput> => {
    const {
      getSecretValueJson,
      parms: { 
        secretName:Name, description:Description,
        client = { send: () => { throw new Error('Client not initialized'); } } 
      } 
    } = this;
    console.log(`Updating secret ${Name}...`);
    const command = new UpdateSecretCommand({ 
      SecretId: Name, SecretString: await getSecretValueJson(), Description 
    });
    return await client.send(command);
  }

  /**
   * Reads the secret from secrets manager.
   * @returns A promise resolving to the secret value as an object or undefined if not found.
   */
  public read = async (): Promise<Record<string, string> | undefined> => {

    // Return cached result if available
    if(this.lookupResult) {
      return JSON.parse(this.lookupResult);
    }

    // Unpack needed values
    const { 
      parms: { secretName:Name, client = { send: () => { throw new Error('Client not initialized'); } } } 
    } = this;
    
    const command = new GetSecretValueCommand({ SecretId: Name });
    let response:GetSecretValueCommandOutput;
    try {
      // Retrieve from secrets manager
      console.log(`Reading secret ${Name}...`);
      response = await client.send(command);
    } 
    catch (error) {
      if((error instanceof Error && error.name === 'ResourceNotFoundException')) {
        return undefined;
      }
      throw error;
    }
    if (response.SecretString) {
      console.log(`Secret ${Name} retrieved successfully.`);
      
      // Cache the result
      this.lookupResult = response.SecretString;

      // Parse and return the secret value json as an object
      return JSON.parse(response.SecretString);
    }

    // Secret not found in secrets manager
    return undefined;
  }

  /**
   * Checks if the secret exists in secrets manager
   * @returns true/false
   */
  public exists = async (): Promise<boolean> => {
    return (await this.read()) !== undefined;
  }

  /**
   * @returns The secret as json, for upload to secrets manager, formatted so as to be ready for use when downloaded.
   */
  public getSecretValueJson = async (): Promise<any> => {
    const { exists } = this;
    if ( ! await exists()) {
      const { 
        parms: { fldNames: { jwtPrivateKeySecretFld, jwtPublicKeySecretFld } }, 
        setJwtPrivateKeySecret, setJwtPublicKeySecret
      } = this;
      const jwtPrivateKey = this.kvPairs[jwtPrivateKeySecretFld];
      const jwtPublicKey = this.kvPairs[jwtPublicKeySecretFld];
      if(jwtPrivateKey && ! jwtPublicKey) {
        throw new Error('Cannot create secret: JWT public key is missing while private key is present');
      }
      if(! jwtPrivateKey && jwtPublicKey) {
        throw new Error('Cannot create secret: JWT private key is missing while public key is present');
      }
      if(! jwtPrivateKey && ! jwtPublicKey) {
        const keys = new Keys();
        setJwtPrivateKeySecret(keys.privateKeyPEM);
        setJwtPublicKeySecret(keys.publicKeyPEM);
      }
    }

    // Convert to json
    let secretJson = JSON.stringify(this.kvPairs, (key: string, value: any) => {
      switch (key) {
        default:
          return value;
      }
    });
    
    // In case of windows, fix newlines
    return secretJson.replace(/\\r\\n/g, '\\n');
  }

  /**
   * Saves the secret to secrets manager. This is either a create or update operation depending on whether 
   * the secret already exists.
   * @returns A promise resolving to the result of the save operation.
   */
  public save = async (): Promise<CreateSecretCommandOutput | UpdateSecretCommandOutput> => {

    // Unpack needed values
    const { exists, create, update } = this;

    // Update existing secret
    if(await exists()) {
      return await update();
    } 

    // Else, create new secret
    return await create();
  }
}

