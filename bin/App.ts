#!/usr/bin/env node
import { App, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CustomResourceConfig } from 'aws-cdk-lib/custom-resources';
import { BuildOptions, build } from 'esbuild';
import 'source-map-support/register';
import { CloudFrontCachingStrategy, IContext, OriginAlb, OriginType, SecretFieldNames } from '../context/IContext';
import * as ctx from '../context/context.json';
import { CloudfrontDistribution } from '../lib/Distribution';
import { albExists } from '../lib/OriginAlb';
import { findARecord } from '../lib/Route53';
import { getClone, getStackName, logHeader } from '../lib/Util';
import { SecretsManagerSecret } from '../lib/secrets/Secret';
import { BU_NameTagAspect, TaggingAspect } from '../lib/Tagging';

// Instatiate the app
const app = new App();

// Configure custom resource defaults
CustomResourceConfig.of(app).addRemovalPolicy(RemovalPolicy.DESTROY);
CustomResourceConfig.of(app).addLogRetentionLifetime(RetentionDays.ONE_WEEK);

// Cast the context to the IContext type
const _context = ctx as IContext;

(async () => {

  // Get an object that can be mutated.
  let context = getClone<IContext>(_context);

  const { 
    ACCOUNT:account, REGION:region,
    SHIBBOLETH: { secret: { secretArn } },
    ORIGIN, ORIGIN: { subdomain } = {},
    DNS: { hostedZone } = {},
    TAGS: { Landscape, Function, Service, CostCenter='', Ticket='' }
  } = context;

  const dnsName = (ORIGIN as OriginAlb)?.dnsName;

  const missingAlb = ! (await albExists({ dnsName, region }));
  console.log(`ALB with DNS name ${dnsName} exists: ${!missingAlb}`);

  if( missingAlb && ORIGIN && `${ORIGIN.originType}`.toLowerCase() == OriginType.ALB ) {
    // Use a function URL as an origin. This could mean the ALB is still intended to be used,
    // but the stack in which the ALB is created has not been deployed yet.
    console.warn(`NOTICE: The ALB with DNS name ${dnsName} does not exist in region ${region}. ` +
      `\nSwitching the origin type to Function URL temporarily.`);
    context.ORIGIN!.originType = OriginType.FUNCTION_URL;
    context.CLOUDFRONT_CACHING_STRATEGY = CloudFrontCachingStrategy.NO_CACHE;
  }

  // Find out if an A record for the subdomain already exists AND was not created by this stack.
  let ignoreRoute53:boolean = false;
  if( subdomain && hostedZone ) {
    const record = await findARecord(hostedZone, subdomain, region);
    if(record.recordSet && ! record.createdByThisStack) {
      ignoreRoute53 = true;
    }
  }

  app.node.setContext('stack-parms', context);

  const stackName = getStackName(_context);

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
  
  // Make sure the secret arn is included in the context and that the secret exists.
  if( secretArn ) {
    // Make sure it exists.
    const exists = await new SecretsManagerSecret({ 
      secretName: secretArn, fldNames: {} as SecretFieldNames, region 
    }).exists();

    // Abort if the specified secret does not exist
    if( ! exists ) {
      logHeader('VALIDATION ERROR!!!')
      console.error(`The secret ${secretArn} does not exist. ` +
        `\nYou can create it by populating the ./.env file as directed in the README and running: ` +
        `\nnpm run create-secrets`);
      process.exit(1);
    }
  }
  else {
    logHeader('VALIDATION ERROR!!!')
    console.error(`SHIBBOLETH.secret.secretArn must be defined in ./context/context.json. ` +
      `\nIf this is because the secret does not exist in secrets manager yet, you can create it by populating ` +
      `\nthe ./.env file as directed in the README and running ` +
      `\nnpm run create-secrets`);
    process.exit(1);
  }

  // Check the region
  if( context.REGION != 'us-east-1' ) {

    // Gotta build the lambda code asset manually due to using EdgeLambda instead of NodejsFunction
    const { 
      EDGE_VIEWER_REQUEST_CODE_FILE,
      EDGE_ORIGIN_REQUEST_CODE_FILE, 
      EDGE_VIEWER_RESPONSE_CODE_FILE 
    } = CloudfrontDistribution

    // Build viewer request.
    const viewerRequestBuildResult = await build({
      entryPoints: ['lib/lambda/FunctionSpViewerRequest.ts'],
      write: true,
      outfile: EDGE_VIEWER_REQUEST_CODE_FILE,
      bundle: true,
      platform: 'node'
    } as BuildOptions);

    // Abort if there were build errors
    (viewerRequestBuildResult.errors || []).forEach((error) => {
      console.error(`Error building viewer request: ${error}`);
      process.exit(1);
    });

    // Build viewer response.
    const originRequestBuildResult = await build({
      entryPoints: ['lib/lambda/FunctionSpOriginRequest.ts'],
      write: true,
      outfile: EDGE_ORIGIN_REQUEST_CODE_FILE,
      bundle: true,
      platform: 'node',
      external: ['@aws-sdk/*']
    } as BuildOptions);

    // Abort if there were build errors
    (originRequestBuildResult.errors || []).forEach((error) => {
      console.error(`Error building origin request: ${error}`);
      process.exit(1);
    });

    // Build origin request.
    const viewerResponseBuildResult = await build({
      entryPoints: ['lib/lambda/FunctionSpViewerResponse.ts'],
      write: true,
      outfile: EDGE_VIEWER_RESPONSE_CODE_FILE,
      bundle: true,
      platform: 'node'
    } as BuildOptions);

    // Abort if there were build errors
    (viewerResponseBuildResult.errors || []).forEach((error) => {
      console.error(`Error building viewer response: ${error}`);
      process.exit(1);
    });
  }
  
  new CloudfrontDistribution(stack, stackName);
  
  // Apply standard tags to all resources in each stack
  // SEE: https://github.com/bu-ist/buaws-istcloud-information/blob/main/aws-tagging-standard.md#costcenter
  // NOTE: The CostCenter value is "AWS Word Press Migration to AWS", not "AWS WordPress Migration to AWS"
  const standardTags = { 
    Service, 
    Function, 
    Landscape, 
    CostCenter, 
    Ticket 
  };
  new TaggingAspect(stack, standardTags).applyTags({ 
    aspect: new BU_NameTagAspect(standardTags) 
  });

})();
