#!/usr/bin/env node
import { App, Stack } from 'aws-cdk-lib';
import { BuildOptions, BuildResult, build } from 'esbuild';
import 'source-map-support/register';
import { IContext } from '../context/IContext';
import * as ctx from '../context/context.json';
import { CloudfrontDistribution } from '../lib/Distribution';

const app = new App();
const context = ctx as IContext;
app.node.setContext('stack-parms', context);
const { ACCOUNT:account, REGION:region, STACK_ID, TAGS: { Landscape, Function, Service }} = context;
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

if( context.REGION != 'us-east-1' ) {
  // Gotta build the lambda code asset manually due to using EdgeLambda instead of NodejsFunction
  const { EDGE_ORIGIN_REQUEST_CODE_FILE, EDGE_VIEWER_RESPONSE_CODE_FILE } = CloudfrontDistribution
  build({
    entryPoints: ['lib/lambda/FunctionSpOrigin.ts'],
    write: true,
    outfile: EDGE_ORIGIN_REQUEST_CODE_FILE,
    bundle: true,
    platform: 'node',
    external: ['@aws-sdk/*']
  } as BuildOptions)
  .then((result:BuildResult) => {
    return build({
      entryPoints: ['lib/lambda/FunctionSpViewer.ts'],
      write: true,
      outfile: EDGE_VIEWER_RESPONSE_CODE_FILE,
      bundle: true,
      platform: 'node'
    } as BuildOptions);
  })
  .then((result:BuildResult) => {
    new CloudfrontDistribution(stack, stackName);
  })
  .catch((reason) => {
    console.log(JSON.stringify(reason, Object.getOwnPropertyNames(reason), 2));
  });
}
else {
  new CloudfrontDistribution(stack, stackName);
}
