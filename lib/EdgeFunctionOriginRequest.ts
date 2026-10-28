import { EdgeLambda, LambdaEdgeEventType, experimental } from "aws-cdk-lib/aws-cloudfront";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { IContext } from "../context/IContext";
import { Construct } from "constructs";
import { CloudfrontDistribution } from "./Distribution";
import { EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME } from "./EdgeFunctionConstants";
import { stageEdgeFunctionAsset } from "./EdgeContext";

export { EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME };

/**
 * Create policy used by lambda@edge origin request function to access secrets manager, scoped to
 * the one secret this deployment is configured to read. Secrets Manager appends a random 6-char
 * suffix to a secret's real ARN, so a "partial" ARN (without that suffix) gets a wildcard added.
 */
export const getEdgeFunctionSecretsManagerPolicy = (secretArn: string): PolicyStatement => {
  const hasRandomSuffix = /-[A-Za-z0-9]{6}$/.test(secretArn);
  const resource = hasRandomSuffix ? secretArn : `${secretArn}-??????`;
  return new PolicyStatement({
    actions: [ 'secretsmanager:GetSecretValue' ],
    effect: Effect.ALLOW,
    resources: [ resource ],    
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

  const edgeFunction = new experimental.EdgeFunction(scope, EDGE_ORIGIN_REQUEST_ID, {
    runtime: Runtime.NODEJS_22_X,
    handler: `${EDGE_ORIGIN_REQUEST_ID}.handler`,
    code: Code.fromAsset(stageEdgeFunctionAsset(context, `${EDGE_ORIGIN_REQUEST_ID}.js`)),
    functionName: `${STACK_ID}-${Landscape}-${EDGE_REQUEST_ORIGIN_FUNCTION_BASENAME}`
  });
  edgeFunction.addToRolePolicy(getEdgeFunctionSecretsManagerPolicy(context.SHIBBOLETH.secret.secretArn));
  edgeFunction.addToRolePolicy(getEdgeFunctionLoggingPolicy());

  callback({
    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
    functionVersion: edgeFunction.currentVersion,
    includeBody: true
  });
}