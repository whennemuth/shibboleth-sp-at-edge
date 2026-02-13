import { Construct } from "constructs";
import { IContext } from "../context/IContext";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { EdgeLambda, experimental, LambdaEdgeEventType } from "aws-cdk-lib/aws-cloudfront";
import path = require("path");
import { CloudfrontDistribution } from "./Distribution";
import { EDGE_REQUEST_VIEWER_FUNCTION_BASENAME } from "./EdgeFunctionConstants";
import { getEdgeFunctionLoggingPolicy, getEdgeFunctionSecretsManagerPolicy } from "./EdgeFunctionOriginRequest";

export { EDGE_REQUEST_VIEWER_FUNCTION_BASENAME };

/**
 * Create the Lambda@Edge viewer request function using pre-built assets.
 * 
 * @param scope 
 * @param context
 * @param callback 
 * @returns 
 */
export const createEdgeFunctionForViewerRequest = (scope:Construct, context:IContext, callback:(lambda:EdgeLambda) => void) => {
  const { STACK_ID, TAGS: { Landscape } } = context;
  const { EDGE_VIEWER_REQUEST_ID } = CloudfrontDistribution;
  const isInstalled = __dirname.includes('node_modules');
  const buildPath = isInstalled ? '../../../build' : '../build';
  const edgeFunction = new experimental.EdgeFunction(scope, EDGE_VIEWER_REQUEST_ID, {    
    runtime: Runtime.NODEJS_22_X,
    handler: `${EDGE_VIEWER_REQUEST_ID}.handler`,
    code: Code.fromAsset(path.resolve(__dirname, buildPath)),
    functionName: `${STACK_ID}-${Landscape}-${EDGE_REQUEST_VIEWER_FUNCTION_BASENAME}`
  });
  edgeFunction.addToRolePolicy(getEdgeFunctionSecretsManagerPolicy());
  edgeFunction.addToRolePolicy(getEdgeFunctionLoggingPolicy());

  callback({
    eventType: LambdaEdgeEventType.VIEWER_REQUEST,
    functionVersion: edgeFunction.currentVersion
  });
}