import { EdgeLambda, LambdaEdgeEventType, experimental } from "aws-cdk-lib/aws-cloudfront";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { IContext } from "../context/IContext";
import { Construct } from "constructs";
import path = require("path");
import { CloudfrontDistribution } from "./Distribution";
import { EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME } from "./EdgeFunctionConstants";

export { EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME };

/**
 * Create policy used by lambda@edge origin request function to access secrets manager.
 */
export const getEdgeFunctionSecretsManagerPolicy = ():PolicyStatement => {
  return new PolicyStatement({
    actions: [ 'secretsmanager:GetSecretValue', 'secretsmanager:ListSecrets' ],
    effect: Effect.ALLOW,
    resources: [ '*' ],    
  });      
}

/**
 * Create policy used by lambda@edge origin request function to stream logs to cloudwatch
 */
export const getEdgeFunctionLoggingPolicy = ():PolicyStatement => {
  return new PolicyStatement({
    actions: [ 'logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents' ],
    effect: Effect.ALLOW,
    resources: [ '*' ],    
  });
}

/**
 * Create the Lambda@Edge origin request function using pre-built assets.
 *  
 * @param scope 
 * @param context 
 * @param callback
 * @returns 
 */
export const createEdgeFunctionForOriginRequest = (scope:Construct, context:IContext, callback:(lambda:EdgeLambda) => void) => {
  const { STACK_ID, TAGS: { Landscape} } = context;
  const { EDGE_ORIGIN_REQUEST_ID } = CloudfrontDistribution;

  const isInstalled = __dirname.includes('node_modules');
  const buildPath = isInstalled ? '../../../build' : '../build';
  const edgeFunction = new experimental.EdgeFunction(scope, EDGE_ORIGIN_REQUEST_ID, {
    runtime: Runtime.NODEJS_22_X,
    handler: `${EDGE_ORIGIN_REQUEST_ID}.handler`,
    code: Code.fromAsset(path.resolve(__dirname, buildPath)),
    functionName: `${STACK_ID}-${Landscape}-${EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME}`
  });
  edgeFunction.addToRolePolicy(getEdgeFunctionSecretsManagerPolicy());
  edgeFunction.addToRolePolicy(getEdgeFunctionLoggingPolicy());

  callback({
    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
    functionVersion: edgeFunction.currentVersion,
    includeBody: true
  });
}