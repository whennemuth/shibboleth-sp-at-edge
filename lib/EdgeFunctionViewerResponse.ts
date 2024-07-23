import { Construct } from "constructs";
import { IContext } from "../context/IContext";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import path = require("path");
import { EdgeLambda, LambdaEdgeEventType, experimental } from "aws-cdk-lib/aws-cloudfront";
import { CloudfrontDistribution } from "./Distribution";


/**
 * Create the Lambda@Edge viewer response function.
 * It can be bundled as normal because the stack is in the correct region.
 */
const createSameRegionEdgeFunction = (stack:Construct, context:IContext):NodejsFunction => {
  const { STACK_ID, TAGS: { Landscape }, EDGE_RESPONSE_VIEWER_FUNCTION_NAME } = context;
  const ftn = new NodejsFunction(stack, 'edge-function-viewer-response', {
    runtime: Runtime.NODEJS_18_X,
    entry: 'lib/lambda/FunctionSpViewer.ts',
    functionName: `${STACK_ID}-${Landscape}-${EDGE_RESPONSE_VIEWER_FUNCTION_NAME}`,
  });
  return ftn;
};

/**
 * Create the Lambda@Edge origin request function.
 * It must be created in us-east-1, which, since this stack is NOT being
 * created in us-east-1, requires the experimental EdgeFunction and a prebundled code asset.
 * SEE: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-edge-function-restrictions.html
 * 
 * @param scope 
 * @param context 
 * @returns 
 */
const createCrossRegionEdgeFunction = (scope:Construct, context:IContext):experimental.EdgeFunction => {
  const { STACK_ID, TAGS: { Landscape }, EDGE_RESPONSE_VIEWER_FUNCTION_NAME } = context;
  const { EDGE_VIEWER_RESPONSE_CODE_FILE:outfile } = CloudfrontDistribution
  const ftn = new experimental.EdgeFunction(scope, 'edge-function-viewer-response', {
    runtime: Runtime.NODEJS_18_X,
    handler: 'index.handler',
    code: Code.fromAsset(path.join(__dirname, `../${path.dirname(outfile)}`)),
    functionName: `${STACK_ID}-${Landscape}-${EDGE_RESPONSE_VIEWER_FUNCTION_NAME}`
  });
  return ftn;
}

export const createEdgeFunctionForViewerResponse = (scope:Construct, context:IContext, callback:(lambda:EdgeLambda) => void) => {
  const { REGION } = context;
  let edgeFunction:NodejsFunction|experimental.EdgeFunction;
  if(REGION == 'us-east-1') {
    edgeFunction = createSameRegionEdgeFunction(scope, context);
  }
  else {
    edgeFunction = createCrossRegionEdgeFunction(scope, context);
  }

  callback({
    eventType: LambdaEdgeEventType.VIEWER_RESPONSE,
    functionVersion: edgeFunction.currentVersion
  });
}