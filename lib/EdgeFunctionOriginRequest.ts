import { EdgeLambda, LambdaEdgeEventType, experimental } from "aws-cdk-lib/aws-cloudfront";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { IContext } from "../context/IContext";
import { Construct } from "constructs";
import path = require("path");
import { CloudfrontDistribution } from "./Distribution";

/**
 * Create policy used by lambda@edge origin request function to access secrets manager.
 */
const getEdgeFunctionSecretsManagerPolicy = ():PolicyStatement => {
  return new PolicyStatement({
    actions: [ 'secretsmanager:GetSecretValue', 'secretsmanager:ListSecrets' ],
    effect: Effect.ALLOW,
    resources: [ '*' ],    
  });      
}

/**
 * Create policy used by lambda@edge origin request function to stream logs to cloudwatch
 */
const getEdgeFunctionLoggingPolicy = ():PolicyStatement => {
  return new PolicyStatement({
    actions: [ 'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents' ],
    effect: Effect.ALLOW,
    resources: [ '*' ],    
  });
}

/**
 * Create the Lambda@Edge origin request function.
 * It can be bundled as normal because the stack is in the correct region.
 */
const createSameRegionEdgeFunction = (stack:Construct, context:IContext):NodejsFunction => {
  const { STACK_ID, TAGS: { Landscape}, EDGE_REQUEST_ORIGIN_FUNCTION_NAME } = context;
  const ftn = new NodejsFunction(stack, 'edge-function-origin-request', {
    runtime: Runtime.NODEJS_18_X,
    entry: 'lib/lambda/FunctionSpOrigin.ts',
    functionName: `${STACK_ID}-${Landscape}-${EDGE_REQUEST_ORIGIN_FUNCTION_NAME}`,
    bundling: {
      externalModules: [ '@aws-sdk/*' ],
    }
  });
  ftn.addToRolePolicy(getEdgeFunctionSecretsManagerPolicy());
  ftn.addToRolePolicy(getEdgeFunctionLoggingPolicy());
  return ftn;
};

/**
 * Create the Lambda@Edge origin request function.
 * It must be created in us-east-1, which, since this stack is NOT being
 * created in us-east-1, requires the experimental EdgeFunction and a prebundled code asset.
 * SEE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html
 *  
 * NOTE: If target origins are ALBs that exist in regions other than us-east-1, but this stack is to 
 * nonetheless to be deployed in us-east-1, the requests incoming to the ALB will not match the prefix list 
 * "com.amazonaws.global.cloudfront.origin-facing" for the region the ALB is in. This is because such prefix
 * lists are region-specific and not global. If this problem is solved and the ALB can be assigned a security
 * group that allows ingress from a cloudfront distribution (the one created by this stack) that is in a 
 * different region, then this use of the experimental edge function can be removed and this stack can be 
 * created in us-east-1 regardless of the target ALB origin region. 
 * 
 * @param scope 
 * @param context 
 * @returns 
 */
const createCrossRegionEdgeFunction = (scope:Construct, context:IContext):experimental.EdgeFunction => {
  const { STACK_ID, TAGS: { Landscape}, EDGE_REQUEST_ORIGIN_FUNCTION_NAME } = context;
  const { EDGE_ORIGIN_REQUEST_CODE_FILE:outfile } = CloudfrontDistribution
  const ftn = new experimental.EdgeFunction(scope, 'edge-function-origin-request', {
    runtime: Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code: Code.fromAsset(path.join(__dirname, `../${path.dirname(outfile)}`)),
    functionName: `${STACK_ID}-${Landscape}-${EDGE_REQUEST_ORIGIN_FUNCTION_NAME}`
  });
  ftn.addToRolePolicy(getEdgeFunctionSecretsManagerPolicy());
  ftn.addToRolePolicy(getEdgeFunctionLoggingPolicy());
  return ftn;
}

export const createEdgeFunctionForOriginRequest = (scope:Construct, context:IContext, callback:(lambda:EdgeLambda) => void) => {
  const { REGION } = context;
  let edgeFunction:NodejsFunction|experimental.EdgeFunction;
  if(REGION == 'us-east-1') {
    edgeFunction = createSameRegionEdgeFunction(scope, context);
  }
  else {
    edgeFunction = createCrossRegionEdgeFunction(scope, context);
  }

  callback({
    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
    functionVersion: edgeFunction.currentVersion,
    includeBody: true
  });
}