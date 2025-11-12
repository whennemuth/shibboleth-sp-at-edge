#!/usr/bin/env node
import { App, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { BuildOptions, build } from 'esbuild';
import 'source-map-support/register';
import { IContext, SecretFieldNames } from '../context/IContext';
import * as ctx from '../context/context.json';
import { CloudfrontDistribution } from '../lib/Distribution';
import { createOrUpdateSecrets } from '../lib/secrets/SecretsManager';
import { SecretsManagerSecret } from '../lib/secrets/Secret';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

// Instatiate the app
const app = new App();

// Configure custom resource defaults
CustomResourceConfig.of(app).addRemovalPolicy(RemovalPolicy.DESTROY);
CustomResourceConfig.of(app).addLogRetentionLifetime(RetentionDays.ONE_WEEK);

// Cast the context to the IContext type
const context = ctx as IContext;

/**
 * @returns The name of the stack
 */
export const getStackName = ():string => {
  const { STACK_ID, TAGS: { Landscape } } = context;
  return `${STACK_ID}-${Landscape}`;
}

(async () => {

const { 
  ACCOUNT:account, REGION:region, STACK_ID,
  SHIBBOLETH: { secret: { _secretArn } },
  TAGS: { Landscape, Function, Service }} = context;
const stackName = `${STACK_ID}-${Landscape}`;

const stack:Stack = new Stack(app, stackName, {
  stackName,
  description: 'Lambda-based shibboleth serice provider',
  env: { account, region },
  tags: { Service, Function, Landscape }
});

// Set the tags for the stack
var tags: object = context.TAGS;
for (const [key, value] of Object.entries(tags)) {
  stack.tags.setTag(key, value);
}

(async () => {
  
  if( _secretArn ) {
    // Make sure it exists.
    const exists = await new SecretsManagerSecret({ 
      secretName: _secretArn, fldNames: {} as SecretFieldNames, region 
    }).exists();

    // Abort if the specified secret does not exist
    if( ! exists ) {
      throw new Error(`The secret with ARN ${_secretArn} does not exist`);
    }
  }
  else {
    // Generate and upload the secrets to secrets manager
    await createOrUpdateSecrets();
  }

  // Check the region
  if( context.REGION != 'us-east-1' ) {

    // Gotta build the lambda code asset manually due to using EdgeLambda instead of NodejsFunction
    const { EDGE_ORIGIN_REQUEST_CODE_FILE, EDGE_VIEWER_RESPONSE_CODE_FILE } = CloudfrontDistribution

    // Build viewer response.
    const originBuildResult = await build({
      entryPoints: ['lib/lambda/FunctionSpOrigin.ts'],
      write: true,
      outfile: EDGE_ORIGIN_REQUEST_CODE_FILE,
      bundle: true,
      platform: 'node',
      external: ['@aws-sdk/*']
    } as BuildOptions);

    // Abort if there were build errors
    (originBuildResult.errors || []).forEach((error) => {
      console.error(`Error building origin request: ${error}`);
      process.exit(1);
    });

    // Build origin request.
    const viewerBuildResult = await build({
      entryPoints: ['lib/lambda/FunctionSpViewer.ts'],
      write: true,
      outfile: EDGE_VIEWER_RESPONSE_CODE_FILE,
      bundle: true,
      platform: 'node'
    } as BuildOptions);

    // Abort if there were build errors
    (viewerBuildResult.errors || []).forEach((error) => {
      console.error(`Error building viewer response: ${error}`);
      process.exit(1);
    });
  }
  
  new CloudfrontDistribution(stack, stackName);
  
})();
