import { Construct } from "constructs";
import { IContext } from "../context/IContext";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import path = require("path");
import { EdgeLambda, LambdaEdgeEventType, experimental } from "aws-cdk-lib/aws-cloudfront";
import { CloudfrontDistribution } from "./Distribution";

export const EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME = 'SPFunctionViewerResponse';

/**
 * Create the Lambda@Edge viewer response function using pre-built assets.
 * 
 * @param scope 
 * @param context 
 * @param callback
 * @returns 
 */
export const createEdgeFunctionForViewerResponse = (scope:Construct, context:IContext, callback:(lambda:EdgeLambda) => void) => {
  const { STACK_ID, TAGS: { Landscape } } = context;
  const { EDGE_VIEWER_RESPONSE_ID } = CloudfrontDistribution;
  const isInstalled = __dirname.includes('node_modules');
  const buildPath = isInstalled ? '../../../build' : '../build';
  const edgeFunction = new experimental.EdgeFunction(scope, EDGE_VIEWER_RESPONSE_ID, {
    runtime: Runtime.NODEJS_22_X,
    handler: `${EDGE_VIEWER_RESPONSE_ID}.handler`,
    code: Code.fromAsset(path.resolve(__dirname, buildPath)),
    functionName: `${STACK_ID}-${Landscape}-${EDGE_RESPONSE_VIEWER_FUNCTION_BASENAME}`
  });

  callback({
    eventType: LambdaEdgeEventType.VIEWER_RESPONSE,
    functionVersion: edgeFunction.currentVersion
  });
}